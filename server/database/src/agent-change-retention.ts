import type { Pool } from "pg";

/** Prune old, acknowledged journal projections. Keep each subject's high watermark. */
export async function maintainAgentChanges(pool: Pool, limit = 500): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) throw new RangeError("Agent change retention limit must be 1–5000");
  const result = await pool.query(`
    with locked as materialized (
      select pg_try_advisory_xact_lock(hashtextextended('agent-change-retention', 9)) acquired
    ), acknowledged as materialized (
      select subscription.subject_id, min(coalesce(c.cursor, 0)) floor
      from locked join agent_subscriptions subscription on locked.acquired
      left join agent_change_cursors c
        on c.subject_id = subscription.subject_id and c.consumer = subscription.business_key
      where subscription.data->>'state' = 'active'
      group by subscription.subject_id
    ), candidates as (
      select change.sequence
      from acknowledged a
      cross join lateral (
        select sequence from agent_changes where subject_id = a.subject_id order by sequence desc limit 1
      ) watermark
      join agent_changes change on change.subject_id = a.subject_id
      where change.sequence <= a.floor and change.sequence < watermark.sequence
        and change.created_at < now() - interval '30 days'
      order by change.sequence
      limit $1
    )
    delete from agent_changes change using candidates
    where change.sequence = candidates.sequence
  `, [limit]);
  return result.rowCount ?? 0;
}
