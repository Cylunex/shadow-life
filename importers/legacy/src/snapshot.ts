import { z } from "zod";
import { canonical, sha256 } from "./bundle.js";

const jsonScalar=z.union([z.string(),z.number(),z.boolean(),z.null()]);
const jsonValue:z.ZodType<unknown>=z.lazy(()=>z.union([jsonScalar,z.array(jsonValue),z.record(z.string(),jsonValue)]));
export const legacyColumnSchema=z.object({name:z.string().min(1),data_type:z.string().min(1),udt_name:z.string().min(1),nullable:z.boolean(),primary_key_position:z.number().int().positive().nullable()}).strict();
export const legacySnapshotTableSchema=z.object({schema:z.string().min(1).default("public"),table:z.string().min(1),disposition:z.enum(["staged_for_mapping","excluded_session_or_identity_secret","excluded_runtime_state"]),columns:z.array(legacyColumnSchema).min(1),row_count:z.number().int().nonnegative(),rows:z.array(z.record(z.string(),jsonValue)),sha256:z.string().regex(/^[a-f0-9]{64}$/u).nullable()}).strict();
export const legacySnapshotSchema=z.object({protocol:z.literal("shadow.legacy-snapshot"),snapshot_id:z.string().regex(/^snapshot_[a-f0-9]{64}$/u),source_instance:z.string().min(1).max(200),exported_at:z.iso.datetime({offset:true}),database:z.literal("postgresql"),isolation:z.literal("repeatable read read only"),catalog_fingerprint:z.string().regex(/^[a-f0-9]{64}$/u),excluded_tables:z.array(z.string()),tables:z.array(legacySnapshotTableSchema)}).strict();
export type LegacySnapshot=z.infer<typeof legacySnapshotSchema>;

const columnDispositionSchema=z.enum(["source_identity","native_field","archive_payload","excluded_session_or_identity","excluded_runtime_state","blocked"]);
export const mappingReviewSchema=z.object({protocol:z.literal("shadow.legacy-mapping-review"),snapshot_id:z.string().regex(/^snapshot_[a-f0-9]{64}$/u),source_instance:z.string().min(1).max(200),mapper_version:z.string().min(1).max(100),tables:z.array(z.object({name:z.string().min(1),disposition:z.enum(["native","historical_archive","excluded_session_or_identity","excluded_runtime_state","blocked"]),mapping_key:z.string().min(1).max(200).nullable(),reason:z.string().min(1).max(1_000),columns:z.array(z.object({name:z.string().min(1),disposition:columnDispositionSchema,target:z.string().min(1).max(300).nullable(),reason:z.string().min(1).max(1_000)}).strict())}).strict())}).strict();
export type MappingReview=z.infer<typeof mappingReviewSchema>;

export interface MappingAudit{protocol:"shadow.legacy-mapping-audit";snapshot_id:string;mapper_version:string;coverage_complete:boolean;ready:boolean;tables:number;columns:number;native_tables:number;archived_tables:number;excluded_tables:number;blocked_tables:number;gaps:string[];}
export interface SnapshotInspection{
  protocol:"shadow.legacy-snapshot-inspection";
  snapshot_id:string;
  source_instance:string;
  catalog_fingerprint:string;
  schemas:Array<{name:string;tables:number;columns:number;rows:number;included_tables:number;included_rows:number;excluded_tables:number}>;
  totals:{tables:number;columns:number;rows:number;included_tables:number;included_rows:number;excluded_tables:number};
  tables:Array<{name:string;disposition:LegacySnapshot["tables"][number]["disposition"];columns:number;rows:number;sha256:string|null}>;
  mapping_review_required:true;
}

export function jsonSafe(value:unknown):unknown{
  if(value===null||typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value;
  if(typeof value==="bigint")return value.toString();
  if(value instanceof Date)return value.toISOString();
  if(Buffer.isBuffer(value))return{encoding:"base64",data:value.toString("base64")};
  if(Array.isArray(value))return value.map(jsonSafe);
  if(typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,jsonSafe(item)]));
  throw new Error(`unsupported PostgreSQL export value: ${typeof value}`);
}

export function deterministicRows(rows:readonly Record<string,unknown>[]):Record<string,unknown>[]{return rows.map(row=>jsonSafe(row) as Record<string,unknown>).sort((left,right)=>canonical(left).localeCompare(canonical(right)));}
export function tableIdentity(table:{schema?:string;table:string}):string{return !table.schema||table.schema==="public"?table.table:`${table.schema}.${table.table}`;}
export function catalogFingerprint(tables:readonly {schema?:string;table:string;columns:readonly z.infer<typeof legacyColumnSchema>[]}[]):string{return sha256(tables.map(table=>({schema:table.schema??"public",table:table.table,columns:table.columns})).sort((left,right)=>tableIdentity(left).localeCompare(tableIdentity(right))));}
export function snapshotId(value:{source_instance:string;catalog_fingerprint:string;tables:readonly {schema?:string;table:string;disposition:string;row_count:number;sha256:string|null}[]}):string{return`snapshot_${sha256({source_instance:value.source_instance,catalog_fingerprint:value.catalog_fingerprint,tables:value.tables.map(table=>({schema:table.schema??"public",table:table.table,disposition:table.disposition,row_count:table.row_count,sha256:table.sha256})).sort((left,right)=>tableIdentity(left).localeCompare(tableIdentity(right)))})}`;}

export function mappingSkeleton(snapshotInput:unknown,mapperVersion:string):MappingReview{const snapshot=validateSnapshot(snapshotInput);return{protocol:"shadow.legacy-mapping-review",snapshot_id:snapshot.snapshot_id,source_instance:snapshot.source_instance,mapper_version:mapperVersion,tables:snapshot.tables.map(table=>{const excludedSession=table.disposition==="excluded_session_or_identity_secret",excludedRuntime=table.disposition==="excluded_runtime_state",disposition=excludedSession?"excluded_session_or_identity" as const:excludedRuntime?"excluded_runtime_state" as const:"blocked" as const,reason=excludedSession?"Exporter excluded session or identity state; users must authenticate again.":excludedRuntime?"Exporter explicitly excluded source-bound runtime state; it must be re-established by the native client.":"Assign a native or historical archive mapper before migration.";return{name:tableIdentity(table),disposition,mapping_key:null,reason,columns:table.columns.map(column=>({name:column.name,disposition:excludedSession?"excluded_session_or_identity" as const:excludedRuntime?"excluded_runtime_state" as const:"blocked" as const,target:null,reason:excludedSession?"Excluded with the containing session or identity table.":excludedRuntime?"Excluded with the containing source-bound runtime state table.":"Assign this source field an explicit disposition."}))};})};}

export function inspectSnapshot(snapshotInput:unknown):SnapshotInspection{
  const snapshot=validateSnapshot(snapshotInput),schemas=new Map<string,SnapshotInspection["schemas"][number]>();
  for(const table of snapshot.tables){
    const schema=schemas.get(table.schema)??{name:table.schema,tables:0,columns:0,rows:0,included_tables:0,included_rows:0,excluded_tables:0},included=table.disposition==="staged_for_mapping";
    schema.tables++;schema.columns+=table.columns.length;schema.rows+=table.row_count;if(included){schema.included_tables++;schema.included_rows+=table.row_count;}else schema.excluded_tables++;
    schemas.set(table.schema,schema);
  }
  const tables=snapshot.tables.map(table=>({name:tableIdentity(table),disposition:table.disposition,columns:table.columns.length,rows:table.row_count,sha256:table.sha256})).sort((left,right)=>left.name.localeCompare(right.name)),totals=tables.reduce((result,table)=>({tables:result.tables+1,columns:result.columns+table.columns,rows:result.rows+table.rows,included_tables:result.included_tables+(table.disposition==="staged_for_mapping"?1:0),included_rows:result.included_rows+(table.disposition==="staged_for_mapping"?table.rows:0),excluded_tables:result.excluded_tables+(table.disposition!=="staged_for_mapping"?1:0)}),{tables:0,columns:0,rows:0,included_tables:0,included_rows:0,excluded_tables:0});
  return{protocol:"shadow.legacy-snapshot-inspection",snapshot_id:snapshot.snapshot_id,source_instance:snapshot.source_instance,catalog_fingerprint:snapshot.catalog_fingerprint,schemas:[...schemas.values()].sort((left,right)=>left.name.localeCompare(right.name)),totals,tables,mapping_review_required:true};
}

export function auditMapping(snapshotInput:unknown,reviewInput:unknown):MappingAudit{
  const snapshot=validateSnapshot(snapshotInput),review=mappingReviewSchema.parse(reviewInput),gaps:string[]=[];
  if(review.snapshot_id!==snapshot.snapshot_id)gaps.push("review is bound to a different snapshot_id");
  if(review.source_instance!==snapshot.source_instance)gaps.push("review is bound to a different source_instance");
  const reviews=new Map<string,MappingReview["tables"][number]>();
  for(const table of review.tables){if(reviews.has(table.name))gaps.push(`duplicate review table: ${table.name}`);reviews.set(table.name,table);}
  for(const extra of [...reviews.keys()].filter(name=>!snapshot.tables.some(table=>tableIdentity(table)===name)))gaps.push(`review contains unknown table: ${extra}`);
  let columns=0,native=0,archived=0,excluded=0,blocked=0;
  for(const source of snapshot.tables){
    const sourceName=tableIdentity(source);columns+=source.columns.length;const table=reviews.get(sourceName);
    if(!table){gaps.push(`missing table disposition: ${sourceName}`);continue;}
    if(table.disposition==="native")native++;else if(table.disposition==="historical_archive")archived++;else if(table.disposition==="excluded_session_or_identity"||table.disposition==="excluded_runtime_state")excluded++;else blocked++;
    if(source.disposition==="staged_for_mapping"&&(table.disposition==="excluded_session_or_identity"||table.disposition==="excluded_runtime_state"))gaps.push(`included source table cannot be excluded: ${sourceName}`);
    if(source.disposition==="excluded_session_or_identity_secret"&&table.disposition!=="excluded_session_or_identity")gaps.push(`session or identity table must remain excluded: ${sourceName}`);
    if(source.disposition==="excluded_runtime_state"&&table.disposition!=="excluded_runtime_state")gaps.push(`runtime state table must remain excluded: ${sourceName}`);
    if((table.disposition==="native"||table.disposition==="historical_archive")&&!table.mapping_key)gaps.push(`mapped table needs mapping_key: ${sourceName}`);
    if((table.disposition==="blocked"||table.disposition==="excluded_session_or_identity"||table.disposition==="excluded_runtime_state")&&table.mapping_key)gaps.push(`unmapped table cannot name a mapping_key: ${sourceName}`);
    const fields=new Map<string,MappingReview["tables"][number]["columns"][number]>();
    for(const field of table.columns){if(fields.has(field.name))gaps.push(`duplicate field disposition: ${sourceName}.${field.name}`);fields.set(field.name,field);}
    for(const extra of [...fields.keys()].filter(name=>!source.columns.some(column=>column.name===name)))gaps.push(`unknown source field: ${sourceName}.${extra}`);
    for(const column of source.columns){
      const field=fields.get(column.name);if(!field){gaps.push(`missing field disposition: ${sourceName}.${column.name}`);continue;}
      if(field.disposition==="blocked"&&field.target!==null)gaps.push(`blocked field cannot name a target: ${sourceName}.${column.name}`);
      if((field.disposition==="native_field"||field.disposition==="source_identity")&&!field.target)gaps.push(`mapped field needs target: ${sourceName}.${column.name}`);
      if(field.disposition==="excluded_session_or_identity"&&table.disposition!=="excluded_session_or_identity")gaps.push(`session or identity field exclusion is only allowed inside its excluded table: ${sourceName}.${column.name}`);
      if(field.disposition==="excluded_runtime_state"&&table.disposition!=="excluded_runtime_state")gaps.push(`runtime field exclusion is only allowed inside its excluded table: ${sourceName}.${column.name}`);
      if(table.disposition==="native"&&field.disposition==="archive_payload")gaps.push(`native table field cannot be hidden in archive payload: ${sourceName}.${column.name}`);
    }
  }
  const coverageComplete=gaps.length===0,ready=coverageComplete&&blocked===0&&review.tables.every(table=>table.columns.every(field=>field.disposition!=="blocked"));
  return{protocol:"shadow.legacy-mapping-audit",snapshot_id:snapshot.snapshot_id,mapper_version:review.mapper_version,coverage_complete:coverageComplete,ready,tables:snapshot.tables.length,columns,native_tables:native,archived_tables:archived,excluded_tables:excluded,blocked_tables:blocked,gaps};
}

export function validateSnapshot(input:unknown):LegacySnapshot{const snapshot=legacySnapshotSchema.parse(input),names=new Set<string>();for(const table of snapshot.tables){const name=tableIdentity(table);if(names.has(name))throw new Error(`duplicate snapshot table: ${name}`);names.add(name);if(table.rows.length!==table.row_count)throw new Error(`snapshot row count mismatch: ${name}`);const digest=table.disposition==="staged_for_mapping"?sha256(table.rows):null;if(digest!==table.sha256)throw new Error(`snapshot table hash mismatch: ${name}`);const rowColumns=new Set(table.columns.map(column=>column.name));for(const row of table.rows)for(const column of Object.keys(row))if(!rowColumns.has(column))throw new Error(`snapshot row contains unknown column: ${name}.${column}`);}const fingerprint=catalogFingerprint(snapshot.tables);if(fingerprint!==snapshot.catalog_fingerprint)throw new Error("snapshot catalog fingerprint mismatch");const expected=snapshotId(snapshot);if(expected!==snapshot.snapshot_id)throw new Error("snapshot content identity mismatch");return snapshot;}
