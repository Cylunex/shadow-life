import { sql } from "drizzle-orm";
import { importMoneyFileInputSchema, moneyImportFileResultSchema } from "@shadow/contracts";
import { decideStatementCandidate, statementAmount, statementChunks, invalidInput, sha256Fingerprinter, KernelError, type StatementCandidate, type StatementEntry, type TransactionStore } from "@shadow/kernel";
import { configuredStatementDecoder, type StatementDecoder } from "./statement-decoder.js";

type Database = import("drizzle-orm/node-postgres").NodePgDatabase<any>;
type DomainWrite = TransactionStore["executeDomainWrite"];

export async function readMoneyImportFile(database: Pick<Database, "execute">, subjectId: string, fileId: string) {
  const files = await database.execute<any>(sql`select id,asset_version_id,source_name,sha256,revision,decisions,created_at::text from money_import_files where id=${fileId} and subject_id=${subjectId}`);
  const file = files.rows[0]; if (!file) return undefined;
  const batches = await database.execute<any>(sql`select batch.id batch_id,count(item.id)::int total,count(item.id) filter(where item.status='confirmed')::int confirmed,count(item.id) filter(where item.status='ignored')::int ignored,count(item.id) filter(where item.status in ('pending','invalid'))::int pending from money_import_file_batches link join money_import_batches batch on batch.id=link.batch_id and batch.subject_id=${subjectId} left join money_import_candidates item on item.batch_id=batch.id and item.subject_id=${subjectId} where link.file_id=${fileId} group by batch.id order by batch.created_at,batch.id`);
  const counts = { total: 0, confirmed: 0, ignored: 0, pending: 0 };
  for (const b of batches.rows) for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] += b[key];
  const pending = await database.execute<any>(sql`select item.id from money_import_candidates item join money_import_file_batches link on link.batch_id=item.batch_id where link.file_id=${fileId} and item.subject_id=${subjectId} and item.status in ('pending','invalid')`);
  const reasons = new Map<string, number>();
  for (const c of pending.rows) { const reason = file.decisions?.[c.id] ?? "needs_source_information"; reasons.set(reason, (reasons.get(reason) ?? 0) + 1); }
  return moneyImportFileResultSchema.parse({ file_id: file.id, asset_version_id: file.asset_version_id, sha256: file.sha256, source_name: file.source_name, revision: file.revision, status: counts.pending ? "needs_input" : "completed", ...counts, batches: batches.rows, pending_reasons: [...reasons].map(([code, count]) => ({ code, count })), created_at: new Date(file.created_at).toISOString() });
}

/** One compound Executor transaction; every ledger write reuses the existing domain path. */
export async function writeMoneyImportFile(database: Database, subjectId: string, raw: unknown, nextId: (type: string) => string, run: (database: Database, capability: "money.stage_import" | "money.resolve_import_candidate", input: unknown) => ReturnType<DomainWrite>, decoder: StatementDecoder = configuredStatementDecoder()) {
  const input = importMoneyFileInputSchema.parse(raw);
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${subjectId}:money-file-import`},9))`);
  const assets = await database.execute<{ bytes: Buffer; sha256: string }>(sql`select blob.bytes,version.sha256 from asset_blobs blob join asset_versions version on version.id=blob.asset_version_id join assets asset on asset.id=version.asset_id where version.id=${input.asset_version_id} and asset.subject_id=${subjectId}`);
  const asset = assets.rows[0]; if (!asset) throw invalidInput("Statement original is unavailable to this subject.", ["asset_version_id"]);
  const identity = sha256Fingerprinter.fingerprint({ sha256: asset.sha256, platform: input.platform ?? "auto", account: input.source_account ?? "default", time_zone: input.time_zone, member: input.member ?? null });
  const existing = await database.execute<{ id: string }>(sql`select id from money_import_files where subject_id=${subjectId} and identity_hash=${identity}`);
  const resultFor = async (id: string) => {
    const view = (await readMoneyImportFile(database, subjectId, id))!;
    return { resources: [{ type: "money_import_file" as const, id, revision: view.revision }], actualValues: { file_id: id, status: view.status, total: view.total, confirmed: view.confirmed, ignored: view.ignored, pending: view.pending } };
  };
  if (existing.rows[0]) return resultFor(existing.rows[0].id);
  const rows = await decoder(asset.bytes, input);
  let parts;
  try { parts = statementChunks(rows); } catch { throw invalidInput("Statement order exceeds the import limit.", ["asset_version_id"]); }
  const fileId = nextId("import_file");
  await database.execute(sql`insert into money_import_files(id,subject_id,asset_version_id,identity_hash,source_name,sha256) values(${fileId},${subjectId},${input.asset_version_id},${identity},${input.source_name},${asset.sha256})`);
  const batchIds: string[] = [];
  for (const [index, part] of parts.entries()) {
    const written = await run(database, "money.stage_import", { format: "json", source_name: `${input.source_name.slice(0, 170)}:${index + 1}`, content: JSON.stringify(part), time_zone: input.time_zone, ...(input.platform && { platform: input.platform }), ...(input.source_account && { source_account: input.source_account }) });
    const batchId = String(written.actualValues.batch_id);
    await database.execute(sql`insert into money_import_file_batches(file_id,batch_id) values(${fileId},${batchId}) on conflict do nothing`); batchIds.push(batchId);
  }
  const all = await database.execute<StatementCandidate>(sql`select * from money_import_candidates where subject_id=${subjectId} and status<>'ignored' order by created_at,id limit 100001`);
  const facts = await database.execute<StatementEntry>(sql`select entry.id,entry.record_id,entry.amount::text,entry.currency,entry.entry_type,entry.occurred_on::text,entry.occurred_at::text,entry.counterparty,coalesce((select sum(back.amount) from refunds refund join money_entries back on back.id=refund.refund_entry_id join consumption_records r on r.id=back.record_id where refund.original_entry_id=entry.id and refund.subject_id=${subjectId} and refund.link_state='linked' and r.state='confirmed'),0)::text refunded from money_entries entry join consumption_records record on record.id=entry.record_id where entry.subject_id=${subjectId} and record.state='confirmed' limit 100001`);
  if (all.rows.length > 100000 || facts.rows.length > 100000) throw invalidInput("Statement history exceeds automatic processing coverage.", ["asset_version_id"]);
  const peers = all.rows, entries = facts.rows;
  const selected = peers.filter(c => batchIds.includes(c.batch_id) && ["pending", "invalid"].includes(c.status));
  // Detect cross-platform same-day/same-amount source ambiguity before any row is written.
  const conflicting = new Set<string>();
  const key = (c: StatementCandidate) => JSON.stringify([c.proposed.occurred_on, c.proposed.currency, c.proposed.entry_type, c.proposed.amount && statementAmount(c.proposed.amount).toString()]);
  const groups = new Map<string, StatementCandidate[]>();
  for (const c of selected.filter(c => !c.issues.length && c.proposed.entry_type !== "refund")) { const k = key(c); groups.set(k, [...(groups.get(k) ?? []), c]); }
  for (const group of groups.values()) if (new Set(group.map(c => c.platform)).size > 1) for (const c of group) conflicting.add(c.id);
  const decisions: Record<string, string> = {};
  for (const c of [...selected.filter(c => c.proposed.entry_type !== "refund"), ...selected.filter(c => c.proposed.entry_type === "refund")]) {
    const decision = decideStatementCandidate(c, entries, peers);
    if (decision.decision === "pending" || conflicting.has(c.id) && decision.decision === "confirm") { decisions[c.id] = conflicting.has(c.id) ? "cross_platform_ambiguity" : decision.reason; continue; }
    try {
      const written = await database.transaction(async nested => {
        const result = await run(nested as unknown as Database, "money.resolve_import_candidate", { candidate_id: c.id, expected_revision: c.revision, decision: decision.decision, reason: `Life 自动处理：${decision.reason}`, ...(decision.original_entry_id && { original_entry_id: decision.original_entry_id }) });
        for (const source of result.resources.filter(r => r.type === "source")) await nested.execute(sql`update sources set asset_version_id=${input.asset_version_id} where id=${source.id} and subject_id=${subjectId}`);
        return result;
      });
      c.status = decision.decision === "confirm" ? "confirmed" : "ignored";
      c.revision++; c.linked_record_id = written.actualValues.record_id ? String(written.actualValues.record_id) : null;
      if (c.status === "confirmed") {
        entries.push({ id: String(written.actualValues.money_entry_id), record_id: c.linked_record_id!, amount: c.proposed.amount, currency: c.proposed.currency, entry_type: c.proposed.entry_type, occurred_on: c.proposed.occurred_on, occurred_at: null, counterparty: c.proposed.counterparty ?? null, refunded: "0" });
        if (decision.original_entry_id) { const original = entries.find(e => e.id === decision.original_entry_id)!; const amount = statementAmount(original.refunded) + statementAmount(c.proposed.amount); original.refunded = `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0")}`; }
      }
    } catch (error) {
      if (error instanceof KernelError && [409, 422].includes(error.status) || error instanceof Error && error.name === "ZodError") decisions[c.id] = "source_or_accounting_conflict"; else throw error;
    }
  }
  await database.execute(sql`update money_import_files set decisions=${JSON.stringify(decisions)}::jsonb where id=${fileId} and subject_id=${subjectId}`);
  return resultFor(fileId);
}
