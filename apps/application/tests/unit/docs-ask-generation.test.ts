import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  GENERATION_CACHE,
  GENERATION_MODELS,
  explainError,
} from '../../../docs/.vitepress/theme/ask-docs/generation-models';
import type { GenerationMessage, GenerationRequest, Source } from '../../../docs/.vitepress/theme/ask-docs/protocol';
import { useGeneration } from '../../../docs/.vitepress/theme/ask-docs/useGeneration';

/** A worker that records what the panel sends and lets the test answer as the real one would. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  sent: GenerationRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<GenerationMessage>) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: GenerationRequest) {
    this.sent.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: GenerationMessage) {
    this.onmessage?.({ data: message } as MessageEvent<GenerationMessage>);
  }
}

const storage = new Map<string, string>();
const deleted: string[] = [];

const sources: Source[] = [
  {
    page: 'operate/database',
    anchor: 'postgresql',
    title: 'Database',
    headings: ['PostgreSQL'],
    excerpt: '',
    markdown: 'Set `PIWI_DATABASE_URL` and Piwi uses PostgreSQL.',
  },
  { page: 'guide/ci', anchor: '', title: 'CI', headings: [], excerpt: '', markdown: 'Shards merge into one run.' },
];
const hrefOf = ({ page }: Source) => `/${page}`;

beforeEach(() => {
  FakeWorker.instances = [];
  storage.clear();
  deleted.length = 0;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal('caches', { delete: async (name: string) => void deleted.push(name) });
});

afterEach(() => vi.unstubAllGlobals());

const worker = () => FakeWorker.instances[0]!;
const model = GENERATION_MODELS[0]!;

describe('useGeneration', () => {
  test('asks the reader before it downloads anything', () => {
    const generation = useGeneration(hrefOf);
    generation.write('can I use PostgreSQL?', sources);
    expect(generation.phase.value).toBe('probing');
    expect(worker().sent).toEqual([{ type: 'probe', model: model.id, files: model.files }]);

    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: false });
    expect(generation.phase.value).toBe('asking');
    expect(generation.size.value).toBe(model.bytes.q4f16);
    expect(worker().sent.some((request) => request.type === 'load')).toBe(false);
  });

  test('a browser without a usable GPU is told so and downloads nothing', () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: false, dtype: 'q4', cached: false });
    expect(generation.phase.value).toBe('unsupported');
    expect(worker().sent.some((request) => request.type === 'load')).toBe(false);
    generation.reset();
    expect(generation.phase.value).toBe('off');
  });

  test('the size to download follows the precision this device runs', () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4', cached: false });
    expect(generation.size.value).toBe(model.bytes.q4);
  });

  test('after agreement it downloads, then writes from the best passages', () => {
    const generation = useGeneration(hrefOf);
    generation.write('can I use PostgreSQL?', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: false });
    generation.accept();
    expect(generation.phase.value).toBe('downloading');
    expect(storage.get('ask-docs:generation')).toBe(model.id);
    expect(worker().sent.at(-1)).toEqual({ type: 'load' });

    worker().reply({ type: 'progress', loaded: 100, total: 570 });
    expect(generation.progress.value).toEqual({ loaded: 100, total: 570 });

    worker().reply({ type: 'ready' });
    expect(generation.phase.value).toBe('writing');
    const write = worker().sent.at(-1) as Extract<GenerationRequest, { type: 'write' }>;
    expect(write.type).toBe('write');
    expect(write.messages[1]!.content).toContain('[1] Database > PostgreSQL');
    expect(write.messages[1]!.content).toContain('Question: can I use PostgreSQL?');
  });

  test('starts with the model the reader agreed to last time, not the first of the catalog', () => {
    const other = GENERATION_MODELS[1]!;
    storage.set('ask-docs:generation', other.id);
    const generation = useGeneration(hrefOf);
    expect(generation.model.value.id).toBe(other.id);
    generation.write('a question', sources);
    expect(worker().sent).toEqual([{ type: 'probe', model: other.id, files: other.files }]);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: false });
    expect(generation.phase.value).toBe('downloading');
  });

  test('ignores a remembered model that is no longer in the catalog', () => {
    storage.set('ask-docs:generation', 'someone/retired-model');
    expect(useGeneration(hrefOf).model.value.id).toBe(model.id);
  });

  test('a model already in this browser loads without a question', () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    expect(generation.phase.value).toBe('downloading');
    expect(worker().sent.at(-1)).toEqual({ type: 'load' });
  });

  test('a reader who agreed before is not asked again', () => {
    storage.set('ask-docs:generation', model.id);
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: false });
    expect(generation.phase.value).toBe('downloading');
  });

  test('the answer streams in, citations link to their passage, and the check runs at the end', () => {
    const generation = useGeneration(hrefOf);
    generation.write('can I use PostgreSQL?', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    worker().reply({ type: 'ready' });
    const id = (worker().sent.at(-1) as Extract<GenerationRequest, { type: 'write' }>).id;

    worker().reply({ type: 'text', id, text: '- Set `PIWI_DATABASE_URL` [1]' });
    expect(generation.markdown.value).toBe('- Set `PIWI_DATABASE_URL` [\\[1\\]](/operate/database)');
    expect(generation.written.value).toBeNull();

    worker().reply({
      type: 'done',
      id,
      text: '- Set `PIWI_DATABASE_URL` [1]\n- Use `PIWI_MADE_UP_NAME` [2]',
      tokens: 20,
      ms: 900,
    });
    expect(generation.phase.value).toBe('ready');
    expect(generation.written.value).toMatchObject({ covered: true, tokens: 20, ms: 900 });
    expect(generation.written.value!.grounding!.invented).toEqual(['PIWI_MADE_UP_NAME']);
  });

  test('a refusal shows no answer', () => {
    const generation = useGeneration(hrefOf);
    generation.write('the weather in Paris', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    worker().reply({ type: 'ready' });
    const id = (worker().sent.at(-1) as Extract<GenerationRequest, { type: 'write' }>).id;
    worker().reply({ type: 'text', id, text: 'The docs do not cover this.' });
    expect(generation.markdown.value).toBe('');
    worker().reply({ type: 'done', id, text: 'The docs do not cover this.', tokens: 7, ms: 300 });
    expect(generation.written.value).toMatchObject({ covered: false, grounding: null });
  });

  test('a question asked while an answer is written waits for that one to stop', () => {
    const generation = useGeneration(hrefOf);
    generation.write('first', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    worker().reply({ type: 'ready' });
    const first = (worker().sent.at(-1) as Extract<GenerationRequest, { type: 'write' }>).id;

    generation.reset();
    expect(worker().sent.at(-1)).toEqual({ type: 'stop' });
    generation.write('second', sources);
    worker().reply({ type: 'text', id: first, text: 'text of the first answer' });
    expect(generation.text.value).toBe('');
    expect(worker().sent.filter((request) => request.type === 'write')).toHaveLength(1);

    worker().reply({ type: 'done', id: first, text: 'text of the first answer', tokens: 3, ms: 100 });
    const writes = worker().sent.filter(
      (request): request is Extract<GenerationRequest, { type: 'write' }> => request.type === 'write',
    );
    expect(writes).toHaveLength(2);
    expect(writes[1]!.id).toBeGreaterThan(first);
    expect(writes[1]!.messages[1]!.content).toContain('Question: second');
    expect(generation.written.value).toBeNull();
    expect(generation.phase.value).toBe('writing');
  });

  test('a reader who stops an answer keeps what was written', () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    worker().reply({ type: 'ready' });
    const id = (worker().sent.at(-1) as Extract<GenerationRequest, { type: 'write' }>).id;
    worker().reply({ type: 'text', id, text: '- Set `PIWI_DATABASE_URL` [1]' });
    generation.stop();
    worker().reply({ type: 'done', id, text: '- Set `PIWI_DATABASE_URL` [1]', tokens: 9, ms: 400 });
    expect(generation.written.value).toMatchObject({ covered: true, markdown: '- Set `PIWI_DATABASE_URL` [1]' });
    expect(generation.phase.value).toBe('ready');
  });

  test('stop and reset stop the model and forget the answer', () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    worker().reply({ type: 'ready' });
    generation.stop();
    expect(worker().sent.at(-1)).toEqual({ type: 'stop' });
    generation.reset();
    expect(worker().sent.at(-1)).toEqual({ type: 'stop' });
    expect(generation.text.value).toBe('');
    expect(generation.written.value).toBeNull();
  });

  test('an error while writing is shown, and the model stays loaded', () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
    worker().reply({ type: 'ready' });
    const write = worker().sent.at(-1) as Extract<GenerationRequest, { type: 'write' }>;
    worker().reply({ type: 'error', id: write.id, message: 'the GPU was lost' });
    expect(generation.phase.value).toBe('error');
    expect(generation.message.value).toBe('the GPU was lost');
    expect(worker().terminated).toBe(false);
  });

  describe('a model that cannot be loaded', () => {
    const [small, large] = GENERATION_MODELS as [GenerationModel, GenerationModel];

    function failLarge() {
      storage.set('ask-docs:generation', large.id);
      const generation = useGeneration(hrefOf);
      generation.write('a question', sources);
      worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
      expect(worker().sent.at(-1)).toEqual({ type: 'load' });
      worker().reply({
        type: 'error',
        id: null,
        message: 'this browser could not give the model enough memory: std::bad_alloc',
      });
      return generation;
    }

    test('lets the reader pick another model, with the reason shown', () => {
      const generation = failLarge();
      expect(generation.phase.value).toBe('asking');
      expect(generation.failed.value).toBe(large.label);
      expect(generation.message.value).toContain('std::bad_alloc');
    });

    test('is not loaded again on its own after a reload', () => {
      failLarge();
      expect(storage.has('ask-docs:generation')).toBe(false);
      expect(useGeneration(hrefOf).model.value.id).toBe(small.id);
    });

    test('replaces the worker, and the next choice loads in a new one', () => {
      const generation = failLarge();
      const first = worker();
      expect(first.terminated).toBe(true);

      generation.choose(small.id);
      // Picking does not start anything after a failure: the reader decides with the button.
      expect(FakeWorker.instances).toHaveLength(1);
      generation.accept();
      const second = FakeWorker.instances[1]!;
      expect(second.sent).toEqual([{ type: 'probe', model: small.id, files: small.files }]);
      second.reply({ type: 'device', supported: true, dtype: 'q4f16', cached: false });
      expect(second.sent.at(-1)).toEqual({ type: 'load' });
      expect(generation.phase.value).toBe('downloading');
      expect(generation.failed.value).toBeNull();
      expect(storage.get('ask-docs:generation')).toBe(small.id);
    });

    test('a cached model that failed waits for the reader, who can still pick it again', () => {
      const generation = failLarge();
      generation.cancel();
      generation.write('another question', sources);
      const second = FakeWorker.instances[1]!;
      second.reply({ type: 'device', supported: true, dtype: 'q4f16', cached: true });
      expect(generation.phase.value).toBe('asking');
      expect(second.sent.some((request) => request.type === 'load')).toBe(false);

      generation.accept();
      expect(second.sent.at(-1)).toEqual({ type: 'load' });
      expect(generation.phase.value).toBe('downloading');
    });
  });

  test('removing the model deletes its files and forgets the agreement', async () => {
    const generation = useGeneration(hrefOf);
    generation.write('a question', sources);
    worker().reply({ type: 'device', supported: true, dtype: 'q4f16', cached: false });
    generation.accept();
    await generation.remove();
    expect(worker().terminated).toBe(true);
    expect(deleted).toEqual([GENERATION_CACHE]);
    expect(storage.has('ask-docs:generation')).toBe(false);
    expect(generation.phase.value).toBe('off');
  });
});

describe('explainError', () => {
  test('explains the words of the runtime for running out of memory, and keeps them', () => {
    for (const message of [
      "Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc",
      'RangeError: Array buffer allocation failed',
      'Aborted(OOM). Out of memory',
      'RuntimeError: memory access out of bounds',
    ]) {
      expect(explainError(message)).toBe(`this browser could not give the model enough memory: ${message}`);
    }
  });

  test('passes other errors through', () => {
    expect(explainError('the model is not loaded')).toBe('the model is not loaded');
  });
});
