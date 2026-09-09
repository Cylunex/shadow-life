import { PgBoss } from "pg-boss";
import { Pool } from "pg";
import { materializeRecurringOccurrences, processPendingHealth } from "@shadow/database";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString });
const boss = new PgBoss(connectionString);
await boss.start();

async function dispatchOutbox(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rows = await client.query<{ id: string; event_type: string; payload: unknown }>("select id, event_type, payload from outbox where delivered_at is null order by created_at for update skip locked limit 50");
    for (const row of rows.rows) {
      await boss.send("shadow-events", { outbox_id: row.id, event_type: row.event_type, payload: row.payload }, { singletonKey: row.id });
      await client.query("update outbox set delivered_at = now() where id = $1 and delivered_at is null", [row.id]);
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

await boss.createQueue("shadow-events");
await boss.work("shadow-events", async (jobs) => {
  for (const job of jobs) {
    const data=job.data as {event_type?:string};
    if(data.event_type?.startsWith("health.")){const results=await processPendingHealth(pool);if(results.some(result=>result.state==="failed"))throw new Error("One or more health normalization jobs failed");console.log(JSON.stringify({event:"health.projections.updated",job_id:job.id,normalized:results.length}));}
    else console.log(JSON.stringify({ event: "shadow.event.observed", job_id: job.id }));
  }
});
const timer = setInterval(() => void dispatchOutbox().catch((error) => console.error(error)), 1_000);
const recoveryTimer=setInterval(()=>void processPendingHealth(pool).catch(error=>console.error(error)),30_000);
const planningTimer=setInterval(()=>void materializeRecurringOccurrences(pool).catch(error=>console.error(error)),60_000);
await dispatchOutbox();
await materializeRecurringOccurrences(pool);

async function shutdown() { clearInterval(timer);clearInterval(recoveryTimer);clearInterval(planningTimer); await boss.stop(); await pool.end(); process.exit(0); }
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
