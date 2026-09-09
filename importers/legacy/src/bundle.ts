import { createHash } from "node:crypto";
import { z } from "zod";

const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([jsonScalar, z.array(jsonValue), z.record(z.string(), jsonValue)]));
const sourceIdentitySchema = z.object({
  instance: z.string().min(1).max(200),
  table: z.string().min(1).max(200),
  pk: z.record(z.string(), jsonScalar),
  owner: z.string().min(1).max(200),
  revision: z.string().max(100).optional()
}).strict();
export const migrationObjectSchema = z.object({
  source: sourceIdentitySchema,
  payload: z.record(z.string(), jsonValue),
  targets: z.array(z.object({
    component: z.string().min(1).max(100),
    type: z.enum(["money_entry", "meal", "health_raw", "archive"]),
    id: z.string().regex(/^[a-z][a-z0-9_]{7,127}$/u),
    role: z.string().min(1).max(80).default("primary"),
    data: z.record(z.string(), jsonValue)
  }).strict()).min(1)
}).strict();
export const migrationBundleSchema = z.object({
  protocol: z.literal("shadow.legacy-bundle"),
  source_snapshot: z.string().min(1).max(200),
  mapper_version: z.string().min(1).max(100),
  target_schema_version: z.string().min(1).max(100),
  owners: z.record(z.string(), z.string().regex(/^[a-z][a-z0-9_]{7,127}$/u)),
  manifest: z.object({ files: z.array(z.object({ path:z.string().min(1), sha256:z.string().regex(/^[a-f0-9]{64}$/u), bytes:z.number().int().nonnegative() }).strict()).default([]) }).strict(),
  objects: z.array(migrationObjectSchema)
}).strict();
export type MigrationBundle = z.infer<typeof migrationBundleSchema>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const sha256 = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
export const stableMigrationId = (prefix: string, value: unknown) => `${prefix}_${sha256(value).slice(0,24)}`;

const forbidden = /(^|_)(password|passwd|token|cookie|secret|private_key|dsn|authorization)($|_)/iu;
export function findSecretFields(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item,index)=>findSecretFields(item,`${path}[${index}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string,unknown>).flatMap(([key,item]) => [
    ...(forbidden.test(key) ? [`${path}.${key}`] : []),
    ...findSecretFields(item, `${path}.${key}`)
  ]);
}

export function validateBundle(input: unknown): MigrationBundle {
  const parsed = migrationBundleSchema.parse(input);
  const secrets = findSecretFields(parsed);
  if (secrets.length) throw new Error(`bundle contains forbidden secret fields: ${secrets.join(", ")}`);
  const identities = new Set<string>();
  for (const object of parsed.objects) {
    if (!(object.source.owner in parsed.owners)) throw new Error(`unmapped owner: ${object.source.owner}`);
    const key = canonical([object.source.instance, object.source.table, object.source.pk, object.source.owner]);
    if (identities.has(key)) throw new Error(`duplicate source identity: ${key}`);
    identities.add(key);
  }
  return parsed;
}
