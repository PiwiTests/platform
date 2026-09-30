import { describe, expect, test } from 'vitest';
import {
  MAX_FILE_BYTES,
  MIN_TENSOR_BYTES,
  dataFileName,
  readVarint,
  splitWeights,
  writeVarint,
} from '../../../docs/.vitepress/theme/ask-docs/split-weights';

// A minimal encoder and decoder of Protocol Buffers messages, enough to build an ONNX model and read the result.

const join = (parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const varint = (value: number) => Uint8Array.from(writeVarint(value));
const text = (value: string) => new TextEncoder().encode(value);
const bytesField = (number: number, payload: Uint8Array) =>
  join([varint(number * 8 + 2), varint(payload.length), payload]);
const numberField = (number: number, value: number) => join([varint(number * 8), varint(value)]);

interface Field {
  number: number;
  wire: number;
  /** The whole field, tag included. */
  raw: Uint8Array;
  /** The payload of a length-delimited field, the number of a varint one. */
  payload: Uint8Array;
  value: number;
}

function parse(bytes: Uint8Array): Field[] {
  const fields: Field[] = [];
  let at = 0;
  while (at < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, at);
    const wire = tag % 8;
    let end: number;
    let payload = new Uint8Array(0);
    let value = 0;
    if (wire === 0) {
      [value, end] = readVarint(bytes, afterTag);
    } else {
      const [length, afterLength] = readVarint(bytes, afterTag);
      payload = bytes.subarray(afterLength, afterLength + length);
      end = afterLength + length;
    }
    fields.push({ number: Math.floor(tag / 8), wire, raw: bytes.subarray(at, end), payload, value });
    at = end;
  }
  return fields;
}

const GRAPH = 7;
const INITIALIZER = 5;

/** A `TensorProto`: dims, data type, name, then the weights. `after` are fields written after them. */
function tensor(
  name: string,
  raw: Uint8Array | null,
  { after = [] as Uint8Array[], before = [] as Uint8Array[] } = {},
) {
  return join([
    numberField(1, 4),
    numberField(2, 1),
    bytesField(8, text(name)),
    ...before,
    ...(raw ? [bytesField(9, raw)] : []),
    ...after,
  ]);
}

const weights = (size: number, seed: number) =>
  Uint8Array.from({ length: size }, (_unused, i) => (i * 13 + seed) % 256);
const node = (name: string) => bytesField(1, text(`node ${name}`));

function model(graphFields: Uint8Array[]) {
  return join([
    numberField(1, 8),
    bytesField(2, text('test')),
    bytesField(GRAPH, join(graphFields)),
    bytesField(8, text('opset')),
  ]);
}

const split = (bytes: Uint8Array, maxFileBytes?: number) =>
  splitWeights(new Blob([bytes as BlobPart]), 'model.onnx_data', maxFileBytes);
const initializers = (graph: Uint8Array) =>
  parse(parse(graph).find((field) => field.number === GRAPH)!.payload)
    .filter((field) => field.number === INITIALIZER)
    .map((field) => parse(field.payload));
const entries = (tensorFields: Field[]) =>
  Object.fromEntries(
    tensorFields
      .filter((field) => field.number === 13)
      .map((field) => {
        const [key, value] = parse(field.payload);
        return [new TextDecoder().decode(key!.payload), new TextDecoder().decode(value!.payload)];
      }),
  );

describe('varints', () => {
  test('round trip, past 2^31 where bit shifts would overflow', () => {
    for (const value of [0, 1, 127, 128, 300, 2 ** 31 - 1, 2 ** 31, 2 ** 32 + 5, 1_426_069_098, 2 ** 40 + 7]) {
      const bytes = Uint8Array.from(writeVarint(value));
      expect(readVarint(bytes, 0)).toEqual([value, bytes.length]);
    }
  });

  test('a number that does not end is an error', () => {
    expect(() => readVarint(Uint8Array.from([0x80, 0x80]), 0)).toThrow('cut short');
  });
});

describe('splitWeights', () => {
  const first = weights(2000, 1);
  const second = weights(1500, 2);
  const small = weights(MIN_TENSOR_BYTES - 1, 3);
  const file = model([
    node('a'),
    bytesField(INITIALIZER, tensor('first', first)),
    bytesField(INITIALIZER, tensor('small', small)),
    node('b'),
    bytesField(INITIALIZER, tensor('second', second)),
    bytesField(11, text('input x')),
  ]);

  test('moves the weights of large tensors to the data file and points the tensors at it', async () => {
    const result = (await split(file))!;
    expect(result.tensors).toBe(2);
    const [one, , two] = initializers(result.graph);

    // The data file holds the weights one after the other, each at a multiple of 8.
    expect(result.files).toHaveLength(1);
    const data = new Uint8Array(await result.files[0]!.arrayBuffer());
    expect(entries(one!)).toEqual({ location: 'model.onnx_data', offset: '0', length: '2000' });
    expect(entries(two!)).toEqual({ location: 'model.onnx_data', offset: '2000', length: '1500' });
    expect(data.slice(0, 2000)).toEqual(first);
    expect(data.slice(2000, 3500)).toEqual(second);
    expect(data.length).toBe(3500);

    // The tensors no longer carry the weights, and say they are external.
    for (const fields of [one!, two!]) {
      expect(fields.some((field) => field.number === 9)).toBe(false);
      expect(fields.find((field) => field.number === 14)!.value).toBe(1);
    }
    expect(result.graph.length).toBeLessThan(file.length - 3000);
  });

  test('pads each tensor to a multiple of 8 bytes', async () => {
    const odd = weights(MIN_TENSOR_BYTES + 3, 4);
    const result = (await split(
      model([bytesField(INITIALIZER, tensor('odd', odd)), bytesField(INITIALIZER, tensor('next', first))]),
    ))!;
    const [one, two] = initializers(result.graph);
    expect(entries(one!).offset).toBe('0');
    expect(entries(two!).offset).toBe(String(Math.ceil((MIN_TENSOR_BYTES + 3) / 8) * 8));
    const data = new Uint8Array(await result.files[0]!.arrayBuffer());
    const at = Number(entries(two!).offset);
    expect(data.slice(at, at + first.length)).toEqual(first);
  });

  test('keeps the rest of the model byte for byte, in its order', async () => {
    const result = (await split(file))!;
    const before = parse(file).map((field) => field.number);
    const after = parse(result.graph).map((field) => field.number);
    expect(after).toEqual(before);
    const fieldsOf = (bytes: Uint8Array) => parse(parse(bytes).find((field) => field.number === GRAPH)!.payload);
    const kept = (bytes: Uint8Array) =>
      fieldsOf(bytes)
        .filter((field) => field.number !== INITIALIZER)
        .map((field) => [...field.raw]);
    expect(kept(result.graph)).toEqual(kept(file));
    // The tensor below the threshold is untouched.
    expect(fieldsOf(result.graph)[2]!.raw).toEqual(fieldsOf(file)[2]!.raw);
    expect(parse(result.graph)[0]!.raw).toEqual(parse(file)[0]!.raw);
    expect(parse(result.graph).at(-1)!.raw).toEqual(parse(file).at(-1)!.raw);
  });

  test('moves the weights of a tensor that writes them before its name', async () => {
    const odd = join([numberField(1, 4), bytesField(9, first), bytesField(8, text('late name'))]);
    const result = (await split(model([bytesField(INITIALIZER, odd)])))!;
    const [fields] = initializers(result.graph);
    expect(entries(fields!)).toMatchObject({ offset: '0', length: String(first.length) });
    expect(new TextDecoder().decode(fields!.find((field) => field.number === 8)!.payload)).toBe('late name');
  });

  test('replaces a data location written as DEFAULT, and leaves a tensor that is external already', async () => {
    const explicitDefault = tensor('default', first, { after: [numberField(14, 0)] });
    const external = tensor('external', null, {
      after: [
        bytesField(13, join([bytesField(1, text('location')), bytesField(2, text('other.bin'))])),
        numberField(14, 1),
      ],
    });
    const result = (await split(model([bytesField(INITIALIZER, explicitDefault), bytesField(INITIALIZER, external)])))!;
    const [one, two] = initializers(result.graph);
    expect(result.tensors).toBe(1);
    expect(one!.filter((field) => field.number === 14).map((field) => field.value)).toEqual([1]);
    expect(entries(one!).location).toBe('model.onnx_data');
    expect(two!.map((field) => [...field.raw])).toEqual(parse(external).map((field) => [...field.raw]));
  });

  test('leaves a large external tensor alone even when it also has raw data', async () => {
    const both = tensor('both', first, { after: [numberField(14, 1)] });
    expect(await split(model([bytesField(INITIALIZER, both)]))).toBeNull();
  });

  test('leaves a tensor that keeps its values in another field', async () => {
    const floats = join([numberField(1, 4), bytesField(4, weights(4000, 5)), bytesField(8, text('floats'))]);
    expect(await split(model([bytesField(INITIALIZER, floats)]))).toBeNull();
  });

  test('returns null when no tensor is large enough', async () => {
    expect(await split(model([node('a'), bytesField(INITIALIZER, tensor('small', small))]))).toBeNull();
  });

  test('reads a graph larger than the window it reads through', async () => {
    const many = Array.from({ length: 120 }, (_unused, i) =>
      bytesField(INITIALIZER, tensor(`tensor ${i}`, weights(2048 + i, i))),
    );
    const big = model([...Array.from({ length: 3000 }, (_unused, i) => node(String(i))), ...many]);
    expect(big.length).toBeGreaterThan(2 * 64 * 1024);
    const result = (await split(big))!;
    expect(result.tensors).toBe(120);
    const data = new Uint8Array(await result.files[0]!.arrayBuffer());
    initializers(result.graph).forEach((fields, i) => {
      const { offset, length } = entries(fields);
      expect(Number(length)).toBe(2048 + i);
      expect(data.slice(Number(offset), Number(offset) + Number(length))).toEqual(weights(2048 + i, i));
    });
  });

  test('starts another data file, named as transformers.js looks for it, when one would pass the limit', async () => {
    const tensors = [1500, 1500, 1500, 3000, 1200].map((size, i) => weights(size, 10 + i));
    const file = model(tensors.map((raw, i) => bytesField(INITIALIZER, tensor(`t${i}`, raw))));
    const result = (await split(file, 4000))!;
    expect(result.tensors).toBe(5);
    // The second tensor fits beside the first (after 4 bytes of padding); the third does not, and neither do the next ones.
    expect(result.files.map((part) => part.size)).toEqual([3004, 1500, 3000, 1200]);
    const contents = await Promise.all(result.files.map(async (part) => new Uint8Array(await part.arrayBuffer())));
    const names = [0, 1, 2, 3].map((index) => dataFileName('model.onnx_data', index));
    expect(names).toEqual(['model.onnx_data', 'model.onnx_data_1', 'model.onnx_data_2', 'model.onnx_data_3']);
    const locations = initializers(result.graph).map((fields) => entries(fields));
    expect(locations.map(({ location }) => location)).toEqual([names[0], names[0], names[1], names[2], names[3]]);
    locations.forEach(({ location, offset, length }, i) => {
      const data = contents[names.indexOf(location!)]!;
      expect(data.slice(Number(offset), Number(offset) + Number(length))).toEqual(tensors[i]);
    });
  });

  test('puts a tensor larger than the limit in a file of its own', async () => {
    const result = (await split(
      model([bytesField(INITIALIZER, tensor('big', weights(5000, 1))), bytesField(INITIALIZER, tensor('next', first))]),
      4000,
    ))!;
    expect(result.files.map((part) => part.size)).toEqual([5000, first.length]);
  });

  test('keeps files under 2 GB, which a browser cannot hold in one buffer', () => {
    expect(MAX_FILE_BYTES).toBeLessThan(2 * 1024 ** 3);
  });

  test('rejects a file that is cut short', async () => {
    await expect(split(file.slice(0, file.length - 40))).rejects.toThrow('cut short');
  });
});
