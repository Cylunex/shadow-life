import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolConfig } from "pg";

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
