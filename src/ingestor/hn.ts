import type { SourceConfig } from '../types.js';
import type { IngestorResult, RawFeedItem } from './types.js';

const USER_AGENT = 'ai-news-feed/0.5.1';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one Algolia query with bounded retries.
 *
 * Algolia intermittently returns 429/5xx or drops the connection; a single
 * attempt made the whole `hn` source report `fetch failed` while every other
 * source succeeded, which looked like a plugin bug to users.
 */
async function fetchQuery(url: string): Promise<any> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        // 4xx other than 429 is a permanent query problem: retrying cannot help.
        const retryable = res.status === 429 || res.status >= 500;
        const err = new Error(`HN Algolia query returned status ${res.status}`);
        if (!retryable) throw err;
        lastError = err;
      } else {
        return await res.json();
      }
    } catch (err) {
      lastError = err;
      // A permanent status error carries no retry budget.
      if (err instanceof Error && /returned status 4(?!29)/.test(err.message)) throw err;
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Algolia occasionally omits timestamps; `undefined * 1000` throws RangeError. */
function resolvePublishedAt(hit: any): string {
  if (typeof hit?.created_at === 'string' && hit.created_at) return hit.created_at;
  if (typeof hit?.created_at_i === 'number' && Number.isFinite(hit.created_at_i)) {
    return new Date(hit.created_at_i * 1000).toISOString();
  }
  return new Date().toISOString();
}

export async function fetchHackerNews(config: SourceConfig): Promise<IngestorResult> {
  const startTime = Date.now();
  const maxItems = config.maxItemsPerRun || 20;
  const keywords = config.keywords && config.keywords.length > 0 ? config.keywords : ['AI', 'LLM', 'Agent'];
  const windowHours = config.windowHours || 48;
  const sinceTimestamp = Math.floor(Date.now() / 1000) - windowHours * 3600;

  const results: RawFeedItem[] = [];
  const seenUrls = new Set<string>();
  let firstError: string | undefined;

  try {
    for (const kw of keywords) {
      if (results.length >= maxItems) break;

      const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(
        kw
      )}&hitsPerPage=${maxItems}&numericFilters=created_at_i>${sinceTimestamp}`;

      let data: any;
      try {
        data = await fetchQuery(url);
      } catch (err: any) {
        // One failing keyword should not discard the others; remember it only
        // to report a useful error if nothing at all succeeded.
        firstError = firstError || err?.message || String(err);
        continue;
      }

      const hits = Array.isArray(data.hits) ? data.hits : [];

      for (const hit of hits) {
        if (results.length >= maxItems) break;

        const targetUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        if (seenUrls.has(targetUrl)) continue;
        seenUrls.add(targetUrl);

        results.push({
          source: 'hn',
          source_type: 'api',
          url: targetUrl,
          title: hit.title || 'Untitled HN Post',
          summary: hit.story_text
            ? hit.story_text.replace(/<[^>]+>/g, ' ').slice(0, 300)
            : `Hacker News [${hit.points || 0} pts, ${hit.num_comments || 0} comments]`,
          published_at: resolvePublishedAt(hit),
          raw_content: null,
        });
      }
    }

    return {
      sourceId: config.id,
      success: true,
      items: results.slice(0, maxItems),
      // Partial degradation is reported without failing the source outright.
      error: results.length === 0 && firstError ? firstError : undefined,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      sourceId: config.id,
      success: false,
      items: results,
      error: err?.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
