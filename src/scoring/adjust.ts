import { computeTopicBoost } from './topics.js';

export const SOURCE_WEIGHTS = {
  tier_a: 1.15,
  tier_b: 1.0,
  tier_c: 0.75,
  default: 0.9,
} as const;

export type SourceTier = keyof typeof SOURCE_WEIGHTS;

export function sourceWeight(tier?: string | null): number {
  if (!tier) return SOURCE_WEIGHTS.default;
  if (tier in SOURCE_WEIGHTS) {
    return SOURCE_WEIGHTS[tier as SourceTier];
  }
  return SOURCE_WEIGHTS.default;
}

export const FOLLOW_UP_PENALTY = -15;

export interface AdjustScoreResult {
  adjusted: number;
  base_adjusted: number;
  source_weight: number;
  tracking_penalty: number;
  topic_boost: number;
  is_s_tier: boolean;
}

/**
 * Adjusts the mean score with tracking penalty, source weight, and capped topic boost.
 * Formula:
 *   base_adjusted = clamp(0, 100, Math.round((mean + penalty) * weight))
 *   adjusted = clamp(0, 100, base_adjusted + topic_boost)
 *   is_s_tier = base_adjusted >= sTierScore (strictly pre-boost per §5.3)
 */
export function adjustScore(
  mean: number,
  opts: {
    tier?: string | null;
    isFollowUp?: boolean;
    topicMatch?: string[];
    activeTopics?: string[];
    sTierScore?: number;
  } = {}
): AdjustScoreResult {
  const weight = sourceWeight(opts.tier);
  const penalty = opts.isFollowUp ? FOLLOW_UP_PENALTY : 0;

  const rawAdjusted = (mean + penalty) * weight;
  const rounded = Math.round(rawAdjusted);
  const baseAdjusted = Math.max(0, Math.min(100, rounded));
  const topicBoost = opts.topicMatch
    ? computeTopicBoost(opts.topicMatch, opts.activeTopics)
    : 0;
  const adjusted = Math.max(0, Math.min(100, baseAdjusted + topicBoost));
  const sTierCutoff = opts.sTierScore ?? 85;

  return {
    adjusted,
    base_adjusted: baseAdjusted,
    source_weight: weight,
    tracking_penalty: penalty,
    topic_boost: topicBoost,
    is_s_tier: baseAdjusted >= sTierCutoff,
  };
}
