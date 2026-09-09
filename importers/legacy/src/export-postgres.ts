import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { canonical } from "./bundle.js";

const [sourceInstance,outputPath]=process.argv.slice(2);const connectionString=process.env.LEGACY_DATABASE_URL;
if(!sourceInstance||!outputPath||!connectionString)throw new Error("usage: LEGACY_DATABASE_URL=... export-postgres <source-instance> <output.json>");
const excluded=new Set(["local_identities","browser_sessions","oidc_transactions"]);
const forbidden=/(^|_)(password|passwd|access_token|refresh_token|cookie|client_secret|private_key|dsn|authorization)($|_)/iu;
const pool=new Pool({connectionString,max:1});const client=await pool.connect();
try{
  await client.query("begin isolation level repeatable read read only");
  const catalog=await client.query<{table_name:string;column_name:string}>("select table_name,column_name from information_schema.columns where table_schema='public' and table_name not in ('alembic_version') order by table_name,ordinal_position");
  const tables=new Map<string,string[]>();for(const row of catalog.rows){const columns=tables.get(row.table_name)??[];columns.push(row.column_name);tables.set(row.table_name,columns);}
  const secretColumns=[...tables].flatMap(([table,columns])=>excluded.has(table)?[]:columns.filter(column=>forbidden.test(column)).map(column=>`${table}.${column}`));if(secretColumns.length)throw new Error(`refusing export with secret-bearing columns: ${secretColumns.join(", ")}`);
  const snapshots=[];for(const [table,columns] of tables){if(excluded.has(table)){snapshots.push({table,disposition:"excluded_session_or_identity_secret",columns,row_count:0,rows:[],sha256:null});continue;}const quoted=`"${table.replaceAll('"','""')}"`;const result=await client.query(`select * from ${quoted}`);const rows=result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,Buffer.isBuffer(value)?{encoding:"base64",data:value.toString("base64")}:value])));snapshots.push({table,disposition:"staged_for_mapping",columns,row_count:rows.length,rows,sha256:createHash("sha256").update(canonical(rows)).digest("hex")});}
  const payload={protocol:"shadow.legacy-snapshot",source_instance:sourceInstance,exported_at:new Date().toISOString(),database:"postgresql",isolation:"repeatable read read only",excluded_tables:[...excluded],tables:snapshots};const encoded=JSON.stringify(payload,null,2)+"\n";await writeFile(outputPath,encoded,{mode:0o600});await client.query("commit");console.log(JSON.stringify({protocol:payload.protocol,source_instance:sourceInstance,tables:snapshots.length,rows:snapshots.reduce((sum,item)=>sum+item.row_count,0),sha256:createHash("sha256").update(encoded).digest("hex"),output:outputPath}));
}catch(error){await client.query("rollback");throw error;}finally{client.release();await pool.end();}
