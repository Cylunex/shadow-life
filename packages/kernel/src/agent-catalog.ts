import { createHash } from "node:crypto";
import {
  agentCatalogInputSchema, agentCatalogSnapshotSchema, profileAllows, type McpProfile,
  agentDiscoverInputSchema, agentDiscoverResultSchema, agentGlossaryInputSchema, agentGlossaryResultSchema,
  agentScenariosInputSchema, agentScenariosResultSchema, agentValidateInputSchema, agentValidateResultSchema,
  buildAgentCatalogDocument, capabilityRegistry, type AgentCapability, type AgentScenarioName, type AgentTerm, type CapabilityName
} from "@shadow/contracts";
import type { RequestContext } from "./ports.js";
import { notFound } from "./errors.js";

const catalog = buildAgentCatalogDocument();
export const agentCatalogRevision = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");
function matches(query: string, values: readonly string[]): boolean {
  const q = normalize(query);
  return !q || values.some(value => {
    const candidate = normalize(value);
    return candidate.length >= 2 && (candidate.includes(q) || q.includes(candidate));
  });
}
const termMatches = (query: string, term: AgentTerm) => matches(query, [term.id, term.title, ...term.aliases]);
function visibleNames(context: RequestContext, profile: McpProfile = "authorized", scenario?: AgentScenarioName): Set<string> {
  return new Set(Object.entries(capabilityRegistry).filter(([name, item]) => profileAllows(profile, name as CapabilityName, scenario) && item.possibleEffects.some(effect => context.effects.has(effect))).map(([, item]) => item.name));
}
function visibleTerms(names: ReadonlySet<string>): AgentTerm[] {
  return catalog.terms.map(term => ({ ...term, capabilities: term.capabilities.filter(name => names.has(name)), lookup_tools: term.lookup_tools.filter(name => names.has(name)) }))
    .filter(term => term.capabilities.length > 0);
}
function visibleScenarios(names: ReadonlySet<string>) {
  return catalog.scenarios.map(scenario => ({ ...scenario, capabilities: scenario.capabilities.filter(name => names.has(name)) })).filter(scenario => scenario.capabilities.length > 0);
}

export function discoverAgentCapabilities(context: RequestContext, input: unknown = {}) {
  const parsed = agentDiscoverInputSchema.parse(input), names = visibleNames(context, parsed.profile, parsed.scenario);
  const terms = visibleTerms(names).filter(term => termMatches(parsed.query, term));
  const scenario = catalog.scenarios.find(item => item.name === parsed.scenario);
  const ranked = catalog.capabilities.filter(item => names.has(item.name))
    .filter(item => !scenario || scenario.capabilities.includes(item.name))
    .filter(item => !parsed.names || parsed.names.includes(item.name))
    .filter(item => !parsed.read_only || item.mode === "read")
    .map(item => {
      const matched = terms.filter(term => term.capabilities.includes(item.name));
      const q = parsed.query.trim().toLowerCase();
      const nameScore = q && item.name.toLowerCase() === q ? 100 : q && item.name.toLowerCase().includes(q) ? 60 : 0;
      const descriptionScore = q && matches(q, [item.description]) ? 30 : 0;
      const termScore = matched.reduce((sum, term) => sum + 15 + (term.capabilities.length - term.capabilities.indexOf(item.name)) * 2, 0);
      const score = nameScore + descriptionScore + (q ? termScore : 0);
      return { item, matched, score };
    }).filter(item => !parsed.query || item.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : 0));
  const page = ranked.slice(parsed.offset, parsed.offset + parsed.limit);
  const capabilities: AgentCapability[] = page.map(({ item, matched }) => {
    const { input_schema, result_schema, ...metadata } = item;
    return { ...metadata, matched_terms: matched.map(term => term.id), ...(parsed.include_schemas ? { input_schema, result_schema } : {}) };
  });
  const next = parsed.offset + page.length;
  const returned = new Set(capabilities.map(item => item.name));
  return agentDiscoverResultSchema.parse({
    catalog_revision: agentCatalogRevision, capabilities,
    terms: terms.filter(term => term.capabilities.some(name => returned.has(name))),
    total: ranked.length, next_offset: next < ranked.length ? next : null, truncated: next < ranked.length
  });
}
export function queryAgentGlossary(context: RequestContext, input: unknown = {}) {
  const parsed = agentGlossaryInputSchema.parse(input);
  const terms = visibleTerms(visibleNames(context, parsed.profile, parsed.scenario)).filter(term => termMatches(parsed.query, term));
  return agentGlossaryResultSchema.parse({ catalog_revision: agentCatalogRevision, terms: terms.slice(0, parsed.limit), total: terms.length, truncated: terms.length > parsed.limit });
}
export function queryAgentScenarios(context: RequestContext, input: unknown = {}) {
  const parsed = agentScenariosInputSchema.parse(input);
  return agentScenariosResultSchema.parse({ catalog_revision: agentCatalogRevision, scenarios: visibleScenarios(visibleNames(context, parsed.profile)).filter(item => !parsed.scenario || item.name === parsed.scenario) });
}
export function exportAgentCatalog(context: RequestContext, input: unknown = {}) {
  const parsed = agentCatalogInputSchema.parse(input), names = visibleNames(context, parsed.profile, parsed.scenario);
  return agentCatalogSnapshotSchema.parse({ catalog_revision: agentCatalogRevision,
    capabilities: catalog.capabilities.filter(item => names.has(item.name)).map(item => ({ ...item, matched_terms: [] })),
    terms: visibleTerms(names), scenarios: visibleScenarios(names) });
}

/** Syntax/effect validation only. Never calls a repository, Executor, or model. */
export function validateAgentTool(context: RequestContext, input: unknown) {
  const parsed = agentValidateInputSchema.parse(input);
  if (!Object.hasOwn(capabilityRegistry, parsed.name) || !visibleNames(context).has(parsed.name)) throw notFound("Capability");
  const capability = capabilityRegistry[parsed.name as CapabilityName];
  const value = capability.inputSchema.safeParse(parsed.input), write = capability.idempotency === "required";
  const issues = value.success ? [] : value.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({ path: issue.path.join("."), message: issue.message }));
  const required = value.success ? [...capability.resolveEffects(value.data)] : [];
  // Read aggregates deliberately allow partial domain visibility. Real read execution rechecks its scope.
  if (value.success && write) for (const effect of required) if (!context.effects.has(effect)) issues.push({ path: "", message: `Missing permission: ${effect}` });
  return agentValidateResultSchema.parse({ name: parsed.name, catalog_revision: agentCatalogRevision, valid: issues.length === 0, executed: false,
    mode: write ? "write" : "read", required_effects: required, issues, ...(issues.length === 0 && value.success ? { input: value.data } : {}) });
}
