# @dsh-plugins/ai-news-feed

> **What it is**: An all-in-one native AI intelligence & news feed plugin for DeepSeek Harness (DSH), with zero external Python or background process dependencies.  
> **What it gives you**: Configurable multi-source automated fetching + 5-axis LLM quantitative evaluation + realtime sidebar drawer + automated in-session morning and evening briefings.  
> **How to install**: `dsh plugin add @dsh-plugins/ai-news-feed` (or configure in `cordis.yml`).  
> **Version**: v1.0.0 · MIT · no external process dependencies

![AI News Feed · sidebar drawer](assets/ai-news-feed.png)

## 🌟 Key Features

- ⚡ **Six Native Sources**: Hacker News, GitHub Releases, AIHot Daily, OpenAI Blog, Google DeepMind, Simon Willison. You can customize the configuration of information sources that support RSS/ATOM subscriptions according to your needs.
- 🎯 **Five-Axis Scoring**: `industry/rubric.md` as single source of truth with SHA256 version hash; scoring and copywriting strictly separated; source weights and first-report penalties applied post-hoc in code and never passed into prompts.
- 📰 **Two-Layer Reading Surface**: L1 "Today's Must-Reads" = same-day, unread, clustered events at or above 80 (hard cap 5); L2 "Raw Stream" = every ingested signal, expanded by default, with Smart / Latest / Score sorting.
- 💬 **One-Click Conversation Import**: Use the "Import Conversation" button to load information directly into the chat box, then enter prompts for further analysis to gain deeper insights and assessments.
- 🔗 **Cross-Source Clustering**: same-day coverage of the same event is merged and badged with "N sources", while distinct model suffixes stay apart (`Gemini 4 Hydrogen` ≠ `Gemini 4 Carbon`).
- 🎛️ **Topic Personalization**: Agent Infra / Model Releases / Open-source Tools / Funding & Business, with only the first two enabled by default. Selected topics are injected into the scoring system prompt for up to +5 boost, which never leaks into the S-Tier flag — selecting all four cancels the effect.
- 🌏 **Bilingual Titles**: both Chinese and English sources carry `title_zh` / `title_en`; UI copy and titles follow the language setting. Summaries are generated once in the active language rather than duplicated.
- 🛡️ **Cost Guardrail + Zero-LLM Mode**: `dailyModelCallBudget` defaults to 120 calls/day, halting scoring at the cap and falling back to a plain list, reset at local midnight. Without an LLM the drawer still shows a weighted raw stream instead of a blank panel.
- 📬 **In-Session Briefings**: morning 08:00 and evening 20:00 digests injected into the original session via `@deepseek-ai/dsh-schedule`; cards can inject summary, score and link into the composer in one click.

---

## 🚀 Quick Start

### 1. Requirements

Development dependencies:

```
    "@types/node": "^22.10.0",

    "@types/react": "^19.0.0",

    "@types/react-dom": "^19.3.0",

    "esbuild": "^0.28.2",

    "react": "^19.0.0",

    "react-dom": "^19.3.1",

    "tsdown": "^0.6.0",

    "tsx": "^4.23.15",
```

### 2. Installation

#### Method A: Via DSH CLI (Recommended)
```bash
dsh plugin add @dsh-plugins/ai-news-feed
```

#### Method B: Local Development & Source Installation
```bash
git clone https://github.com/laowang5/ai-news-feed.git
cd ai-news-feed
pnpm install
pnpm build
```

Enable the plugin in your DSH configuration (e.g. `~/.dsh/profiles/desktop/cordis.yml`):
```yaml
plugins:
  "@dsh-plugins/ai-news-feed":
    # Optional custom configuration
    syncIntervalMinutes: 60
    dailyModelCallBudget: 120
```

#### ⚠️ Important Step: Completely Restart Desktop App

**After installing or upgrading the plugin, you must completely quit DeepSeek Harness (Cmd+Q on macOS) and relaunch it.** Merely reloading the browser window will NOT take effect, because the host's client boot manifest is generated when the DSH host process initializes.

**Self-Check Verification (DevTools Console):**
Open Developer Tools in DSH (Console), and run the following command:
```js
window.__DSH_BOOT__.entries.map(e => e.id)
```
The output array must include `'@dsh-plugins/ai-news-feed'`. If it is absent, the plugin has not been registered in the active profile or the DSH desktop app has not been completely restarted.

---

## ⚙️ Configuration Options

All options can be customized in `PluginConfig`:

| Option | Type | Default | Description |
|---|---|---|---|
| `syncIntervalMinutes` | `number` | `60` | Background sync interval in minutes. Set to `0` to disable auto-sync. |
| `firstSyncDelaySeconds` | `number` | `5` | Initial sync delay in seconds on host startup, ensuring content is available within 5 seconds. Set to `0` to disable. |
| `dailyModelCallBudget` | `number` | `120` | Daily limit on model calls (scoring + copywriting). Resets at local midnight. |
| `maxScoresPerRun` | `number` | `10` | Maximum pending items evaluated with LLM per sync cycle. |
| `scoreCalls` | `number` | `2` | Number of serial scoring samples per item (takes floored mean for stability). |
| `thresholds` | `object` | See below | 3-tier score thresholds. |
| `featuredMaxItems` | `number` | `20` | Candidate cap for the featured stream. **Today's Must-Reads is hard-capped at 5** (`Math.min(5, value)`), so larger values have no effect. |
| `appearance` | `'auto' \| 'light' \| 'dark'` | `'auto'` | Drawer palette; defaults to following the host's light/dark theme. |
| `display.language` | `'auto' \| 'zh' \| 'en'` | `'auto'` | UI language. `auto` follows the system locale and also determines the language of summaries and "why it matters". |
| `display.topics` | `string[]` | `['agent-infra','model-release']` | Focus topics; affects the score boost and the angle of "why it matters". |
| `fetchArticle.enabled` | `boolean` | `true` | Fetch the article body before scoring (5s timeout + 1 retry); items under 400 characters are skipped as `insufficient_content`. |
| `storePath` | `string` | `<dataDir>/signals.json` | Path to persistent JSON store. |

### Default Thresholds (`thresholds`)

```yaml
thresholds:
  featuredMinScore: 80   # Entry threshold for featured sidebar stream (covers ~45% of authoritative items)
  sTierScore: 85         # S-Tier badge cutoff (top ~20%)
  browseMinScore: 60     # Noise cutoff, below which no copywriting is generated
```

> The three thresholds serve **different surfaces**, not three filter tiers: `featuredMinScore` is the only product gate for Today's Must-Reads; `sTierScore` only drives the `S-Tier` badge; `browseMinScore` filters the raw stream and doubles as the exemption line for digest child events.

---

## 📡 Source Management (`sources.yaml`)

On startup, `sources.yaml` is automatically created in your project data directory (default `<project-dir>/data/sources.yaml` or system config directory). You can edit it directly to enable/disable or add custom RSS/Atom feeds:

```yaml
sources:
  # Hacker News AI stories (Algolia API, no key required)
  - id: hn
    type: api
    enabled: true
    keywords: [AI, LLM, Agent]
    windowHours: 48
    maxItemsPerRun: 20

  # GitHub Releases (public REST API, no key required)
  - id: github
    type: api
    enabled: true
    repos:
      - deepseek-ai/DeepSeek-V3
      - vllm-project/vllm
      - huggingface/transformers
      - anthropics/anthropic-sdk-python
    maxItemsPerRun: 15

  # AIHot Daily (Chinese, human-curated)
  - id: aihot
    type: rss
    enabled: true
    tier: tier_a          # curated by humans, ranks above discussion threads
    url: https://aihot.news/feed/daily.xml
    maxItemsPerRun: 2     # one item = one full day of digest; today + yesterday only

  # OpenAI Official News
  - id: rss-openai
    type: rss
    enabled: true
    url: https://openai.com/news/rss.xml
    maxItemsPerRun: 20

  # Google DeepMind Research & News
  - id: rss-deepmind
    type: rss
    enabled: true
    url: https://deepmind.google/blog/rss.xml
    maxItemsPerRun: 20

  # Simon Willison's Weblog (Atom)
  - id: rss-simonw
    type: atom
    enabled: true
    url: https://simonwillison.net/atom/everything/
    maxItemsPerRun: 20

  # Custom Industry RSS (Example)
  - id: my-custom-feed
    type: rss
    tier: tier_b
    enabled: true
    url: https://example.com/feed.xml
    maxItemsPerRun: 20
```

> Sources without a `tier` settle at `default` (×0.9). `tier` only affects the code-side multiplier and never enters the model prompt.

> **Source Tier Multipliers**: `tier_a` (×1.15), `tier_b` (×1.0), `tier_c` (×0.75), `default` (×0.9). Multipliers are applied strictly in code post-hoc and never passed into LLM prompts.

---

## 📰 Daily Intelligence Briefing (v1.0 Two-Layer Density)

### Today's Must-Reads (L1)
- Same-day (CST), unread, scored, unmerged events at or above `featuredMinScore` (default `80`) after cross-source clustering; **hard-capped at 5 items**, expanded when the drawer opens.
- **Digest child events are exempted from the 80-point line** and fall back to `browseMinScore` (60): AIHot is human-curated, so a single child event may not clear 80 on its own while the digest as a whole still deserves attention.
- Cards show an "N sources" badge, an `S-Tier` badge (`is_s_tier`, without topic boost), the matched focus topic, and a one-line "Why It Matters".
- **Opening the drawer does not mark anything as read**; clicking a title, expanding a summary, clicking "Inject into chat" or "Mark all read" writes the read state, and "Show all (including read)" switches back.

### Raw Stream (L2)
- **Expanded by default** — so an empty briefing never leaves a blank panel; shows every ingested signal, including unscored items and digest children.
- Supports the three local sorts (`Smart / Latest / Score`); the `⚙` in the header collapses it.

### Settings Panel
The `⚙` in the drawer header (or at the end of the topic summary row) expands in place:

| Item | Contents |
|---|---|
| Language | Follow system / 中文 / English, persisted to `preferences.json` |
| Focus topics | Four chips, multi-select; changes affect **future scoring only**, history is not rescored |
| Thresholds | 80 / 85 / 60 shown read-only (thresholds are a developer concern, not editable here) |

The header keeps a single summary line: `Following: Agent Infra · Model Releases ⚙`.

### How Topic Personalization Works
- Four built-in topics: `agent-infra`, `model-release`, `open-source`, `business`.
- **Only the first two are enabled by default; keep 2–3 — selecting all four dilutes the effect.**
- The boost is capped at +5 and never participates in the `is_s_tier` decision: an 82-point item cannot pass itself off as S-Tier through topic weight.

### Language & Bilingual Titles
- `title_zh` / `title_en` come from the same copywriting call: a Chinese source gets an English title and vice versa, **falling back to the original title when missing**.
- Summaries and "why it matters" are generated once in `display.language` and follow the language setting.
- Switching the language only changes which field is displayed; **it never rewrites historical items**. Entries missing that language keep falling back to what they have.

---

## 🤖 Registered Agent Tools

The plugin registers 7 powerful tools with the DSH host, which the Agent can invoke autonomously during conversations:

1. **`get_top_ai_news`**: Retrieve top AI signals with metadata (`stats.candidate_count`, `stats.pending_count`, `stats.budget_remaining_percent`).
2. **`search_ai_signals`**: Full-text search over local signal database by topic or keyword (e.g. `DeepSeek-V4.1`, `reasoning`).
3. **`trigger_feed_sync`**: Manually trigger background sync and scoring pipeline.
4. **`get_feed_health`**: Query source health status, error counters, and budget usage.
5. **`enable_briefing`**: Enable in-session morning (08:00:00) and evening (20:00:00) briefings.
6. **`disable_briefing`**: Disable briefings and clean up scheduled tasks to unblock session archiving.
7. **`get_briefing_prompt`**: Retrieve standard prompt template for morning or evening briefings.

---

## ❓ Frequently Asked Questions (FAQ)

### Q1: Can I use this plugin without configuring an LLM service?
**Yes, absolutely.** The plugin features Graceful Zero-LLM Degradation. If no LLM service or API key is available, the drawer defaults to the "Raw Stream" showing unscored signals sorted by source authority (e.g. OpenAI blog prioritised over generic feeds) and recency, ensuring new users never see a blank screen.

### Q2: How is the daily 120 model call budget measured? What happens when it runs out?
- **Measurement**: Actual physical calls made to the LLM API. The scoring step consumes 2 calls per item (mean), and the copywriting step consumes 1 call. A 120-call budget supports in-depth evaluation of approximately **40 featured items per day**.
- **Exhaustion Guardrail**: Once 120 calls are reached for the day, evaluation is paused automatically. Newly ingested items remain in their raw `pending` state and are still viewable in the latest feed. No errors or surprise costs will occur. The budget automatically resets at local midnight.

### Q3: Why do briefings appear in chat sessions instead of desktop notifications?
DSH Desktop (0.2.2-rc.2) does not expose a desktop notification service, but provides a durable, persistent `@deepseek-ai/dsh-schedule` service. Having briefings in the chat session makes them durable, searchable, and lets you immediately follow up with questions (e.g. "Explain the technical implementation of item #2 in detail").

### Q4: What should I do if session archiving is blocked by active reminders?
For safety, the host rejects archiving sessions that still hold recurring reminders. Simply tell the assistant "Disable briefings in this session" or call the `disable_briefing` tool to unregister the reminders and archive the session.

### Q5: Why are source website names not visible in the scoring prompt?
This is an intentional anti-bias design. Passing "from OpenAI Blog" into the prompt tends to inflate scores based on reputation rather than technical substance. We strictly follow the "facts in input, weights post-hoc" principle: the LLM evaluates the event itself, and authority multipliers are applied in code.

### Q6: Is there any data leftover after uninstalling the plugin?
**Zero external scattering.** All runtime files (`signals.json`, `sources.yaml`, `budget.json`, `preferences.json`) are strictly contained inside `<dataDir>`. Uninstalling the plugin and restarting the host will leave no dangling references. To completely remove all data, simply delete the `data/` folder.

### Q7: I switched the language, but old items still show the other language. Why?
Copy is generated **at scoring time** in whatever `display.language` was active then, and it is frozen into the record. Switching the language only changes which field is displayed:

- Titles: when `title_en` / `title_zh` is missing, the card falls back to the original title — so old Chinese-source items keep their Chinese title in English mode.
- Summaries and "why it matters": there is only one copy, in the language used when it was scored.

The only way to change history is to rescore it, which is not worth the budget — **newly ingested items arrive with bilingual titles automatically.**

### Q8: Why aren't summaries bilingual like the titles?
Titles are **identifiers**: without the right language they are a wall — a Chinese title is unreadable to an English reader — so both versions must exist. Summaries are **interpretation**: writing two means outputting the same meaning twice in one call, roughly doubling output tokens, while a reader only ever sees one language at a time. The other copy would never be read.

So titles are bilingual; summaries and "why it matters" are generated once in `display.language`.

---

## 📄 License

Licensed under the [MIT License](LICENSE).
