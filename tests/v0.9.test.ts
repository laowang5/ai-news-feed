import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { JSDOM } from 'jsdom';
import { apply as applyPlugin } from '../src/index.js';
import { JsonStore, isDigestItem } from '../src/store/json-store.js';
import { writeCopy } from '../src/scoring/write.js';
import { extractContentFromHtml, fetchArticleContent } from '../src/ingestor/article.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createBootstrappedClientDom() {
  const clientPath = path.resolve(process.cwd(), 'lib/client.js');
  const clientCode = fs.readFileSync(clientPath, 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body></body></html>`,
    { url: 'http://127.0.0.1/', runScripts: 'dangerously' }
  );
  dom.window.__ModuleLoader__ = { load: () => {} };
  dom.window.eval(clientCode);
  return {
    dom,
    api: (dom.window as any).__dshAiNewsFeedClient,
  };
}

describe('v0.9.0 Experience Fixes Specification Tests', () => {
  it('W4: client bundle migrates color tokens from --dsh-* to --dsw-alias-* and sets light/dark overrides', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/client.tsx'), 'utf8');
    const built = fs.readFileSync(path.resolve(process.cwd(), 'lib/client.js'), 'utf8');

    assert.strictEqual(/--dsh-(bg|text|border)/.test(src), false, 'src/client.tsx must not use legacy --dsh-* color tokens');
    assert.strictEqual(/--dsh-(bg|text|border)/.test(built), false, 'lib/client.js must not use legacy --dsh-* color tokens');
    assert.ok(src.includes('--dsw-alias-bg-base'), 'Must use --dsw-alias-bg-base');
    assert.ok(src.includes('--dsw-alias-label-primary'), 'Must use --dsw-alias-label-primary');
    assert.ok(src.includes("data-theme='dark'") || src.includes('[data-theme="dark"]'), 'Must include dark theme token overrides');
    assert.ok(src.includes('.dsh-ai-news-feed-root'), 'Must scope theme variables under .dsh-ai-news-feed-root');
  });

  it('W2: groupByStatus sorts scored desc then pending desc BEFORE limit slice', () => {
    const dir = createTempDir('ai-news-w2-');
    const store = new JsonStore({ storePath: path.join(dir, 'signals.json') });

    // Seed items matching acceptance scenario: [pending_weightA_new, scored_70, scored_90, pending_weightA_old]
    const seeded = [
      {
        source: 'rss-openai',
        source_type: 'rss',
        source_weight: 1.15,
        url: 'https://example.com/pending-new',
        title: 'Pending New',
        status: 'pending' as const,
        score: 0,
        published_at: '2026-11-12T10:00:00Z',
      },
      {
        source: 'hn',
        source_type: 'api',
        source_weight: 0.9,
        url: 'https://example.com/scored-70',
        title: 'Scored 70',
        status: 'scored' as const,
        score: 70,
        published_at: '2026-11-10T10:00:00Z',
      },
      {
        source: 'hn',
        source_type: 'api',
        source_weight: 0.9,
        url: 'https://example.com/scored-90',
        title: 'Scored 90',
        status: 'scored' as const,
        score: 90,
        published_at: '2026-11-09T10:00:00Z',
      },
      {
        source: 'rss-openai',
        source_type: 'rss',
        source_weight: 1.15,
        url: 'https://example.com/pending-old',
        title: 'Pending Old',
        status: 'pending' as const,
        score: 0,
        published_at: '2026-11-08T10:00:00Z',
      },
    ];

    return store.addItems(seeded).then(() => {
      const full = store.querySignals({ groupByStatus: true });
      assert.deepStrictEqual(
        full.map((i) => i.title),
        ['Scored 90', 'Scored 70', 'Pending New', 'Pending Old']
      );

      const limited = store.querySignals({ groupByStatus: true, limit: 2 });
      assert.deepStrictEqual(
        limited.map((i) => i.title),
        ['Scored 90', 'Scored 70'],
        'Sorting must happen before limit slice'
      );

      const { api, dom } = createBootstrappedClientDom();
      const sortedSmart = Array.from(
        api.sortSignalsForDisplay(
          full.map((x) => ({ ...x })).reverse(),
          'smart'
        )
      ).map((i: any) => i.title);
      assert.deepStrictEqual(
        sortedSmart,
        ['Scored 90', 'Scored 70', 'Pending New', 'Pending Old']
      );

      const sortedLatest = Array.from(
        api.sortSignalsForDisplay(full, 'latest')
      ).map((i: any) => i.title);
      assert.deepStrictEqual(
        sortedLatest,
        ['Pending New', 'Scored 70', 'Scored 90', 'Pending Old']
      );
      dom.window.close();
    });
  });

  it('W3: injectIntoComposer updates controlled textarea via prototype setter + read-back, ignoring drawer inputs', () => {
    const { dom, api } = createBootstrappedClientDom();
    const { document } = dom.window;

    // 1. Decoy textarea inside plugin drawer
    const drawer = document.createElement('div');
    drawer.className = 'dsh-ai-news-feed-root';
    const drawerTa = document.createElement('textarea');
    Object.defineProperty(drawerTa, 'offsetParent', { value: document.body, configurable: true });
    drawer.appendChild(drawerTa);
    document.body.appendChild(drawer);

    // 2. Invisible textarea in host
    const hiddenTa = document.createElement('textarea');
    hiddenTa.setAttribute('data-composer-input', 'true');
    Object.defineProperty(hiddenTa, 'offsetParent', { value: null, configurable: true });
    document.body.appendChild(hiddenTa);

    // 3. Real controlled host textarea with React-style value tracker
    const hostTa = document.createElement('textarea');
    hostTa.setAttribute('data-composer-input', 'true');
    Object.defineProperty(hostTa, 'offsetParent', { value: document.body, configurable: true });
    let reactControlledState = '';
    const protoDesc = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!;
    let protoSetterCalled = false;
    Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, 'value', {
      configurable: true,
      get: protoDesc.get,
      set(v: string) {
        if (this === hostTa) protoSetterCalled = true;
        protoDesc.set!.call(this, v);
      },
    });
    hostTa.addEventListener('input', () => {
      reactControlledState = hostTa.value;
    });
    document.body.appendChild(hostTa);

    const toasts: string[] = [];
    const ok = api.injectIntoComposer(
      {
        source: 'rss-deepmind',
        title: 'Introducing Gemini 4 Hydrogen',
        title_zh: '发布 Gemini 4 Hydrogen',
        summary: '下一代多模态推理模型',
        score: 92,
        status: 'scored',
        url: 'https://deepmind.google/gemini-4',
      },
      (msg: string) => toasts.push(msg),
      { document, navigator: dom.window.navigator, lang: 'zh' }
    );

    // Restore prototype descriptor cleanly
    Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, 'value', protoDesc);

    assert.strictEqual(ok, true);
    assert.strictEqual(protoSetterCalled, true, 'Must use HTMLTextAreaElement.prototype value setter');
    assert.strictEqual(drawerTa.value, '', 'Must ignore textarea inside .dsh-ai-news-feed-root');
    assert.strictEqual(hiddenTa.value, '', 'Must ignore invisible textarea');
    assert.ok(hostTa.value.includes('发布 Gemini 4 Hydrogen'), 'Read-back value must contain quote');
    assert.ok(reactControlledState.includes('https://deepmind.google/gemini-4'), 'Controlled input listener must receive updated value');
    assert.ok(toasts[0]?.includes('已成功填入'));
    dom.window.close();
  });

  it('W3: falls back to clipboard with non-success toast when no composer input is found', () => {
    const { dom, api } = createBootstrappedClientDom();
    const { document } = dom.window;

    let copied = '';
    const mockNavigator = {
      clipboard: {
        writeText: (txt: string) => {
          copied = txt;
          return Promise.resolve();
        },
      },
    };

    const toasts: string[] = [];
    const ok = api.injectIntoComposer(
      {
        source: 'hn',
        title: 'Fallback test',
        summary: 'Summary text',
        score: 82,
        status: 'scored',
        url: 'https://example.com/fallback',
      },
      (msg: string) => toasts.push(msg),
      { document, navigator: mockNavigator, lang: 'zh' }
    );

    assert.strictEqual(ok, false);
    assert.ok(copied.includes('https://example.com/fallback'), 'Must write quote text to clipboard');
    assert.ok(toasts[0]?.includes('已复制到剪贴板'), 'Must notify user of clipboard fallback');
    assert.strictEqual(toasts[0]?.includes('已成功填入'), false, 'Must NOT claim composer injection succeeded');
    dom.window.close();
  });

  it('W1: resolves zh/en/auto titles and piggybacks title_zh in single writeCopy LLM call', async () => {
    const { dom, api } = createBootstrappedClientDom();

    assert.deepStrictEqual(
      structuredClone(api.resolveCardTitles({ title: 'Introducing Gemini 4 Hydrogen', title_zh: '发布 Gemini 4 Hydrogen' }, 'zh')),
      { primaryTitle: '发布 Gemini 4 Hydrogen', secondaryTitle: 'Introducing Gemini 4 Hydrogen' }
    );
    assert.deepStrictEqual(
      structuredClone(api.resolveCardTitles({ title: 'Introducing Gemini 4 Hydrogen', title_zh: null }, 'zh')),
      { primaryTitle: 'Introducing Gemini 4 Hydrogen', secondaryTitle: null }
    );
    assert.deepStrictEqual(
      structuredClone(api.resolveCardTitles({ title: 'Introducing Gemini 4 Hydrogen', title_zh: '发布 Gemini 4 Hydrogen' }, 'en')),
      { primaryTitle: 'Introducing Gemini 4 Hydrogen', secondaryTitle: null }
    );
    assert.strictEqual(api.resolveEffectiveLanguage('auto', 'zh-CN'), 'zh');
    assert.strictEqual(api.resolveEffectiveLanguage('auto', 'en-US'), 'en');
    dom.window.close();

    // Verify writeCopy piggybacks title_zh in the same single LLM call
    let llmCallCount = 0;
    const res = await writeCopy(
      {
        title: 'Introducing Gemini 4 Hydrogen',
        raw_content: 'Google DeepMind releases Gemini 4 Hydrogen with major latency and benchmark improvements.',
      },
      { mean: 88, thresholds: { sTierScore: 85, featuredMinScore: 80, browseMinScore: 60 }, lang: 'zh' },
      async (sysPrompt) => {
        llmCallCount += 1;
        assert.ok(sysPrompt.includes('title_zh'), 'writeCopy prompt must ask for title_zh');
        return JSON.stringify({
          title_zh: 'Google DeepMind 发布 Gemini 4 Hydrogen',
          summary: 'DeepMind 推出新一代 Gemini 4 Hydrogen 模型，显著降低推理延迟。',
          tags: ['gemini-4', 'deepmind'],
        });
      }
    );

    assert.strictEqual(llmCallCount, 1, 'Must NOT add extra LLM calls for title translation');
    assert.strictEqual(res?.title_zh, 'Google DeepMind 发布 Gemini 4 Hydrogen');
    assert.ok(res?.summary.includes('Gemini 4 Hydrogen'));

    // Failure/omission of title_zh gracefully sets null without failing copywriting
    const resMissingTitle = await writeCopy(
      { title: 'Another Launch', raw_content: 'Content text.' },
      { mean: 82, thresholds: { sTierScore: 85, featuredMinScore: 80, browseMinScore: 60 }, lang: 'zh' },
      async () => JSON.stringify({ summary: '中文摘要内容', tags: ['llm-release'] })
    );
    assert.strictEqual(resMissingTitle?.title_zh, null);
    assert.strictEqual(resMissingTitle?.summary, '中文摘要内容');
  });

  it('W5: extracts HTML og:description / article and handles timeouts silently without throwing', async () => {
    const longOg = 'DeepMind announces Gemini 4 Hydrogen, delivering breakthrough multimodal reasoning, native tool execution, long-context memory, and major inference efficiency gains across developer APIs and edge deployments worldwide.';
    const fixtureHtml = `
      <!doctype html>
      <html>
        <head>
          <meta property="og:description" content="${longOg}" />
          <meta name="description" content="Short fallback description" />
        </head>
        <body>
          <article><p>${'Detailed technical architecture benchmark results and release notes. '.repeat(10)}</p></article>
        </body>
      </html>
    `;
    const extracted = extractContentFromHtml(fixtureHtml);
    assert.ok(extracted.includes(longOg), 'Must extract og:description');
    assert.ok(extracted.length >= 400, 'Should combine with <article> body when both >= 200 chars');

    const ogOnlyHtml = `<meta content="${longOg}" property="og:description">`;
    assert.strictEqual(extractContentFromHtml(ogOnlyHtml), longOg);

    // Timeout test -> returns '' silently and retries once (2 total requests)
    let hitCount = 0;
    const server = http.createServer((_req, res) => {
      hitCount += 1;
      // Never respond so AbortController triggers timeout
      setTimeout(() => {
        try {
          res.end('too late');
        } catch {}
      }, 300);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    try {
      const result = await fetchArticleContent(`http://127.0.0.1:${port}/slow`, {
        timeoutMs: 40,
        retries: 1,
      });
      assert.strictEqual(result, '', 'Timed-out fetch must silently return empty string');
      assert.strictEqual(hitCount, 2, 'Must retry once on timeout');
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  it('W5: runSync hydrates empty raw_content before scoring, skips <400 chars with 0 LLM calls, and excludes digest from S-tier', async () => {
    const longArticleBody = 'Google DeepMind today introduced Gemini 4 Hydrogen, featuring unified multimodal reasoning, native structured tool use, 2M context efficiency, and 2x faster decoding speeds across benchmark suites including SWE-bench, LiveCodeBench, and MMMU. '.repeat(3);

    const server = http.createServer((req, res) => {
      if (req.url === '/rich') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<html><body><article>${longArticleBody}</article></body></html>`);
        return;
      }
      if (req.url === '/thin') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<html><body><article>Only short title blurb.</article></body></html>`);
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    const tmpDir = createTempDir('ai-news-w5-');

    let llmCalls = 0;
    const registeredRoutes: Record<string, any> = {};
    const mockCtx = {
      webServer: {
        register: (route: { path: string; handler: any }) => {
          registeredRoutes[route.path] = route.handler;
        },
      },
      effect: (fn: () => any) => {
        if (typeof fn === 'function') fn();
      },
      llm: {
        call: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
          llmCalls += 1;
          const sys = messages[0]?.content || '';
          if (sys.includes('高阶 AI 情报编辑')) {
            return JSON.stringify({
              title_zh: 'DeepMind 发布 Gemini 4 Hydrogen',
              summary: 'DeepMind 推出 Gemini 4 Hydrogen，多模态推理与吞吐性能倍增。',
              tags: ['gemini-4', 'deepmind'],
            });
          }
          return JSON.stringify({ score: 82 });
        },
      },
    };

    try {
      const plugin = applyPlugin(mockCtx, {
        dataDir: tmpDir,
        storePath: path.join(tmpDir, 'signals.json'),
        syncIntervalMinutes: 0,
        scoreCalls: 2,
        fetchArticle: { enabled: true, timeoutMs: 2000, minContentChars: 400 },
      });

      await plugin.store.addItems([
        {
          source: 'rss-deepmind',
          source_type: 'rss',
          source_weight: 1.15,
          url: `http://127.0.0.1:${port}/rich`,
          title: 'Introducing Gemini 4 Hydrogen',
          summary: 'Short RSS blurb',
          raw_content: '',
          published_at: '2026-11-12T12:00:00Z',
        },
        {
          source: 'hn',
          source_type: 'api',
          source_weight: 0.9,
          url: `http://127.0.0.1:${port}/thin`,
          title: 'Show HN: Empty Short Link',
          summary: '',
          raw_content: '',
          published_at: '2026-11-12T11:00:00Z',
        },
        {
          source: 'aihot',
          source_type: 'rss',
          source_weight: 0.9,
          url: 'https://aihot.example.com/digest-2026-11-12',
          title: 'AI 早报｜2026-11-12 多条资讯汇总',
          summary: '汇总内容',
          score: 91,
          is_s_tier: true,
          status: 'scored',
          published_at: '2026-11-12T08:00:00Z',
        },
      ]);

      await plugin.runSync({ skipIngest: true });
      await plugin.waitForSync();

      const all = plugin.store.querySignals({ status: 'all' });
      const richItem = all.find((i) => i.url.endsWith('/rich'))!;
      const thinItem = all.find((i) => i.url.endsWith('/thin'))!;
      const digestItem = all.find((i) => i.source === 'aihot')!;

      // Rich item was hydrated (>=400 chars), scored (2 calls) + copywriting+title_zh (1 call) = 3 total LLM calls
      assert.strictEqual(llmCalls, 3, 'Thin item must invoke 0 LLM calls; rich item takes 2 score + 1 copy = 3');
      assert.strictEqual(richItem.status, 'scored');
      assert.ok((richItem.raw_content || '').length >= 400);
      assert.strictEqual(richItem.title_zh, 'DeepMind 发布 Gemini 4 Hydrogen');
      assert.ok(richItem.score >= 85, `Expected adjusted >= 85, got ${richItem.score}`);

      // Thin item skipped without polluting scored metrics
      assert.strictEqual(thinItem.status, 'pending');
      assert.strictEqual(thinItem.skip_reason, 'insufficient_content');
      assert.strictEqual(thinItem.score, 0);

      // Health snapshot reports insufficient_content_items, appearance, display
      const health = plugin.getHealthSnapshot();
      assert.strictEqual(health.insufficient_content_items, 1);
      assert.strictEqual(health.scored_items, 2); // rich + seeded digest
      assert.strictEqual(health.display?.language, 'auto');
      assert.strictEqual(health.appearance, 'auto');

      // Digest detection & S-tier exclusion
      assert.strictEqual(isDigestItem(digestItem), true);
      assert.strictEqual(digestItem.source_type, 'digest');

      const sTierHandler = registeredRoutes['/api/plugins/ai-news-feed/signals'];
      let sTierBody = '';
      sTierHandler(
        { method: 'GET', url: '/api/plugins/ai-news-feed/signals?minScore=85' },
        { setHeader() {}, end: (d: string) => { sTierBody = d; } }
      );
      const sTierJson = JSON.parse(sTierBody);
      assert.strictEqual(
        sTierJson.signals.some((s: any) => s.source === 'aihot'),
        false,
        'Digest items must be excluded from S-tier (minScore=85)'
      );
      assert.ok(
        sTierJson.signals.some((s: any) => s.url.endsWith('/rich')),
        'Rich scored S-tier item must appear in S-tier response'
      );

      let latestBody = '';
      sTierHandler(
        { method: 'GET', url: '/api/plugins/ai-news-feed/signals?stream=latest' },
        { setHeader() {}, end: (d: string) => { latestBody = d; } }
      );
      const latestJson = JSON.parse(latestBody);
      assert.strictEqual(
        latestJson.signals.some((s: any) => s.source === 'aihot'),
        true,
        'Digest item should still appear in latest stream'
      );
    } finally {
      server.closeAllConnections?.();
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
