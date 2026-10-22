import { foundationKinds } from "@shadow/contracts";
import { z } from "zod";
import { buildCapabilityHttpRequest, capabilityRegistry, commandId, operationErrorSchema, parseCapabilityResult, type AgentScenarioName, type CapabilityName } from "@shadow/contracts";
import { profileAllows, type McpProfile } from "./profile.js";

export class ToolFailure extends Error {
  constructor(readonly detail: Record<string, unknown>) { super(String(detail.message)); }
}

export interface ClientOptions {
  api: string;
  token?: string;
  proxySecret?: string;
  proxyClientId?: string;
  profile: McpProfile;
  scenario?: AgentScenarioName;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
const catalogSchema = z.object({ capabilities: z.array(z.object({
  name: z.string(), description: z.string(), input_schema: z.record(z.string(), z.unknown()).optional()
})) });
export const isCapability = (name: string): name is CapabilityName => Object.hasOwn(capabilityRegistry, name);

export function capabilityTool(name: CapabilityName, schema: Record<string, unknown>) {
  const capability = capabilityRegistry[name], write = capability.idempotency === "required";
  return {
    name, description: capability.description,
    inputSchema: write ? { type: "object", additionalProperties: false, required: ["command_id", "input"], properties: { command_id: z.toJSONSchema(commandId), input: schema } } : schema,
    annotations: { readOnlyHint: !write, idempotentHint: true, openWorldHint: false, ...(write ? {} : { destructiveHint: false }) }
  };
}

export class LifeClient {
  readonly api: string;
  constructor(readonly options: ClientOptions) {
    const url = new URL(options.api);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("SHADOW_API_URL must be an HTTP(S) URL without credentials, query or fragment");
    this.api = options.api.replace(/\/$/u, "");
    if (!options.token && !options.proxySecret) throw new Error("SHADOW_ACCESS_TOKEN or SHADOW_PROXY_AUTH_SECRET is required");
    if(options.proxyClientId&&!/^client_[A-Za-z0-9_.:-]{1,193}$/u.test(options.proxyClientId))throw new Error("SHADOW_PROXY_CLIENT_ID is invalid");
  }
  allows(name: string): name is CapabilityName { return isCapability(name) && profileAllows(this.options.profile, name, this.options.scenario); }

  async request(path: string, init: RequestInit = {}, write = false): Promise<unknown> {
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.api}${path}`, {
        ...init, redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        headers: { ...init.headers,...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : { "x-shadow-proxy-secret": this.options.proxySecret!,...(this.options.proxyClientId?{"x-shadow-proxy-client-id":this.options.proxyClientId}:{}) }) }
      });
      let body: unknown;
      try { body = await response.json(); } catch { /* Never echo proxy HTML or arbitrary upstream bodies. */ }
      if (!response.ok) {
        const error = operationErrorSchema.safeParse(body);
        if (error.success) throw new ToolFailure({ ...error.data, http_status: response.status });
        const code = response.status === 401 ? "invalid_token" : response.status === 403 ? "permission_denied" : write ? "outcome_unknown" : "upstream_error";
        throw new ToolFailure({ protocol: "shadow.error", code, message: `Life returned HTTP ${response.status}.`, http_status: response.status });
      }
      if (body === undefined) throw new ToolFailure({ protocol: "shadow.error", code: write ? "outcome_unknown" : "unsupported_contract", message: "Life returned an unreadable result." });
      return body;
    } catch (error) {
      if (error instanceof ToolFailure) throw error;
      throw new ToolFailure({ protocol: "shadow.error", code: write ? "outcome_unknown" : "temporarily_unavailable", message: "Life request timed out or could not reach the API." });
    }
  }

  async listCapabilities(includeSchemas = false) {
    const catalog = catalogSchema.parse(await this.request(`/api/capabilities${includeSchemas ? "?include_schemas=true" : ""}`));
    return catalog.capabilities.filter(item => this.allows(item.name));
  }

  async listTools() {
    const visible = await this.listCapabilities(true);
    const tools = [];
    // Old servers omit input_schema; bound legacy discovery to four requests at a time.
    for (let offset = 0; offset < visible.length; offset += 4) {
      tools.push(...await Promise.all(visible.slice(offset, offset + 4).map(async item => {
        const name = item.name as CapabilityName;
        const schema = item.input_schema ?? z.object({ input_schema: z.record(z.string(), z.unknown()) }).parse(await this.request(`/api/capabilities/${encodeURIComponent(name)}`)).input_schema;
        return capabilityTool(name, schema);
      })));
    }
    return tools;
  }

  async call(name: CapabilityName, args: unknown): Promise<unknown> {
    if (!this.allows(name)) throw new ToolFailure({ protocol: "shadow.error", code: "permission_denied", message: "The tool is unavailable in this profile/scenario." });
    if (["agent.context", "agent.discover", "agent.glossary", "agent.scenarios", "agent.catalog", "agent.intentions", "agent.workspace", "agent.objects", "agent.tasks", "agent.learning", "agent.changes", "agent.export"].includes(name)) {
      // Profile is narrowing metadata, never authority. The adapter owns its configured scope.
      const value = z.record(z.string(), z.unknown()).parse(args);
      args = { ...value, profile: this.options.profile,
        ...(this.options.scenario ? { scenario: this.options.scenario } : {}) };
    }
    if(this.options.scenario && ["agent.set_intention","agent.save_task","agent.save_learning","agent.set_subscription","agent.restore"].includes(name)){
      const wrapper=z.object({input:z.record(z.string(),z.unknown())}).passthrough().parse(args);
      wrapper.input=capabilityRegistry[name].inputSchema.parse(wrapper.input) as Record<string,unknown>;
      const scopes=name==="agent.restore"?(wrapper.input.entries as Array<{scope?:string}>??[]).map(entry=>entry.scope):[wrapper.input.scope];
      const payloads=name==="agent.restore"?(wrapper.input.entries as Array<Record<string,any>>):[wrapper.input];
      if(payloads.some(payload=>[...(payload.object_refs as Array<{kind:string}>??[]),...(payload.project_ref?[payload.project_ref]:[])].some((ref:any)=>!foundationKinds[this.options.scenario!]!.includes(ref.kind))))throw new ToolFailure({protocol:"shadow.error",code:"permission_denied",message:"Evidence outside the configured scenario is unavailable."});
      if(scopes.some(scope=>scope!==this.options.scenario&&scope!=="global"))throw new ToolFailure({protocol:"shadow.error",code:"permission_denied",message:"Writing outside the configured scenario is unavailable."});
    }
    if(this.options.scenario&&name==="agent.ack_changes"){
      const wrapper=z.object({input:z.object({consumer:z.string()}).passthrough()}).passthrough().parse(args);
      await this.call("agent.changes",{consumer:wrapper.input.consumer,limit:1});
    }
    const request = buildCapabilityHttpRequest(this.api, name, args);
    const write = capabilityRegistry[name].idempotency === "required";
    const body = await this.request(request.url.slice(this.api.length), { method: request.method, headers: { "content-type": "application/json" }, ...(request.body ? { body: request.body } : {}) }, write);
    try { return parseCapabilityResult(name, body); }
    catch { throw new ToolFailure({ protocol: "shadow.error", code: write ? "outcome_unknown" : "unsupported_contract", message: "Life result did not match the current contract. Check the receipt before retrying a write; refresh matching API/MCP versions." }); }
  }
}

export function toolError(error: unknown, name: string, args: unknown) {
  const detail = error instanceof ToolFailure ? error.detail : error instanceof z.ZodError ? {
    protocol: "shadow.error", code: "validation", message: "Tool input is invalid; no command was submitted.",
    fields: error.issues.map(issue => issue.path.join(".")), issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message }))
  } : { protocol: "shadow.error", code: "tool_failed", message: "The tool could not complete. No success is claimed." };
  const key = z.object({ command_id: commandId }).safeParse(args);
  const recovery = detail.code === "outcome_unknown" && key.success ? {
    action: "lookup_receipt", tool: "operations.find", arguments: { command_id: key.data.command_id },
    instruction: "Do not claim failure or create a new key. If no receipt is visible, retry only the identical command with this same key; a not_found result alone does not prove non-application."
  } : detail.code === "conflict" ? { action: "read_current_record", instruction: "Read the current record/revision and reconcile the user's intent. Never blindly change command_id or expected_revision to bypass a conflict." }
    : ["invalid_token", "permission_denied", "identity_not_linked"].includes(String(detail.code)) ? { action: "check_connection", instruction: "Report the authorization issue; do not bypass it using a different service, shell or database." }
    : detail.code === "retryable_not_applied" ? { action: "retry_same_command", instruction: "The server reports no write was applied; retry the same command_id and input when available." }
    : detail.code === "validation" || detail.code === "missing_fact" ? { action: "correct_input", instruction: "Correct only the listed fields. Omit unknown optional values rather than null; ask only for a necessary fact that changes business meaning." }
    : { action: "report_error", instruction: "Report the actual unavailable capability or error; do not substitute legacy services or invent success." };
  const body = { ...detail, capability: name, recovery };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
}
