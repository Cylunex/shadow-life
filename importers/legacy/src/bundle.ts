import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
  change_kind: z.enum(["upsert", "delete"]).default("upsert"),
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
export interface VerifiedManifestFile { path:string;sha256:string;bytes:number; }

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
  const identities = new Set<string>(),targetIdentities=new Set<string>(),mappingIdentities=new Set<string>(),manifestPaths=new Set<string>();
  for(const file of parsed.manifest.files){if(manifestPaths.has(file.path))throw new Error(`duplicate manifest path: ${file.path}`);manifestPaths.add(file.path);}
  for (const object of parsed.objects) {
    if (!(object.source.owner in parsed.owners)) throw new Error(`unmapped owner: ${object.source.owner}`);
    const key = canonical([object.source.instance, object.source.table, object.source.pk, object.source.owner]);
    if (identities.has(key)) throw new Error(`duplicate source identity: ${key}`);
    identities.add(key);
    if (object.change_kind === "delete" && object.source.revision === undefined) throw new Error(`deleted source needs a revision: ${key}`);
    for(const target of object.targets){const targetKey=canonical([target.type,target.id]),mappingKey=canonical([key,target.type,target.role]);if(targetIdentities.has(targetKey))throw new Error(`duplicate target identity: ${targetKey}`);if(mappingIdentities.has(mappingKey))throw new Error(`duplicate source target role: ${mappingKey}`);targetIdentities.add(targetKey);mappingIdentities.add(mappingKey);}
  }
  return parsed;
}

export async function verifyBundleFiles(bundle:MigrationBundle,bundlePath:string):Promise<VerifiedManifestFile[]>{
  const root=await realpath(dirname(resolve(bundlePath))),verified:VerifiedManifestFile[]=[];
  for(const file of bundle.manifest.files){
    if(isAbsolute(file.path))throw new Error(`manifest path must be relative: ${file.path}`);
    const candidate=await realpath(resolve(root,file.path)).catch(()=>{throw new Error(`manifest file does not exist: ${file.path}`);});
    const within=relative(root,candidate);
    if(within.startsWith("..")||isAbsolute(within))throw new Error(`manifest path escapes bundle directory: ${file.path}`);
    const bytes=await readFile(candidate),digest=createHash("sha256").update(bytes).digest("hex");
    if(bytes.byteLength!==file.bytes)throw new Error(`manifest byte size mismatch: ${file.path}`);
    if(digest!==file.sha256)throw new Error(`manifest sha256 mismatch: ${file.path}`);
    verified.push({path:file.path,sha256:digest,bytes:bytes.byteLength});
  }
  return verified;
}
