import { z } from "zod";
import { LifeClient, toolError } from "./client.js";
import { uploadLocalImage, uploadTool } from "./media.js";
import { operatorInstructions } from "./profile.js";

const requestSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number().int()]).optional(), method: z.string(), params: z.unknown().optional() });
const callSchema = z.object({ name: z.string(), arguments: z.unknown().optional() });
const initializationSchema = z.object({ protocolVersion: z.string(), capabilities: z.object({}).passthrough(), clientInfo: z.object({ name: z.string(), version: z.string() }).passthrough() });
const versions = ["2025-06-18", "2025-03-26", "2024-11-05"];
const rpcError = (id: string | number | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

export function createMcpServer(client: LifeClient, mediaRoots: readonly string[] = []) {
  return async function handleLine(line: string): Promise<unknown | undefined> {
    if (!line.trim()) return;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { return rpcError(null, -32700, "Parse error"); }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return rpcError(null, -32600, "Invalid Request");
    const message = parsed.data;
    // JSON-RPC notifications never receive responses, including unsupported notifications.
    if (message.id === undefined) return;
    const result = (value: unknown) => ({ jsonrpc: "2.0", id: message.id, result: value });
    try {
      if (message.method === "initialize") {
        const input = initializationSchema.parse(message.params);
        return result({ protocolVersion: versions.includes(input.protocolVersion) ? input.protocolVersion : versions[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "shadow-life", version: "0.3.0" }, instructions: operatorInstructions });
      }
      if (message.method === "ping") return result({});
      if (message.method === "tools/list") {
        // Catalog is intentionally refreshed on every list; cached catalogs in gateways need a reconnect.
        const tools = await client.listTools();
        const canUpload = mediaRoots.length > 0 && tools.some(tool => tool.name === "library.capture");
        return result({ tools: canUpload ? [uploadTool, ...tools] : tools });
      }
      if (message.method === "tools/call") {
        const params = callSchema.parse(message.params), args = params.arguments ?? {};
        const upload = params.name === uploadTool.name && mediaRoots.length > 0;
        if (!upload && !client.allows(params.name)) return rpcError(message.id, -32602, "Unknown tool or tool unavailable in this profile");
        try {
          const value = upload ? await uploadLocalImage(client, mediaRoots, args) : await client.call(params.name as Parameters<LifeClient['call']>[0], args);
          return result({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
        } catch (error) { return result(toolError(error, params.name, args)); }
      }
      return rpcError(message.id, -32601, "Method not found");
    } catch (error) {
      if (error instanceof z.ZodError) return rpcError(message.id, -32602, "Invalid method parameters or capability catalog");
      return rpcError(message.id, -32603, "Life capability discovery is unavailable; verify the API connection and refresh the MCP catalog");
    }
  };
}
