import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { ChatCompletionRuntimeAdapter } from "@shadow/agent-adapter";
import { AgentRepository, PostgresUnitOfWork, migrate } from "@shadow/database";
import { CommandExecutor, QueryService, sha256Fingerprinter, systemClock, uuidIds } from "@shadow/kernel";
import { createApp } from "../src/app.js";
const pgOnly = { skip: !process.env.TEST_DATABASE_URL };
const mealInput = { occurred_on: "2026-09-10", time_zone: "Asia/Shanghai", meal_type: "lunch", items: [{ name: "合成米饭", quantity: "1", unit: "碗", estimate: false }] };
async function reviewFixture(t: TestContext) {
  const admin = new PostgresUnitOfWork({ connectionString: process.env.TEST_DATABASE_URL }), name = `model_${randomUUID().replaceAll("-", "")}`;
  await admin.pool.query(`create database "${name}"`); const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const unitOfWork = new PostgresUnitOfWork({ connectionString: url.toString() }), pool = unitOfWork.pool;
  t.after(async () => { await unitOfWork.close(); await admin.pool.query(`drop database "${name}" with (force)`); await admin.close(); });
  await migrate(pool); await pool.query("update write_epochs set stage='life',epoch=epoch+1");
  const context = { subjectId: "subject_model_test" }; await unitOfWork.ensurePrincipal(context.subjectId);
  const executor = new CommandExecutor({ unitOfWork, ids: uuidIds, clock: systemClock, fingerprinter: sha256Fingerprinter }), queries = new QueryService(unitOfWork);
  return { pool, unitOfWork, executor, queries, context };
}

test("built-in model runs writes through Executor and only Host publishes saved receipts", pgOnly, async t => {
  const { pool, unitOfWork, executor, queries, context } = await reviewFixture(t);
  let count = 0;
  const runtime = new ChatCompletionRuntimeAdapter({ url: "https://model.example.com/chat/completions", apiKey: "test", model: "test", fetcher: async (_url, init) => {
    const request = JSON.parse(String(init?.body)); count++;
    const tool = count === 1 ? { id: "discover_test", type: "function", function: { name: "life_agent__discover", arguments: JSON.stringify({ names: ["life.record_meal"], include_schemas: true }) } } : count === 2 ? { id: "meal_test", type: "function", function: { name: "life_life__record_meal", arguments: JSON.stringify(mealInput) } } : null;
    if (count === 3) { const receipt = JSON.parse(request.messages.at(-1).content); assert.ok(receipt.execution_id); assert.ok(receipt.actual_values.meal_id); }
    return Response.json({ choices: [{ finish_reason: tool ? "tool_calls" : "stop", message: { content: tool ? null : "已记录合成米饭，营养未知。", ...(tool ? { tool_calls: [tool] } : {}) } }] });
  } });
  const repository = new AgentRepository(pool), thread = `thread_${randomUUID().replaceAll("-", "")}`;
  await repository.createThread(context.subjectId, thread, "model test");
  const app = createApp({ unitOfWork, executor, queries, developmentAuth: true, agent: { repository, runtime, nextId: kind => `${kind}_${randomUUID().replaceAll("-", "")}` } });
  const response = await app.request(`/api/threads/${thread}/runs`, { method: "POST", headers: { authorization: `Bearer dev:${context.subjectId}`, "content-type": "application/json" }, body: JSON.stringify({ text: "记录合成午餐" }) });
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
  assert.equal(response.status, 200); assert.equal(count, 3);
  const saved = events.filter(event => event.type === "operation.committed");
  assert.equal(saved.length, 1); assert.equal(saved[0].authority, "executor");
  assert.equal(events.filter(event => event.type === "run.state").at(-1).state, "completed");
});
