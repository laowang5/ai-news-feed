export type BriefingKind = 'morning' | 'evening';

export const MORNING_BRIEFING_PROMPT = `生成【AI News Feed 晨报】。

1. 调用 get_top_ai_news({minScore: 85, limit: 3})，再调用 get_top_ai_news({minScore: 80, limit: 5})；
2. 输出格式（不要加别的段落）：
   ## AI 晨报 · {YYYY-MM-DD}
   **S 级（≥85）**
   - {标题} — {一句话结论}（{分数} · {来源}）
   **入选（≥80）**
   - {标题} — {一句话结论}（{分数} · {来源}）
   尾部一行：今日候选 N 条 / 未评分 M 条 / 预算剩余 K%
3. 若两个工具都返回空：只输出「今日无新增 80+。未评分 M 条，候选 N 条。」，不要编内容；
4. 不要重复上一期已列出的条目（用标题比对即可）。

约束：条目标题截断到 80 字，结论 ≤60 字；分数取 adjusted 并标注 S 或 A；来源显示域名或名称，不显示 tier；末尾必须包含统计行。若预算用尽走纯列表模式，末尾标明今日模型预算已用尽。`;

export const EVENING_BRIEFING_PROMPT = `生成【AI News Feed 晚报】。

1. 调用 get_top_ai_news({minScore: 80, limit: 5})（获取当日 Top 5 核心情报）；
2. 输出格式（不要加别的段落）：
   ## AI 晚报 · {YYYY-MM-DD}
   **当日 Top 5 前沿突破**
   - {标题} — {一句话结论}（{分数} · {来源}）
   **动态积压与观察**
   - 被预算/门槛挤掉的积压条数与主要分布领域
   - 明日观察重点（若有已排期发布的模型/会议）
   尾部一行：今日候选 N 条 / 未评分 M 条 / 预算剩余 K%
3. 若工具返回空：只输出「今日无新增 80+。未评分 M 条，候选 N 条。」，不要编内容；
4. 不要重复早晨已列出的条目（用标题比对即可）。

约束：条目标题截断到 80 字，结论 ≤60 字；分数取 adjusted 并标注 S 或 A；来源显示域名或名称，不显示 tier；末尾必须包含统计行。若预算用尽走纯列表模式，末尾标明今日模型预算已用尽。`;

export function getBriefingPrompt(kind: BriefingKind): string {
  if (kind === 'evening') {
    return EVENING_BRIEFING_PROMPT;
  }
  return MORNING_BRIEFING_PROMPT;
}
