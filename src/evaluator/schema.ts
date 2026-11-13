import { z } from 'zod';

export const ScoreOnlySchema = z.object({
  score: z.number().int().min(0).max(100),
  topic_match: z.array(z.string()).optional(),
});

export type ScoreOnly = z.infer<typeof ScoreOnlySchema>;

export const CopywritingSchema = z.object({
  summary: z.string().min(1).max(500),
  tags: z.array(z.string()).default([]),
  /** Localized title — bilingual by design (see write.ts). */
  title_zh: z.string().max(300).nullable().optional(),
  title_en: z.string().max(300).nullable().optional(),
  /** Optional single-sentence explanation (<=40 chars target) why the item matters. */
  why_it_matters: z.string().max(200).nullable().optional(),
});

export type CopywritingResult = z.infer<typeof CopywritingSchema>;
