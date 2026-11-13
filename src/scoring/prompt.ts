/**
 * Converts a date string to Beijing Time (+08:00) ISO8601 string.
 * Unknown or invalid dates fallback to "未知（收录时间不代表发布时间）".
 */
export function formatToBeijingTime(dateStr?: string): string {
  if (!dateStr || typeof dateStr !== 'string') {
    return '未知（收录时间不代表发布时间）';
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      return '未知（收录时间不代表发布时间）';
    }
    // Convert to UTC+8
    const utcMs = d.getTime();
    const beijingMs = utcMs + 8 * 3600000;
    const bj = new Date(beijingMs);
    const yyyy = bj.getUTCFullYear();
    const mm = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(bj.getUTCDate()).padStart(2, '0');
    const hh = String(bj.getUTCHours()).padStart(2, '0');
    const min = String(bj.getUTCMinutes()).padStart(2, '0');
    const ss = String(bj.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+08:00`;
  } catch {
    return '未知（收录时间不代表发布时间）';
  }
}

/**
 * Builds the user prompt input for scoring.
 * Strict constraint: ONLY contains 发布时间, 标题, 正文.
 * Must NOT leak source id, name, source_type, tier, old scores, thresholds, or tags.
 */
export function buildScoreInput(item: {
  title: string;
  raw_content?: string | null;
  summary?: string;
  published_at?: string;
}): string {
  const pubTime = formatToBeijingTime(item.published_at);
  const content = (item.raw_content || item.summary || item.title).slice(0, 2000);

  return [
    `【发布时间】：${pubTime}`,
    `【标题】：${item.title}`,
    `【正文】：${content}`,
  ].join('\n');
}
