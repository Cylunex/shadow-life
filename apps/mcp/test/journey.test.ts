import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewFixture, pgOnly, mealInput } from "../../../packages/database/test/review-fixture.js";
import { LifeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";
import { createApp } from "../../api/src/app.js";

test("MCP image-backed dining survives a lost response, replays once, and reads an exact historical window", pgOnly, async t => {
  const fixture = await reviewFixture(t);
  const app = createApp({ ...fixture, developmentAuth: true });
  let dropDiningResponse = true, diningPosts = 0;
  const client = new LifeClient({ api: "http://life.example.com", token: `dev:${fixture.context.subjectId}`, profile: "personal", fetch: async (url, init) => {
    const response = await app.request(String(url), init);
    if (String(url).includes("/commands/life.record_dining")) {
      diningPosts++;
      if (dropDiningResponse) { dropDiningResponse = false; assert.equal(response.status, 201, await response.clone().text()); throw new TypeError("response lost after database commit"); }
    }
    return response;
  } });
  const root = await mkdtemp(join(tmpdir(), "life-dining-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  const handler = createMcpServer(client, [root]);
  const call = async (name: string, args: unknown): Promise<any> => handler(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }));
  const files = [Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')];
  const versions: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = join(root, `original-${i}`); await writeFile(path, files[i]!);
    const upload = await call("assets.upload_local_image", { path });
    assert.equal(upload.result.isError, undefined, JSON.stringify(upload)); versions.push(upload.result.structuredContent.asset_version_id);
  }
  const examples = JSON.parse(await readFile(new URL("../../../skills/life-operator/references/examples.json", import.meta.url), "utf8"));
  const args = examples.find((item: any) => item.capability === "life.record_dining").arguments;
  args.input.sources.forEach((source: any, index: number) => { source.asset_version_id = versions[index]; });
  const unknown = await call("life.record_dining", args);
  assert.equal(unknown.result.structuredContent.code, "outcome_unknown"); assert.equal(diningPosts, 1);
  const recovery = unknown.result.structuredContent.recovery;
  const recovered = await call(recovery.tool, recovery.arguments);
  assert.equal(recovered.result.structuredContent.status, "committed");
  const replay = await call("life.record_dining", args);
  assert.equal(replay.result.structuredContent.replayed, true);
  assert.equal(replay.result.structuredContent.execution_id, recovered.result.structuredContent.execution_id);
  const mealId = String(recovered.result.structuredContent.actual_values.meal_id);
  const detail = await client.call("life.get_record", { id: String(recovered.result.structuredContent.actual_values.consumption_record_id) });
  for (const version of versions) assert.ok(JSON.stringify(detail).includes(version));
  const intakes = (await fixture.pool.query("select name from intake_items where meal_id=$1 and effective", [mealId])).rows;
  assert.deepEqual(intakes.map(item => item.name), ["牛肉面"]);
  assert.equal((await fixture.pool.query("select count(*)::int as count from money_entries")).rows[0].count, 1);
  assert.equal((await fixture.pool.query("select count(*)::int as count from meals")).rows[0].count, 1);
  await fixture.run("life.record_meal", { ...mealInput, occurred_on: "2026-09-21" });
  await fixture.run("life.record_meal", { ...mealInput, occurred_on: "2026-09-23" });
  const filtered: any = await client.call("life.search", { types: ["meals"], from_on: "2026-09-22", to_on_exclusive: "2026-09-23", limit: 1 });
  assert.deepEqual(filtered.items.map((item: any) => item.id), [mealId]);
  const first: any = await client.call("life.list_meals", { limit: 1 });
  const second: any = await client.call("life.list_meals", { limit: 1, cursor: first.next_cursor });
  assert.ok(first.next_cursor); assert.notEqual(first.items[0].id, second.items[0].id);
});
