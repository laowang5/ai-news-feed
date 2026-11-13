import type { SourceConfig } from '../types.js';
import type { IngestorResult, RawFeedItem } from './types.js';

const USER_AGENT = 'ai-news-feed/0.5.1';

export async function fetchGitHubReleases(config: SourceConfig): Promise<IngestorResult> {
  const startTime = Date.now();
  const maxItems = config.maxItemsPerRun || 20;
  const repos = config.repos && config.repos.length > 0
    ? config.repos
    : [
        'deepseek-ai/DeepSeek-V3',
        'vllm-project/vllm',
        'huggingface/transformers',
        'anthropics/anthropic-sdk-python',
      ];

  const results: RawFeedItem[] = [];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github.v3+json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError: string | undefined;

  for (const repo of repos) {
    if (results.length >= maxItems) break;

    try {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=3`;
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 403 || res.status === 429) {
        lastError = `GitHub rate limit exceeded (status ${res.status})`;
        break; // Stop querying GitHub repos in this run
      }

      if (!res.ok) {
        lastError = `Failed to fetch repo ${repo} (status ${res.status})`;
        continue;
      }

      const releases = (await res.json()) as any[];
      if (Array.isArray(releases)) {
        for (const rel of releases) {
          if (results.length >= maxItems) break;
          results.push({
            source: 'github',
            source_type: 'api',
            url: rel.html_url,
            title: `[Release] ${repo} ${rel.name || rel.tag_name}`,
            summary: rel.body ? rel.body.slice(0, 300) : `Release ${rel.tag_name} for ${repo}`,
            published_at: rel.published_at || rel.created_at,
            raw_content: rel.body ? rel.body.slice(0, 4096) : null,
          });
        }
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  return {
    sourceId: config.id,
    success: results.length > 0 || !lastError,
    items: results,
    error: results.length === 0 ? lastError : undefined,
    durationMs: Date.now() - startTime,
  };
}
