import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { reviewFixture, mealInput } from '../../server/database/test/review-fixture.js';

test('record existing retrieval baseline on synthetic records', async t => {
  const { run, queries, context } = await reviewFixture(t);
  const meal = await run('life.record_meal', mealInput);
  await run('agent.set_memory', { category: 'explicit_preference', memory_key: 'travel.seat', value: '靠窗' });
  const start = performance.now();
  const history = await queries.lifeSearch(context, { q: '合成米饭', types: ['meals'], from_on: '2026-09-10', to_on_exclusive: '2026-09-11' });
  const memory = await queries.agentMemories(context);
  assert.equal(history.items[0]?.id, meal.actual_values.meal_id);
  assert.equal(memory.items.length, 1);
  const report = { fixture_version: 'life-context-v1', runtime: 'none', model_success_rate: null, path: 'existing life.search + agent.memories', requests: 2, retrieval_match_rate: 1, source_validity_rate: null, result_bytes: Buffer.byteLength(JSON.stringify({ history, memory })), duration_ms: performance.now() - start, limitations: ['search result has no revision-pinned source', 'recent memory injects unrelated travel preference'] };
  if (process.env.SHADOW_EVAL_REPORT) writeFileSync(process.env.SHADOW_EVAL_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
