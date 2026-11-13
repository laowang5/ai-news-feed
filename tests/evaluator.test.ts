import { describe, it } from 'node:test';
import assert from 'node:assert';
import { repairAndParseEvaluation } from '../src/evaluator/repair.js';
import { NewsEvaluator } from '../src/evaluator/evaluator.js';

describe('NewsEvaluator & Malformed JSON Repair', () => {
  it('should clean and repair JSON wrapped in markdown fences with trailing comma', () => {
    const raw = `
\`\`\`json
{
  "score": 92,
  "summary": "DeepSeek-V3 架构突破，大幅度优化 MoE 路由与训练开销，具备顶级开源模型竞争力。",
  "tags": ["DeepSeek-V3", "MoE-Architecture"],
}
\`\`\`
`;
    const repaired = repairAndParseEvaluation(raw);
    assert.ok(repaired, 'Repaired result must not be null');
    assert.strictEqual(repaired.score, 92);
    assert.strictEqual(repaired.tags.length, 2);
    assert.strictEqual(repaired.tags[0], 'DeepSeek-V3');
  });

  it('should gracefully return null for completely unparseable text without throwing', () => {
    const invalidRaw = '抱歉，我不清楚如何回答这个问题。';
    const res = repairAndParseEvaluation(invalidRaw);
    assert.strictEqual(res, null);
  });

  it('should gracefully degrade when no LLM is available', async () => {
    // Empty options, no API key, no ctx
    const evaluator = new NewsEvaluator({});
    assert.strictEqual(evaluator.isAvailable(), false);

    const result = await evaluator.evaluateItem({
      title: 'Test Article',
      summary: 'Summary text',
      source: 'test',
    });
    assert.strictEqual(result, null);
  });
});
