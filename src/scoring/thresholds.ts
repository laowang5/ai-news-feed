export interface Thresholds {
  featuredMinScore: number;
  sTierScore: number;
  browseMinScore: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  featuredMinScore: 80,
  sTierScore: 85,
  browseMinScore: 60,
};

export function resolveThresholds(input?: Partial<Thresholds>): {
  thresholds: Thresholds;
  error?: 'invalid_thresholds';
} {
  if (!input) {
    return { thresholds: { ...DEFAULT_THRESHOLDS } };
  }

  const candidate: Thresholds = {
    featuredMinScore: input.featuredMinScore ?? DEFAULT_THRESHOLDS.featuredMinScore,
    sTierScore: input.sTierScore ?? DEFAULT_THRESHOLDS.sTierScore,
    browseMinScore: input.browseMinScore ?? DEFAULT_THRESHOLDS.browseMinScore,
  };

  // Validation rule: browseMinScore < featuredMinScore <= sTierScore
  const isValid =
    candidate.browseMinScore < candidate.featuredMinScore &&
    candidate.featuredMinScore <= candidate.sTierScore;

  if (!isValid) {
    return {
      thresholds: { ...DEFAULT_THRESHOLDS },
      error: 'invalid_thresholds',
    };
  }

  return { thresholds: candidate };
}

export function resolveFeaturedMaxItems(input?: number): number {
  if (typeof input !== 'number' || input <= 0 || isNaN(input)) {
    return 20;
  }
  return Math.floor(input);
}
