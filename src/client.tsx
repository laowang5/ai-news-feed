/**
 * Client-side Web UI extension for DeepSeek Harness (DSH).
 * Provides a Medium-Density AI News Feed sidebar drawer & composer entry.
 * Follows specs defined in docs/spec/v0.1-spec.md and docs/spec/v0.9-experience-fixes.md.
 */

declare const window: any;

function registerClient() {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) {
    return;
  }

  const DEFAULT_RAW_EXPANDED = true;
  const DEFAULT_SETTINGS_OPEN = false;

  const I18N: { zh: Record<string, string>; en: Record<string, string> } = {
    zh: {
      title: 'AI 情报流',
      trigger_subtitle: '· 汇聚前沿精选动态',
      trigger_title: '打开 AI 前沿情报抽屉',
      lang_short: '中',
      lang_toggle_title: '切换标题显示语言（中 / EN）',
      settings: '设置',
      refresh_title: '刷新信号库',
      close_title: '关闭情报抽屉',
      settings_language: '语言',
      lang_auto: '跟随系统',
      lang_zh: '中文',
      lang_en: 'English',
      settings_topics: '关注主题',
      settings_topics_hint: '勾选的主题在评分时获得最高 +5 加权（至少保留 1 个）',
      settings_thresholds: '门槛',
      settings_thresholds_value: '必看 ≥{featured} · S级 ≥{sTier} · 原始流 ≥{browse}（只读）',
      topic_agent_infra: 'Agent 基建',
      topic_model_release: '模型发布',
      topic_open_source: '开源工具',
      topic_business: '融资与商业',
      topics_summary: '关注：{topics}',
      topics_none: '未选择',
      include_read_on: '☑ 显示全部（含已读）',
      include_read_off: '☐ 显示全部（含已读）',
      mark_all_read: '全部已读',
      sync_progress: '同步中 ({completed}/{total}): {source}...',
      no_llm_banner: '⚠️ 未检测到大模型服务，当前今日必看为空，可在下方原始流查看未评分条目。',
      llm_broken_banner:
        '⚠️ 大模型调用失败（{error}），评分已暂停。请检查插件配置里的 llmModel / llmProvider，或稍后重试。',
      llm_route_hint: '评分模型：{route}',
      budget_exhausted_banner: '💰 今日大模型调用预算已达上限（{used}/{limit} 次），新动态保持原始展示，次日零点自动重置。',
      briefing_heading: '📌 今日必看 ({count}/5)',
      sync_now: '⚡ 立即同步',
      syncing_btn: '⏳ 同步中...',
      loading_briefing: '正在加载今日情报...',
      empty_briefing: '今日暂无达标的重大更新，以下为最新动态',
      raw_stream_heading: '📡 原始流（{count}）',
      collapse: '▼ 收起',
      expand: '▶ 展开',
      sort_label: '排序方式',
      sort_smart: '智能',
      sort_latest: '最新',
      sort_score: '分数',
      empty_raw: '暂无原始流条目',
      badge_pending: '⏳ 待评分',
      badge_s: 'S · {score}分',
      badge_a: 'A · {score}分',
      badge_b: 'B · {score}分',
      badge_score: '{score}分',
      source_count_badge: '{count} 源报道',
      topic_hit: '· 命中你的关注：{topic}',
      read_label: '已读',
      time_just_now: '刚刚',
      time_hours_ago: '{hours}小时前',
      time_yesterday: '昨天',
      time_days_ago: '{days}天前',
      why_it_matters: '为什么重要：{text}',
      summary_collapse_title: '点击收起',
      summary_expand_title: '点击展开全文摘要并标记已读',
      copy_btn: '📋 复制',
      copy_title: '复制卡片摘要',
      source_link_btn: '🔗 原文',
      inject_btn: '💬 引入对话',
      inject_title: '将本条动态背景填入会话输入框进行深度讨论',
      toast_copied_summary: '📋 摘要已复制到剪贴板',
      toast_injected: '✅ 已成功填入会话输入框',
      toast_clipboard_fallback: '📋 已复制到剪贴板（无法直接写入输入框）',
      toast_marked_unread: '已标记未读',
      quote_pending: '待评分',
      quote_s_tier: 'S级 · {score}分',
      quote_a_tier: 'A级 · {score}分',
      quote_scored: '评分 · {score}分',
      quote_source_link: '原文链接: {url}',
      quote_prompt: '请结合上述 AI 前沿动态，帮我分析：',
      copy_template: '【{source}】{title}\n评分: {score}分\n摘要: {summary}\n链接: {url}',
    },
    en: {
      title: 'AI Feed',
      trigger_subtitle: '· Curated Frontier Signals',
      trigger_title: 'Open AI News Feed Drawer',
      lang_short: 'EN',
      lang_toggle_title: 'Switch display language (ZH / EN)',
      settings: 'Settings',
      refresh_title: 'Refresh feed',
      close_title: 'Close drawer',
      settings_language: 'Language',
      lang_auto: 'System',
      lang_zh: 'Chinese',
      lang_en: 'English',
      settings_topics: 'Topics',
      settings_topics_hint: 'Selected topics receive up to +5 score boost (keep at least 1)',
      settings_thresholds: 'Thresholds',
      settings_thresholds_value: 'Briefing >={featured} · S-Tier >={sTier} · Feed >={browse} (read-only)',
      topic_agent_infra: 'Agent Infra',
      topic_model_release: 'Model Releases',
      topic_open_source: 'Open-source Tools',
      topic_business: 'Funding & Business',
      topics_summary: 'Following: {topics}',
      topics_none: 'None',
      include_read_on: '☑ Show all (incl. read)',
      include_read_off: '☐ Show all (incl. read)',
      mark_all_read: 'Mark all read',
      sync_progress: 'Syncing ({completed}/{total}): {source}...',
      no_llm_banner: '⚠️ No LLM service detected. Daily Briefing is empty; browse unscored items below.',
      llm_broken_banner:
        '⚠️ LLM calls are failing ({error}), so scoring is paused. Check llmModel / llmProvider in the plugin config, or retry later.',
      llm_route_hint: 'Scoring model: {route}',
      budget_exhausted_banner: '💰 Daily LLM call budget exhausted ({used}/{limit}). New items remain unscored until midnight reset.',
      briefing_heading: '📌 Daily Briefing ({count}/5)',
      sync_now: '⚡ Sync Now',
      syncing_btn: '⏳ Syncing...',
      loading_briefing: 'Loading daily briefing...',
      empty_briefing: 'No major updates met the bar today — showing the latest feed below',
      raw_stream_heading: '📡 Raw Feed ({count})',
      collapse: '▼ Collapse',
      expand: '▶ Expand',
      sort_label: 'Sort by',
      sort_smart: 'Smart',
      sort_latest: 'Latest',
      sort_score: 'Score',
      empty_raw: 'No items in feed',
      badge_pending: '⏳ Pending',
      badge_s: 'S · {score}',
      badge_a: 'A · {score}',
      badge_b: 'B · {score}',
      badge_score: '{score} pts',
      source_count_badge: '{count} sources',
      topic_hit: '· Matched topic: {topic}',
      read_label: 'Read',
      time_just_now: 'just now',
      time_hours_ago: '{hours}h ago',
      time_yesterday: 'yesterday',
      time_days_ago: '{days}d ago',
      why_it_matters: 'Why it matters: {text}',
      summary_collapse_title: 'Click to collapse',
      summary_expand_title: 'Click to expand summary and mark as read',
      copy_btn: '📋 Copy',
      copy_title: 'Copy summary',
      source_link_btn: '🔗 Source',
      inject_btn: '💬 Discuss',
      inject_title: 'Insert into chat input for discussion',
      toast_copied_summary: '📋 Summary copied to clipboard',
      toast_injected: '✅ Inserted into chat input',
      toast_clipboard_fallback: '📋 Copied to clipboard (chat input unavailable)',
      toast_marked_unread: 'Marked as unread',
      quote_pending: 'Pending',
      quote_s_tier: 'S-Tier · {score}',
      quote_a_tier: 'A-Tier · {score}',
      quote_scored: 'Score · {score}',
      quote_source_link: 'Source URL: {url}',
      quote_prompt: 'Based on the AI update above, please analyze:',
      copy_template: '[{source}] {title}\nScore: {score}\nSummary: {summary}\nURL: {url}',
    },
  };

  function t(key: string, lang: 'zh' | 'en', vars?: Record<string, string | number>): string {
    const dict = lang === 'en' ? I18N.en : I18N.zh;
    let template = dict[key] ?? I18N.zh[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        template = template.split(`{${k}}`).join(String(v));
      }
    }
    return template;
  }

  function formatThresholdsSummary(
    thresholds?: { featuredMinScore?: number; sTierScore?: number; browseMinScore?: number },
    lang: 'zh' | 'en' = 'zh'
  ): string {
    return t('settings_thresholds_value', lang, {
      featured: thresholds?.featuredMinScore ?? 80,
      sTier: thresholds?.sTierScore ?? 85,
      browse: thresholds?.browseMinScore ?? 60,
    });
  }

  // 纯工具函数（脱离 React 组件，便于单测直接验证 W1/W2/W3/W4/W5 逻辑）
  function resolveEffectiveLanguage(lang?: string, navLang?: string): 'zh' | 'en' {
    if (lang === 'en') return 'en';
    if (lang === 'zh') return 'zh';
    if (lang === 'auto') {
      const detected =
        navLang !== undefined
          ? navLang
          : typeof navigator !== 'undefined' && navigator.language
            ? navigator.language
            : 'zh-CN';
      return /^zh\b/i.test(detected) ? 'zh' : 'en';
    }
    return 'zh';
  }

  function resolveCardTitles(
    item: { title: string; title_zh?: string | null; title_en?: string | null },
    lang?: string,
    navLang?: string
  ): { primaryTitle: string; secondaryTitle: string | null } {
    const eff = resolveEffectiveLanguage(lang, navLang);
    if (eff === 'en') {
      const en = typeof item.title_en === 'string' ? item.title_en.trim() : '';
      return {
        primaryTitle: en || item.title,
        secondaryTitle: null,
      };
    }
    const zh = typeof item.title_zh === 'string' ? item.title_zh.trim() : '';
    if (eff === 'zh' && zh.length > 0) {
      return {
        primaryTitle: zh,
        secondaryTitle: zh !== item.title.trim() ? item.title : null,
      };
    }
    return {
      primaryTitle: item.title,
      secondaryTitle: null,
    };
  }

  function itemTimestamp(item: any): number {
    const raw = item?.published_at || item?.fetched_at;
    if (!raw) return 0;
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }

  function sortSignalsForDisplay(items: any[], mode: 'smart' | 'latest' | 'score'): any[] {
    if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? items : [];
    const copy = [...items];
    if (mode === 'latest') {
      return copy.sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
    }
    if (mode === 'score') {
      return copy.sort((a, b) => {
        const diff = (b.score || 0) - (a.score || 0);
        if (diff !== 0) return diff;
        return itemTimestamp(b) - itemTimestamp(a);
      });
    }
    // 'smart': 已评分优先（组内分数降序，同分最新优先）→ 待评分（最新优先）
    return copy.sort((a, b) => {
      const aScored = a.status === 'scored' ? 0 : 1;
      const bScored = b.status === 'scored' ? 0 : 1;
      if (aScored !== bScored) return aScored - bScored;
      if (a.status === 'scored' && b.status === 'scored') {
        const diff = (b.score || 0) - (a.score || 0);
        if (diff !== 0) return diff;
      }
      return itemTimestamp(b) - itemTimestamp(a);
    });
  }

  function isElementVisibleForComposer(el: any): boolean {
    if (!el) return false;
    if (el.closest && el.closest('.dsh-ai-news-feed-root')) return false;
    if (el.hidden || el.disabled) return false;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
    if (el.offsetParent === null) return false;
    return true;
  }

  function findComposerInput(rootDoc?: any): any {
    const doc = rootDoc || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;

    const selectors = [
      '[data-composer-input]',
      'textarea[data-composer-input]',
      'textarea',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
    ];

    for (const sel of selectors) {
      let candidates: any[] = [];
      try {
        candidates = Array.from(doc.querySelectorAll(sel));
      } catch {
        candidates = [];
      }
      for (const el of candidates) {
        if (isElementVisibleForComposer(el)) {
          return el;
        }
      }
    }
    return null;
  }

  function injectIntoComposer(
    item: any,
    setToast: (msg: string) => void,
    env?: { document?: any; navigator?: any; lang?: string }
  ): boolean {
    const doc = env?.document || (typeof document !== 'undefined' ? document : null);
    const nav = env?.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    const effLang = resolveEffectiveLanguage(env?.lang || 'zh');

    const { primaryTitle } = resolveCardTitles(item, effLang);
    const scoreVal = item.score || 0;
    const scoreLabel =
      item.status === 'pending'
        ? t('quote_pending', effLang)
        : scoreVal >= 85
          ? t('quote_s_tier', effLang, { score: scoreVal })
          : scoreVal >= 80
            ? t('quote_a_tier', effLang, { score: scoreVal })
            : t('quote_scored', effLang, { score: scoreVal });

    const quoteText = [
      `> **[${item.source}] ${primaryTitle} (${scoreLabel})**`,
      `> ${item.summary || primaryTitle}`,
      `> ${t('quote_source_link', effLang, { url: item.url })}`,
      '',
      t('quote_prompt', effLang),
    ].join('\n');

    const composerInput = findComposerInput(doc);
    let verified = false;

    if (composerInput) {
      const tag = String(composerInput.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA') {
        const currentVal = String(composerInput.value || '');
        const nextVal = currentVal ? `${currentVal}\n\n${quoteText}` : quoteText;
        const win = doc?.defaultView;
        const taProto =
          (win && win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype) ||
          (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : null) ||
          Object.getPrototypeOf(composerInput);
        const nativeSetter = taProto ? Object.getOwnPropertyDescriptor(taProto, 'value')?.set : undefined;
        if (nativeSetter) {
          nativeSetter.call(composerInput, nextVal);
        } else {
          composerInput.value = nextVal;
        }
        const EventCtor = (win && win.Event) || (typeof Event !== 'undefined' ? Event : null);
        if (EventCtor) {
          composerInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
        }
        verified = String(composerInput.value || '').includes(quoteText);
      } else {
        composerInput.focus?.();
        const existing = String(composerInput.textContent || composerInput.innerText || '');
        const insertPayload = existing ? `\n\n${quoteText}` : quoteText;
        let execOk = false;
        try {
          if (doc && typeof doc.execCommand === 'function') {
            execOk = Boolean(doc.execCommand('insertText', false, insertPayload));
          }
        } catch {
          execOk = false;
        }
        if (!execOk) {
          const nextText = existing ? `${existing}\n\n${quoteText}` : quoteText;
          composerInput.innerText = nextText;
          if (!composerInput.textContent) {
            composerInput.textContent = nextText;
          }
          const win = doc?.defaultView;
          const InputEventCtor =
            (win && win.InputEvent) || (typeof InputEvent !== 'undefined' ? InputEvent : null);
          const EventCtor = (win && win.Event) || (typeof Event !== 'undefined' ? Event : null);
          if (InputEventCtor) {
            composerInput.dispatchEvent(
              new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: quoteText })
            );
          } else if (EventCtor) {
            composerInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
          }
        }
        const readBack = String(composerInput.textContent || composerInput.innerText || '');
        verified = readBack.includes(quoteText);
      }
    }

    if (composerInput && verified) {
      composerInput.focus?.();
      setToast(t('toast_injected', effLang));
      setTimeout(() => setToast(''), 2500);
      return true;
    }

    try {
      nav?.clipboard?.writeText?.(quoteText);
    } catch {
      // ignore clipboard errors
    }
    setToast(t('toast_clipboard_fallback', effLang));
    setTimeout(() => setToast(''), 2500);
    return false;
  }

  // 暴露供单测使用（不引入顶层 export，保证 classic script 兼容）
  try {
    (globalThis as any).__dshAiNewsFeedClient = {
      I18N,
      t,
      formatThresholdsSummary,
      DEFAULT_RAW_EXPANDED,
      DEFAULT_SETTINGS_OPEN,
      resolveEffectiveLanguage,
      resolveCardTitles,
      sortSignalsForDisplay,
      findComposerInput,
      injectIntoComposer,
    };
  } catch {
    // ignore
  }

  window.__ModuleLoader__.load({
    id: 'ai-news-feed',
    factory(require: any) {
      const React = require('react');
      const ReactDOM = require('react-dom');
      const h = React.createElement;
      const { useState, useEffect, useCallback, useMemo, useRef } = React;

      // 动态注入组件基础样式、主题覆盖与动画
      function ensureStyles() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('dsh-ai-news-feed-styles')) return;
        const style = document.createElement('style');
        style.id = 'dsh-ai-news-feed-styles';
        style.textContent = `
          @keyframes dshSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes dshFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .dsh-ai-news-feed-root[data-theme='light'] {
            --dsw-alias-bg-base: #ffffff;
            --dsw-alias-bg-layer-1: #f8fafc;
            --dsw-alias-bg-layer-2: #f1f5f9;
            --dsw-alias-bg-layer-3: #e2e8f0;
            --dsw-alias-bg-overlay: #1e293b;
            --dsw-alias-card-fill: #ffffff;
            --dsw-alias-card-fill-hover: #f8fafc;
            --dsw-alias-label-primary: #0f172a;
            --dsw-alias-label-secondary: #475569;
            --dsw-alias-label-tertiary: #94a3b8;
            --dsw-alias-border-l1: #e2e8f0;
            --dsw-alias-border-l2: #cbd5e1;
            --dsw-alias-border-l3: #94a3b8;
            --dsw-alias-border-l4: #64748b;
          }
          .dsh-ai-news-feed-root[data-theme='dark'] {
            --dsw-alias-bg-base: #111318;
            --dsw-alias-bg-layer-1: #181b22;
            --dsw-alias-bg-layer-2: #222630;
            --dsw-alias-bg-layer-3: #2d3340;
            --dsw-alias-bg-overlay: #272b36;
            --dsw-alias-card-fill: #181b22;
            --dsw-alias-card-fill-hover: #1f242d;
            --dsw-alias-label-primary: #f1f5f9;
            --dsw-alias-label-secondary: #cbd5e1;
            --dsw-alias-label-tertiary: #94a3b8;
            --dsw-alias-border-l1: #2a2f3a;
            --dsw-alias-border-l2: #3a4150;
            --dsw-alias-border-l3: #4b5563;
            --dsw-alias-border-l4: #6b7280;
          }
          .dsh-signal-card {
            transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
          }
          .dsh-signal-card:hover {
            transform: translateY(-1px);
            background-color: var(--dsw-alias-card-fill-hover, #f8fafc) !important;
            border-color: var(--dsw-alias-border-l2, #cbd5e1) !important;
          }
          .dsh-trigger-btn:hover {
            background-color: var(--dsw-alias-card-fill-hover, #f8fafc) !important;
            border-color: var(--dsw-alias-border-l2, #cbd5e1) !important;
          }
          .dsh-card-title-link:hover {
            color: var(--dsw-alias-brand-primary, #4f46e5) !important;
            text-decoration: underline !important;
          }
          .dsh-custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .dsh-custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .dsh-custom-scrollbar::-webkit-scrollbar-thumb {
            background: var(--dsw-alias-border-l2, #cbd5e1);
            border-radius: 3px;
          }
          .dsh-custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: var(--dsw-alias-label-tertiary, #94a3b8);
          }
        `;
        document.head.appendChild(style);
      }

      // 格式化相对时间
      function formatRelativeTime(dateStr?: string, lang: 'zh' | 'en' = 'zh') {
        if (!dateStr) return t('time_just_now', lang);
        try {
          const date = new Date(dateStr);
          const now = new Date();
          const diffMs = now.getTime() - date.getTime();
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          if (diffHours < 1) return t('time_just_now', lang);
          if (diffHours < 24) return t('time_hours_ago', lang, { hours: diffHours });
          const diffDays = Math.floor(diffHours / 24);
          if (diffDays === 1) return t('time_yesterday', lang);
          if (diffDays < 7) return t('time_days_ago', lang, { days: diffDays });
          return `${date.getMonth() + 1}-${date.getDate()}`;
        } catch {
          return dateStr.slice(0, 10);
        }
      }

      // 复制卡片摘要
      function copyCardSummary(item: any, setToast: (msg: string) => void, lang: string) {
        const effLang = resolveEffectiveLanguage(lang);
        const { primaryTitle } = resolveCardTitles(item, effLang);
        const text = t('copy_template', effLang, {
          source: item.source,
          title: primaryTitle,
          score: item.score || 0,
          summary: item.summary || '',
          url: item.url,
        });
        navigator.clipboard?.writeText?.(text);
        setToast(t('toast_copied_summary', effLang));
        setTimeout(() => setToast(''), 2000);
      }

      const TOPIC_OPTIONS = [
        { id: 'agent-infra', key: 'topic_agent_infra' },
        { id: 'model-release', key: 'topic_model_release' },
        { id: 'open-source', key: 'topic_open_source' },
        { id: 'business', key: 'topic_business' },
      ];

      function getTopicLabelById(id: string, lang: 'zh' | 'en' = 'zh'): string | null {
        const found = TOPIC_OPTIONS.find((opt) => opt.id === id);
        return found ? t(found.key, lang) : null;
      }

      // 单条新闻卡片组件 (v1.0 两层密度 + 主题/多源徽标)
      function SignalCard({
        item,
        lang,
        isBriefing,
        onInject,
        onCopy,
        onMarkRead,
      }: {
        item: any;
        lang: string;
        isBriefing?: boolean;
        onInject: (i: any) => void;
        onCopy: (i: any) => void;
        onMarkRead?: (id: number) => void;
      }) {
        const [expandedDetail, setExpandedDetail] = useState(false);
        const effLang = resolveEffectiveLanguage(lang);
        const isPending = item.status === 'pending';
        const score = item.score || 0;
        const isSTier =
          typeof item.is_s_tier === 'boolean' ? item.is_s_tier : score >= 85;
        const isATier = !isSTier && score >= 80;
        const isBTier = !isSTier && !isATier && score >= 60;
        const { primaryTitle, secondaryTitle } = resolveCardTitles(item, effLang);
        const sourceCount = item.source_count || 1;
        const firstTopicId =
          Array.isArray(item.topic_match) && item.topic_match.length > 0
            ? item.topic_match[0]
            : null;
        const matchedTopicLabel = firstTopicId ? getTopicLabelById(firstTopicId, effLang) : null;
        const isRead = Boolean(item.read_at);

        let badgeText = isSTier
          ? t('badge_s', effLang, { score })
          : isATier
          ? t('badge_a', effLang, { score })
          : isBTier
          ? t('badge_b', effLang, { score })
          : t('badge_score', effLang, { score });

        let badgeBg: string = isSTier
          ? 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)'
          : isATier
          ? 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)'
          : isBTier
          ? 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)'
          : 'var(--dsw-alias-bg-layer-2, #f1f5f9)';

        let badgeColor: string =
          !isPending && (isSTier || isATier || isBTier)
            ? 'var(--dsw-alias-label-on-brand, #ffffff)'
            : 'var(--dsw-alias-label-secondary, #475569)';

        if (isPending) {
          badgeText = t('badge_pending', effLang);
          badgeBg = 'var(--dsw-alias-bg-layer-2, #f1f5f9)';
          badgeColor = 'var(--dsw-alias-label-secondary, #475569)';
        }

        const handleOpenItem = () => {
          onMarkRead?.(item.id);
        };

        return h(
          'div',
          {
            className: 'dsh-signal-card',
            style: {
              padding: '12px 14px',
              borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
              backgroundColor: 'var(--dsw-alias-card-fill, #ffffff)',
              opacity: isRead ? 0.72 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: isSTier
                ? '0 2px 8px -2px rgba(139, 92, 246, 0.15), 0 1px 3px rgba(0, 0, 0, 0.05)'
                : '0 1px 3px rgba(0, 0, 0, 0.04)',
            },
          },
          // 头部：评级徽章 + 信源 + N源报道 + 命中关注 + 发布时间
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                fontSize: '11px',
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } },
              h(
                'span',
                {
                  style: {
                    padding: '2px 7px',
                    borderRadius: '4px',
                    fontWeight: 700,
                    fontSize: '11px',
                    color: badgeColor,
                    background: badgeBg,
                    boxShadow: isSTier && !isPending ? '0 1px 4px rgba(236, 72, 153, 0.3)' : 'none',
                  },
                },
                badgeText
              ),
              h(
                'span',
                {
                  style: {
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--dsw-alias-bg-layer-2, #f1f5f9)',
                    color: 'var(--dsw-alias-label-secondary, #475569)',
                    fontWeight: 500,
                  },
                },
                item.source
              ),
              sourceCount > 1
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: '11px',
                        color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                      },
                    },
                    t('source_count_badge', effLang, { count: sourceCount })
                  )
                : null,
              matchedTopicLabel
                ? h(
                    'span',
                    {
                      style: {
                        fontSize: '11px',
                        color: 'var(--dsw-alias-brand-primary, #4f46e5)',
                        fontWeight: 500,
                      },
                    },
                    t('topic_hit', effLang, { topic: matchedTopicLabel })
                  )
                : null
            ),
            h(
              'span',
              {
                style: {
                  color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                },
              },
              isRead ? t('read_label', effLang) : formatRelativeTime(item.published_at || item.fetched_at, effLang)
            )
          ),

          // 主标题（点击外部打开同时标记已读）
          h(
            'a',
            {
              href: item.url,
              target: '_blank',
              rel: 'noopener noreferrer',
              onClick: handleOpenItem,
              className: 'dsh-card-title-link',
              style: {
                fontWeight: 600,
                fontSize: '13.5px',
                lineHeight: '1.4',
                color: 'var(--dsw-alias-label-primary, #0f172a)',
                textDecoration: 'none',
              },
            },
            primaryTitle
          ),

          // 为什么重要（仅今日必看卡片展示一行）
          isBriefing && item.why_it_matters
            ? h(
                'div',
                {
                  title: item.why_it_matters,
                  style: {
                    fontSize: '12px',
                    lineHeight: '1.4',
                    color: 'var(--dsw-alias-label-secondary, #475569)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                t('why_it_matters', effLang, { text: item.why_it_matters })
              )
            : null,

          // 核心研判摘要（点击展开详情可触发已读）
          item.summary
            ? h(
                'div',
                {
                  onClick: () => {
                    setExpandedDetail((prev: boolean) => !prev);
                    onMarkRead?.(item.id);
                  },
                  title: expandedDetail ? t('summary_collapse_title', effLang) : t('summary_expand_title', effLang),
                  style: {
                    fontSize: '12.5px',
                    lineHeight: '1.5',
                    color: 'var(--dsw-alias-label-secondary, #475569)',
                    cursor: 'pointer',
                    ...(expandedDetail
                      ? {}
                      : {
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }),
                  },
                },
                item.summary
              )
            : null,

          // 关键词标签
          item.tags && item.tags.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' } },
                item.tags.slice(0, 3).map((tag: string, idx: number) =>
                  h(
                    'span',
                    {
                      key: idx,
                      style: {
                        fontSize: '10.5px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--dsw-alias-bg-layer-1, #f8fafc)',
                        border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                        color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                      },
                    },
                    `#${tag}`
                  )
                )
              )
            : null,

          // W1.3 中文展示模式下保留原文小字（12px，单行省略）
          secondaryTitle
            ? h(
                'div',
                {
                  className: 'dsh-card-original-title',
                  title: secondaryTitle,
                  style: {
                    fontSize: '12px',
                    lineHeight: '1.35',
                    color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                },
                secondaryTitle
              )
            : null,

          // 底部操作栏
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '4px',
                paddingTop: '6px',
                borderTop: '1px dashed var(--dsw-alias-border-l1, #e2e8f0)',
              },
            },
            h(
              'button',
              {
                onClick: () => onCopy(item),
                title: t('copy_title', effLang),
                style: {
                  background: 'none',
                  border: 'none',
                  color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '3px 6px',
                  borderRadius: '4px',
                },
              },
              t('copy_btn', effLang)
            ),
            h(
              'a',
              {
                href: item.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                onClick: handleOpenItem,
                style: {
                  color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                  textDecoration: 'none',
                  fontSize: '11px',
                  padding: '3px 6px',
                },
              },
              t('source_link_btn', effLang)
            ),
            h(
              'button',
              {
                onClick: () => {
                  onInject(item);
                  onMarkRead?.(item.id);
                },
                title: t('inject_title', effLang),
                style: {
                  backgroundColor: 'var(--dsw-alias-brand-primary, #4f46e5)',
                  color: 'var(--dsw-alias-label-on-brand, #ffffff)',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 1px 2px rgba(79, 70, 229, 0.2)',
                },
              },
              t('inject_btn', effLang)
            )
          )
        );
      }

      // 右侧抽屉核心容器组件 (v1.0 两层情报台：今日必看 + 可折叠原始流)
      function NewsFeedDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
        const [rawExpanded, setRawExpanded] = useState(DEFAULT_RAW_EXPANDED);
        const [settingsOpen, setSettingsOpen] = useState(DEFAULT_SETTINGS_OPEN);
        const [sortMode, setSortMode] = useState('smart' as 'smart' | 'latest' | 'score');
        const [displayLang, setDisplayLang] = useState('auto' as string);
        const [selectedTopics, setSelectedTopics] = useState(['agent-infra', 'model-release'] as string[]);
        const [includeRead, setIncludeRead] = useState(false);
        const langTouchedRef = useRef(false);
        const topicsTouchedRef = useRef(false);
        const [briefingSignals, setBriefingSignals] = useState([] as any[]);
        const [rawSignals, setRawSignals] = useState([] as any[]);
        const [health, setHealth] = useState(null as any);
        const [loading, setLoading] = useState(false);
        const [toastMessage, setToastMessage] = useState('');

        const loadHealth = useCallback(async () => {
          try {
            const res = await fetch('/dsh-plugins/ai-news-feed/health');
            if (res.ok) {
              const data = await res.json();
              setHealth(data);
              if (!langTouchedRef.current && data?.display?.language) {
                setDisplayLang(data.display.language);
              }
              if (!topicsTouchedRef.current && Array.isArray(data?.display?.topics)) {
                setSelectedTopics(data.display.topics);
              }
            }
          } catch {
            // silent
          }
        }, []);

        const loadSignals = useCallback(async () => {
          setLoading(true);
          try {
            const [briefRes, rawRes] = await Promise.all([
              fetch(`/dsh-plugins/ai-news-feed/briefing?includeRead=${includeRead ? 'true' : 'false'}&limit=5`),
              fetch('/dsh-plugins/ai-news-feed/signals?limit=50&stream=latest'),
            ]);
            if (briefRes.ok) {
              const data = await briefRes.json();
              setBriefingSignals(data.signals || []);
            }
            if (rawRes.ok) {
              const data = await rawRes.json();
              setRawSignals(data.signals || []);
            }
          } catch (err) {
            console.warn('[ai-news-feed] Failed to fetch signals:', err);
          } finally {
            setLoading(false);
          }
        }, [includeRead]);

        const markReadIds = useCallback(
          async (ids: number[]) => {
            if (!ids || ids.length === 0) return;
            try {
              await fetch('/dsh-plugins/ai-news-feed/mark-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
              });
              const now = Date.now();
              setBriefingSignals((prev: any[]) =>
                includeRead
                  ? prev.map((it) => (ids.includes(it.id) && !it.read_at ? { ...it, read_at: now } : it))
                  : prev.filter((it) => !ids.includes(it.id))
              );
              setRawSignals((prev: any[]) =>
                prev.map((it) => (ids.includes(it.id) && !it.read_at ? { ...it, read_at: now } : it))
              );
            } catch {
              // ignore mark-read errors
            }
          },
          [includeRead]
        );

        const changeLanguage = useCallback((next: 'auto' | 'zh' | 'en') => {
          langTouchedRef.current = true;
          setDisplayLang(next);
          fetch('/dsh-plugins/ai-news-feed/language', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language: next }),
          }).catch(() => {});
        }, []);

        const toggleTopic = useCallback(
          async (topicId: string) => {
            const isSelected = selectedTopics.includes(topicId);
            if (isSelected && selectedTopics.length <= 1) {
              return;
            }
            topicsTouchedRef.current = true;
            const nextTopics = isSelected
              ? selectedTopics.filter((id: string) => id !== topicId)
              : [...selectedTopics, topicId];
            setSelectedTopics(nextTopics);
            try {
              await fetch('/dsh-plugins/ai-news-feed/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topics: nextTopics }),
              });
            } catch {
              // silent
            }
          },
          [selectedTopics]
        );

        const triggerSync = useCallback(async () => {
          setLoading(true);
          try {
            await fetch('/dsh-plugins/ai-news-feed/sync');
            let count = 0;
            const timer = setInterval(async () => {
              count++;
              await loadHealth();
              await loadSignals();
              if (count >= 10) clearInterval(timer);
            }, 1200);
          } catch (err) {
            console.error('[ai-news-feed] Sync trigger failed:', err);
          } finally {
            setLoading(false);
          }
        }, [loadHealth, loadSignals]);

        useEffect(() => {
          if (isOpen) {
            loadHealth();
            loadSignals();
          }
        }, [isOpen, loadHealth, loadSignals]);

        const displayedRawSignals = useMemo(() => {
          return sortSignalsForDisplay(rawSignals, sortMode);
        }, [rawSignals, sortMode]);

        if (!isOpen) return null;

        const isNoLlm = health?.llm_state === 'missing';
        const isLlmBroken = health?.llm_state === 'misconfigured';
        const isBudgetExhausted = health?.budget && health.budget.remaining <= 0;
        const isSyncing = health?.is_syncing;
        const syncProgress = health?.sync_progress;
        const appearance = health?.appearance || 'auto';
        const effectiveTheme = appearance === 'light' || appearance === 'dark' ? appearance : undefined;
        const effectiveLang = resolveEffectiveLanguage(displayLang);
        const followedTopicsText =
          selectedTopics
            .map((id: string) => getTopicLabelById(id, effectiveLang))
            .filter(Boolean)
            .join(' · ') || t('topics_none', effectiveLang);

        return h(
          React.Fragment,
          null,
          h('div', {
            className: 'dsh-news-feed-backdrop',
            onClick: onClose,
            style: {
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              zIndex: 9998,
              animation: 'dshFadeIn 0.2s ease',
            },
          }),
          h(
            'div',
            {
              className: 'dsh-news-feed-drawer-overlay dsh-ai-news-feed-root',
              'data-theme': effectiveTheme,
              style: {
                position: 'fixed',
                right: 0,
                top: 0,
                bottom: 0,
                width: 'min(420px, 92vw)',
                height: '100vh',
                backgroundColor: 'var(--dsw-alias-bg-base, #ffffff)',
                color: 'var(--dsw-alias-label-primary, #0f172a)',
                boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                borderLeft: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                animation: 'dshSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              },
            },
            // 顶部标题栏
            h(
              'div',
              {
                style: {
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('span', {
                  style: {
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--dsw-alias-state-success-primary, #10b981)',
                    boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)',
                  },
                }),
                h(
                  'span',
                  {
                    style: {
                      fontWeight: 700,
                      fontSize: '15px',
                      color: 'var(--dsw-alias-label-primary, #0f172a)',
                    },
                  },
                  t('title', effectiveLang)
                ),
                h(
                  'span',
                  { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #94a3b8)' } },
                  'v1.0'
                )
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                h(
                  'button',
                  {
                    onClick: () => {
                      const next = effectiveLang === 'zh' ? 'en' : 'zh';
                      changeLanguage(next);
                    },
                    title: t('lang_toggle_title', effectiveLang),
                    style: {
                      backgroundColor: 'var(--dsw-alias-bg-layer-2, #f1f5f9)',
                      border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '2px 7px',
                      borderRadius: '4px',
                      color: 'var(--dsw-alias-label-secondary, #475569)',
                    },
                  },
                  t('lang_short', effectiveLang)
                ),
                h(
                  'button',
                  {
                    onClick: () => setSettingsOpen((prev: boolean) => !prev),
                    title: t('settings', effectiveLang),
                    style: {
                      backgroundColor: 'var(--dsw-alias-bg-layer-2, #f1f5f9)',
                      border: settingsOpen
                        ? '1px solid var(--dsw-alias-brand-primary, #4f46e5)'
                        : '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                      cursor: 'pointer',
                      fontSize: '15px',
                      lineHeight: 1,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      color: settingsOpen
                        ? 'var(--dsw-alias-brand-primary, #4f46e5)'
                        : 'var(--dsw-alias-label-secondary, #475569)',
                    },
                  },
                  '⚙'
                ),
                h(
                  'button',
                  {
                    onClick: () => {
                      loadHealth();
                      loadSignals();
                    },
                    disabled: loading,
                    title: t('refresh_title', effectiveLang),
                    style: {
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px',
                      borderRadius: '4px',
                      color: 'var(--dsw-alias-label-secondary, #475569)',
                    },
                  },
                  loading ? '⏳' : '🔄'
                ),
                h(
                  'button',
                  {
                    onClick: onClose,
                    title: t('close_title', effectiveLang),
                    style: {
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '16px',
                      padding: '2px 6px',
                      color: 'var(--dsw-alias-label-secondary, #475569)',
                    },
                  },
                  '✕'
                )
              )
            ),

            // 就地设置面板（默认收起）
            settingsOpen
              ? h(
                  'div',
                  {
                    className: 'dsh-settings-panel',
                    style: {
                      padding: '10px 12px',
                      backgroundColor: 'var(--dsw-alias-bg-layer-1, #f8fafc)',
                      borderBottom: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      fontSize: '12px',
                    },
                  },
                  h(
                    'div',
                    {
                      style: {
                        fontWeight: 700,
                        color: 'var(--dsw-alias-label-primary, #0f172a)',
                        borderBottom: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                        paddingBottom: '6px',
                      },
                    },
                    `⚙ ${t('settings', effectiveLang)}`
                  ),
                  // 语言三态切换
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      },
                    },
                    h(
                      'span',
                      { style: { color: 'var(--dsw-alias-label-secondary, #475569)', fontWeight: 500 } },
                      t('settings_language', effectiveLang)
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: '4px' } },
                      (
                        [
                          { id: 'auto', key: 'lang_auto' },
                          { id: 'zh', key: 'lang_zh' },
                          { id: 'en', key: 'lang_en' },
                        ] as const
                      ).map((opt) => {
                        const active = displayLang === opt.id;
                        return h(
                          'button',
                          {
                            key: opt.id,
                            onClick: () => changeLanguage(opt.id),
                            style: {
                              padding: '2px 8px',
                              borderRadius: '4px',
                              border: active
                                ? '1px solid var(--dsw-alias-brand-primary, #4f46e5)'
                                : '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                              backgroundColor: active
                                ? 'var(--dsw-alias-brand-primary, #4f46e5)'
                                : 'var(--dsw-alias-bg-base, #ffffff)',
                              color: active
                                ? 'var(--dsw-alias-label-on-brand, #ffffff)'
                                : 'var(--dsw-alias-label-secondary, #475569)',
                              fontSize: '11px',
                              fontWeight: active ? 600 : 400,
                              cursor: 'pointer',
                            },
                          },
                          t(opt.key, effectiveLang)
                        );
                      })
                    )
                  ),
                  // 关注主题 chips
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
                    h(
                      'span',
                      { style: { color: 'var(--dsw-alias-label-secondary, #475569)', fontWeight: 500 } },
                      t('settings_topics', effectiveLang)
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                      TOPIC_OPTIONS.map((topic) => {
                        const selected = selectedTopics.includes(topic.id);
                        return h(
                          'button',
                          {
                            key: topic.id,
                            onClick: () => toggleTopic(topic.id),
                            style: {
                              padding: '3px 9px',
                              borderRadius: '12px',
                              border: selected
                                ? '1px solid var(--dsw-alias-brand-primary, #4f46e5)'
                                : '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                              backgroundColor: selected
                                ? 'var(--dsw-alias-brand-primary, #4f46e5)'
                                : 'var(--dsw-alias-bg-base, #ffffff)',
                              color: selected
                                ? 'var(--dsw-alias-label-on-brand, #ffffff)'
                                : 'var(--dsw-alias-label-secondary, #475569)',
                              fontSize: '11px',
                              fontWeight: selected ? 600 : 400,
                              cursor: 'pointer',
                            },
                          },
                          t(topic.key, effectiveLang)
                        );
                      })
                    ),
                    h(
                      'div',
                      { style: { fontSize: '10.5px', color: 'var(--dsw-alias-label-tertiary, #94a3b8)' } },
                      t('settings_topics_hint', effectiveLang)
                    )
                  ),
                  // 门槛只读展示
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        paddingTop: '6px',
                        borderTop: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                      },
                    },
                    h(
                      'span',
                      { style: { color: 'var(--dsw-alias-label-secondary, #475569)', fontWeight: 500 } },
                      t('settings_thresholds', effectiveLang)
                    ),
                    h(
                      'span',
                      {
                        className: 'dsh-thresholds-readonly',
                        style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #94a3b8)' },
                      },
                      formatThresholdsSummary(health?.thresholds, effectiveLang)
                    )
                  ),
                  // 评分实际使用的模型。以前这个 i18n 键只存在于字典里、
                  // 从未被渲染，用户看不到插件到底在用哪个模型打分。
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      },
                    },
                    h(
                      'span',
                      { style: { color: 'var(--dsw-alias-label-secondary, #475569)', fontWeight: 500 } },
                      t('llm_route_hint', effectiveLang, {
                        route: health?.llm_route
                          ? `${health.llm_route.provider} / ${health.llm_route.model}`
                          : health?.llm_backend === 'fetch'
                            ? 'llmBaseUrl'
                            : '—',
                      })
                    ),
                    h(
                      'span',
                      {
                        style: {
                          fontSize: '10.5px',
                          color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                          flexShrink: 0,
                        },
                      },
                      health?.llm_backend || 'none'
                    )
                  )
                )
              : null,

            // 顶部关注主题一行摘要 + 已读控制栏
            h(
              'div',
              {
                style: {
                  padding: '8px 12px',
                  backgroundColor: 'var(--dsw-alias-bg-layer-1, #f8fafc)',
                  borderBottom: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                },
              },
              h(
                'button',
                {
                  onClick: () => setSettingsOpen((prev: boolean) => !prev),
                  title: t('settings', effectiveLang),
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    padding: '2px 0',
                    cursor: 'pointer',
                    fontSize: '11.5px',
                    color: 'var(--dsw-alias-label-secondary, #475569)',
                    textAlign: 'left',
                  },
                },
                h(
                  'span',
                  {
                    style: {
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  t('topics_summary', effectiveLang, { topics: followedTopicsText })
                ),
                h(
                  'span',
                  {
                    style: {
                      color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                      marginLeft: '8px',
                      flexShrink: 0,
                      fontSize: '14px',
                      lineHeight: 1,
                    },
                  },
                  '⚙'
                )
              ),
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                  },
                },
                h(
                  'button',
                  {
                    onClick: () => setIncludeRead((prev: boolean) => !prev),
                    style: {
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: includeRead
                        ? 'var(--dsw-alias-brand-primary, #4f46e5)'
                        : 'var(--dsw-alias-label-secondary, #475569)',
                      fontWeight: includeRead ? 600 : 400,
                      fontSize: '11px',
                    },
                  },
                  t(includeRead ? 'include_read_on' : 'include_read_off', effectiveLang)
                ),
                h(
                  'button',
                  {
                    onClick: () => markReadIds(briefingSignals.map((s: any) => s.id)),
                    disabled: briefingSignals.length === 0,
                    style: {
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                      backgroundColor: 'var(--dsw-alias-bg-base, #ffffff)',
                      color:
                        briefingSignals.length === 0
                          ? 'var(--dsw-alias-label-tertiary, #94a3b8)'
                          : 'var(--dsw-alias-label-secondary, #475569)',
                      fontSize: '11px',
                      cursor: briefingSignals.length === 0 ? 'default' : 'pointer',
                    },
                  },
                  t('mark_all_read', effectiveLang)
                )
              )
            ),

            // 状态提示横幅
            isSyncing && syncProgress
              ? h(
                  'div',
                  {
                    style: {
                      padding: '8px 14px',
                      backgroundColor: 'var(--dsw-alias-bg-layer-2, #eff6ff)',
                      color: 'var(--dsw-alias-brand-primary, #1d4ed8)',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      borderBottom: '1px solid var(--dsw-alias-border-l1, #bfdbfe)',
                    },
                  },
                  h('span', null, '🔄'),
                  h(
                    'span',
                    null,
                    t('sync_progress', effectiveLang, {
                      completed: syncProgress.completed,
                      total: syncProgress.total,
                      source: syncProgress.current_source_name || '',
                    })
                  )
                )
              : null,

            isNoLlm
              ? h(
                  'div',
                  {
                    style: {
                      padding: '8px 14px',
                      backgroundColor: 'var(--dsw-alias-bg-layer-2, #fef3c7)',
                      color: 'var(--dsw-alias-state-warn-primary, #92400e)',
                      fontSize: '12px',
                      lineHeight: '1.4',
                      borderBottom: '1px solid var(--dsw-alias-border-l1, #fde68a)',
                    },
                  },
                  t('no_llm_banner', effectiveLang)
                )
              : null,

            // A configured-but-failing model route used to look exactly like a
            // healthy install: the banner never appeared and items piled up
            // unscored. Surface the failure instead of staying silent.
            isLlmBroken
              ? h(
                  'div',
                  {
                    style: {
                      padding: '8px 14px',
                      backgroundColor: 'var(--dsw-alias-bg-layer-2, #fee2e2)',
                      color: 'var(--dsw-alias-state-error-primary, #991b1b)',
                      fontSize: '12px',
                      lineHeight: '1.4',
                      borderBottom: '1px solid var(--dsw-alias-border-l1, #fecaca)',
                    },
                  },
                  t('llm_broken_banner', effectiveLang, {
                    error: health?.llm_last_error || 'unknown error',
                  })
                )
              : null,

            isBudgetExhausted && !isNoLlm
              ? h(
                  'div',
                  {
                    style: {
                      padding: '8px 14px',
                      backgroundColor: 'var(--dsw-alias-bg-layer-2, #f1f5f9)',
                      color: 'var(--dsw-alias-label-secondary, #475569)',
                      fontSize: '12px',
                      lineHeight: '1.4',
                      borderBottom: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                    },
                  },
                  t('budget_exhausted_banner', effectiveLang, {
                    used: health?.budget?.used ?? 0,
                    limit: health?.budget?.limit ?? 0,
                  })
                )
              : null,

            // 两层滚动内容区
            h(
              'div',
              {
                className: 'dsh-custom-scrollbar',
                style: {
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                },
              },
              // L1: 今日必看（默认展开，<= 5 条）
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--dsw-alias-label-primary, #0f172a)',
                    },
                  },
                  h('span', null, t('briefing_heading', effectiveLang, { count: briefingSignals.length })),
                  h(
                    'button',
                    {
                      onClick: triggerSync,
                      disabled: loading,
                      style: {
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                        backgroundColor: 'var(--dsw-alias-bg-layer-1, #f8fafc)',
                        color: 'var(--dsw-alias-label-secondary, #475569)',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      },
                    },
                    loading ? t('syncing_btn', effectiveLang) : t('sync_now', effectiveLang)
                  )
                ),
                loading && briefingSignals.length === 0
                  ? h(
                      'div',
                      {
                        style: {
                          textAlign: 'center',
                          padding: '12px 4px',
                          color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                          fontSize: '12px',
                        },
                      },
                      t('loading_briefing', effectiveLang)
                    )
                  : briefingSignals.length === 0
                  ? h(
                      'div',
                      {
                        className: 'dsh-briefing-empty',
                        style: {
                          fontSize: '12px',
                          color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                          padding: '4px 2px',
                        },
                      },
                      t('empty_briefing', effectiveLang)
                    )
                  : briefingSignals.map((item: any) =>
                      h(SignalCard, {
                        key: `brief-${item.id}`,
                        item,
                        lang: effectiveLang,
                        isBriefing: true,
                        onInject: (i: any) => injectIntoComposer(i, setToastMessage, { lang: effectiveLang }),
                        onCopy: (i: any) => copyCardSummary(i, setToastMessage, effectiveLang),
                        onMarkRead: (id: number) => markReadIds([id]),
                      })
                    )
              ),

              // L2: 原始流（默认展开，保留折叠开关与 v0.9 三态排序）
              h(
                'div',
                {
                  style: {
                    borderTop: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                    paddingTop: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  },
                },
                h(
                  'button',
                  {
                    onClick: () => setRawExpanded((prev: boolean) => !prev),
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                      backgroundColor: 'var(--dsw-alias-bg-layer-1, #f8fafc)',
                      color: 'var(--dsw-alias-label-primary, #0f172a)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                    },
                  },
                  h('span', null, t('raw_stream_heading', effectiveLang, { count: rawSignals.length })),
                  h(
                    'span',
                    { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #94a3b8)' } },
                    rawExpanded ? t('collapse', effectiveLang) : t('expand', effectiveLang)
                  )
                ),
                rawExpanded
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 6px',
                            fontSize: '11px',
                          },
                        },
                        h(
                          'span',
                          { style: { color: 'var(--dsw-alias-label-tertiary, #94a3b8)' } },
                          t('sort_label', effectiveLang)
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', gap: '4px' } },
                          (
                            [
                              { id: 'smart', key: 'sort_smart' },
                              { id: 'latest', key: 'sort_latest' },
                              { id: 'score', key: 'sort_score' },
                            ] as const
                          ).map((opt) =>
                            h(
                              'button',
                              {
                                key: opt.id,
                                onClick: () => setSortMode(opt.id),
                                style: {
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: sortMode === opt.id ? 600 : 400,
                                  backgroundColor:
                                    sortMode === opt.id
                                      ? 'var(--dsw-alias-bg-base, #ffffff)'
                                      : 'transparent',
                                  color:
                                    sortMode === opt.id
                                      ? 'var(--dsw-alias-brand-primary, #4f46e5)'
                                      : 'var(--dsw-alias-label-secondary, #475569)',
                                },
                              },
                              t(opt.key, effectiveLang)
                            )
                          )
                        )
                      ),
                      displayedRawSignals.length === 0
                        ? h(
                            'div',
                            {
                              style: {
                                textAlign: 'center',
                                padding: '20px',
                                color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                                fontSize: '12px',
                              },
                            },
                            t('empty_raw', effectiveLang)
                          )
                        : displayedRawSignals.map((item: any) =>
                            h(SignalCard, {
                              key: `raw-${item.id}`,
                              item,
                              lang: effectiveLang,
                              isBriefing: false,
                              onInject: (i: any) => injectIntoComposer(i, setToastMessage, { lang: effectiveLang }),
                              onCopy: (i: any) => copyCardSummary(i, setToastMessage, effectiveLang),
                              onMarkRead: (id: number) => markReadIds([id]),
                            })
                          )
                    )
                  : null
              )
            ),

            // 浮动 Toast 提示
            toastMessage
              ? h(
                  'div',
                  {
                    style: {
                      position: 'absolute',
                      bottom: '16px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      backgroundColor: 'var(--dsw-alias-bg-overlay, rgba(15, 23, 42, 0.92))',
                      color: 'var(--dsw-alias-label-on-brand, #ffffff)',
                      border: '1px solid var(--dsw-alias-border-l2, #cbd5e1)',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 500,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      zIndex: 10000,
                    },
                  },
                  toastMessage
                )
              : null
          )
        );
      }

      // 入口微组件（常驻在输入框上方 dock 或右上角 utilities）
      function NewsFeedTrigger(props?: { isComposer?: boolean }) {
        const [isDrawerOpen, setIsDrawerOpen] = useState(false);
        const isComposer = Boolean(props && props.isComposer);
        const triggerLang = resolveEffectiveLanguage('auto');

        const button = isComposer
          ? h(
              'div',
              {
                style: {
                  padding: '4px 0 6px 0',
                  display: 'flex',
                  alignItems: 'center',
                },
              },
              h(
                'button',
                {
                  className: 'dsh-trigger-btn',
                  onClick: () => setIsDrawerOpen((prev: boolean) => !prev),
                  title: t('trigger_title', triggerLang),
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                    background: 'var(--dsw-alias-card-fill, #ffffff)',
                    color: 'var(--dsw-alias-label-primary, #0f172a)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                    transition: 'all 0.15s ease',
                  },
                },
                h('span', { style: { fontSize: '13px' } }, '⚡'),
                h('span', null, t('title', triggerLang)),
                h(
                  'span',
                  {
                    style: {
                      fontSize: '11px',
                      color: 'var(--dsw-alias-label-tertiary, #94a3b8)',
                      marginLeft: '4px',
                    },
                  },
                  t('trigger_subtitle', triggerLang)
                )
              )
            )
          : h(
              'button',
              {
                className: 'dsh-trigger-btn',
                onClick: () => setIsDrawerOpen((prev: boolean) => !prev),
                title: t('trigger_title', triggerLang),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  border: '1px solid var(--dsw-alias-border-l1, #e2e8f0)',
                  background: 'var(--dsw-alias-card-fill, #ffffff)',
                  color: 'var(--dsw-alias-label-primary, #0f172a)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 500,
                  transition: 'all 0.15s ease',
                },
              },
              h('span', { style: { fontSize: '13px' } }, '⚡'),
              t('title', triggerLang)
            );

        // 统一使用 React Portal 挂载到 document.body，规避父容器 overflow:hidden 导致的裁剪
        const drawer = isDrawerOpen
          ? (typeof document !== 'undefined' && ReactDOM && ReactDOM.createPortal
              ? ReactDOM.createPortal(
                  h(NewsFeedDrawer, {
                    isOpen: isDrawerOpen,
                    onClose: () => setIsDrawerOpen(false),
                  }),
                  document.body
                )
              : h(NewsFeedDrawer, {
                  isOpen: isDrawerOpen,
                  onClose: () => setIsDrawerOpen(false),
                }))
          : null;

        return h(React.Fragment, null, button, drawer);
      }

      return {
        inject: ['slots'],
        apply(ctx: any) {
          ensureStyles();

          // 1. 注入到会话对话输入框上方 (conversation.input.dock)
          ctx.slots?.inject?.('conversation.input.dock', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.dock',
                id: 'ai-news-feed-input-dock',
                order: 10,
              },
              () => h(NewsFeedTrigger, { isComposer: true })
            )
          );

          // 2. 注入到会话右上角 Header Utilities (conversation.session.header.utilities)
          ctx.slots?.inject?.('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'ai-news-feed-header-utility',
                order: 10,
              },
              () => h(NewsFeedTrigger, { isComposer: false })
            )
          );

          // 兼容性保留契约标识声明 (conversation.session.header.actions, conversation.composer.dock)
        },
      };
    },
  });
}

// 自动在浏览器脚本加载时执行注册
registerClient();
