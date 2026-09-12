import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { capabilityRegistry } from "../src/registry.js";
import { agentThreadMessagesResultSchema, agentThreadsResultSchema, domainRecordsResultSchema, healthSourcesResultSchema, lifeProjectsResultSchema, lifeReviewsResultSchema, lifeSearchResultSchema, lifeTimelineResultSchema, lifeTodayResultSchema, listMealsResultSchema, mealPlanningResultSchema, moneyPlanningResultSchema, notificationsResultSchema, ownedItemsResultSchema, planningAgendaResultSchema } from "../src/schemas.js";

const output = resolve(import.meta.dirname, "../generated");
await mkdir(output, { recursive: true });
const registry = Object.fromEntries(Object.values(capabilityRegistry).map((capability) => [capability.name, {
  name: capability.name,
  description: capability.description,
  possible_effects: capability.possibleEffects,
  idempotency: capability.idempotency,
  status_query: capability.statusQuery,
  input_schema: z.toJSONSchema(capability.inputSchema),
  command_schema: z.toJSONSchema(capability.commandSchema),
  result_schema: z.toJSONSchema(capability.resultSchema)
}]));
const target = resolve(output, "capabilities.json");
const content = `${JSON.stringify({ capabilities: registry }, null, 2)}\n`;
type JsonSchema = {
  type?: string | string[];
  anyOf?: JsonSchema[];
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
};
const kotlinDefinitions: string[] = [];
const defined = new Set<string>();
const pascal = (value: string) => value.split(/[^A-Za-z0-9]+/u).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
const camel = (value: string) => { const name = pascal(value); return name[0]!.toLowerCase() + name.slice(1); };
function kotlinType(schema: JsonSchema, name: string): string {
  if (schema.anyOf) {
    const concrete = schema.anyOf.filter((item) => item.type !== "null");
    if (concrete.length === 1 && concrete.length !== schema.anyOf.length) return `${kotlinType(concrete[0]!, name)}?`;
  }
  if (Array.isArray(schema.type)) {
    const concrete = schema.type.filter((type) => type !== "null");
    if (concrete.length === 1 && concrete.length !== schema.type.length) return `${kotlinType({ ...schema, type: concrete[0]! }, name)}?`;
  }
  if (schema.enum) {
    if (!defined.has(name)) {
      defined.add(name);
      kotlinDefinitions.push(`@Serializable\nenum class ${name}(val wireValue: String) {\n${schema.enum.map((value) => `  @SerialName(${JSON.stringify(value)}) ${pascal(value)}(${JSON.stringify(value)})`).join(",\n")}\n}`);
    }
    return name;
  }
  if (schema.type === "array") return `List<${kotlinType(schema.items ?? {}, name)}>`;
  if (schema.type === "object" && !schema.properties && schema.additionalProperties) return "JsonObject";
  if (schema.type === "object" || schema.properties) { defineObject(schema, name); return name; }
  if (schema.type === "integer") return "Long";
  if (schema.type === "number") return "Double";
  if (schema.type === "boolean") return "Boolean";
  if (schema.type === "string") return "String";
  return "JsonElement";
}
function defineObject(schema: JsonSchema, name: string): void {
  if (defined.has(name)) return;
  defined.add(name);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(properties).map(([wire, value]) => {
    const local = camel(wire);
    const child = value.type === "array" ? `${name}${pascal(wire)}Entry` : `${name}${pascal(wire)}`;
    const type = kotlinType(value, child);
    const optional = !required.has(wire);
    const propertyType = optional && !type.endsWith("?") ? `${type}?` : type;
    return `  @SerialName(${JSON.stringify(wire)}) val ${local}: ${propertyType}${optional ? " = null" : ""}`;
  });
  kotlinDefinitions.push(`@Serializable\ndata class ${name}(\n${fields.join(",\n")}\n)`);
}
defineObject(z.toJSONSchema(domainRecordsResultSchema) as JsonSchema, "DomainRecordsResultDto");
defineObject(z.toJSONSchema(planningAgendaResultSchema) as JsonSchema, "PlanningAgendaResultDto");
defineObject(z.toJSONSchema(notificationsResultSchema) as JsonSchema, "NotificationsResultDto");
defineObject(z.toJSONSchema(lifeTodayResultSchema) as JsonSchema, "LifeTodayResultDto");
defineObject(z.toJSONSchema(lifeTimelineResultSchema) as JsonSchema, "LifeTimelineResultDto");
defineObject(z.toJSONSchema(lifeSearchResultSchema) as JsonSchema, "LifeSearchResultDto");
defineObject(z.toJSONSchema(listMealsResultSchema) as JsonSchema, "ListMealsResultDto");
defineObject(z.toJSONSchema(healthSourcesResultSchema) as JsonSchema, "HealthSourcesResultDto");
defineObject(z.toJSONSchema(lifeProjectsResultSchema) as JsonSchema, "LifeProjectsResultDto");
defineObject(z.toJSONSchema(ownedItemsResultSchema) as JsonSchema, "OwnedItemsResultDto");
defineObject(z.toJSONSchema(lifeReviewsResultSchema) as JsonSchema, "LifeReviewsResultDto");
defineObject(z.toJSONSchema(agentThreadsResultSchema) as JsonSchema, "AgentThreadsResultDto");
defineObject(z.toJSONSchema(agentThreadMessagesResultSchema) as JsonSchema, "AgentThreadMessagesResultDto");
defineObject(z.toJSONSchema(moneyPlanningResultSchema) as JsonSchema, "MoneyPlanningResultDto");
defineObject(z.toJSONSchema(mealPlanningResultSchema) as JsonSchema, "MealPlanningResultDto");
const kotlinTarget = resolve(import.meta.dirname, "../../../apps/android/core/model/src/main/java/com/shadow/life/GeneratedApiDtos.kt");
const kotlinContent = `// Generated by @shadow/contracts. Do not edit.\npackage com.shadow.life\n\nimport kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement\nimport kotlinx.serialization.json.JsonObject\n\n${kotlinDefinitions.join("\n\n")}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  const kotlinCurrent = await readFile(kotlinTarget, "utf8").catch(() => "");
  if (current !== content || kotlinCurrent !== kotlinContent) { console.error("Generated contracts are stale. Run pnpm --filter @shadow/contracts generate."); process.exit(1); }
} else {
  await writeFile(target, content);
  await writeFile(kotlinTarget, kotlinContent);
}
