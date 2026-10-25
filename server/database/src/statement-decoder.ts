import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { invalidInput } from "@shadow/kernel";

interface DecoderConfig { pythonCommand?: string; timeoutMs?: number; }
export type StatementDecoder = (bytes: Buffer, input: { source_name: string; password?: string | undefined; member?: string | undefined }) => Promise<Record<string, unknown>[]>;
export function statementDecoder(config: DecoderConfig = {}): StatementDecoder {
  if (config.pythonCommand !== undefined && !isAbsolute(config.pythonCommand)) throw new Error("Statement Python command must be absolute");
  const timeout = config.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120_000) throw new Error("Invalid statement decoder timeout");
  return async (bytes, input) => {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw invalidInput("Statement file exceeds 20 MiB.", ["asset_version_id"]);
    try {
      const value = await new Promise<any>((resolve, reject) => {
        const child = execFile(config.pythonCommand ?? "python3", [fileURLToPath(new URL("../python/statement_files.py", import.meta.url))], { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, shell: false }, (error, stdout) => {
          if (error) reject(new Error("conversion failed")); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("invalid conversion")); } }
        });
        child.stdin!.on("error", () => {});
        child.stdin!.end(JSON.stringify({ data: bytes.toString("base64"), name: input.source_name, password: input.password, member: input.member }));
      });
      if (value.selectionRequired) throw new Error("member required");
      if (!Array.isArray(value.rows) || !value.rows.length || value.rows.length > 50_000 || value.rows.some((r: unknown) => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("invalid rows");
      return value.rows;
    } catch { throw invalidInput("Statement could not be decoded. Check file format, password, member selection and decoder availability.", ["asset_version_id", "password", "member"]); }
  };
}
export function configuredStatementDecoder(): StatementDecoder {
  const path = process.env.SHADOW_STATEMENT_CONFIG_FILE;
  if (!path) return statementDecoder();
  if (!isAbsolute(path)) throw new Error("Statement config path must be absolute");
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).some(k => !["pythonCommand", "timeoutMs"].includes(k))) throw new Error("Invalid statement decoder config");
  return statementDecoder(config);
}
