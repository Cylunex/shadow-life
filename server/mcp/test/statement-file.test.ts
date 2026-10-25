import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewFixture, pgOnly } from "../../database/test/review-fixture.js";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";
import { createApp } from "../../api/src/app.js";

test("opaque original files cross MCP/HTTP and Life automatically processes ordinary rows exactly once", pgOnly, async t => {
  const fixture = await reviewFixture(t), app = createApp({ ...fixture, developmentAuth: true });
  const dir = await mkdtemp(join(tmpdir(), "life-statement-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "statement.csv");
  await writeFile(path, "date,amount,type,transaction_id,merchant\n2026-10-01,12.30,expense,synthetic-pay-001,合成商家\n2026-10-02,4.50,income,synthetic-income-001,合成收入");
  let drop = true;
  const client = new LifeClient({ api: "http://life.example.com", token: `dev:${fixture.context.subjectId}`, profile: "personal", fetch: async (url, init) => {
    const response = await app.request(String(url), init);
    if (String(url).includes("/commands/money.import_file") && drop) { assert.equal(response.status, 201, await response.clone().text()); drop = false; throw new TypeError("response lost after commit"); }
    return response;
  } });
  const handler = createMcpServer(client, [dir]);
  const call = async (name: string, args: unknown): Promise<any> => (await handler(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any).result;
  const original = (await call("assets.upload_local_file", { path })).structuredContent;
  assert.ok(original.asset_version_id);
  const args = { command_id: "cmd_file_import_001", input: { asset_version_id: original.asset_version_id, source_name: "statement.csv", time_zone: "Asia/Shanghai" } };
  const lost = await call("money.import_file", args);
  assert.equal(lost.structuredContent.code, "outcome_unknown");
  const recovered = (await call("operations.find", { command_id: args.command_id })).structuredContent;
  assert.equal(recovered.actual_values.confirmed, 2);
  assert.equal((await call("money.import_file", args)).structuredContent.replayed, true);
  const status = (await call("money.import_file_status", { file_id: recovered.actual_values.file_id })).structuredContent;
  assert.equal(status.status, "completed"); assert.equal(status.confirmed, 2); assert.equal(status.sha256, original.sha256);
  const repeated = (await call("money.import_file", { ...args, command_id: "cmd_file_import_repeat_001" })).structuredContent;
  assert.equal(repeated.actual_values.file_id, status.file_id);
  assert.equal((await fixture.pool.query("select count(*)::int count from money_entries")).rows[0].count, 2);
  assert.equal((await fixture.pool.query("select count(*)::int count from sources where asset_version_id=$1", [original.asset_version_id])).rows[0].count, 2);
  const stranger = { ...fixture.context, subjectId: "subject_other_person", actorId: "subject_other_person" };
  await fixture.unitOfWork.ensurePrincipal(stranger.subjectId);
  await assert.rejects(fixture.queries.moneyImportFile(stranger, status.file_id));
  await assert.rejects(fixture.run("money.import_file", args.input, stranger));
  assert.equal((await fixture.pool.query("select count(*)::int count from money_import_files")).rows[0].count, 1);
  assert.ok(!JSON.stringify(recovered).includes("password"));
});

test("Life retains exceptional refunds and conflicting source identities while processing normal rows", pgOnly, async t => {
  const fixture = await reviewFixture(t), app = createApp({ ...fixture, developmentAuth: true });
  const content = JSON.stringify([{ date: "2026-10-01", amount: "12.30", type: "expense", transaction_id: "conflict" }, { date: "2026-10-02", amount: "13.30", type: "expense", transaction_id: "conflict" }, { date: "2026-10-03", amount: "2.00", type: "refund", transaction_id: "unknown-refund" }, { date: "2026-10-04", amount: "9.50", type: "expense", transaction_id: "normal" }]);
  const response = await app.request("/api/assets", { method: "POST", headers: { authorization: `Bearer dev:${fixture.context.subjectId}`, "content-type": "application/octet-stream" }, body: content });
  const asset = await response.json() as any;
  const result = await fixture.run("money.import_file", { asset_version_id: asset.asset_version_id, source_name: "statement.json", time_zone: "Asia/Shanghai" });
  assert.equal(result.actual_values.confirmed, 1); assert.equal(result.actual_values.pending, 3);
  const status = await fixture.queries.moneyImportFile(fixture.context, String(result.actual_values.file_id));
  assert.equal(status.status, "needs_input"); assert.ok(status.pending_reasons.some(r => r.code === "source_identity_conflict"));
  assert.equal((await fixture.pool.query("select count(*)::int count from money_entries")).rows[0].count, 1);
});
