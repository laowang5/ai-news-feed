# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-13

### Added
- **两层情报台 UI**：重构抽屉为 L1「今日必看」（自然日未读高分事件，硬上限 5 条，默认展开）与 L2「原始流」（默认折叠，保留 `智能 | 最新 | 分数` 三态排序）；取消 S 级独立 tab，降级为卡片徽标。
- **AIHot 日报拆条**：新增 `src/ingestor/aihot-digest.ts`，零模型调用拆解 `daily.xml` 为子条目与分区标签，保留 `digest` 本体不送评。
- **跨源事件合并**：新增 `src/scoring/cluster.ts`，按自然日窗口与标题相似度/专有名词聚合同事件多源报道，展示 `N 源报道` 徽标并严格区分不同型号后缀（如 `Gemini 4 Hydrogen` 与 `Gemini 4 Carbon`）。
- **已读追踪闭环**：新增 `POST /dsh-plugins/ai-news-feed/mark-read` 与 `GET /dsh-plugins/ai-news-feed/briefing`，支持「显示全部（含已读）」与「全部已读」。
- **主题个性化与「为什么重要」**：新增 `src/scoring/topics.ts`（默认仅勾选 `agent-infra`、`model-release`），system 段注入并与 `rubricVersion` 联动，后置 `topic_boost` 上限 `+5` 且不污染 `is_s_tier`；摘要同调产出单行 `why_it_matters`。

### Fixed
- **今日必看日报子事件门槛豁免（W1）**：`queryDailyBriefing` 对携带 `parent_digest` 的日报拆条子事件豁免 80 分门槛（下探至 `browseMinScore=60`），同分时优先排序日报子事件。
- **空态与原始流默认展开（W2）**：抽屉打开时「原始流」默认展开（`rawExpanded=true`），今日必看为空时改用极简双语单行提示 `empty_briefing`。
- **AIHot 信源提权与窗口收窄（W3）**：`aihot` 升级为 `tier_a`（权重 1.15）并将 `maxItemsPerRun` 从 20 收窄为 2（仅抓当天与前一天日报），避免首启队列拥塞。
- **语言默认跟随系统与全量双语化（W4）**：`display.language` 默认改为 `'auto'`，新增 `POST /dsh-plugins/ai-news-feed/language` 路由并与 `/topics` 共用 `preferences.json` 读-合并-写持久化；抽屉内联完整 `I18N.zh` / `I18N.en` 双语字典。
- **抽屉就地设置面板（W5）**：右上角与主题摘要行新增 `⚙` 设置入口，就地展开语言三态切换、关注主题勾选与只读门槛展示（`health.thresholds`）。
- **标题双语文案（摘要保持单语）**：`writeCopy` 单次调用产出 `title_zh`/`title_en` 双标题，解决中文源（AIHot 日报）在英文模式下没有英文标题可显示的问题；摘要与 `why_it_matters` 仍按 `display.language` 单语生成——同一次调用写两份译文属重复开销（输出 token 翻倍且收益为零），已回退；前端 `resolveCardTitles` 在 `en` 模式下优先 `title_en`，缺失时回落原文标题。

## [0.9.0] - 2026-11-13

### Fixed
- **主题深度跟随（W4）**：全量迁移 CSS 变量至宿主真实 `--dsw-alias-*` 语义体系，清除所有 `--dsh-*` 失效变量及裸 hex 中性色，新增 `appearance: 'auto' | 'light' | 'dark'` 配置项，深浅色模式平滑切换。
- **最新流分档排序（W2）**：`querySignals` 新增 `groupByStatus`，最新流按「已评分优先（高分在前）→ 待评分（最新在前）」排序，抽屉新增「智能 | 最新 | 分数」三态本地排序切换。
- **引入对话原生注入（W3）**：修复 React 受控组件 `textarea` 绕过 value tracker 失效问题（改走原型 setter + `input` 事件）及 `contenteditable` `execCommand` 路径；排除抽屉内元素，注入后读回校验，失败自动兜底剪贴板。
- **中文标题翻译与语言开关（W1）**：`writeCopy` 同一次模型调用附带返回 `title_zh`，不新增模型预算消耗；支持 `display.language: 'zh' | 'en' | 'auto'` 配置及抽屉头部快速切换。
- **评分前置正文补全（W5）**：新增 `src/ingestor/article.ts` 抓取原网页正文（5s 超时 + 1 次重试，按 `og:description` → `<article>`/`<main>` → `meta[name=description]` 提取），不足 400 字符跳过模型并标记 `skip_reason='insufficient_content'`；`aihot` 日报标记为 `source_type='digest'`，不参与单条 S 级榜。

## [0.8.1] - 2026-11-12

### Fixed
- **桌面端「AI 情报流」按钮加载修复**：将 `lib/client.js` 改为纯经典脚本（Classic Script）格式输出，彻底去除顶层 `export` 语法。
  - **根因说明**：DeepSeek Harness 宿主使用无 `type="module"` 的 `<script>` 标签注入客户端插件脚本，原 bundle 中的 ESM `export` 关键字导致浏览器产生 `SyntaxError: Unexpected token 'export'` 并阻断整个插件注册流程。
- **构建后防回归断言**：新增 `scripts/check-client-bundle.mjs`，在构建完成后严格校验无 ESM 语法、经典脚本可执行性以及必要 Slots 注册。
- **端到端契约测试校正**：更新测试用例直接校验构建产物语法特征，杜绝动态 import 造成的假绿灯。

## [0.8.0] - 2026-11-12

### Added
- **会话内定时晨报与晚报（In-Session Briefings via dsh-schedule）**：利用宿主内置 `@deepseek-ai/dsh-schedule` 计划任务服务，定时将结构化 Prompt 注入原始会话，由 Agent 自动生成晨报（08:00）与晚报（20:00）。
- **三段式优雅降级架构**：优先尝试插件自注册（Path A）；缺失会话上下文时提供标准 Prompt 生成（Path B）；宿主未挂载 schedule 服务时平稳报错并标明 `schedule_unavailable`（Path C）。
- **对比并替换（CAS）幂等注册**：重复启用自动执行比对更新，避免重复生成冗余任务，遭遇并发冲突时自动重试。
- **简报注销与会话归档解锁**：提供 `disable_briefing` 统一清理指定会话下的关联任务，解除宿主因活跃任务拦截会话归档的限制。
- **零新增与预算耗尽保护**：无高分新增时输出极简提示；模型预算耗尽时自动降级为纯列表模式，严守成本红线。

## [0.7.0] - 2026-11-12

### Added
- **首个对外可发布版（First Public Release Ready）**
- **零模型可用性（Graceful Zero-LLM Degradation）**：宿主未注入 LLM 或未提供 API Key 时，自动降级为未评分原始信源流，支持按信源权重与发布时间智能排序展示。
- **每日模型调用成本护栏（Daily Model Call Budget）**：默认 120 次模型调用上限，原子追踪打分与摘要调用，触顶自动停止评分并持久化，跨本地零点自动重置。
- **极速首次同步（Fast First-Run Experience）**：支持配置 `firstSyncDelaySeconds`（默认 5 秒），确保新用户首装 3 分钟内即可看到丰富内容。
- **抽屉空态与实时分源同步进度**：侧栏空态一键触发同步，展示实时分源拉取进度。
- **五轴评分与后置权重内核（v0.6 评分体系内置）**：7×5 权重表与三层门槛机制（精选 80、S级 85、浏览 60）。
- **国际化完整覆盖**：`locale/zh.json` 与 `locale/en.json` 键完全镜像对齐。
- **法务与开源许可**：正式采用 MIT 开源许可证。
