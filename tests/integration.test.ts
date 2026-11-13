import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, resolveDataDir } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const integrationDataDir = path.join(__dirname, 'tmp-integration');
const storePath = path.join(integrationDataDir, 'signals.json');

describe('Full Plugin Integration & Contract Scenarios', () => {
  before(() => {
    if (fs.existsSync(integrationDataDir)) {
      fs.rmSync(integrationDataDir, { recursive: true, force: true });
    }
  });

  after(() => {
    if (fs.existsSync(integrationDataDir)) {
      fs.rmSync(integrationDataDir, { recursive: true, force: true });
    }
  });

  it('Scenario 7: Zero Config Boot without any pre-existing files', () => {
    const mockCtx = {
      tools: {
        registered: [] as any[],
        register(tool: any) {
          this.registered.push(tool);
        },
      },
      webServer: {
        routes: [] as any[],
        register(route: any) {
          this.routes.push(route);
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0, // Disable background interval in test
    });

    assert.ok(plugin.store, 'Store must be initialized');
    assert.strictEqual(plugin.store.getItemsCount(), 0, 'Zero config starts empty');

    // Check health snapshot
    const health = plugin.getHealthSnapshot();
    assert.strictEqual(health.total_items, 0);
    assert.strictEqual(health.pending_items, 0);

    // Verify tools registered
    const toolNames = mockCtx.tools.registered.map((t) => t.name);
    assert.ok(toolNames.includes('get_top_ai_news'));
    assert.ok(toolNames.includes('search_ai_signals'));
    assert.ok(toolNames.includes('trigger_feed_sync'));
    assert.ok(toolNames.includes('get_feed_health'));
    assert.ok(!toolNames.includes('trigger_news_pipeline'), 'Old python tool must be removed');
  });

  it('Scenario 4 & Scenario 5: Ingestion and Idempotency without LLM (degrades to pending)', async () => {
    const mockCtx = {
      tools: { register() {} },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
    });

    // Add 2 mock items directly
    const added1 = await plugin.store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/deepseek-breakthrough',
        title: 'DeepSeek Breakthrough',
        summary: 'DeepSeek achieves major breakthrough',
        published_at: new Date().toISOString(),
      },
    ]);
    assert.strictEqual(added1.length, 1);
    assert.strictEqual(added1[0].status, 'pending', 'Must degrade to pending when no LLM scored it');

    // Edge Case 1: Repeated ingestion with tracking params (Idempotency)
    const added2 = await plugin.store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/deepseek-breakthrough?utm_source=x&ref=feed',
        title: 'Duplicate DeepSeek Item',
      },
    ]);
    assert.strictEqual(added2.length, 0, 'Must reject duplicate normalized URL');
    assert.strictEqual(plugin.store.getItemsCount(), 1);

    // Query signals
    const signals = plugin.store.querySignals();
    assert.strictEqual(signals.length, 1);
    assert.strictEqual(signals[0].status, 'pending');
  });

  it('Scenario 8: Standalone distribution check (No python, no child_process in src)', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const files = fs.readdirSync(srcDir, { recursive: true }) as string[];

    for (const file of files) {
      if (typeof file === 'string' && (file.endsWith('.ts') || file.endsWith('.tsx'))) {
        const fullPath = path.join(srcDir, file);
        const content = fs.readFileSync(fullPath, 'utf8');

        assert.ok(
          !content.includes('node:child_process') && !content.includes("from 'child_process'"),
          `File ${file} must NOT import child_process`
        );
        assert.ok(
          !content.includes('/my-daily-news') && !content.includes('my_daily_news'),
          `File ${file} must NOT reference my-daily-news`
        );
      }
    }
  });
});
