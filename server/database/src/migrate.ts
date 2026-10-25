import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient, type PoolConfig } from "pg";

const canonicalInitialChecksum = "c418d9faaf5ed2017433a8069b9a8ba863233aa9c1969e8d0920675ebf4fd73f";
const intermediateInitialChecksum = "bd38674d5476ffe2c4030c3fba0d460298e37a591bc65586cdb09502952155ad";

async function bridgeIntermediateInitialMigration(client:PoolClient):Promise<void>{
  await client.query("begin");
  try{
    const columns=await client.query<{column_name:string}>("select column_name from information_schema.columns where table_schema=current_schema() and table_name='operations' and column_name in ('capability_version','legacy_capability_version') order by column_name");
    if(columns.rowCount!==0)throw new Error("Intermediate 0001 schema is not in its expected pre-bridge shape");
    const operationTable=await client.query("select to_regclass(current_schema()||'.operations') present");
    if(operationTable.rows[0]?.present===null)throw new Error("Intermediate 0001 schema is missing operations");
    await client.query("alter table operations add column capability_version integer");
    await client.query("update schema_migrations set checksum=$2 where name=$1",["0001_initial.sql",canonicalInitialChecksum]);
    await client.query("commit");
  }catch(error){await client.query("rollback");throw error;}
}

export async function migrate(config: PoolConfig | Pool): Promise<void> {
  const pool = config instanceof Pool ? config : new Pool(config);
  const ownsPool = !(config instanceof Pool);
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended('shadow-life:schema-migrations', 0))");
    await client.query("create table if not exists schema_migrations(name text primary key, checksum text not null, applied_at timestamptz not null default now())");
    const directory = resolve(import.meta.dirname, "../migrations");
    const names = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
    for (const name of names) {
      const contents = await readFile(resolve(directory, name), "utf8");
      const checksum = createHash("sha256").update(contents).digest("hex");
      const existing = await client.query<{ checksum: string }>("select checksum from schema_migrations where name=$1", [name]);
      if (existing.rowCount) {
        if(existing.rows[0]!.checksum===intermediateInitialChecksum&&name==="0001_initial.sql"&&checksum===canonicalInitialChecksum){await bridgeIntermediateInitialMigration(client);continue;}
        if (existing.rows[0]!.checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      const body = contents.replace(/^\s*BEGIN;\s*/iu, "").replace(/\s*COMMIT;\s*$/iu, "");
      await client.query("begin");
      try {
        await client.query(body);
        await client.query("insert into schema_migrations(name, checksum) values($1, $2)", [name, checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    try { await client.query("select pg_advisory_unlock(hashtextextended('shadow-life:schema-migrations', 0))"); }
    finally { client.release(); if (ownsPool) await pool.end(); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  await migrate({ connectionString });
}
