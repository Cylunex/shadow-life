import { sql } from "drizzle-orm";

// Purchase details are a separate read permission. All money list projections share this expression.
export function moneyTitle(includePurchase:boolean){
  return sql`coalesce(
    case when ${includePurchase} then (select nullif(string_agg(item.raw_name,'、' order by item.position,item.id),'') from purchases purchase join purchase_items item on item.purchase_id=purchase.id where purchase.record_id=entry.record_id and purchase.subject_id=entry.subject_id and item.detail_role<>'folded_summary') end,
    case when ${includePurchase} then (select nullif(string_agg(item.raw_name,'、' order by item.position,item.id),'') from purchases purchase join purchase_items item on item.purchase_id=purchase.id where purchase.record_id=entry.record_id and purchase.subject_id=entry.subject_id) end,
    nullif(entry.note,''),nullif(entry.counterparty,''),
    case when ${includePurchase} then (select coalesce(nullif(purchase.note,''),nullif(purchase.merchant,'')) from purchases purchase where purchase.record_id=entry.record_id and purchase.subject_id=entry.subject_id limit 1) end,
    nullif(entry.category,''),case entry.entry_type when 'expense' then '支出' when 'income' then '收入' when 'refund' then '退款' else '收支记录' end)`;
}
