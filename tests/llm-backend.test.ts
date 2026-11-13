import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../src/index.js';
import { NewsEvaluator } from '../src/evaluator/evaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'tmp-llm-backend-test');
const storePath = path.join(dataDir, 'signals.json');

function clean() {
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** Mock of the real host `LlmRuntime`: prepareCall + stream, no `call`. */
function makeHostLlm(behaviour: 'ok' | 'fail' = 'ok') {
  const seen: any[] = [];
  return {
    seen,
    listProviders: () => [{ id: 'ollama-cloud', name: 'Ollama Cloud' }],
    listModels: async () => ['deepseek-v4.1-flash:1017'],
    stream: async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
    prepareCall: async (config: any) => {
      seen.push(config);
      return {
        config: { ...config },
        async *stream() {
          if (behaviour === 'fail') {
            throw new Error('adapter exploded');
          }
          yield { type: 'text-delta', text: '{"score": 91,' };
          yield { type: 'text-delta', text: ' "tags": ["llm"]}' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
}

/** Walk a snapshot and collect paths whose value is `undefined`. */
function findUndefined(value: unknown, at = '$', out: string[] = []): string[] {
  if (value === undefined) {
    out.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findUndefined(v, `${at}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) out.push(`${at}.${k}`);
      else findUndefined(v, `${at}.${k}`, out);
    }
  }
  return out;
}

describe('LLM backend detection and health contract', () => {
  beforeEach(clean);
  afterEach(clean);

  it('detects the host streaming runtime instead of claiming a missing llm', () => {
    const evaluator = new NewsEvaluator({ ctx: { llm: makeHostLlm() } });
    assert.strictEqual(evaluator.getBackend(), 'host-stream');
    assert.strictEqual(evaluator.isAvailable(), true);
  });

  it('prefers the direct fetch transport when only llmApiKey is configured', () => {
    const evaluator = new NewsEvaluator({ llmApiKey: 'sk-test', llmModel: 'gpt-x' });
    assert.strictEqual(evaluator.getBackend(), 'fetch');
  });

  it('reports "none" when neither a host runtime nor an api key exists', () => {
    const evaluator = new NewsEvaluator({});
    assert.strictEqual(evaluator.getBackend(), 'none');
    assert.strictEqual(evaluator.isAvailable(), false);
  });

  it('drives prepareCall + stream and concatenates text deltas', async () => {
    const llm = makeHostLlm('ok');
    const evaluator = new NewsEvaluator({ ctx: { llm } });
    const text = await evaluator.callLlmRaw('system rubric', 'user prompt');

    assert.ok(text, 'must return the assembled text');
    assert.strictEqual(text, '{"score": 91, "tags": ["llm"]}');
    assert.strictEqual(llm.seen.length, 1, 'exactly one prepareCall');
    assert.strictEqual(llm.seen[0].provider, 'ollama-cloud');
    assert.strictEqual(llm.seen[0].model, 'deepseek-v4.1-flash:1017');

    const diag = evaluator.getDiagnostics();
    assert.strictEqual(diag.backend, 'host-stream');
    assert.strictEqual(diag.ok_calls, 1);
    assert.strictEqual(diag.failed_calls, 0);
    assert.strictEqual(diag.last_error, undefined);
  });

  it('records the failure reason instead of swallowing it', async () => {
    const evaluator = new NewsEvaluator({ ctx: { llm: makeHostLlm('fail') } });
    const text = await evaluator.callLlmRaw('sys', 'user');

    assert.strictEqual(text, null);
    const diag = evaluator.getDiagnostics();
    assert.strictEqual(diag.failed_calls, 1);
    assert.match(diag.last_error || '', /adapter exploded/);
    assert.ok(diag.last_error_at, 'failure timestamp must be recorded');
  });

  it('surfaces a misconfigured state and keeps the snapshot lossless JSON', async () => {
    const mockCtx = {
      effect: (fn: any) => fn(),
      tools: { register() {} },
      llm: makeHostLlm('fail'),
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    assert.strictEqual(plugin.getHealthSnapshot().llm_state, 'available');

    await plugin.evaluator.callLlmRaw('sys', 'user');
    const health = plugin.getHealthSnapshot();

    assert.strictEqual(health.llm_state, 'misconfigured');
    assert.strictEqual(health.llm_backend, 'host-stream');
    assert.match(health.llm_last_error || '', /adapter exploded/);
    assert.strictEqual(health.llm_failed_calls, 1);
  });

  it('never emits undefined: get_feed_health output must be lossless JSON', () => {
    const mockCtx = {
      effect: (fn: any) => fn(),
      tools: { register() {} },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    // Not syncing + no schedule service: both branches used to leave
    // `undefined` in the payload, which DSH rejects as invalid tool output.
    const snapshot = plugin.getHealthSnapshot();
    assert.deepStrictEqual(findUndefined(snapshot), []);
    assert.strictEqual(snapshot.sync_progress, undefined);
    assert.strictEqual(snapshot.schedule?.reason !== undefined, true);

    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    assert.deepStrictEqual(roundTripped, snapshot);
  });
});
