import { z } from "zod";
import { buildCapabilityHttpRequest, capabilityRegistry, commandId, operationErrorSchema, parseCapabilityResult, type CapabilityName } from "@shadow/contracts";
import { profileAllows, type McpProfile } from "./profile.js";

export class ToolFailure extends Error {
  constructor(readonly detail: Record<string, unknown>) { super(String(detail.message)); }
}

export interface ClientOptions {
  api: string;
  token?: string;
  proxySecret?: string;
  profile: McpProfile;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
const catalogSchema = z.object({ capabilities: z.array(z.object({
  name: z.string(), description: z.string(), input_schema: z.record(z.string(), z.unknown()).optional()
})) });
export const isCapability = (name: string): name is CapabilityName => Object.hasOwn(capabilityRegistry, name);

export class LifeClient {
  readonly api: string;
  constructor(readonly options: ClientOptions) {
    const url = new URL(options.api);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("SHADOW_API_URL must be an HTTP(S) URL without credentials, query or fragment");
    this.api = options.api.replace(/\/$/u, "");
    if (!options.token && !options.proxySecret) throw new Error("SHADOW_ACCESS_TOKEN or SHADOW_PROXY_AUTH_SECRET is required");
  }
  allows(name: string): name is CapabilityName { return isCapability(name) && profileAllows(this.options.profile, name); }

  async request(path: string, init: RequestInit = {}, write = false): Promise<unknown> {
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.api}${path}`, {
        ...init, redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        headers: { ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : { "x-shadow-proxy-secret": this.options.proxySecret! }), ...init.headers }
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

  async listTools() {
    const catalog = catalogSchema.parse(await this.request("/api/capabilities?include_schemas=true"));
    const visible = catalog.capabilities.filter(item => this.allows(item.name));
    const tools = [];
    // Old servers omit input_schema; bound legacy discovery to four requests at a time.
    for (let offset = 0; offset < visible.length; offset += 4) {
      tools.push(...await Promise.all(visible.slice(offset, offset + 4).map(async item => {
        const name = item.name as CapabilityName, capability = capabilityRegistry[name];
        const schema = item.input_schema ?? z.object({ input_schema: z.record(z.string(), z.unknown()) }).parse(await this.request(`/api/capabilities/${encodeURIComponent(name)}`)).input_schema;
        const write = capability.idempotency === "required";
        return {
          name, description: capability.description,
          inputSchema: write ? { type: "object", additionalProperties: false, required: ["command_id", "input"], properties: { command_id: z.toJSONSchema(commandId), input: schema } } : schema,
          annotations: { readOnlyHint: !write, idempotentHint: true, openWorldHint: false, ...(write ? {} : { destructiveHint: false }) }
        };
      })));
    }
    return tools;
  }

  async call(name: CapabilityName, args: unknown): Promise<unknown> {
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
