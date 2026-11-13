import type { SourceConfig } from '../types.js';

export const DEFAULT_SOURCES: SourceConfig[] = [
  {
    id: 'hn',
    type: 'api',
    tier: 'default',
    enabled: true,
    keywords: ['AI', 'LLM', 'Agent'],
    windowHours: 48,
    maxItemsPerRun: 20,
  },
  {
    id: 'github',
    type: 'api',
    tier: 'default',
    enabled: true,
    repos: [
      'deepseek-ai/DeepSeek-V3',
      'vllm-project/vllm',
      'huggingface/transformers',
      'anthropics/anthropic-sdk-python',
    ],
    maxItemsPerRun: 15,
  },
  {
    id: 'aihot',
    type: 'rss',
    tier: 'tier_a',
    enabled: true,
    url: 'https://aihot.news/feed/daily.xml',
    maxItemsPerRun: 2,
  },
  {
    id: 'rss-openai',
    type: 'rss',
    tier: 'tier_a',
    enabled: true,
    url: 'https://openai.com/news/rss.xml',
    maxItemsPerRun: 20,
  },
  {
    id: 'rss-deepmind',
    type: 'rss',
    tier: 'tier_a',
    enabled: true,
    url: 'https://deepmind.google/blog/rss.xml',
    maxItemsPerRun: 20,
  },
  {
    id: 'rss-simonw',
    type: 'atom',
    tier: 'tier_b',
    enabled: true,
    url: 'https://simonwillison.net/atom/everything/',
    maxItemsPerRun: 20,
  },
];

export const DEFAULT_SOURCES_YAML = `# AI News Feed Sources Configuration
# Edit this file to enable, disable or add new RSS/Atom or API sources.
sources:
  # 1. Hacker News AI Stories (Algolia API, no key required)
  - id: hn
    type: api
    tier: default
    enabled: true
    keywords:
      - AI
      - LLM
      - Agent
    windowHours: 48
    maxItemsPerRun: 20

  # 2. GitHub High-Value AI Releases (Public REST API, no key required)
  - id: github
    type: api
    tier: default
    enabled: true
    repos:
      - deepseek-ai/DeepSeek-V3
      - vllm-project/vllm
      - huggingface/transformers
      - anthropics/anthropic-sdk-python
    maxItemsPerRun: 15

  # 3. AIHOT Daily News Feed
  - id: aihot
    type: rss
    tier: tier_a
    enabled: true
    url: https://aihot.news/feed/daily.xml
    maxItemsPerRun: 2

  # 4. OpenAI Official Blog (Truncated to latest 20 items)
  - id: rss-openai
    type: rss
    tier: tier_a
    enabled: true
    url: https://openai.com/news/rss.xml
    maxItemsPerRun: 20

  # 5. Google DeepMind Research & News
  - id: rss-deepmind
    type: rss
    tier: tier_a
    enabled: true
    url: https://deepmind.google/blog/rss.xml
    maxItemsPerRun: 20

  # 6. Simon Willison's Weblog (AI & LLM updates)
  - id: rss-simonw
    type: atom
    tier: tier_b
    enabled: true
    url: https://simonwillison.net/atom/everything/
    maxItemsPerRun: 20
`;
