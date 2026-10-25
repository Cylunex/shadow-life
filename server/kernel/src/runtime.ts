import { createHash, randomUUID } from "node:crypto";
import type { Clock, Fingerprinter, IdGenerator } from "./ports.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const systemClock: Clock = { now: () => new Date() };
export const uuidIds: IdGenerator = { next: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}` };
export const sha256Fingerprinter: Fingerprinter = { fingerprint: (value) => createHash("sha256").update(canonical(value)).digest("hex") };
