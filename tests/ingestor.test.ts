import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IngestorManager } from '../src/ingestor/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.join(__dirname, 'tmp-ingestor');
const testYamlPath = path.join(testDir, 'sources.yaml');

describe('IngestorManager Configuration & Isolation', () => {
  before(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should auto-create default sources.yaml if missing and load 6 default sources', () => {
    const manager = new IngestorManager(testYamlPath);
    assert.ok(fs.existsSync(testYamlPath), 'sources.yaml must be auto-created');

    const sources = manager.getSources();
    assert.strictEqual(sources.length, 6);
    assert.ok(sources.some((s) => s.id === 'hn'));
    assert.ok(sources.some((s) => s.id === 'aihot'));
    assert.ok(sources.some((s) => s.id === 'rss-deepmind'));
  });

  it('should isolate errors when one source fails or times out', async () => {
    const manager = new IngestorManager(testYamlPath);

    // Mock an invalid / blackhole source alongside a mock valid source
    const failingResult = await manager.fetchSource({
      id: 'failing-rss',
      type: 'rss',
      enabled: true,
      url: 'http://127.0.0.1:59999/non-existent-feed.xml',
    });

    assert.strictEqual(failingResult.success, false);
    assert.ok(failingResult.error, 'Error must be captured');
    assert.strictEqual(failingResult.items.length, 0);
  });
});
