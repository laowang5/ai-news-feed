import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import YAML from 'yaml';
import { JSDOM } from 'jsdom';
import { apply as applyPlugin } from '../src/index.js';
import { JsonStore } from '../src/store/json-store.js';
import { parseDigestItems, toLocalDateString } from '../src/ingestor/aihot-digest.js';
import { clusterSignals } from '../src/scoring/cluster.js';
import { buildRubricWithTopics, loadRubric } from '../src/scoring/rubric.js';
import { adjustScore, sourceWeight } from '../src/scoring/adjust.js';
import { DEFAULT_TOPICS } from '../src/scoring/topics.js';
import { writeCopy } from '../src/scoring/write.js';
import { IngestorManager } from '../src/ingestor/manager.js';
import { DEFAULT_SOURCES_YAML } from '../src/ingestor/default-sources.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const REAL_DAILY_HTML_FIXTURE = `
<p>NVIDIA 董事会宣布 Jensen Huang 即刻辞去总裁、CEO 及董事职务。</p>
<p><strong>模型发布/更新</strong></p>
<ul>
  <li><a href="https://aihot.news/items/uy1ayrrlqx1snqsv4lub7whsa">Google DeepMind 发布 Gemini 4 Hydrogen</a></li>
  <li>无链接的纯文本条目应当被跳过</li>
</ul>
<p><strong>产品发布/更新</strong></p>
<ul>
  <li><a href="https://aihot.news/items/l36ne5q2gsdx6thyia7fi10kn">Anthropic 推出 Claude Meetings，Claude 以参会者身份加入视频会议</a></li>
  <li><a href="https://aihot.news/items/t5pucqx6ac58z0ed1b0875ci0">Anthropic 建议把 Claude Opus 5.5 作为知识工作的日常主力模型</a></li>
  <li><a href="https://aihot.news/items/hjhcsj440ym8b7ynttcx4433j">Google 智能眼镜开放预购，12 月 10 日发货</a></li>
  <li><a href="/items/k7sfjumcmtq0zswb5yj5kmju1">Replit Agent 新增代购能力和 Google Ads 投放功能</a></li>
</ul>
<p><strong>行业动态</strong></p>
<ul>
  <li><a href="https://aihot.news/items/qsbjbz754aodhcijq56puh6va">NVIDIA 宣布 CEO 变动：Jensen Huang 辞任，CFO Colette Kress 出任临时 CEO</a></li>
  <li><a href="https://aihot.news/items/k99zjo9hbtous9r6vmmz7pxyh">Anthropic 官宣首次公开募股（IPO）</a></li>
  <li><a href="https://aihot.news/items/ivpl9ziip8mpoa90avi3ke9pj">Jensen Huang 辞任 Nvidia CEO 后对 AI 经济的五点影响分析</a></li>
  <li><a href="https://aihot.news/items/cfh0nazzl7eedgttz8n99fza4">民主党对 Nvidia 对华芯片销售启动调查，致函质疑黄仁勋与特朗普的安排</a></li>
  <li><a href="https://aihot.news/items/k1kga19xtdab67lhplor8he8n">Rohan Paul 类比乔布斯被逐，评 NVIDIA 放走黄仁勋</a></li>
</ul>
<p><strong>技巧与观点</strong></p>
<ul>
  <li><a href="https://aihot.news/items/cve017k4le2q7l8x1bfr2xdjx">OpenRouter 详解自纠错网站本地化流水线：GPT-6.1 Sol 翻译 7 种语言全站约 $460</a></li>
  <li><a href="https://aihot.news/items/vq9nwgwhtm31cgoliyb7ydyde">OpenRouter 实测六模型并给出四层防护，解决 AI Agent 无限循环烧钱问题</a></li>
</ul>
`;

describe('v1.0.0 Daily Briefing Specification Tests', () => {
  it('拆条: unpacks 12 DigestChild items with exact sections, absolute URLs, and skips li without anchor', () => {
    const children = parseDigestItems(
      REAL_DAILY_HTML_FIXTURE,
      'daily-2026-11-13',
      '2026-11-13T00:00:48.000Z'
    );

    assert.strictEqual(children.length, 12);
    assert.strictEqual(children[0].section, '模型发布/更新');
    assert.strictEqual(children[0].title, 'Google DeepMind 发布 Gemini 4 Hydrogen');
    assert.strictEqual(children[1].section, '产品发布/更新');
    assert.strictEqual(children[4].url, 'https://aihot.news/items/k7sfjumcmtq0zswb5yj5kmju1');
    assert.strictEqual(children[5].section, '行业动态');
    assert.strictEqual(children[10].section, '技巧与观点');
    assert.ok(
      children.every((c) => /^https?:\/\//.test(c.url) && c.parent_digest === 'daily-2026-11-13'),
      'Every child must have absolute URL and parent_digest'
    );
    assert.strictEqual(
      children.some((c) => c.title.includes('无链接')),
      false,
      '<li> without <a> must be skipped'
    );

    assert.deepStrictEqual(
      parseDigestItems('<p>Only paragraph</p>', 'daily-empty', '2026-11-13T00:00:00Z'),
      [],
      'HTML without <li> must return empty array'
    );
  });

  it('拆条幂等 & 降级: syncing identical daily.xml twice keeps child count invariant; no LLM still exposes unpacked stream', async () => {
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AIHOT Daily</title>
    <link>https://aihot.news/</link>
    <item>
      <guid>daily-2026-11-13</guid>
      <title>AIHOT 日报 · 2026-11-13</title>
      <link>https://aihot.news/daily/2026-11-13</link>
      <pubDate>Fri, 13 Nov 2026 00:00:48 GMT</pubDate>
      <description><![CDATA[${REAL_DAILY_HTML_FIXTURE}]]></description>
    </item>
  </channel>
</rss>`;

    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.end(rssXml);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    const tmpDir = createTempDir('ai-news-v1-digest-');

    const registeredRoutes: Record<string, any> = {};
    const mockCtx = {
      webServer: {
        register: (r: { path: string; handler: any }) => {
          registeredRoutes[r.path] = r.handler;
        },
      },
      effect: (fn: () => any) => {
        if (typeof fn === 'function') fn();
      },
    };

    try {
      // Configure sources.yaml directly before plugin init so only test server aihot source runs
      fs.writeFileSync(
        path.join(tmpDir, 'sources.yaml'),
        `sources:\n  - id: aihot\n    type: rss\n    tier: tier_b\n    enabled: true\n    url: http://127.0.0.1:${port}/daily.xml\n    maxItemsPerRun: 5\n`,
        'utf8'
      );

      const plugin = applyPlugin(mockCtx, {
        dataDir: tmpDir,
        storePath: path.join(tmpDir, 'signals.json'),
        syncIntervalMinutes: 0,
      });

      await plugin.runSync();
      await plugin.waitForSync();
      const firstCount = plugin.store.getItemsCount();
      assert.strictEqual(firstCount, 13, '1 parent digest + 12 unpacked children');

      await plugin.runSync();
      await plugin.waitForSync();
      const secondCount = plugin.store.getItemsCount();
      assert.strictEqual(secondCount, 13, 'Syncing identical daily.xml twice must be idempotent');

      // Degradation: No LLM -> briefing empty, latest raw stream returns unpacked children
      let briefBody = '';
      registeredRoutes['/dsh-plugins/ai-news-feed/briefing'](
        { method: 'GET', url: '/dsh-plugins/ai-news-feed/briefing?date=2026-11-13' },
        { setHeader() {}, end: (d: string) => { briefBody = d; } }
      );
      const briefJson = JSON.parse(briefBody);
      assert.strictEqual(briefJson.signals.length, 0);

      let latestBody = '';
      registeredRoutes['/dsh-plugins/ai-news-feed/signals'](
        { method: 'GET', url: '/dsh-plugins/ai-news-feed/signals?stream=latest&limit=50' },
        { setHeader() {}, end: (d: string) => { latestBody = d; } }
      );
      const latestJson = JSON.parse(latestBody);
      assert.strictEqual(latestJson.signals.length, 13);
      assert.ok(
        latestJson.signals.some((s: any) => s.parent_digest === 'daily-2026-11-13'),
        'Unpacked child items must appear in raw latest stream when no LLM is present'
      );
    } finally {
      server.closeAllConnections?.();
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('合并正例 & 合并反例 & 反例2: merges same event picking longest body, blocks distinct model suffixes & digest parents', () => {
    const baseDate = '2026-11-13T04:00:00Z';

    // Positive merge: 3 items across sources for "Claude Meetings"
    const mergeCandidates = [
      {
        id: 1,
        source: 'aihot',
        source_type: 'rss',
        parent_digest: 'daily-2026-11-13',
        url: 'https://aihot.news/items/cm-1',
        url_key: 'aihot.news/items/cm-1',
        title: 'Anthropic 推出 Claude Meetings，Claude 以参会者身份加入视频会议',
        summary: '',
        score: 84,
        tags: [],
        source_weight: 1.0,
        raw_content: 'Short blurb.',
        status: 'scored' as const,
        published_at: '2026-11-13T01:00:00Z',
      },
      {
        id: 2,
        source: 'hn',
        source_type: 'api',
        url: 'https://news.ycombinator.com/cm-2',
        url_key: 'news.ycombinator.com/cm-2',
        title: 'Anthropic launches Claude Meetings with live meeting assistant',
        summary: '',
        score: 86,
        tags: [],
        source_weight: 0.9,
        raw_content: 'A'.repeat(1200),
        status: 'scored' as const,
        published_at: '2026-11-13T03:00:00Z',
      },
      {
        id: 3,
        source: 'rss-simonw',
        source_type: 'rss',
        url: 'https://simonwillison.net/cm-3',
        url_key: 'simonwillison.net/cm-3',
        title: 'Notes on Anthropic Claude Meetings rollout',
        summary: '',
        score: 81,
        tags: [],
        source_weight: 1.0,
        raw_content: 'B'.repeat(500),
        status: 'scored' as const,
        published_at: '2026-11-13T02:00:00Z',
      },
    ];

    const mergedPairs = clusterSignals(mergeCandidates);
    assert.strictEqual(mergedPairs.length, 1);
    assert.strictEqual(mergedPairs[0].primaryId, 2, 'Item with longest raw_content must be primary');
    assert.deepStrictEqual(mergedPairs[0].mergedIds.sort(), [1, 3]);

    // Anti-merge 1: Gemini 4 Hydrogen vs Gemini 4 Carbon must stay separate
    const antiModelPairs = clusterSignals([
      {
        id: 10,
        source: 'rss-deepmind',
        source_type: 'rss',
        url: 'https://deepmind.google/g4-hydrogen',
        url_key: 'deepmind.google/g4-hydrogen',
        title: 'Introducing Gemini 4 Hydrogen',
        summary: '',
        score: 90,
        tags: [],
        raw_content: 'X'.repeat(600),
        status: 'scored',
        published_at: baseDate,
      },
      {
        id: 11,
        source: 'hn',
        source_type: 'api',
        url: 'https://deepmind.google/g4-carbon',
        url_key: 'deepmind.google/g4-carbon',
        title: 'Gemini 4 Carbon is now available',
        summary: '',
        score: 88,
        tags: [],
        raw_content: 'Y'.repeat(600),
        status: 'scored',
        published_at: baseDate,
      },
    ]);
    assert.strictEqual(antiModelPairs.length, 0, 'Gemini 4 Hydrogen and Gemini 4 Carbon must NOT merge');

    // Anti-merge 2: Digest parent excluded even if title shares proper nouns
    const antiDigestPairs = clusterSignals([
      {
        id: 20,
        source: 'aihot',
        source_type: 'digest',
        url: 'https://aihot.news/daily/2026-11-13',
        url_key: 'aihot.news/daily/2026-11-13',
        title: 'AIHOT 日报 · 2026-11-13 — Google DeepMind Gemini 4 Hydrogen',
        summary: '',
        score: 0,
        tags: [],
        raw_content: 'Z'.repeat(800),
        status: 'pending',
        published_at: baseDate,
      },
      {
        id: 21,
        source: 'rss-deepmind',
        source_type: 'rss',
        url: 'https://deepmind.google/g4-hydrogen',
        url_key: 'deepmind.google/g4-hydrogen',
        title: 'Google DeepMind Gemini 4 Hydrogen launch notes',
        summary: '',
        score: 92,
        tags: [],
        raw_content: 'W'.repeat(800),
        status: 'scored',
        published_at: baseDate,
      },
    ]);
    assert.strictEqual(antiDigestPairs.length, 0, 'Digest parent must not participate in clustering');
  });

  it('今日必看 & 未读: enforces CST day boundary, excludes digest & merged_into, hard caps 5, respects read_at & markRead', async () => {
    const dir = createTempDir('ai-news-v1-briefing-');
    const store = new JsonStore({ storePath: path.join(dir, 'signals.json') });

    const distinctTitles = [
      'AlphaZero Robotics Framework',
      'Beta Compiler Optimization',
      'Gamma Quantum Simulator',
      'Delta Kernel Scheduler',
      'Epsilon Speech Codec',
      'Zeta Vector Storage',
      'Eta Network Router',
    ];
    const todayItems = Array.from({ length: 7 }, (_, idx) => ({
      source: `src-${idx}`,
      source_type: 'rss',
      url: `https://example.com/today-${idx}`,
      title: distinctTitles[idx],
      summary: `Summary ${idx}`,
      score: 90 - idx,
      raw_content: 'C'.repeat(500),
      status: 'scored' as const,
      published_at: `2026-11-13T0${idx}:10:00+08:00`,
      digest_date: '2026-11-13',
    }));

    await store.addItems([
      ...todayItems,
      // Yesterday 23:59 CST -> must not enter today 2026-11-13
      {
        source: 'rss-openai',
        source_type: 'rss',
        url: 'https://example.com/yesterday-late',
        title: 'Yesterday 23:59 CST Event',
        score: 99,
        raw_content: 'Y'.repeat(500),
        status: 'scored',
        published_at: '2026-11-12T23:59:00+08:00',
      },
      // Digest parent on today -> excluded
      {
        source: 'aihot',
        source_type: 'digest',
        url: 'https://aihot.news/daily/2026-11-13',
        title: 'AIHOT 日报 · 2026-11-13',
        score: 95,
        status: 'scored',
        published_at: '2026-11-13T08:00:00+08:00',
      },
      // Duplicate of today-0 -> merged_into set
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://news.ycombinator.com/dup-0',
        title: 'AlphaZero Robotics Framework',
        score: 98,
        raw_content: 'D'.repeat(200),
        status: 'scored',
        published_at: '2026-11-13T01:15:00+08:00',
        digest_date: '2026-11-13',
      },
    ]);

    const resLimit10 = store.queryDailyBriefing({ date: '2026-11-13', limit: 10 });
    assert.strictEqual(resLimit10.length, 5, 'Hard cap must remain 5 even when limit=10');
    assert.ok(
      resLimit10.every((i) => toLocalDateString(i.published_at) === '2026-11-13'),
      'Must exclude previous day 23:59 CST item'
    );
    assert.strictEqual(
      resLimit10.some((i) => i.source_type === 'digest' || i.merged_into !== undefined),
      false,
      'Must exclude digest parent and merged_into items'
    );

    const topItem = resLimit10[0];
    assert.ok((topItem.source_count || 1) >= 2, 'Primary item should carry source_count >= 2');

    // Mark top 2 as read
    const firstMark = await store.markRead([resLimit10[0].id, resLimit10[1].id], 1700000000000);
    assert.strictEqual(firstMark, 2);
    const secondMark = await store.markRead([resLimit10[0].id], 1800000000000);
    assert.strictEqual(secondMark, 0, 'markRead must be idempotent and keep original read_at');

    const unreadOnly = store.queryDailyBriefing({ date: '2026-11-13' });
    assert.strictEqual(unreadOnly.some((i) => i.id === topItem.id), false, 'Read items hidden by default');
    assert.strictEqual(unreadOnly.length, 5, 'Should backfill next unread item up to 5 when available');

    const withRead = store.queryDailyBriefing({ date: '2026-11-13', includeRead: true });
    assert.strictEqual(withRead[0].id, topItem.id, 'includeRead=true must include read items');
    assert.strictEqual(withRead[0].read_at, 1700000000000);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('主题默认 / 主题空 / topic_boost 上限与 S级隔离 / WHY', async () => {
    const tmpDir = createTempDir('ai-news-v1-topics-');
    const pluginDefault = applyPlugin(
      { effect: () => {} },
      { dataDir: tmpDir, syncIntervalMinutes: 0 }
    );
    assert.deepStrictEqual(
      pluginDefault.getHealthSnapshot().display?.topics,
      DEFAULT_TOPICS,
      'Fresh config must default display.topics to agent-infra & model-release'
    );

    const baseRubric = loadRubric();
    const injected = buildRubricWithTopics(DEFAULT_TOPICS, baseRubric);
    assert.ok(injected.includes('## 读者关注方向'));
    assert.ok(injected.includes('Agent 基建'));

    const emptyRubric = buildRubricWithTopics([], baseRubric);
    assert.strictEqual(emptyRubric.includes('读者关注方向'), false, 'Empty topics must omit section');
    assert.strictEqual(emptyRubric, baseRubric);

    // 2 matched topics -> +5 cap; base=82 -> adjusted=87, yet is_s_tier stays false
    const boosted = adjustScore(82, {
      tier: 'tier_b',
      topicMatch: ['agent-infra', 'model-release'],
      activeTopics: ['agent-infra', 'model-release'],
      sTierScore: 85,
    });
    assert.strictEqual(boosted.topic_boost, 5);
    assert.strictEqual(boosted.base_adjusted, 82);
    assert.strictEqual(boosted.adjusted, 87);
    assert.strictEqual(boosted.is_s_tier, false, 'S-tier must judge strictly on pre-boost score');

    // Empty activeTopics -> topic_boost = 0
    const noBoost = adjustScore(82, {
      tier: 'tier_b',
      topicMatch: ['agent-infra', 'model-release'],
      activeTopics: [],
      sTierScore: 85,
    });
    assert.strictEqual(noBoost.topic_boost, 0);
    assert.strictEqual(noBoost.adjusted, 82);

    // writeCopy extracts WHY without extra LLM call
    let copyCalls = 0;
    const copyRes = await writeCopy(
      { title: 'Agent SDK Released', raw_content: 'R'.repeat(500) },
      { mean: 84, thresholds: { sTierScore: 85, featuredMinScore: 80, browseMinScore: 60 }, lang: 'zh' },
      async () => {
        copyCalls += 1;
        return '{"title_zh":"发布 Agent SDK","summary":"支持多智能体编排。","tags":["agent-sdk"]}\nWHY: 降低多 Agent 编排开发成本';
      }
    );
    assert.strictEqual(copyCalls, 1);
    assert.strictEqual(copyRes?.why_it_matters, '降低多 Agent 编排开发成本');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('W1 必看豁免 & 排序: exempts digest children down to browseMinScore, rejects regular <80, caps 5, orders digest first on ties', async () => {
    const dir = createTempDir('ai-news-v1-w1-');
    const store = new JsonStore({ storePath: path.join(dir, 'signals.json') });

    await store.addItems([
      {
        source: 'aihot',
        source_type: 'rss',
        parent_digest: 'daily-2026-11-13',
        url: 'https://example.com/digest-65',
        title: 'Anthropic Launches Video Meeting Agent',
        score: 65,
        raw_content: 'D'.repeat(500),
        status: 'scored',
        published_at: '2026-11-13T08:00:00+08:00',
        digest_date: '2026-11-13',
      },
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/regular-65',
        title: 'PostgreSQL Parallel Query Engine Upgrade',
        score: 65,
        raw_content: 'R'.repeat(500),
        status: 'scored',
        published_at: '2026-11-13T09:00:00+08:00',
        digest_date: '2026-11-13',
      },
      {
        source: 'aihot',
        source_type: 'rss',
        parent_digest: 'daily-2026-11-13',
        url: 'https://example.com/digest-55',
        title: 'Cloudflare Worker Cold Start Optimization',
        score: 55,
        raw_content: 'E'.repeat(500),
        status: 'scored',
        published_at: '2026-11-13T07:00:00+08:00',
        digest_date: '2026-11-13',
      },
    ]);

    const exemption = store.queryDailyBriefing({
      date: '2026-11-13',
      featuredMinScore: 80,
      digestMinScore: 60,
    });
    assert.deepStrictEqual(
      exemption.map((i) => i.title),
      ['Anthropic Launches Video Meeting Agent'],
      '65+parent_digest must pass; regular 65 and digest 55 must be excluded'
    );

    // 8 qualified items -> strictly returns 5
    const dirCap = createTempDir('ai-news-v1-w1-cap-');
    const storeCap = new JsonStore({ storePath: path.join(dirCap, 'signals.json') });
    const batchTitles = [
      'Kappa Compiler Release',
      'Lambda Runtime Engine',
      'Mu Inference Kernel',
      'Nu Distributed Store',
      'Xi Hardware Accelerator',
      'Omicron Tensor Graph',
      'Pi Reasoning Benchmark',
      'Rho Agent Framework',
    ];
    await storeCap.addItems(
      batchTitles.map((title, idx) => ({
        source: `src-${idx}`,
        source_type: 'rss',
        url: `https://example.com/cap-${idx}`,
        title,
        score: 88 - idx,
        raw_content: 'Q'.repeat(500),
        status: 'scored' as const,
        published_at: `2026-11-13T0${idx}:00:00+08:00`,
        digest_date: '2026-11-13',
      }))
    );
    const capped = storeCap.queryDailyBriefing({
      date: '2026-11-13',
      limit: 8,
      featuredMinScore: 80,
      digestMinScore: 60,
    });
    assert.strictEqual(capped.length, 5);

    // Tie-break sorting: 90 regular first; two 70s (one digest child vs one regular) -> digest before regular
    const dirSort = createTempDir('ai-news-v1-w1-sort-');
    const storeSort = new JsonStore({ storePath: path.join(dirSort, 'signals.json') });
    await storeSort.addItems([
      {
        source: 'rss-openai',
        source_type: 'rss',
        url: 'https://example.com/regular-90',
        title: 'Sigma Regular Ninety',
        score: 90,
        raw_content: 'S'.repeat(500),
        status: 'scored',
        published_at: '2026-11-13T01:00:00+08:00',
        digest_date: '2026-11-13',
      },
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/regular-70',
        title: 'Tau Regular Seventy',
        score: 70,
        raw_content: 'T'.repeat(500),
        status: 'scored',
        published_at: '2026-11-13T10:00:00+08:00',
        digest_date: '2026-11-13',
      },
      {
        source: 'aihot',
        source_type: 'rss',
        parent_digest: 'daily-2026-11-13',
        url: 'https://example.com/digest-70',
        title: 'Upsilon Digest Seventy',
        score: 70,
        raw_content: 'U'.repeat(500),
        status: 'scored',
        published_at: '2026-11-13T02:00:00+08:00',
        digest_date: '2026-11-13',
      },
    ]);
    const sorted = storeSort.queryDailyBriefing({
      date: '2026-11-13',
      featuredMinScore: 70,
      digestMinScore: 60,
    });
    assert.deepStrictEqual(
      sorted.map((i) => i.title),
      ['Sigma Regular Ninety', 'Upsilon Digest Seventy', 'Tau Regular Seventy']
    );

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dirCap, { recursive: true, force: true });
    fs.rmSync(dirSort, { recursive: true, force: true });
  });

  it('W3 源权重 & 抓取窗口: aihot is tier_a (1.15) with maxItemsPerRun=2 while other 5 sources keep 20/15/20/20/20', () => {
    // Parse the shipped template rather than `data/sources.yaml`: that file is
    // gitignored (it is runtime state, generated on first run), so reading it
    // made this test fail on every fresh clone and in CI.
    const dataYaml = YAML.parse(DEFAULT_SOURCES_YAML);
    const sources: any[] = dataYaml?.sources || [];
    assert.strictEqual(sources.length, 6);

    const aihot = sources.find((s) => s.id === 'aihot');
    assert.strictEqual(aihot?.tier, 'tier_a');
    assert.strictEqual(sourceWeight(aihot?.tier), 1.15);
    assert.strictEqual(aihot?.maxItemsPerRun, 2);

    const expectedOtherLimits: Record<string, number> = {
      hn: 20,
      github: 15,
      'rss-openai': 20,
      'rss-deepmind': 20,
      'rss-simonw': 20,
    };
    for (const [id, expected] of Object.entries(expectedOtherLimits)) {
      const found = sources.find((s) => s.id === id);
      assert.strictEqual(found?.maxItemsPerRun, expected, `${id} maxItemsPerRun must remain ${expected}`);
    }

    // Also verify fresh auto-generated sources.yaml from IngestorManager matches
    const tmpDir = createTempDir('ai-news-v1-sources-');
    const mgr = new IngestorManager(path.join(tmpDir, 'sources.yaml'));
    const freshSources = mgr.getSources();
    const freshAihot = freshSources.find((s) => s.id === 'aihot');
    assert.strictEqual(freshAihot?.tier, 'tier_a');
    assert.strictEqual(freshAihot?.maxItemsPerRun, 2);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('空库首启 & W4 语言默认 / 持久化 / 非法值 / topics 合并', async () => {
    const tmpDir = createTempDir('ai-news-v1-lang-');
    const registeredRoutes: Record<string, any> = {};
    const mockCtx = {
      webServer: {
        register: (r: { path: string; handler: any }) => {
          registeredRoutes[r.path] = r.handler;
        },
      },
      effect: (fn: () => any) => {
        if (typeof fn === 'function') fn();
      },
    };

    try {
      const plugin = applyPlugin(mockCtx, {
        dataDir: tmpDir,
        storePath: path.join(tmpDir, 'signals.json'),
        syncIntervalMinutes: 0,
      });

      // 空库首启
      await plugin.runSync({ skipIngest: true });
      await plugin.waitForSync();
      assert.deepStrictEqual(plugin.store.queryDailyBriefing({ date: '2026-11-13' }), []);

      // 语言默认
      assert.strictEqual(plugin.getHealthSnapshot().display?.language, 'auto');

      // 先写 topics
      const topicsHandler = registeredRoutes['/dsh-plugins/ai-news-feed/topics'];
      const langHandler = registeredRoutes['/dsh-plugins/ai-news-feed/language'];
      assert.ok(topicsHandler, 'POST /topics route must exist');
      assert.ok(langHandler, 'POST /language route must exist');

      let resStatus = 200;
      let resBody = '';
      await langHandler(
        { method: 'POST', body: { language: 'en' } },
        {
          statusCode: 200,
          setHeader() {},
          end: (d: string) => { resBody = d; },
        }
      );
      assert.strictEqual(JSON.parse(resBody).language, 'en');

      const prefsAfterLang = JSON.parse(fs.readFileSync(path.join(tmpDir, 'preferences.json'), 'utf8'));
      assert.strictEqual(prefsAfterLang.language, 'en');

      // Invalid language -> 400 invalid_language
      const badRes: any = {
        statusCode: 200,
        setHeader() {},
        end: (d: string) => { resBody = d; },
      };
      await langHandler({ method: 'POST', body: { language: 'fr' } }, badRes);
      resStatus = badRes.statusCode;
      assert.strictEqual(resStatus, 400);
      assert.strictEqual(JSON.parse(resBody).error, 'invalid_language');

      // POST /topics merges instead of wiping language
      await topicsHandler(
        { method: 'POST', body: { topics: ['open-source'] } },
        { setHeader() {}, end: (d: string) => { resBody = d; } }
      );
      const prefsAfterTopics = JSON.parse(fs.readFileSync(path.join(tmpDir, 'preferences.json'), 'utf8'));
      assert.deepStrictEqual(prefsAfterTopics.topics, ['open-source']);
      assert.strictEqual(prefsAfterTopics.language, 'en', 'POST /topics must preserve existing language');

      // POST /language again preserves existing topics
      await langHandler(
        { method: 'POST', body: { language: 'zh' } },
        { setHeader() {}, end: (d: string) => { resBody = d; } }
      );
      const prefsFinal = JSON.parse(fs.readFileSync(path.join(tmpDir, 'preferences.json'), 'utf8'));
      assert.strictEqual(prefsFinal.language, 'zh');
      assert.deepStrictEqual(prefsFinal.topics, ['open-source'], 'POST /language must preserve existing topics');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('W4 文案 en 完整 & W2 空态 & W5 设置面板', () => {
    const clientPath = path.resolve(process.cwd(), 'lib/client.js');
    const clientCode = fs.readFileSync(clientPath, 'utf8');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://127.0.0.1/',
      runScripts: 'dangerously',
    });
    dom.window.__ModuleLoader__ = { load: () => {} };
    dom.window.eval(clientCode);

    const api = (dom.window as any).__dshAiNewsFeedClient;
    const zhKeys = Object.keys(api.I18N.zh);
    const enKeys = Object.keys(api.I18N.en);
    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
    assert.deepStrictEqual(missingInEn, [], 'I18N.en must cover every key in I18N.zh');

    for (const [k, v] of Object.entries(api.I18N.en)) {
      assert.strictEqual(
        /[\u4e00-\u9fff]/.test(String(v)),
        false,
        `I18N.en.${k} must not contain Chinese characters: ${v}`
      );
    }

    assert.strictEqual(api.t('empty_briefing', 'zh'), '今日暂无达标的重大更新，以下为最新动态');
    assert.strictEqual(
      api.t('empty_briefing', 'en'),
      'No major updates met the bar today — showing the latest feed below'
    );

    // W2 空态：rawExpanded 初始值 true
    assert.strictEqual(api.DEFAULT_RAW_EXPANDED, true);
    const clientSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/client.tsx'), 'utf8');
    assert.ok(clientSrc.includes('useState(DEFAULT_RAW_EXPANDED)'));

    // W5 设置面板：settingsOpen 默认 false；门槛从 health.thresholds 读取而非硬编码
    assert.strictEqual(api.DEFAULT_SETTINGS_OPEN, false);
    assert.ok(clientSrc.includes('useState(DEFAULT_SETTINGS_OPEN)'));
    assert.ok(clientSrc.includes('formatThresholdsSummary(health?.thresholds, effectiveLang)'));
    const formattedZh = api.formatThresholdsSummary(
      { featuredMinScore: 82, sTierScore: 88, browseMinScore: 64 },
      'zh'
    );
    assert.ok(formattedZh.includes('82') && formattedZh.includes('88') && formattedZh.includes('64'));

    dom.window.close();
  });

  it('标题双语文案: 单语摘要 + title_en 回落/优先', async () => {
    const thresholds = { sTierScore: 85, featuredMinScore: 80, browseMinScore: 60 };

    // 1. 端到端：模型返回 5 字段（摘要单语、标题双语）-> 正确落库
    const tmpDir = createTempDir('ai-news-v1-title-en-');
    try {
      const plugin = applyPlugin(
        {
          effect: (fn: () => any) => {
            if (typeof fn === 'function') fn();
          },
          llm: {
            call: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
              const sys = messages[0]?.content || '';
              if (sys.includes('高阶 AI 情报编辑')) {
                return JSON.stringify({
                  title_zh: 'OpenAI 发布推理编译器',
                  title_en: null,
                  summary: 'OpenAI 推出全新推理编译器，端到端吞吐提升两倍，延迟显著下降。',
                  why_it_matters: '显著降低线上大模型推理部署成本',
                  tags: ['openai', 'inference-compiler'],
                });
              }
              return JSON.stringify({ score: 86, topic_match: ['agent-infra'] });
            },
          },
        },
        {
          dataDir: tmpDir,
          storePath: path.join(tmpDir, 'signals.json'),
          syncIntervalMinutes: 0,
          scoreCalls: 1,
          fetchArticle: { enabled: false, minContentChars: 10 },
        }
      );

      await plugin.store.addItems([
        {
          source: 'rss-openai',
          source_type: 'rss',
          source_weight: 1.15,
          url: 'https://openai.com/news/inference-compiler',
          title: 'OpenAI Releases Inference Compiler',
          raw_content: 'Long detailed technical writeup on the new OpenAI inference compiler. '.repeat(10),
          published_at: '2026-11-13T08:00:00+08:00',
        },
      ]);

      await plugin.runSync({ skipIngest: true });
      await plugin.waitForSync();

      const stored = plugin.store.querySignals({ status: 'scored' })[0];
      assert.strictEqual(stored.title_zh, 'OpenAI 发布推理编译器');
      assert.strictEqual(stored.title_en, null);
      assert.strictEqual(stored.summary, 'OpenAI 推出全新推理编译器，端到端吞吐提升两倍，延迟显著下降。');
      assert.strictEqual(stored.why_it_matters, '显著降低线上大模型推理部署成本');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 2. 旧格式兼容：只返回 {summary, tags, title_zh} 仍可解析
    const legacyRes = await writeCopy(
      { title: 'Legacy Model Launch', raw_content: 'C'.repeat(500) },
      { mean: 84, thresholds, lang: 'zh' },
      async () => JSON.stringify({ summary: '旧格式单语摘要', tags: ['legacy-tag'], title_zh: '旧格式标题' })
    );
    assert.ok(legacyRes);
    assert.strictEqual(legacyRes.summary, '旧格式单语摘要');
    assert.strictEqual(legacyRes.title_zh, '旧格式标题');
    assert.strictEqual(legacyRes.title_en, null);

    // 3. 摘要为空 -> 返回 null，不写半截数据
    const emptyRes = await writeCopy(
      { title: 'No Summary', raw_content: 'E'.repeat(500) },
      { mean: 82, thresholds, lang: 'zh' },
      async () => JSON.stringify({ tags: ['no-summary'] })
    );
    assert.strictEqual(emptyRes, null);

    // 4-6. 前端 resolveCardTitles 的 title_en 逻辑
    const clientCode = fs.readFileSync(path.resolve(process.cwd(), 'lib/client.js'), 'utf8');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://127.0.0.1/',
      runScripts: 'dangerously',
    });
    dom.window.__ModuleLoader__ = { load: () => {} };
    dom.window.eval(clientCode);
    const api = (dom.window as any).__dshAiNewsFeedClient;

    // 4. title_en 为 null、title 英文 -> en 回落原文
    assert.deepStrictEqual(
      structuredClone(
        api.resolveCardTitles({ title: 'Native English Headline', title_zh: '中文译名', title_en: null }, 'en')
      ),
      { primaryTitle: 'Native English Headline', secondaryTitle: null }
    );

    // 5. title_en 有值 -> en 优先 title_en
    assert.deepStrictEqual(
      structuredClone(
        api.resolveCardTitles({ title: '原中文标题', title_en: 'Translated English Headline' }, 'en')
      ),
      { primaryTitle: 'Translated English Headline', secondaryTitle: null }
    );

    // 6. 中文源：zh 显示中文，en 显示英文
    const zhSourceItem = {
      title: 'DeepSeek 发布新版推理引擎',
      title_zh: 'DeepSeek 发布新版推理引擎',
      title_en: 'DeepSeek Releases New Inference Engine',
    };
    assert.strictEqual(api.resolveCardTitles(zhSourceItem, 'zh').primaryTitle, 'DeepSeek 发布新版推理引擎');
    assert.strictEqual(api.resolveCardTitles(zhSourceItem, 'en').primaryTitle, 'DeepSeek Releases New Inference Engine');

    dom.window.close();
  });
});
