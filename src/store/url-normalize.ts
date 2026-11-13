import { createHash } from 'node:crypto';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'spm',
  'feature',
]);

/**
 * Normalizes URL and produces a deterministic sha256 url_key.
 * Rules:
 * 1. Host lowercase.
 * 2. Strip 'www.' prefix, normalize 'm.' and 'amp.' subdomains to root domain.
 * 3. Strip fragment (#...).
 * 4. Remove trailing slash (except root '/').
 * 5. Strip marketing/tracking query params (utm_*, fbclid, gclid, ref, spm).
 * 6. Sort remaining query params alphabetically.
 */
export function normalizeUrl(rawUrl: string): { normalizedUrl: string; urlKey: string } {
  try {
    const parsed = new URL(rawUrl.trim());

    // Host normalization
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    if (host.startsWith('m.')) {
      host = host.slice(2);
    } else if (host.startsWith('amp.')) {
      host = host.slice(4);
    }
    parsed.hostname = host;

    // Fragment removal
    parsed.hash = '';

    // Filter and sort query params
    const keptParams: [string, string][] = [];
    for (const [k, v] of parsed.searchParams.entries()) {
      const lowerK = k.toLowerCase();
      if (!TRACKING_PARAMS.has(lowerK) && !lowerK.startsWith('utm_')) {
        keptParams.push([k, v]);
      }
    }
    keptParams.sort((a, b) => a[0].localeCompare(b[0]));

    parsed.search = '';
    for (const [k, v] of keptParams) {
      parsed.searchParams.append(k, v);
    }

    // Pathname normalization
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    const normalizedUrl = parsed.toString();
    const hash = createHash('sha256').update(normalizedUrl).digest('hex');
    return {
      normalizedUrl,
      urlKey: `sha256:${hash}`,
    };
  } catch {
    const trimmed = rawUrl.trim();
    const hash = createHash('sha256').update(trimmed).digest('hex');
    return {
      normalizedUrl: trimmed,
      urlKey: `sha256:${hash}`,
    };
  }
}
