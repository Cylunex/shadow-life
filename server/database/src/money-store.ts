import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildUseCycleStatus, type ConsumptionStatsRawData, type ConsumptionStatsRawIntake, type ConsumptionStatsRawMeal, type ConsumptionStatsRawPurchase, type TransactionStore, type UseCycleIntakeRaw, type UseCycleRaw } from "@shadow/kernel";

type Database = Pick<NodePgDatabase, "execute">;

function monthWindow(period:string):{startOn:string;endOn:string}{
  const year=Number(period.slice(0,4)),month=Number(period.slice(5));
  return{startOn:`${period}-01`,endOn:month===12?`${year+1}-01-01`:`${String(year).padStart(4,"0")}-${String(month+1).padStart(2,"0")}-01`};
}
async function recordRelations(database:Database,subjectId:string,recordId:string|undefined,mealId:string|undefined,sections:readonly string[],includeTravel:boolean){
  const queries=[];
  if(mealId&&sections.includes("purchase"))queries.push(sql`select 'meals' domain,'purchase' kind,record.id,coalesce(purchase.merchant,'关联消费') title,concat(record.occurred_on::text,' · ',case link.evidence when 'user_confirmed' then '手动确认关联' when 'shared_source' then '共同来源关联' else '历史引用关联' end) supporting
    from meal_consumption_links link join consumption_records record on record.id=link.consumption_record_id and record.subject_id=${subjectId}
    join purchases purchase on purchase.record_id=record.id and purchase.subject_id=${subjectId}
    where link.subject_id=${subjectId} and link.meal_id=${mealId} and record.state='confirmed'`);
  if(mealId&&sections.includes("money"))queries.push(sql`select 'money' domain,'money_entry' kind,record.id,coalesce(entry.counterparty,'关联付款') title,
    concat(entry.currency,' ',entry.amount::text,' · ',record.occurred_on::text,' · ',case link.evidence when 'user_confirmed' then '手动确认关联' when 'shared_source' then '共同来源关联' else '历史引用关联' end) supporting
    from meal_consumption_links link join consumption_records record on record.id=link.consumption_record_id and record.subject_id=${subjectId} and record.state='confirmed'
    join money_entries entry on entry.record_id=record.id and entry.subject_id=${subjectId}
    where link.subject_id=${subjectId} and link.meal_id=${mealId}
      and not exists(select 1 from meal_money_links direct where direct.meal_id=${mealId} and direct.money_entry_id=entry.id)
      and (${sections.includes("purchase")} = false or not exists(select 1 from purchases purchase where purchase.record_id=record.id))`);
  if(recordId&&sections.includes("money"))queries.push(sql`select 'money' domain,'money_entry' kind,other.record_id id,
    case when refund.original_entry_id=current.id then '关联退款' else '退款原交易' end title,
    concat(other.currency,' ',other.amount::text,' · ',other.occurred_on::text) supporting
    from money_entries current join refunds refund on (refund.original_entry_id=current.id or refund.refund_entry_id=current.id) and refund.subject_id=${subjectId} and refund.link_state='linked'
    join money_entries other on other.id=case when refund.original_entry_id=current.id then refund.refund_entry_id else refund.original_entry_id end and other.subject_id=${subjectId}
    join consumption_records other_record on other_record.id=other.record_id and other_record.state='confirmed'
    where current.subject_id=${subjectId} and current.record_id=${recordId}`);
  if(recordId&&includeTravel&&sections.includes("money"))queries.push(sql`select distinct 'travel' domain,'trip' kind,trip.id,trip.title,concat(trip.starts_on::text,' — ',trip.ends_on::text) supporting
    from money_entries entry join trips trip on exists(select 1 from trip_money_links link where link.money_entry_id=entry.id and link.trip_id=trip.id)
      or exists(select 1 from reservations reservation where reservation.fare_entry_id=entry.id and reservation.trip_id=trip.id and reservation.subject_id=${subjectId})
    where entry.record_id=${recordId} and entry.subject_id=${subjectId} and (trip.subject_id=${subjectId} or exists(select 1 from trip_members member where member.trip_id=trip.id and member.subject_id=${subjectId}))`);
  if(!queries.length)return[];
  const result=await database.execute(sql`select distinct * from (${sql.join(queries,sql` union all `)}) links order by domain,kind,id limit 100`);
  return result.rows;
}
function projectLifeRecord(value:Record<string,unknown>,sections:readonly ("meal"|"purchase"|"money"|"sources")[],kind:"record"|"meal"):Record<string,unknown>{
  const visible=new Set(sections),result={...value};
  if(kind==="record"){
    if(!visible.has("meal"))delete result.meals;
    if(!visible.has("purchase")){delete result.purchase;delete result.purchase_items;}
    if(!visible.has("money"))delete result.money_entry;
    if(!visible.has("sources"))delete result.sources;
  }else{
    if(!visible.has("meal")){for(const key of ["occurred_on","occurred_at","time_zone","meal_type","note","revision","items"])delete result[key];}
    if(!visible.has("money"))delete result.payments;
    if(!visible.has("sources"))delete result.sources;
  }
  if(!visible.has("sources"))for(const key of ["purchase","money_entry"]){const nested=result[key];if(nested&&typeof nested==="object"&&!Array.isArray(nested)){const sanitized={...(nested as Record<string,unknown>)};delete sanitized.source_id;result[key]=sanitized;}}
  return result;
}
export function moneyStore(database: Database): Pick<TransactionStore, "consumptionStatsData" | "lifeRecord" | "moneyPlanning"> {
  return {
    async consumptionStatsData(subjectId,input):Promise<ConsumptionStatsRawData>{
      const [purchaseResult,mealResult,intakeResult,aliasResult,clockResult]=await Promise.all([
        database.execute<ConsumptionStatsRawPurchase>(sql`select purchase.id,purchase.record_id,purchase.merchant,purchase.category,purchase.scene,purchase.channel_name_raw,purchase.occurred_on::text,
          case when purchase.occurred_at is null then null else to_char(purchase.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end occurred_at,purchase.currency,
          purchase.amount::text purchase_amount,purchase.item_detail_state,
          coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'raw_name',item.raw_name,'quantity',item.quantity::text,'unit',item.unit,'line_amount',item.line_amount::text,'category_key',item.category_key,'detail_role',item.detail_role) order by item.position,item.id) from purchase_items item where item.purchase_id=purchase.id),'[]'::jsonb) items,
          case when ${input.includeMoney} then (select jsonb_build_object('amount',entry.amount::text,'currency',entry.currency) from money_entries entry where entry.record_id=record.id and entry.subject_id=${subjectId} and entry.entry_type='expense' limit 1) else null end expense,
          case when ${input.includeMoney} then coalesce((select jsonb_agg(jsonb_build_object('id',refund_entry.id,'amount',refund_entry.amount::text,'currency',refund_entry.currency) order by refund_entry.id) from money_entries expense join refunds refund on refund.original_entry_id=expense.id and refund.link_state='linked' join money_entries refund_entry on refund_entry.id=refund.refund_entry_id and refund_entry.subject_id=${subjectId} join consumption_records refund_record on refund_record.id=refund_entry.record_id and refund_record.state='confirmed' where expense.record_id=record.id and expense.subject_id=${subjectId} and expense.entry_type='expense'),'[]'::jsonb) else '[]'::jsonb end refunds,
          coalesce((select jsonb_agg(distinct link.meal_id order by link.meal_id) from meal_consumption_links link join meals meal on meal.id=link.meal_id and meal.subject_id=${subjectId} and meal.state='active' where link.subject_id=${subjectId} and link.consumption_record_id=record.id),'[]'::jsonb) meal_ids
          from purchases purchase join consumption_records record on record.id=purchase.record_id and record.subject_id=${subjectId} and record.state='confirmed'
          where purchase.subject_id=${subjectId} and (case when purchase.occurred_at is null then purchase.occurred_on else (purchase.occurred_at at time zone ${input.timeZone})::date end)>=${input.fromOn}::date and (case when purchase.occurred_at is null then purchase.occurred_on else (purchase.occurred_at at time zone ${input.timeZone})::date end)<${input.toOnExclusive}::date order by purchase.occurred_on,purchase.id`),
        database.execute<ConsumptionStatsRawMeal>(sql`select meal.id,meal.occurred_on::text,case when meal.occurred_at is null then null else to_char(meal.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end occurred_at,coalesce((select jsonb_agg(distinct link.consumption_record_id order by link.consumption_record_id) from meal_consumption_links link where link.meal_id=meal.id and link.subject_id=${subjectId}),'[]'::jsonb) linked_record_ids from meals meal where meal.subject_id=${subjectId} and meal.state='active' and (case when meal.occurred_at is null then meal.occurred_on else (meal.occurred_at at time zone ${input.timeZone})::date end)>=${input.fromOn}::date and (case when meal.occurred_at is null then meal.occurred_on else (meal.occurred_at at time zone ${input.timeZone})::date end)<${input.toOnExclusive}::date order by meal.occurred_on,meal.id`),
        database.execute<ConsumptionStatsRawIntake>(sql`select item.id,item.meal_id,item.name,item.quantity::text,item.unit,item.consumed_fraction::text from intake_items item join meals meal on meal.id=item.meal_id and meal.subject_id=${subjectId} and meal.state='active' where item.subject_id=${subjectId} and item.effective and (case when meal.occurred_at is null then meal.occurred_on else (meal.occurred_at at time zone ${input.timeZone})::date end)>=${input.fromOn}::date and (case when meal.occurred_at is null then meal.occurred_on else (meal.occurred_at at time zone ${input.timeZone})::date end)<${input.toOnExclusive}::date order by item.meal_id,item.position,item.id`),
        database.execute<{alias:string;target_kind:string;target_value:string}>(sql`select alias,target_kind,target_value from personal_aliases where subject_id=${subjectId} and target_kind in ('merchant','food') order by target_kind,alias`),
        database.execute<{as_of:string}>(sql`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as_of`)
      ]);
      return{purchases:purchaseResult.rows,meals:mealResult.rows,intakes:intakeResult.rows,aliases:aliasResult.rows,asOf:clockResult.rows[0]!.as_of};
    },
    async lifeRecord(subjectId,id,sections,includeTravel=false){const result=await database.execute(sql`select record.id record_id,record.state,record.occurred_on,record.occurred_at,record.time_zone,record.note,record.revision,case when purchase.id is null then null else to_jsonb(purchase)||jsonb_build_object('amount',purchase.amount::text) end purchase,coalesce((select jsonb_agg(to_jsonb(item)||jsonb_build_object('quantity',item.quantity::text,'unit_price',item.unit_price::text,'line_amount',item.line_amount::text) order by item.position) from purchase_items item where item.purchase_id=purchase.id),'[]'::jsonb) purchase_items,case when entry.id is null then null else to_jsonb(entry)||jsonb_build_object('amount',entry.amount::text) end money_entry,coalesce((select jsonb_agg(jsonb_build_object('id',meal.id,'occurred_on',meal.occurred_on,'meal_type',meal.meal_type,'revision',meal.revision,'items',(select coalesce(jsonb_agg(to_jsonb(intake)||jsonb_build_object('quantity',intake.quantity::text,'amount_g',intake.amount_g::text,'energy_kcal',intake.energy_kcal::text,'protein_g',intake.protein_g::text,'fat_g',intake.fat_g::text,'carb_g',intake.carb_g::text,'fiber_g',intake.fiber_g::text,'sodium_mg',intake.sodium_mg::text,'calcium_mg',intake.calcium_mg::text,'iron_mg',intake.iron_mg::text,'consumed_fraction',intake.consumed_fraction::text) order by intake.position),'[]'::jsonb) from intake_items intake where intake.meal_id=meal.id and intake.effective))) from meals meal where meal.subject_id=${subjectId} and meal.state='active' and (exists(select 1 from meal_consumption_links link where link.meal_id=meal.id and link.subject_id=${subjectId} and link.consumption_record_id=record.id) or exists(select 1 from meal_money_links link where link.meal_id=meal.id and link.money_entry_id=entry.id))),'[]'::jsonb) meals from consumption_records record left join purchases purchase on purchase.record_id=record.id left join money_entries entry on entry.record_id=record.id where record.subject_id=${subjectId} and (record.id=${id} or purchase.id=${id} or entry.id=${id}) limit 1`);if(result.rows[0]){const value=result.rows[0] as Record<string,unknown>,projected=projectLifeRecord(value,sections,"record");if(sections.includes("sources")){const sources=await database.execute(sql`with related as(select entry.source_id from money_entries entry where entry.record_id=${String(value.record_id)} and ${sections.includes('money')} union select link.source_id from meal_source_links link join meal_money_links payment on payment.meal_id=link.meal_id join money_entries entry on entry.id=payment.money_entry_id join meals meal on meal.id=link.meal_id and meal.state='active' where entry.record_id=${String(value.record_id)} union select purchase.source_id from purchases purchase where purchase.record_id=${String(value.record_id)} union select link.source_id from purchase_source_links link join purchases purchase on purchase.id=link.purchase_id where purchase.record_id=${String(value.record_id)} union select link.source_id from meal_source_links link join meal_consumption_links consumption on consumption.meal_id=link.meal_id join meals meal on meal.id=link.meal_id and meal.state='active' where consumption.consumption_record_id=${String(value.record_id)}) select source.* from sources source join related on related.source_id=source.id where source.subject_id=${subjectId} order by source.id`);projected.sources=sources.rows;}projected.related_records=await recordRelations(database,subjectId,String(value.record_id),undefined,sections,includeTravel);return projected;}const meal=await database.execute(sql`select meal.id meal_id,meal.occurred_on,meal.occurred_at,meal.time_zone,meal.meal_type,meal.note,meal.revision,coalesce((select jsonb_agg(to_jsonb(item)||jsonb_build_object('quantity',item.quantity::text,'amount_g',item.amount_g::text,'energy_kcal',item.energy_kcal::text,'protein_g',item.protein_g::text,'fat_g',item.fat_g::text,'carb_g',item.carb_g::text,'fiber_g',item.fiber_g::text,'sodium_mg',item.sodium_mg::text,'calcium_mg',item.calcium_mg::text,'iron_mg',item.iron_mg::text,'consumed_fraction',item.consumed_fraction::text) order by item.position) from intake_items item where item.meal_id=meal.id and item.effective),'[]'::jsonb) items,coalesce((select jsonb_agg(to_jsonb(entry)||jsonb_build_object('amount',entry.amount::text)) from meal_money_links link join money_entries entry on entry.id=link.money_entry_id join consumption_records payment_record on payment_record.id=entry.record_id and payment_record.state='confirmed' where link.meal_id=meal.id),'[]'::jsonb) payments,coalesce((select jsonb_agg(to_jsonb(source)) from meal_source_links link join sources source on source.id=link.source_id where link.meal_id=meal.id),'[]'::jsonb) sources from meals meal where meal.subject_id=${subjectId} and meal.id=${id}`);if(!meal.rows[0])return undefined;const projected=projectLifeRecord(meal.rows[0] as Record<string,unknown>,sections,"meal");projected.related_records=await recordRelations(database,subjectId,undefined,id,sections,includeTravel);return projected;},    async moneyPlanning(subjectId,period){
      const {startOn,endOn}=monthWindow(period);
      const result=await database.execute(sql`
        with budget_window as (
          select budget.id,budget.category,
            jsonb_build_object('id',budget.id,'category',budget.category,'amount',budget.amount::text,'currency',budget.currency,'revision',budget.revision,'spent_basis','gross_expense','spent',coalesce((
              select sum(entry.amount)::text from money_entries entry join consumption_records record on record.id=entry.record_id
              where entry.subject_id=${subjectId} and record.state='confirmed' and entry.entry_type='expense' and entry.currency=budget.currency
                and entry.occurred_on>=${startOn}::date and entry.occurred_on<${endOn}::date and (budget.category is null or entry.category=budget.category)
            ),'0')) value
          from budgets budget where budget.subject_id=${subjectId} and budget.period=${period}
          order by budget.category nulls first,budget.id limit 101
        ), plan_window as (
          select plan.id,plan.next_due_on,(to_jsonb(plan)-'subject_id')||jsonb_build_object('amount',plan.amount::text,'local_time',plan.local_time::text) value
          from recurring_plans plan where plan.subject_id=${subjectId} and (
            (plan.next_due_on>=${startOn}::date and plan.next_due_on<${endOn}::date) or exists(
              select 1 from recurring_occurrences occurrence where occurrence.plan_id=plan.id and occurrence.due_on>=${startOn}::date and occurrence.due_on<${endOn}::date
            )
          ) order by plan.next_due_on,plan.id limit 101
        ), occurrence_window as (
          select occurrence.id,occurrence.due_on,to_jsonb(occurrence) value
          from recurring_occurrences occurrence join recurring_plans plan on plan.id=occurrence.plan_id
          where plan.subject_id=${subjectId} and occurrence.due_on>=${startOn}::date and occurrence.due_on<${endOn}::date
          order by occurrence.due_on,occurrence.id limit 501
        ), intent_window as (
          select intent.id,intent.intended_on,(to_jsonb(intent)-'subject_id')||jsonb_build_object('expected_amount',intent.expected_amount::text) value
          from spending_intents intent where intent.subject_id=${subjectId} and intent.intended_on>=${startOn}::date and intent.intended_on<${endOn}::date
          order by intent.intended_on,intent.id limit 101
        ), cycle_window as (
          select cycle.id,cycle.started_on,jsonb_build_object('id',cycle.id,'purchase_record_id',cycle.purchase_record_id,'purchase_item_id',cycle.purchase_item_id,'item_name',cycle.item_name,'started_on',cycle.started_on::text,'ended_on',cycle.ended_on::text,'state',cycle.state,'revision',cycle.revision,'initial_quantity',cycle.initial_quantity::text,'quantity_unit',cycle.quantity_unit,'expected_daily_usage',cycle.expected_daily_usage::text,'replenish_threshold',cycle.replenish_threshold::text,'replenish_lead_days',cycle.replenish_lead_days,'time_zone',cycle.time_zone,'match_mode',cycle.match_mode,'match_value',cycle.match_value,'reminder_enabled',cycle.reminder_enabled,'usage_state',cycle.usage_state,'quantity_label',cycle.quantity_label,'note',cycle.note,'manual_consumed_quantity',(select coalesce(sum(quantity),0)::text from consumable_uses where cycle_id=cycle.id and state='active'),'uses',coalesce((select jsonb_agg(to_jsonb(u) order by u.occurred_on desc,u.id desc) from (select id,occurred_on::text,quantity::text,state,note,revision from consumable_uses where cycle_id=cycle.id order by occurred_on desc,id desc limit 50) u),'[]'::jsonb),'uses_truncated',(select count(*)>50 from consumable_uses where cycle_id=cycle.id)) value from use_cycles cycle
          where cycle.subject_id=${subjectId} and cycle.started_on<${endOn}::date and (cycle.ended_on is null or cycle.ended_on>=${startOn}::date)
          order by cycle.started_on desc,cycle.id limit 101
        )
        select
          coalesce((select jsonb_agg(value order by category nulls first,id) from (select * from budget_window order by category nulls first,id limit 100) page),'[]'::jsonb) budgets,
          coalesce((select jsonb_agg(value order by next_due_on,id) from (select * from plan_window order by next_due_on,id limit 100) page),'[]'::jsonb) recurring_plans,
          coalesce((select jsonb_agg(value order by due_on,id) from (select * from occurrence_window order by due_on,id limit 500) page),'[]'::jsonb) occurrences,
          coalesce((select jsonb_agg(value order by intended_on,id) from (select * from intent_window order by intended_on,id limit 100) page),'[]'::jsonb) spending_intents,
          coalesce((select jsonb_agg(value order by started_on desc,id) from (select * from cycle_window order by started_on desc,id limit 100) page),'[]'::jsonb) use_cycles,
          jsonb_build_object('budgets',exists(select 1 from budget_window offset 100),'recurring_plans',exists(select 1 from plan_window offset 100),'occurrences',exists(select 1 from occurrence_window offset 500),'spending_intents',exists(select 1 from intent_window offset 100),'use_cycles',exists(select 1 from cycle_window offset 100)) truncated
      `);
      const row=(result.rows[0]??{}) as Record<string,unknown>&{use_cycles?:UseCycleRaw[]},cycles=row.use_cycles??[],asOf=new Date().toISOString(),cycleIds=cycles.map(cycle=>cycle.id);let intakeRows:Array<UseCycleIntakeRaw&{cycle_id:string}>=[];
      if(cycleIds.length){const candidates=await database.execute<UseCycleIntakeRaw&{cycle_id:string}>(sql`select cycle.id cycle_id,item.id,item.name,item.food_ref_id,item.quantity::text,item.unit,item.amount_g::text,item.consumed_fraction::text from use_cycles cycle join meals meal on meal.subject_id=cycle.subject_id and meal.state='active' join intake_items item on item.meal_id=meal.id and item.subject_id=cycle.subject_id and item.effective where cycle.id in (${sql.join(cycleIds.map(id=>sql`${id}`),sql`,`)}) and cycle.usage_state='in_use' and ((cycle.match_mode='exact_name' and lower(btrim(regexp_replace(normalize(item.name,NFKC),'[[:space:]]+',' ','g')))=lower(btrim(regexp_replace(normalize(cycle.match_value,NFKC),'[[:space:]]+',' ','g')))) or (cycle.match_mode='food_ref' and item.food_ref_id=cycle.match_value)) and (case when meal.occurred_at is null then meal.occurred_on else (meal.occurred_at at time zone cycle.time_zone)::date end)>=cycle.started_on and (case when meal.occurred_at is null then meal.occurred_on else (meal.occurred_at at time zone cycle.time_zone)::date end)<=coalesce(cycle.ended_on,(${asOf}::timestamptz at time zone cycle.time_zone)::date) order by cycle.id,item.id`);intakeRows=candidates.rows;}
      return{...row,use_cycles:cycles.map(cycle=>buildUseCycleStatus(cycle,intakeRows.filter(item=>item.cycle_id===cycle.id),asOf)),period,window:{start_on:startOn,end_on_exclusive:endOn},limits:{budgets:100,recurring_plans:100,occurrences:500,spending_intents:100,use_cycles:100},as_of:asOf};
    },
  };
}
