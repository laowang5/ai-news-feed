export interface DigestChild {
  title: string;
  url: string;
  section: string;
  published_at: string;
  parent_digest: string;
}

const CST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Format a timestamp into YYYY-MM-DD in Asia/Shanghai (CST).
 * Returns '' if an explicit invalid value is provided.
 */
export function toLocalDateString(input?: string | number | Date): string {
  const date = input === undefined ? new Date() : input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return CST_FORMATTER.format(date);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function stripTagsAndCollapse(fragment: string): string {
  const plain = fragment
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(plain).replace(/\s+/g, ' ').trim();
}

function extractFirstHref(liHtml: string, baseUrl = 'https://aihot.news'): string | null {
  const match = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(liHtml);
  const rawHref = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
  if (!rawHref) return null;

  try {
    return new URL(rawHref, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Unpack an AIHot daily digest HTML description into individual child news items.
 * Rules (§2.2):
 * 1. Scan <p> and <li> in order; <p> updates current section (default '未分类').
 * 2. Each <li> produces a DigestChild with tag-stripped collapsed title and first <a href> absolute URL.
 * 3. Skip <li> without <a>.
 * 4. Return [] if HTML contains no <li> (caller falls back to keeping only parent digest).
 * 5. Deduplicate by title within the same digest (keep first).
 */
export function parseDigestItems(html: string, guid: string, pubDate: string): DigestChild[] {
  if (!html || !/<li\b/i.test(html)) {
    return [];
  }

  const children: DigestChild[] = [];
  const seenTitles = new Set<string>();
  let currentSection = '未分类';

  const blockRegex = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2];

    if (tag === 'p') {
      const text = stripTagsAndCollapse(inner);
      if (text) {
        currentSection = text;
      }
      continue;
    }

    if (tag === 'li') {
      const url = extractFirstHref(inner);
      if (!url) continue;

      const title = stripTagsAndCollapse(inner);
      if (!title) continue;

      if (seenTitles.has(title)) continue;
      seenTitles.add(title);

      children.push({
        title,
        url,
        section: currentSection,
        published_at: pubDate,
        parent_digest: guid,
      });
    }
  }

  return children;
}
