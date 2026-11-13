import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const dataDir = path.join(rootDir, 'data');
const storePath = path.join(dataDir, 'signals.json');

const mockCtx = {
  baseDir: rootDir,
  tools: { register() {} },
};

const plugin = apply(mockCtx, {
  storePath,
  syncIntervalMinutes: 0,
});

console.log(`[PreviewServer] JsonStore initialized at ${storePath} (Current items: ${plugin.store.getItemsCount()})`);

const PORT = process.env.PORT || 3300;

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  // 1. API: /api/plugins/ai-news-feed/signals
  if (pathname === '/api/plugins/ai-news-feed/signals') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }
    const minScoreParam = reqUrl.searchParams.get('minScore');
    const minScore = minScoreParam !== null && minScoreParam !== '' ? Number(minScoreParam) : undefined;
    const limit = Number(reqUrl.searchParams.get('limit') || '30');
    const category = reqUrl.searchParams.get('category') || undefined;

    const items = plugin.store.querySignals({ minScore, limit, category });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ total: items.length, signals: items }));
    return;
  }

  // 1.1 API: /api/plugins/ai-news-feed/health
  if (pathname === '/api/plugins/ai-news-feed/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(plugin.getHealthSnapshot()));
    return;
  }

  // 1.2 API: /api/plugins/ai-news-feed/sync (Trigger manual fetch)
  if (pathname === '/api/plugins/ai-news-feed/sync') {
    plugin.runSync().then((result) => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // 2. Client script & vendor
  if (pathname === '/lib/client.js') {
    const filePath = path.join(rootDir, 'lib', 'client.js');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }
  if (pathname === '/lib/vendor-react.js') {
    const filePath = path.join(rootDir, 'lib', 'vendor-react.js');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  // 3. Icon: /icon.svg
  if (pathname === '/icon.svg') {
    const iconPath = path.join(rootDir, 'icon.svg');
    if (fs.existsSync(iconPath)) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(fs.readFileSync(iconPath));
      return;
    }
  }

  // 4. Default: Preview Shell HTML
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPreviewHtml());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function renderPreviewHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DeepSeek Harness - AI News Feed Preview</title>
  <style>
    :root {
      --dsh-bg-base: #ffffff;
      --dsh-bg-surface: #f8fafc;
      --dsh-bg-card: #ffffff;
      --dsh-bg-muted: #f1f5f9;
      --dsh-text-primary: #0f172a;
      --dsh-text-secondary: #475569;
      --dsh-text-muted: #94a3b8;
      --dsh-border-color: #e2e8f0;
      --dsh-border-hover: #cbd5e1;
      --dsh-primary: #4f46e5;
      --dsh-primary-hover: #4338ca;
      --dsh-accent: #06b6d4;
    }
    html.dark {
      --dsh-bg-base: #0f172a;
      --dsh-bg-surface: #1e293b;
      --dsh-bg-card: #1e293b;
      --dsh-bg-muted: #334155;
      --dsh-text-primary: #f8fafc;
      --dsh-text-secondary: #cbd5e1;
      --dsh-text-muted: #64748b;
      --dsh-border-color: #334155;
      --dsh-border-hover: #475569;
      --dsh-primary: #6366f1;
      --dsh-primary-hover: #4f46e5;
      --dsh-accent: #22d3ee;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--dsh-bg-base);
      color: var(--dsh-text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Navigation */
    header {
      height: 52px;
      border-bottom: 1px solid var(--dsh-border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background-color: var(--dsh-bg-surface);
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 15px;
    }
    .brand-tag {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(99, 102, 241, 0.15);
      color: var(--dsh-primary);
      font-weight: 600;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .theme-toggle-btn {
      background: none;
      border: 1px solid var(--dsh-border-color);
      color: var(--dsh-text-primary);
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }

    /* Main Container */
    .app-container {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* Left Sidebar */
    aside {
      width: 240px;
      border-right: 1px solid var(--dsh-border-color);
      background-color: var(--dsh-bg-surface);
      padding: 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex-shrink: 0;
    }
    .sidebar-section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--dsh-text-muted);
      font-weight: 600;
      padding: 0 4px;
    }
    .sidebar-item {
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 13px;
      color: var(--dsh-text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .sidebar-item.active {
      background-color: var(--dsh-bg-muted);
      color: var(--dsh-text-primary);
      font-weight: 500;
    }

    /* Center Chat Workspace */
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      background-color: var(--dsh-bg-base);
    }
    .conversation-stream {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .chat-bubble {
      max-width: 800px;
      line-height: 1.6;
      font-size: 14px;
      padding: 14px 18px;
      border-radius: 10px;
    }
    .chat-bubble.user {
      align-self: flex-end;
      background-color: var(--dsh-primary);
      color: #ffffff;
    }
    .chat-bubble.agent {
      align-self: flex-start;
      background-color: var(--dsh-bg-surface);
      border: 1px solid var(--dsh-border-color);
      color: var(--dsh-text-primary);
    }

    /* Bottom Composer Dock */
    .composer-dock-container {
      padding: 12px 24px 20px;
      border-top: 1px solid var(--dsh-border-color);
      background-color: var(--dsh-bg-surface);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .composer-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .composer-input-box {
      width: 100%;
      min-height: 80px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--dsh-border-color);
      background-color: var(--dsh-bg-base);
      color: var(--dsh-text-primary);
      font-size: 13.5px;
      line-height: 1.5;
      font-family: inherit;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .composer-input-box:focus {
      border-color: var(--dsh-primary);
    }
    .composer-bottom-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 4px;
    }
    .send-btn {
      background-color: var(--dsh-primary);
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    #header-action-slot {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
  </style>

  <!-- Local React 19 + ReactDOM Bundle -->
  <script src="/lib/vendor-react.js"></script>
</head>
<body>

  <!-- Top Navigation -->
  <header>
    <div class="brand">
      <span>🚀 DeepSeek Harness</span>
      <span class="brand-tag">v0.1 Plugin Preview</span>
    </div>
    <div class="header-actions">
      <!-- conversation.session.header.actions slot -->
      <div id="header-action-slot"></div>
      <button class="theme-toggle-btn" id="theme-btn" onclick="toggleTheme()">☀️ 切换明暗</button>
    </div>
  </header>

  <!-- Main Container -->
  <div class="app-container">
    <!-- Left Sidebar -->
    <aside>
      <div class="sidebar-section-title">会话列表</div>
      <div class="sidebar-item active">💬 AI 动态深度研判</div>
      <div class="sidebar-item">📁 项目工作区</div>
      <div class="sidebar-item">⚙️ Harness 插件管理</div>
    </aside>

    <!-- Center Workspace -->
    <main>
      <div class="conversation-stream">
        <div class="chat-bubble user">
          请帮我持续追踪今天关于 AI 领域的最新前沿动态与重大突破。
        </div>
        <div class="chat-bubble agent">
          已连接本地情报库 <code>signals.db</code>（当前收录 15,800+ 动态）。<br><br>
          👉 <strong>操作提示</strong>：你可以随时点击页面右上角或下方输入框工具栏的 <strong>【⚡ AI 情报流】</strong> 按钮唤起前沿情报抽屉：<br>
          1. <strong>🔥 S级精选</strong>：聚焦 $\ge 85$ 分行业战略突破。<br>
          2. <strong>⚡ 最新流</strong>：按发布时间排列最新 AI 资讯。<br>
          3. 点击卡片底部的 <strong>【💬 引入对话】</strong>，即可将该条动态及原链接自动排版并填入输入框，随时展开深度推演！
        </div>
      </div>

      <!-- Bottom Composer Dock -->
      <div class="composer-dock-container">
        <div class="composer-toolbar">
          <!-- conversation.composer.dock slot -->
          <div id="composer-dock-slot"></div>
          <span style="font-size: 11px; color: var(--dsh-text-muted);">（点击左侧按钮展开抽屉，或点击卡片“引入对话”自动填入下方）</span>
        </div>

        <textarea
          id="main-composer-textarea"
          data-composer-input="true"
          class="composer-input-box"
          placeholder="输入消息或指令，或从 AI 情报流中一键引入背景... (Enter 发送)"
        ></textarea>

        <div class="composer-bottom-bar">
          <span style="font-size: 12px; color: var(--dsh-text-muted);">模型: deepseek-chat</span>
          <button class="send-btn" onclick="handleSend()">发送</button>
        </div>
      </div>
    </main>
  </div>

  <script>
    function toggleTheme() {
      const html = document.documentElement;
      if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        document.getElementById('theme-btn').innerText = '🌙 切换深色';
      } else {
        html.classList.add('dark');
        document.getElementById('theme-btn').innerText = '☀️ 切换浅色';
      }
    }

    function handleSend() {
      const ta = document.getElementById('main-composer-textarea');
      if (!ta.value.trim()) return;
      alert('模拟发送指令：\\n\\n' + ta.value);
      ta.value = '';
    }
  </script>

  <!-- 模拟 DSH ModuleLoader 与 Slots 系统并加载插件 -->
  <script type="module">
    import { registerClient } from '/lib/client.js';

    window.onerror = function(msg, url, line, col, err) {
      console.error('[Preview Error]', msg, err);
      const box = document.createElement('div');
      box.style = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:8px 16px;border-radius:6px;font-size:12px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      box.innerHTML = '⚠️ 页面组件加载异常: ' + msg;
      document.body.appendChild(box);
    };

    // 1. 初始化 DSH ModuleLoader
    const registeredModules = [];
    window.__ModuleLoader__ = {
      load(entry) {
        registeredModules.push(entry);
      }
    };

    // 2. 执行客户端注册
    registerClient();

    // 3. 构建 Slots 模拟上下文
    const slots = {
      'conversation.composer.dock': [],
      'conversation.session.header.actions': [],
    };

    const ctx = {
      slots: {
        inject(slotName, callback) {
          callback();
        },
        register(meta, component) {
          if (slots[meta.name]) {
            slots[meta.name].push({ meta, component });
          }
        }
      }
    };

    // 4. 激活插件
    for (const mod of registeredModules) {
      const instance = mod.factory((modName) => {
        if (modName === 'react') return window.React;
        if (modName === 'react-dom') return window.ReactDOM;
        return null;
      });
      if (instance && instance.apply) {
        instance.apply(ctx);
      }
    }

    // 5. 将注册的微组件渲染到对应槽位
    const { createElement, Fragment } = window.React;
    const { createRoot } = window.ReactDOM;

    // 渲染到 Header Action 槽位
    const headerSlotEl = document.getElementById('header-action-slot');
    if (headerSlotEl && slots['conversation.session.header.actions'].length > 0) {
      const root = createRoot(headerSlotEl);
      const components = slots['conversation.session.header.actions'].map(s => createElement(s.component, { key: s.meta.id }));
      root.render(createElement(Fragment, null, ...components));
    }

    // 渲染到 Composer Dock 槽位
    const composerSlotEl = document.getElementById('composer-dock-slot');
    if (composerSlotEl && slots['conversation.composer.dock'].length > 0) {
      const root = createRoot(composerSlotEl);
      const components = slots['conversation.composer.dock'].map(s => createElement(s.component, { key: s.meta.id }));
      root.render(createElement(Fragment, null, ...components));
    }
  </script>
</body>
</html>`;
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n============================================================`);
  console.log(`🚀 DeepSeek Harness Plugin Preview Server is RUNNING!`);
  console.log(`🔗 Local URL: http://127.0.0.1:${PORT}`);
  console.log(`📡 Backend API: http://127.0.0.1:${PORT}/api/plugins/ai-news-feed/signals`);
  console.log(`============================================================\n`);
});
