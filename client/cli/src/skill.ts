import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { LifeClient, ToolFailure, toolError, isCapability } from "@shadow/life-client/client";
import { uploadLocalImage, uploadLocalFile, uploadTool, uploadFileTool, uploadAttachmentTool, uploadLocalAttachment } from "@shadow/life-client/media";
import { agentScenarioNameSchema, lifeSourceScope, canReadLifeSource, lifeCardQueries } from "@shadow/contracts";

async function readSource(client: LifeClient) {
  if (![...lifeCardQueries].some(name => client.allows(name))) return { isError: true, code: "permission_denied" };
  try {
    let scope: unknown;
    try {
      const source = await client.request("/api/source") as {scope?: unknown} | null;
      scope = source?.scope;
    } catch (error) {
      if (!(error instanceof ToolFailure) || error.detail.http_status !== 404) throw error;
      const me = await client.request("/api/me") as Record<string, unknown> | null;
      if (Array.isArray(me?.effects) && canReadLifeSource(new Set(me.effects))) {
        scope = await lifeSourceScope(me.issuer, me.environment_id, me.life_subject_id);
      }
    }
    if (typeof scope === "string" && /^[0-9a-f]{64}$/u.test(scope)) return { scope };
    return { isError: true, code: "source_unavailable" };
  } catch (error) {
    const denied = error instanceof ToolFailure && [401, 403].includes(Number(error.detail.http_status));
    return { isError: true, code: denied ? "permission_denied" : "source_unavailable" };
  }
}

// One JSON document in/out; no protocol handshake or resident MCP process.
export async function runSkill(configPath: string, action: string, name?: string, args: unknown = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const profile = config.profile ?? "personal";
  if (!["personal", "personal-money-void", "authorized"].includes(profile)) throw new Error("Invalid Life profile");
  const roots = config.mediaRoots ?? [];
  if (!Array.isArray(roots) || roots.some((root: unknown) => typeof root !== "string" || !isAbsolute(root))) throw new Error("Absolute mediaRoots required");
  const timeoutMs = config.timeoutMs ?? 30000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("Invalid timeoutMs");
  const client = new LifeClient({ api: config.api, profile, timeoutMs,
    ...(config.token ? { token: config.token } : {}),
    ...(config.proxySecret ? { proxySecret: config.proxySecret } : {}),
    ...(config.proxyClientId ? { proxyClientId: config.proxyClientId } : {}),
    ...(config.scenario ? { scenario: agentScenarioNameSchema.parse(config.scenario) } : {}) });
  if (action === "source") return readSource(client);
  if (action === "call-scoped") {
    const request = args as {scope?: unknown; arguments?: unknown} | null;
    if (!name || !lifeCardQueries.has(name) || !isCapability(name) ||
        typeof request?.scope !== "string" || !/^[0-9a-f]{64}$/u.test(request.scope)) return { isError: true, code: "permission_denied" };
    if (["life.owned_items", "life.projects"].includes(name)) {
      const record = request.arguments as { id?: unknown; limit?: unknown } | null;
      if (typeof record?.id !== "string" || !/^[a-z][a-z0-9_]{7,127}$/u.test(record.id) || record.limit !== 1)
        return { isError: true, code: "permission_denied" };
    }
    // One credential snapshot for both attestations and the read, even when the config file is rotated.
    const before = await readSource(client);
    if (before.scope !== request.scope) return { isError: true, code: "permission_denied" };
    try {
      const result = await client.call(name, request.arguments);
      const after = await readSource(client);
      return after.scope === request.scope ? result : { isError: true, code: "permission_denied" };
    } catch (error) { return { ...toolError(error, name, request.arguments).structuredContent, isError: true }; }
  }
  if (action === "catalog") return [...(await client.listTools()).map(tool =>
    lifeCardQueries.has(tool.name) ? { ...tool, _meta: { "shadow.life/source": 1, "shadow.life/record-cards": 1 } } : tool), ...(roots.length ? [uploadTool, uploadAttachmentTool, ...(client.allows("money.import_file") ? [uploadFileTool] : [])] : [])];
  if(action==="describe"&&name){
    const tool=(await client.listTools()).find(t=>t.name===name);
    if(!tool)throw new Error("Capability unavailable for this profile and account");
    return tool;
  }
  if (action !== "call" || !name) throw new Error("Usage: skill --config <private.json> catalog | source | describe <capability> | call <capability> [input.json]; default input is stdin");
  try {
    if (name === uploadAttachmentTool.name) return await uploadLocalAttachment(client, roots, args);
    if (name === uploadTool.name) return await uploadLocalImage(client, roots, args);
    if (name === uploadFileTool.name) return await uploadLocalFile(client, roots, args);
    if (!isCapability(name)) throw new Error("Unknown capability");
    return await client.call(name, args);
  } catch (error) { return { ...toolError(error, name, args).structuredContent, isError: true }; }
}

if (process.argv[1]?.endsWith("/skill.ts")) {
  const [, , flag, configPath, action, name, inputPath] = process.argv;
  if (flag !== "--config" || !configPath || !action) throw new Error("Life skill requires --config <private.json> and catalog/call");
  let args: unknown = {};
  if (action === "call" || action === "call-scoped") {
    let raw: string;
    if (inputPath) raw = await readFile(inputPath, "utf8");
    else { const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); raw = Buffer.concat(chunks).toString("utf8"); }
    args = JSON.parse(raw || "{}");
  }
  try {
    const result = await runSkill(configPath, action, name, args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result && typeof result === "object" && !Array.isArray(result) && "isError" in result && result.isError) process.exitCode = 1;
  } catch { process.stdout.write(`${JSON.stringify({ isError: true, code: "connection_unavailable", message: "Life skill configuration or connection unavailable" })}\n`); process.exitCode = 1; }
}
