export interface StatementCandidate extends Record<string, unknown> {
  id: string; batch_id: string; platform: string; source_account: string; external_id: string | null; identity_kind: string | null;
  raw: Record<string, any>; source_proposed: Record<string, any>; proposed: Record<string, any>; issues: string[]; status: string;
  duplicate_of_record_id: string | null; duplicate_of_candidate_id: string | null; linked_record_id: string | null; revision: number;
}
export interface StatementEntry extends Record<string, unknown> { id: string; record_id: string; amount: string; currency: string; entry_type: string; occurred_on: string; occurred_at: string | null; counterparty: string | null; refunded: string; }
export type StatementDecision = { decision: "confirm" | "ignore" | "pending"; reason: string; original_entry_id?: string };
export function statementAmount(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value)) throw new Error("Invalid statement amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
const row = (c: StatementCandidate): Record<string, any> => c.raw.rows?.[0] ?? c.raw;
export const statementOrder = (c: StatementCandidate): string => String(row(c)["商家订单号"] ?? row(c)["商家单号"] ?? row(c)["订单号"] ?? "").trim();
const direction = (value: string | null) => value === "refund" ? "refund" : "movement";
const sourceFields = ["entry_type", "amount", "currency", "occurred_on"];
const sameFacts = (a: Record<string, any>, b: Record<string, any>) => sourceFields.every(k => k === "amount" && a[k] && b[k] ? statementAmount(a[k]) === statementAmount(b[k]) : (a[k] ?? null) === (b[k] ?? null));
const sameEntry = (c: StatementCandidate, e: StatementEntry) => sameFacts(c.proposed, e);
const normalizedMerchant = (v: string | null) => (v ?? "").replace(/^(?:支付宝|财付通|微信支付|微信|京东支付)[-－—:：]/u, "").trim();

/** Programmatic accounting policy. Uncertain evidence remains exceptional input. */
export function decideStatementCandidate(c: StatementCandidate, entries: readonly StatementEntry[], peers: readonly StatementCandidate[]): StatementDecision {
  const pending = (reason: string): StatementDecision => ({ decision: "pending", reason });
  const ignore = (reason: string): StatementDecision => ({ decision: "ignore", reason });
  const source = row(c), p = c.proposed;
  if (c.issues.includes("external_id_payload_changed")) return pending("source_identity_conflict");
  if (c.external_id && peers.some(other => other.id !== c.id && other.status !== "ignored" && other.platform === c.platform && other.source_account === c.source_account && other.external_id === c.external_id && direction(other.identity_kind) === direction(c.identity_kind) && !sameFacts(other.source_proposed, c.source_proposed))) return pending("source_identity_conflict");
  if (c.duplicate_of_record_id) return ignore("existing_source_identity");
  if (c.issues.length) {
    if (source["收/支"] === "不计收支" && p.entry_type !== "refund" || ["交易关闭", "芝麻免押下单成功", "解冻成功", "还款成功"].includes(source["交易状态"]) || source["订单状态"] === "交易关闭") return ignore("non_accounting_transaction");
    return pending("invalid_source_fields");
  }
  if (!p.amount || !p.occurred_on || p.currency !== "CNY" || !["expense", "income", "refund"].includes(p.entry_type)) return pending("invalid_source_fields");
  if (p.entry_type === "refund") {
    const order = statementOrder(c);
    if (!order) return pending("refund_original_missing");
    const originals = peers.filter(other => other.platform === c.platform && other.source_account === c.source_account && statementOrder(other) === order && other.proposed.entry_type === "expense" && (other.status === "confirmed" || other.duplicate_of_record_id));
    const refs = [...new Set(originals.map(other => other.linked_record_id ?? other.duplicate_of_record_id).filter(Boolean))];
    const original = refs.length === 1 ? entries.find(e => e.record_id === refs[0] && e.entry_type === "expense" && e.currency === p.currency) : undefined;
    if (!original || p.occurred_on < original.occurred_on || statementAmount(original.refunded) + statementAmount(p.amount) > statementAmount(original.amount)) return pending("refund_original_missing");
    return { decision: "confirm", reason: "unique_refund_original", original_entry_id: original.id };
  }
  const ownDuplicate = c.external_id ? peers.find(other => other.id !== c.id && other.status === "confirmed" && other.platform === c.platform && other.source_account === c.source_account && other.external_id === c.external_id && direction(other.identity_kind) === direction(c.identity_kind)) : undefined;
  if (ownDuplicate) return ignore("existing_source_identity");
  const order = statementOrder(c);
  const cross = order ? peers.filter(other => other.platform !== c.platform && other.source_account === c.source_account && (other.status === "confirmed" || other.duplicate_of_record_id) && sameFacts(other.proposed, p) && ((other.external_id && other.external_id.length >= 12 && order.split(/[^0-9]+/u).includes(other.external_id)) || statementOrder(other) === order)) : [];
  if (new Set(cross.map(other => other.linked_record_id ?? other.duplicate_of_record_id).filter(Boolean)).size === 1) return ignore("cross_platform_order_identity");
  const matching = entries.filter(e => sameEntry(c, e));
  const clock = source["交易时间"] ?? source["交易成功时间"] ?? source["订单提交时间"];
  const exact = typeof clock === "string" ? matching.filter(e => e.occurred_at && normalizedMerchant(e.counterparty) && normalizedMerchant(e.counterparty) === normalizedMerchant(p.counterparty) && new Intl.DateTimeFormat("sv-SE", { timeZone: p.time_zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(e.occurred_at)) === clock.trim()) : [];
  if (exact.length === 1) return ignore("existing_exact_payment");
  if (matching.length) return pending("possible_existing_payment");
  if (c.duplicate_of_candidate_id && peers.some(other => other.id === c.duplicate_of_candidate_id && !["ignored", "confirmed"].includes(other.status))) return pending("existing_pending_source");
  return { decision: "confirm", reason: "valid_unique_transaction" };
}

export function statementChunks(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const groups: Record<string, unknown>[][] = [];
  for (const row of rows as Record<string, unknown>[]) {
    if ("订单号" in row && !row["订单号"] && groups.length) groups.at(-1)!.push(row); else groups.push([row]);
  }
  const parts: Record<string, unknown>[][] = []; let part: Record<string, unknown>[] = [];
  for (const group of groups) {
    if (group.length > 500 || JSON.stringify(group).length > 800_000) throw new Error("One order exceeds the import limit");
    if (part.length && (part.length + group.length > 100 || JSON.stringify([...part, ...group]).length > 800_000)) { parts.push(part); part = []; }
    part.push(...group);
  }
  if (part.length) parts.push(part);
  return parts;
}
