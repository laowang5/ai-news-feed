import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl } from '../src/store/url-normalize.js';
import { JsonStore } from '../src/store/json-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, 'tmp-data');
const testStoreFile = path.join(testDataDir, 'test-signals.json');

describe('URL Normalization & Idempotency', () => {
  it('should normalize host, strip www, remove tracking params, and remove trailing slash', () => {
    const raw1 = 'https://WWW.Example.com/post/ai-agent/?utm_source=twitter&utm_medium=feed&b=2&a=1#section';
    const raw2 = 'https://example.com/post/ai-agent?a=1&b=2';

    const res1 = normalizeUrl(raw1);
    const res2 = normalizeUrl(raw2);

    assert.strictEqual(res1.normalizedUrl, 'https://example.com/post/ai-agent?a=1&b=2');
    assert.strictEqual(res1.urlKey, res2.urlKey);
  });
});

describe('JsonStore Atomic Operations & Pruning', () => {
  before(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  after(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should add items idempotently and write atomically to disk', async () => {
    const store = new JsonStore({ storePath: testStoreFile, maxItems: 10 });

    const added = await store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://news.ycombinator.com/item?id=123',
        title: 'DeepSeek V3 Released',
        summary: 'DeepSeek releases new model',
        score: 95,
        status: 'scored',
      },
      {
        source: 'github',
        source_type: 'api',
        url: 'https://github.com/deepseek-ai/deepseek-v3',
        title: 'deepseek-ai/deepseek-v3 repo',
        summary: 'Repo for deepseek-v3',
        score: 90,
        status: 'scored',
      },
    ]);

    assert.strictEqual(added.length, 2);
    assert.strictEqual(store.getItemsCount(), 2);
    assert.ok(fs.existsSync(testStoreFile), 'JSON store file must exist on disk');

    // Verify disk content is valid JSON
    const diskContent = JSON.parse(fs.readFileSync(testStoreFile, 'utf8'));
    assert.strictEqual(diskContent.schema, 1);
    assert.strictEqual(diskContent.items.length, 2);

    // Test idempotency: add the exact same items again with tracking parameters
    const duplicateAdded = await store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://news.ycombinator.com/item?id=123&utm_source=hackernews',
        title: 'DeepSeek V3 Released Duplicate',
        summary: 'Duplicate item',
      },
    ]);

    assert.strictEqual(duplicateAdded.length, 0, 'Duplicate item must be rejected');
    assert.strictEqual(store.getItemsCount(), 2);
  });

  it('should query signals with minScore and category filtering in memory', () => {
    const store = new JsonStore({ storePath: testStoreFile });

    const sTier = store.querySignals({ minScore: 85 });
    assert.strictEqual(sTier.length, 2);

    const filtered = store.querySignals({ category: 'deepseek-v3' });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].source, 'github');
  });

  it('should prune items exceeding maxItems', async () => {
    const pruneStoreFile = path.join(testDataDir, 'prune-signals.json');
    const store = new JsonStore({ storePath: pruneStoreFile, maxItems: 3 });

    for (let i = 1; i <= 5; i++) {
      await store.addItems([
        {
          source: 'test',
          source_type: 'api',
          url: `https://example.com/item-${i}`,
          title: `Item ${i}`,
          score: i * 10,
          published_at: new Date(Date.now() + i * 1000).toISOString(),
        },
      ]);
    }

    assert.strictEqual(store.getItemsCount(), 3);
  });
});
