import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { conflict, type TransactionStore } from "@shadow/kernel";
import type { linkMealConsumptionInputSchema } from "@shadow/contracts";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema.js";
import { moneyNumeric, rowsBy, trimNumeric } from "./postgres-values.js";

type Database = Pick<NodePgDatabase<typeof schema>, "execute" | "select">;

export async function linkMealConsumption(database: Pick<Database, "execute">, subjectId: string, input: ReturnType<typeof linkMealConsumptionInputSchema.parse>): ReturnType<TransactionStore["executeDomainWrite"]> {
  const meal = await database.execute(sql`select id from meals where id=${input.meal_id}
    and subject_id=${subjectId} and state='active' for update`);
  if (!meal.rowCount) throw conflict("active meal and confirmed consumption record must exist under the same subject");
  const revision = input.expected_record_revision;
  const record = await database.execute(sql`
    select record.id from consumption_records record
    where record.subject_id=${subjectId} and record.id=${input.consumption_record_id} and record.state='confirmed'
      ${revision === undefined ? sql`` : sql`and record.revision=${revision}`}
      and (exists(select 1 from money_entries entry where entry.record_id=record.id and entry.entry_type='expense')
        ${revision === undefined ? sql`or (exists(select 1 from purchases p where p.record_id=record.id)
          and not exists(select 1 from money_entries entry where entry.record_id=record.id))` : sql``})
    for update of record`);
  if (!record.rowCount) throw conflict(revision === undefined
    ? "A confirmed consumption with an expense or an unpaid purchase is required"
    : "原消费已变更，或没有可复用的实付支出");
  const duplicate = await database.execute(sql`
    select original.id from meals pending
    join meals original on original.subject_id=pending.subject_id and original.id<>pending.id
      and original.occurred_on=pending.occurred_on and original.meal_type=pending.meal_type
    where pending.subject_id=${subjectId} and pending.id=${input.meal_id} and original.state='active'
      and original.id in (
        select meal_id from meal_consumption_links where subject_id=${subjectId} and consumption_record_id=${input.consumption_record_id}
        union all select link.meal_id from meal_money_links link join money_entries entry on entry.id=link.money_entry_id
          where entry.subject_id=${subjectId} and entry.record_id=${input.consumption_record_id})
    limit 1`);
  if (duplicate.rowCount) throw conflict("原消费已关联同日同餐次，请先回读已有用餐");
  const linked = await database.execute<{meal_revision:number;record_revision:number}>(sql`
    insert into meal_consumption_links(subject_id,meal_id,consumption_record_id,evidence)
    select ${subjectId},meal.id,record.id,${input.evidence}
    from meals meal join consumption_records record on record.subject_id=meal.subject_id
    where meal.id=${input.meal_id} and record.id=${input.consumption_record_id} and meal.subject_id=${subjectId}
      and meal.state='active' and record.state='confirmed'
    on conflict(meal_id,consumption_record_id) do update set evidence=excluded.evidence
    returning (select revision from meals where id=${input.meal_id} and subject_id=${subjectId}) meal_revision,
      (select revision from consumption_records where id=${input.consumption_record_id} and subject_id=${subjectId}) record_revision`);
  const revisions = linked.rows[0];
  if (!revisions) throw conflict("active meal and confirmed consumption record must exist under the same subject");
  return { resources: [{ type: "meal", id: input.meal_id, revision: revisions.meal_revision },
    { type: "consumption_record", id: input.consumption_record_id, revision: revisions.record_revision }],
    actualValues: { meal_id: input.meal_id, consumption_record_id: input.consumption_record_id, evidence: input.evidence } };
}


export function mealsStore(database: Database): Pick<TransactionStore, "listMeals"> {
  return {
    async listMeals(subjectId, options) {
      const asOf=options.asOf??String((await database.execute(sql`
        select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as_of
      `)).rows[0]!.as_of);
      const before=options.before;
      const mealResult=await database.execute<{
        id:string; occurredOn:string; occurredAt:string|null; timeZone:string;
        mealType:string; note:string|null; revision:number; createdAt:Date; pageAt:string;
      }>(sql`
        select id,occurred_on::text "occurredOn",
          case when occurred_at is null then null else to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end "occurredAt",
          time_zone "timeZone",meal_type "mealType",note,revision,created_at "createdAt",
          to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') "pageAt"
        from meals
        where subject_id=${subjectId} and state='active'
          ${options.occurredOn?sql`and occurred_on=${options.occurredOn}::date`:sql``}
          and created_at<=${asOf}::timestamptz
          and (${before?.at??null}::timestamptz is null or
            (occurred_on,created_at,id)<(${before?.on??null}::date,${before?.at??null}::timestamptz,${before?.id??null}))
        order by occurred_on desc,created_at desc,id desc
        limit ${options.limit+1}`);
      const hasMore=mealResult.rows.length>options.limit,mealRows=mealResult.rows.slice(0,options.limit);
      if(mealRows.length===0)return {items:[],hasMore:false,asOf};
      const mealIds=mealRows.map(meal=>meal.id);
      const [itemRows,paymentRows,sourceRows]=await Promise.all([
        database.select({mealId:schema.intakeItems.mealId,item:schema.intakeItems}).from(schema.intakeItems).where(and(inArray(schema.intakeItems.mealId,mealIds),eq(schema.intakeItems.effective,true))).orderBy(schema.intakeItems.mealId,schema.intakeItems.position),
        options.includeMoney?database.select({mealId:schema.mealMoneyLinks.mealId,id:schema.moneyEntries.id,amount:schema.moneyEntries.amount,currency:schema.moneyEntries.currency,paymentMethod:schema.moneyEntries.paymentMethod}).from(schema.mealMoneyLinks).innerJoin(schema.moneyEntries,eq(schema.mealMoneyLinks.moneyEntryId,schema.moneyEntries.id)).where(inArray(schema.mealMoneyLinks.mealId,mealIds)).orderBy(schema.mealMoneyLinks.mealId,schema.moneyEntries.id):Promise.resolve([]),
        database.select({mealId:schema.mealSourceLinks.mealId,id:schema.mealSourceLinks.sourceId,role:schema.mealSourceLinks.role,kind:schema.sources.kind,assetVersionId:schema.sources.assetVersionId}).from(schema.mealSourceLinks).innerJoin(schema.sources,eq(schema.mealSourceLinks.sourceId,schema.sources.id)).where(and(inArray(schema.mealSourceLinks.mealId,mealIds),eq(schema.sources.subjectId,subjectId))).orderBy(schema.mealSourceLinks.mealId,schema.mealSourceLinks.sourceId)
      ]);
      const itemsByMeal=rowsBy(itemRows,row=>row.mealId),paymentsByMeal=rowsBy(paymentRows,row=>row.mealId),sourcesByMeal=rowsBy(sourceRows,row=>row.mealId);
      return {items:mealRows.map((meal) => {
        const items=(itemsByMeal.get(meal.id)??[]).map(row=>row.item),payments=paymentsByMeal.get(meal.id)??[],sourceLinks=sourcesByMeal.get(meal.id)??[];
        return {
          id: meal.id, occurred_on: meal.occurredOn, occurred_at: meal.occurredAt,
          time_zone: meal.timeZone, meal_type: meal.mealType as "breakfast" | "lunch" | "dinner" | "snack" | "other", note: meal.note, revision: meal.revision,
          items: items.map((item) => ({ id: item.id, name: item.name,food_ref_id:item.foodRefId,free_text:item.freeText, quantity: trimNumeric(item.quantity), unit: item.unit,weight_basis:item.weightBasis as "measured_net"|"payment_derived"|null,amount_g:trimNumeric(item.amountG), energy_kcal: trimNumeric(item.energyKcal),protein_g:trimNumeric(item.proteinG),fat_g:trimNumeric(item.fatG),carb_g:trimNumeric(item.carbG),fiber_g:trimNumeric(item.fiberG),sodium_mg:trimNumeric(item.sodiumMg),calcium_mg:trimNumeric(item.calciumMg),iron_mg:trimNumeric(item.ironMg),consumed_fraction:trimNumeric(item.consumedFraction),provenance:item.provenance,grouping_origin:item.groupingOrigin, estimate: item.estimate, revision: item.revision, ...(options.includeEvidence?{evidence_note:item.evidenceNote}:{}) })),
          payments: payments.map((payment) => ({ id: payment.id, amount: moneyNumeric(payment.amount), currency: payment.currency as "CNY",payment_method:payment.paymentMethod as "alipay"|"wechat"|"jd_pay"|"jd_baitiao"|"huabei"|"gift_card"|"cash"|"bank_card"|"bank_transfer"|"mixed"|"other"|null })),
          source_ids: sourceLinks.map((source) => source.id),
          sources:sourceLinks.map(source=>({id:source.id,kind:source.kind,role:source.role as "evidence"|"meal_photo"|"order_screenshot"|"replacement",asset_version_id:source.assetVersionId})),
          _page_at:meal.pageAt
        };
      }),hasMore,asOf};
    },
  };
}
