/**
 * Moves the weights of an ONNX model out of its `.onnx` file into a data file
 * of their own, the "external data" format of ONNX.
 *
 * Why: onnxruntime-web copies a whole `.onnx` file into the memory of its
 * WebAssembly module, which a browser caps at 4 GB, then parses it into a
 * second copy. A 1.4 GB model needs more than 2.8 GB there and fails with
 * `std::bad_alloc`. The data of an external file stays in a JavaScript buffer,
 * and onnxruntime-web reads it one tensor at a time, so only the small graph is
 * copied. Hugging Face ships its larger models in that format already; this
 * does the same to a model exported as a single file.
 *
 * A browser cannot hold a JavaScript buffer of 2 GB, and transformers.js reads
 * each data file into one, so the weights go to several files of at most
 * `MAX_FILE_BYTES`, named as transformers.js looks for them.
 *
 * The file is a Protocol Buffers message. The walk below reads field headers
 * only and never the weights themselves: the data files are built from slices
 * of the source Blob, which the browser does not copy.
 *
 * ```
 * ModelProto     graph = 7
 * GraphProto     initializer = 5 (the tensors that hold the weights)
 * TensorProto    raw_data = 9, external_data = 13, data_location = 14
 * ```
 */

/** Tensors smaller than this stay in the graph, as `onnx.external_data_helper` does. */
export const MIN_TENSOR_BYTES = 1024
/** Each data file holds at most this many bytes, except when a single tensor is larger. */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024
/** Each tensor starts at a multiple of this many bytes in its data file. */
const ALIGNMENT = 8
/** Bytes read at a time while walking the file. */
const WINDOW = 64 * 1024

const VARINT = 0
const FIXED64 = 1
const LENGTH_DELIMITED = 2
const FIXED32 = 5

const GRAPH = 7
const INITIALIZER = 5
const RAW_DATA = 9
const EXTERNAL_DATA = 13
const DATA_LOCATION = 14
const EXTERNAL = 1

/** Bytes of `value` as a Protocol Buffers varint. Arithmetic rather than bit shifts: a length can pass 2^31. */
export function writeVarint(value: number): number[] {
  const bytes: number[] = []
  while (value >= 128) {
    bytes.push((value % 128) | 128)
    value = Math.floor(value / 128)
  }
  bytes.push(value)
  return bytes
}

/** The varint at `at`, and the position after it. */
export function readVarint(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0
  let scale = 1
  for (let i = at; i < bytes.length && i < at + 10; i++) {
    const byte = bytes[i]!
    value += (byte & 127) * scale
    if (byte < 128) return [value, i + 1]
    scale *= 128
  }
  throw new Error('the model file is cut short: a number does not end')
}

/** A Blob read through a window, so walking thousands of small fields does not make thousands of reads. */
class Source {
  private start = 0
  private window = new Uint8Array(0)

  constructor(private readonly blob: Blob) {}

  get size(): number {
    return this.blob.size
  }

  /** A view of the bytes from `start` to `end`: valid until this is called again for a range outside the window. */
  async bytes(start: number, end: number): Promise<Uint8Array> {
    if (end > this.blob.size) throw new Error('the model file is cut short')
    if (start < this.start || end > this.start + this.window.length) {
      const readEnd = Math.min(this.blob.size, Math.max(end, start + WINDOW))
      this.window = new Uint8Array(await this.blob.slice(start, readEnd).arrayBuffer())
      this.start = start
    }
    return this.window.subarray(start - this.start, end - this.start)
  }

  /** A copy of the bytes, which stays valid whatever is read next. */
  async copy(start: number, end: number): Promise<Uint8Array> {
    return (await this.bytes(start, end)).slice()
  }
}

interface Field {
  number: number
  /** Where the field starts, at its tag. */
  from: number
  /** Where its payload starts: after the tag, and after the length when it has one. */
  at: number
  /** Where the field ends. */
  to: number
  wire: number
}

/** The fields of the message that spans `start` to `end`, in order. */
async function* fields(source: Source, start: number, end: number): AsyncGenerator<Field> {
  let position = start
  while (position < end) {
    const header = await source.bytes(position, Math.min(position + 20, end))
    const [tag, afterTag] = readVarint(header, 0)
    const wire = tag % 8
    const number = Math.floor(tag / 8)
    let at = position + afterTag
    let to: number
    if (wire === VARINT) {
      to = position + readVarint(header, afterTag)[1]
    } else if (wire === LENGTH_DELIMITED) {
      const [length, afterLength] = readVarint(header, afterTag)
      at = position + afterLength
      to = at + length
    } else if (wire === FIXED64) {
      to = at + 8
    } else if (wire === FIXED32) {
      to = at + 4
    } else {
      throw new Error(`unsupported field type ${wire} in the model file`)
    }
    if (to > end) throw new Error('the model file is cut short: a field runs past its message')
    yield { number, from: position, at, to, wire }
    position = to
  }
}

const text = new TextEncoder()

function concat(parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.length
  }
  return joined
}

function lengthDelimited(number: number, payload: Uint8Array): Uint8Array {
  return concat([Uint8Array.from(writeVarint(number * 8 + LENGTH_DELIMITED)), Uint8Array.from(writeVarint(payload.length)), payload])
}

/** A `StringStringEntryProto` of a tensor's `external_data`. */
function externalEntry(key: string, value: string): Uint8Array {
  return lengthDelimited(EXTERNAL_DATA, concat([lengthDelimited(1, text.encode(key)), lengthDelimited(2, text.encode(value))]))
}

/** Reads the ranges of the source that a message keeps, and joins them: a run of neighbouring fields is one read. */
class Copier {
  private from = -1
  private to = -1
  readonly parts: Uint8Array[] = []
  length = 0

  constructor(private readonly source: Source) {}

  /** Keep the bytes from `from` to `to`; adjacent ranges are joined. */
  async keep(from: number, to: number): Promise<void> {
    if (from !== this.to) await this.flush()
    if (this.from === -1) this.from = from
    this.to = to
  }

  add(part: Uint8Array): void {
    this.parts.push(part)
    this.length += part.length
  }

  async flush(): Promise<void> {
    if (this.from === -1) return
    this.add(await this.source.copy(this.from, this.to))
    this.from = -1
    this.to = -1
  }
}

/** The name of data file number `index`, as transformers.js looks for it: `model.onnx_data`, `model.onnx_data_1`, `model.onnx_data_2`... */
export function dataFileName(first: string, index: number): string {
  return index === 0 ? first : `${first}_${index}`
}

export interface SplitModel {
  /** The model without its weights: each tensor names the data file it reads its weights from. */
  graph: Uint8Array
  /** The data files, in order; `files[i]` is named `dataFileName(first, i)`. Each holds the weights of the tensors that were moved, one after the other. */
  files: Blob[]
  /** How many tensors were moved. */
  tensors: number
}

/**
 * The model split into a graph and data files of at most `maxFileBytes`, or
 * null when no tensor is large enough to move. `first` is the name of the first
 * data file, which the graph refers to; the next ones follow `dataFileName`.
 */
export async function splitWeights(model: Blob, first: string, maxFileBytes = MAX_FILE_BYTES): Promise<SplitModel | null> {
  const source = new Source(model)
  /** What each data file holds so far, and its size. */
  const files: Array<{ parts: BlobPart[]; size: number }> = [{ parts: [], size: 0 }]
  let tensors = 0

  /** Move the weights of one `initializer` to the data file: its new bytes, or null to leave it as it is. */
  async function moved(tensor: Field): Promise<Uint8Array | null> {
    const copier = new Copier(source)
    let raw: Field | null = null
    for await (const field of fields(source, tensor.at, tensor.to)) {
      if (field.number === RAW_DATA && field.wire === LENGTH_DELIMITED) raw = field
      else if (field.number === EXTERNAL_DATA) return null
      else if (field.number === DATA_LOCATION) {
        // Some tools write `DEFAULT` (0) explicitly: it is replaced below. `EXTERNAL` means the weights are in a file already.
        if (readVarint(await source.bytes(field.at, field.to), 0)[0] === EXTERNAL) return null
      } else await copier.keep(field.from, field.to)
    }
    if (!raw || raw.to - raw.at < MIN_TENSOR_BYTES) return null
    await copier.flush()

    const length = raw.to - raw.at
    let file = files.at(-1)!
    if (file.size > 0 && file.size + ALIGNMENT + length > maxFileBytes) files.push((file = { parts: [], size: 0 }))
    const padding = (ALIGNMENT - (file.size % ALIGNMENT)) % ALIGNMENT
    if (padding) file.parts.push(new Uint8Array(padding))
    const offset = file.size + padding
    const entries = [
      externalEntry('location', dataFileName(first, files.length - 1)),
      externalEntry('offset', String(offset)),
      externalEntry('length', String(length)),
      Uint8Array.from([...writeVarint(DATA_LOCATION * 8 + VARINT), EXTERNAL]),
    ]
    file.parts.push(model.slice(raw.at, raw.to))
    file.size = offset + length
    tensors++
    return concat([...copier.parts, ...entries])
  }

  const out: Uint8Array[] = []
  const top = new Copier(source)
  for await (const field of fields(source, 0, source.size)) {
    if (field.number !== GRAPH || field.wire !== LENGTH_DELIMITED) {
      await top.keep(field.from, field.to)
      continue
    }
    await top.flush()
    out.push(...top.parts.splice(0))

    const graph = new Copier(source)
    for await (const child of fields(source, field.at, field.to)) {
      const tensor = child.number === INITIALIZER && child.wire === LENGTH_DELIMITED ? await moved(child) : null
      if (tensor) {
        await graph.flush()
        graph.add(lengthDelimited(INITIALIZER, tensor))
      } else {
        await graph.keep(child.from, child.to)
      }
    }
    await graph.flush()
    out.push(Uint8Array.from(writeVarint(GRAPH * 8 + LENGTH_DELIMITED)), Uint8Array.from(writeVarint(graph.length)), ...graph.parts)
  }
  await top.flush()
  out.push(...top.parts)

  if (!tensors) return null
  return { graph: concat(out), files: files.map((file) => new Blob(file.parts)), tensors }
}
