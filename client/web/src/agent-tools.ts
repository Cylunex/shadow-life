import {
  agentCatalogSnapshotSchema, agentDiscoverResultSchema, agentGlossaryResultSchema, agentScenariosResultSchema, agentValidateResultSchema,
  buildCapabilityHttpRequest, capabilityRegistry, parseCapabilityResult, personalOperatorTools, writeCapabilityNameSchema, type AgentScenarioName
} from "@shadow/contracts";
import type { Execute } from "./command-controller.js";

export async function toolJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => undefined) as { message?: string } | undefined;
  if (!response.ok) throw new Error(body?.message ?? `HTTP ${response.status}`);
  if (body === undefined) throw new Error("服务端没有返回可识别的结果。");
  return body;
}
export async function loadAgentTools(request: typeof fetch, headers: HeadersInit, input: { query?: string; scenario?: AgentScenarioName; offset?: number; readOnly?: boolean } = {}) {
  const params = new URLSearchParams({ query: input.query ?? "", limit: "20", offset: String(input.offset ?? 0), read_only: String(input.readOnly ?? false), include_schemas: "true" });
  if (input.scenario) params.set("scenario", input.scenario);
  return agentDiscoverResultSchema.parse(await toolJson(await request(`/api/agent/discover?${params}`, { headers })));
}
export async function loadAgentScenarios(request: typeof fetch, headers: HeadersInit) {
  return agentScenariosResultSchema.parse(await toolJson(await request("/api/agent/scenarios", { headers })));
}
export async function loadAgentGlossary(request: typeof fetch, headers: HeadersInit, query = "") {
  return agentGlossaryResultSchema.parse(await toolJson(await request(`/api/agent/glossary?query=${encodeURIComponent(query)}&limit=30`, { headers })));
}
export async function loadAgentSnapshot(request: typeof fetch, headers: HeadersInit) {
  return agentCatalogSnapshotSchema.parse(await toolJson(await request("/api/agent/catalog", { headers })));
}
export async function validateToolInput(request: typeof fetch, headers: HeadersInit, name: string, input: unknown) {
  return agentValidateResultSchema.parse(await toolJson(await request("/api/agent/tools/validate", { method: "POST", headers: { ...Object.fromEntries(new Headers(headers)), "content-type": "application/json" }, body: JSON.stringify({ name, input }) })));
}
export async function runAgentTool(request: typeof fetch, headers: HeadersInit, execute: Execute, name: string, input: unknown) {
  if (!Object.hasOwn(capabilityRegistry, name)) throw new Error("工具不存在。");
  if (!canDebugExecute(name)) throw new Error("此工具需要专用操作入口；调试台只执行查询和普通个人记录操作。");
  const validated = await validateToolInput(request, headers, name, input);
  if (!validated.valid) throw new Error(validated.issues.map(issue => `${issue.path || "权限"}: ${issue.message}`).join("；"));
  const capabilityName = name as keyof typeof capabilityRegistry;
  if (validated.mode === "write") return { mode: "write" as const, value: await execute(writeCapabilityNameSchema.parse(name), validated.input, `agent-tools:${name}`) };
  const invocation = buildCapabilityHttpRequest("", capabilityName, validated.input);
  const value = await toolJson(await request(invocation.url, { method: invocation.method, headers: { ...Object.fromEntries(new Headers(headers)), "content-type": "application/json" }, ...(invocation.body ? { body: invocation.body } : {}) }));
  return { mode: "read" as const, value: parseCapabilityResult(capabilityName, value) };
}
export function canDebugExecute(name: string): boolean {
  if (!Object.hasOwn(capabilityRegistry, name)) return false;
  const key = name as keyof typeof capabilityRegistry;
  return capabilityRegistry[key].idempotency !== "required" || personalOperatorTools.has(key);
}
