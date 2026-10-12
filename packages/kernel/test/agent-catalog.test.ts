import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry, agentScenarios, agentTerms, diffAgentCatalogs, profileAllows } from "@shadow/contracts";
import { discoverAgentCapabilities, exportAgentCatalog, queryAgentGlossary, queryAgentScenarios, validateAgentTool } from "../src/agent-catalog.js";
import type { RequestContext } from "../src/ports.js";

const context = (effects: string[]): RequestContext => ({ actorId: "subject_catalog", subjectId: "subject_catalog", clientId: "client_catalog", effects: new Set(effects), traceId: "catalog_test" });
const all = context([...new Set(Object.values(capabilityRegistry).flatMap(item => [...item.possibleEffects]))]);

test("Chinese task discovery maps business synonyms and preserves consumption boundaries", () => {
  const result = discoverAgentCapabilities(all, { query: "这个月外卖花了多少钱", read_only: true, include_schemas: true });
  assert.ok(result.capabilities.some(item => item.name === "life.consumption_stats"));
  assert.ok(result.capabilities.every(item => item.mode === "read" && item.input_schema));
  const intake = queryAgentGlossary(all, { query: "吃了" });
  assert.ok(intake.terms.some(item => item.id === "intake" && item.boundaries.some(value => value.includes("不证明摄入"))));
  const experience = discoverAgentCapabilities(all, { query: "复购" });
  assert.equal(experience.capabilities[0]?.name, "life.correct_purchase");
  assert.equal(discoverAgentCapabilities(all, { query: "完全不存在的业务术语xyz" }).total, 0);
});

test("permission filtering precedes ranking, glossary expansion, examples and snapshots", () => {
  const health = context(["health.measurement.read"]);
  assert.equal(discoverAgentCapabilities(health, { query: "退款" }).total, 0);
  assert.equal(queryAgentScenarios(health, { scenario: "spending" }).scenarios.length, 0);
  const snapshot = exportAgentCatalog(health);
  const names = new Set(snapshot.capabilities.map(item => item.name));
  assert.ok(!names.has("money.record_entry") && !names.has("life.record_meal"));
  assert.ok(snapshot.terms.every(term => [...term.capabilities, ...term.lookup_tools].every(name => names.has(name))));
  assert.ok(snapshot.scenarios.every(scenario => scenario.capabilities.every(name => names.has(name))));
  assert.equal(exportAgentCatalog(context([])).capabilities.length, 0);
  assert.throws(() => validateAgentTool(health, { name: "money.record_entry", input: {} }), (error: any) => error.detail.code === "not_found");
  assert.throws(() => validateAgentTool(all, { name: "constructor", input: {} }), (error: any) => error.detail.code === "not_found");
});

test("bounded paging completes one deterministic catalog without duplication", () => {
  const names: string[] = []; let offset: number | null = 0, revision: string | undefined;
  while (offset !== null) {
    const page = discoverAgentCapabilities(all, { offset, limit: 7 });
    revision ??= page.catalog_revision; assert.equal(page.catalog_revision, revision);
    assert.ok(page.capabilities.length <= 7); assert.ok(page.capabilities.every(item => item.input_schema === undefined));
    names.push(...page.capabilities.map(item => item.name)); offset = page.next_offset;
  }
  assert.equal(names.length, Object.keys(capabilityRegistry).length); assert.equal(new Set(names).size, names.length);
  assert.throws(() => discoverAgentCapabilities(all, { limit: 31 }));
  assert.throws(() => discoverAgentCapabilities(all, { scenario: "unknown" }));
});

test("scenarios and personal profiles narrow capabilities without granting authority", () => {
  const travel = discoverAgentCapabilities(all, { profile: "personal", scenario: "travel", limit: 30 });
  assert.ok(travel.capabilities.length > 0);
  assert.ok(travel.capabilities.every(item => profileAllows("personal", item.name as keyof typeof capabilityRegistry, "travel")));
  assert.ok(!travel.capabilities.some(item => item.name === "money.record_entry"));
  assert.equal(discoverAgentCapabilities(context(["money.entry.read"]), { scenario: "travel", profile: "authorized" }).total, 0);
  assert.equal(profileAllows("personal", "life.void_purchase"), false);
  assert.equal(profileAllows("personal", "money.void_entry"), false);
  assert.equal(profileAllows("personal-money-void", "money.void_entry"), true);
  assert.equal(profileAllows("personal-money-void", "life.void_purchase"), false);
  assert.equal(profileAllows("personal-money-void", "money.stage_import"), false);
  assert.equal(profileAllows("personal", "agent.discover", "travel"), true);
});

test("syntax-only validation cannot manufacture ownership or bypass conditional write effects", () => {
  const input = { occurred_on: "2026-10-12", time_zone: "Asia/Shanghai", meal_type: "lunch", items: [{ name: "鸡蛋" }], source: { kind: "text", captured_on: "2026-10-12", original_text: "午饭鸡蛋" } };
  const meal = context(["life.meal.write", "library.source.link"]);
  const valid = validateAgentTool(meal, { name: "life.record_meal", input });
  assert.equal(valid.valid, true); assert.equal(valid.executed, false);
  const extra = validateAgentTool(meal, { name: "life.record_meal", input: { ...input, subject_id: "subject_other" } });
  assert.equal(extra.valid, false); assert.equal(extra.input, undefined);
  const missing = validateAgentTool(meal, { name: "life.record_meal", input: { ...input, payment: { amount: "10.00", currency: "CNY", occurred_on: "2026-10-12", time_zone: "Asia/Shanghai" } } });
  assert.equal(missing.valid, false); assert.ok(missing.issues.some(issue => issue.message.includes("money.entry.write")));
});

test("all metadata references resolve, and shared workflow examples obey their actual contracts", () => {
  for (const name of [...agentTerms.flatMap(term => [...term.capabilities, ...term.lookup_tools]), ...agentScenarios.flatMap(scenario => scenario.capabilities)]) assert.ok(Object.hasOwn(capabilityRegistry, name), name);
  for (const item of exportAgentCatalog(all).capabilities) {
    if (!item.example) continue;
    const capability = capabilityRegistry[item.name as keyof typeof capabilityRegistry];
    capability.inputSchema.parse(item.mode === "write" ? item.example.input : item.example);
  }
});

test("snapshot comparison detects contract and terminology changes independently of digest or key order", () => {
  const old = exportAgentCatalog(all), current = structuredClone(old);
  const changed = current.capabilities.find(item => item.name === "money.record_entry")!;
  changed.input_schema = { ...changed.input_schema, description: "changed input" };
  current.terms[0]!.definition += " updated";
  current.scenarios.pop(); current.capabilities = current.capabilities.filter(item => item.name !== "health.trend");
  const diff = diffAgentCatalogs(old, current);
  assert.deepEqual(diff.capabilities.changed, ["money.record_entry"]); assert.deepEqual(diff.capabilities.removed, ["health.trend"]);
  assert.deepEqual(diff.terms.changed, [old.terms[0]!.id]); assert.deepEqual(diff.scenarios.removed, ["planning"]);
  assert.deepEqual(diffAgentCatalogs(old, structuredClone(old)).capabilities.changed, []);
});
