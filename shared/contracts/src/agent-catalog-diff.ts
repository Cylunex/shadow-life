import { agentCatalogSnapshotSchema, type AgentCatalogSnapshot } from "./agent-schemas.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function changes(before: readonly Record<string, unknown>[], after: readonly Record<string, unknown>[], key: string) {
  const old = new Map(before.map(item => [String(item[key]), item])), current = new Map(after.map(item => [String(item[key]), item]));
  return {
    added: [...current.keys()].filter(name => !old.has(name)).sort(),
    removed: [...old.keys()].filter(name => !current.has(name)).sort(),
    changed: [...current.keys()].filter(name => old.has(name) && canonical(old.get(name)) !== canonical(current.get(name))).sort()
  };
}
export function diffAgentCatalogs(before: AgentCatalogSnapshot, after: AgentCatalogSnapshot) {
  const old = agentCatalogSnapshotSchema.parse(before), current = agentCatalogSnapshotSchema.parse(after);
  return { before_revision: old.catalog_revision, after_revision: current.catalog_revision,
    capabilities: changes(old.capabilities, current.capabilities, "name"), terms: changes(old.terms, current.terms, "id"), scenarios: changes(old.scenarios, current.scenarios, "name") };
}
