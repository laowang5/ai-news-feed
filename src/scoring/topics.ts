export const TOPICS = [
  { id: 'agent-infra', label: 'Agent 基建' },
  { id: 'model-release', label: '模型发布' },
  { id: 'open-source', label: '开源工具' },
  { id: 'business', label: '融资与商业' },
] as const;

export type TopicId = (typeof TOPICS)[number]['id'];

export const DEFAULT_TOPICS: TopicId[] = ['agent-infra', 'model-release'];

const VALID_TOPIC_IDS = new Set<string>(TOPICS.map((t) => t.id));
const LABEL_MAP = new Map<string, string>(TOPICS.map((t) => [t.id, t.label]));

/**
 * Resolve configured topics. Defaults to ['agent-infra', 'model-release'] when undefined.
 * Preserves [] when user explicitly disables all topics.
 */
export function resolveTopics(topics?: string[] | null): TopicId[] {
  if (topics === undefined || topics === null) {
    return [...DEFAULT_TOPICS];
  }
  if (!Array.isArray(topics)) {
    return [...DEFAULT_TOPICS];
  }
  const seen = new Set<TopicId>();
  const resolved: TopicId[] = [];
  for (const id of topics) {
    if (typeof id === 'string' && VALID_TOPIC_IDS.has(id) && !seen.has(id as TopicId)) {
      seen.add(id as TopicId);
      resolved.push(id as TopicId);
    }
    if (resolved.length >= TOPICS.length) break;
  }
  return resolved;
}

export function getTopicLabel(topicId: string): string | null {
  return LABEL_MAP.get(topicId) || null;
}

/**
 * Compute capped post-hoc boost: min(5, matchedCount * 3).
 * Returns 0 when activeTopics is empty.
 */
export function computeTopicBoost(topicMatch?: string[], activeTopics?: string[]): number {
  if (!Array.isArray(topicMatch) || topicMatch.length === 0) {
    return 0;
  }
  const activeSet =
    activeTopics !== undefined
      ? new Set(resolveTopics(activeTopics))
      : VALID_TOPIC_IDS;

  if (activeSet.size === 0) {
    return 0;
  }

  const matched = new Set<string>();
  for (const id of topicMatch) {
    if (typeof id === 'string' && activeSet.has(id)) {
      matched.add(id);
    }
  }

  return Math.min(5, matched.size * 3);
}
