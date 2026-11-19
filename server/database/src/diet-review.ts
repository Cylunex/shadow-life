import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { merchantMenuResultSchema, type DietReviewInput } from "@shadow/contracts";
import type { DietEvidence } from "@shadow/kernel";
import { merchantMenu } from "./merchant-foods.js";
import { readWellnessDays } from "./wellness-review.js";
import type * as schema from "./schema.js";

export async function readDietEvidence(
  database:NodePgDatabase<typeof schema>, subject:string, input:DietReviewInput,
  window:{from:string;previousFrom:string;weightFrom:string}, effects:ReadonlySet<string>,
):Promise<DietEvidence> {
  return database.transaction(async db=>{
    const canHealth=effects.has("health.measurement.read");
    const wellness=await readWellnessDays(db,subject,window.previousFrom,input.to,{health:canHealth,consumedOnly:true});
    const mealRows=await db.execute<DietEvidence["meals"][number]>(sql`
      select m.id,m.revision,m.occurred_on::text date,m.meal_type type,
        case when count(distinct lower(coalesce(menu.merchant,split_part(f.name,'｜',1)))) filter(where menu.food_id is not null or f.name like '%｜%')=1
          then min(coalesce(menu.merchant,split_part(f.name,'｜',1))) filter(where menu.food_id is not null or f.name like '%｜%') end merchant,
        coalesce(jsonb_agg(jsonb_build_object('name',i.name,'estimated',i.estimate or coalesce(i.provenance='estimated',false) or coalesce(i.weight_basis='payment_derived',false),
          'energy_kcal',i.energy_kcal * coalesce(i.consumed_fraction,1), 'grams',i.amount_g * coalesce(i.consumed_fraction,1)) order by i.position) filter(where i.id is not null),'[]') items
      from meals m
      left join intake_items i on i.meal_id=m.id and i.subject_id=m.subject_id and i.effective and coalesce(i.consumed_fraction,1)>0
      left join food_references f on f.id=i.food_ref_id and f.subject_id=m.subject_id
      left join merchant_foods menu on menu.food_id=f.id and menu.subject_id=m.subject_id
      where m.subject_id=${subject} and m.state='active' and m.occurred_on between least(${window.from}::date,${input.to}::date-6) and ${input.to}::date
      group by m.id order by m.occurred_on,m.occurred_at nulls last,m.created_at,m.id`);

    const saved=effects.has("agent.run")?(await db.execute<DietEvidence["intentions"][number]>(sql`
      select i.id,i.revision,i.business_key key,i.data->>'statement' statement,
        exists(select 1 from meal_revisions r join meals m on m.id=r.meal_id
          where m.subject_id=i.subject_id and r.created_at>i.updated_at and r.snapshot->>'occurred_on'=i.data->>'valid_from'
          and (m.state<>'active' or m.occurred_on::text<>r.snapshot->>'occurred_on')) recheck
      from agent_intentions i where i.subject_id=${subject} and i.data->>'state'='active' and i.data->>'assertion'='explicit' and (
        (i.scope='health' and i.data->>'kind'='goal' and i.data->>'category'='dietary' and i.business_key in ('wellness.weight','wellness.energy')
          and (i.data->>'valid_from' is null or (i.data->>'valid_from')::date<=${input.to}::date)
          and (i.data->>'valid_to_exclusive' is null or (i.data->>'valid_to_exclusive')::date>${input.to}::date))
        or (i.scope='health' and i.data->>'kind'='preference' and i.data->>'category'='dietary'
          and (i.data->>'valid_from')::date between ${window.from}::date and ${input.to}::date
          and i.business_key='wellness.diary.'||(i.data->>'valid_from')||'.'||${input.time_zone})
        or (i.scope='daily' and i.data->>'kind'='preference' and i.data->>'category'='dietary' and i.business_key='dining.usual_canteen'
          and (i.data->>'valid_from' is null or (i.data->>'valid_from')::date<=${input.to}::date)
          and (i.data->>'valid_to_exclusive' is null or (i.data->>'valid_to_exclusive')::date>${input.to}::date))
      )`)).rows:[];
    // Reuse the menu's evidence filtering and compatibility with legacy food references.
    const canteen=/^常去食堂[：:]\s*([^｜|\n]{1,160})$/u.exec(saved.find(row=>row.key==="dining.usual_canteen")?.statement??"")?.[1]?.trim();
    const menu=canteen?merchantMenuResultSchema.parse(await merchantMenu(db,subject,{merchant:canteen,on:input.to,limit:100},effects)):null;

    const measurements=canHealth?(await db.execute<DietEvidence["measurements"][number]>(sql`
      select o.id,o.revision,(o.occurred_at at time zone ${input.time_zone})::date::text date,
        to_char(o.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,
        s.id source,o.raw_id session,o.metric_key metric,o.value::float8 value,o.unit,o.original_field method
      from health_observations o
      join health_raw_records r on r.id=o.raw_id and r.subject_id=o.subject_id and r.current_version=o.raw_version
      join health_source_instances s on s.id=r.source_instance_id and s.subject_id=o.subject_id
      where o.subject_id=${subject} and o.effective and o.occurred_at is not null
        and o.occurred_on between ${window.weightFrom}::date-1 and ${input.to}::date+2
        and ((s.source_type='scale' and ((o.metric_key='weight' and not o.autofilled)
          or (o.metric_key in ('body_fat','muscle_mass','body_water_rate','visceral_fat') and (not o.autofilled or o.original_field='xiaomi-bia-v1'))))
          or (o.metric_key='waist' and not o.autofilled))
      order by o.occurred_at,o.id`)).rows:[];
    const activity=canHealth?(await db.execute<DietEvidence["activity"][number]>(sql`
      select distinct on (occurred_on) occurred_on::text date,(result #>> '{activity,steps}')::int steps
      from health_daily_summaries where subject_id=${subject} and occurred_on between ${window.from}::date and ${input.to}::date
      order by occurred_on,updated_at desc,algorithm_version desc`)).rows:[];
    return {...wellness,meals:mealRows.rows,intentions:saved,measurements,activity,menu:menu?{
      merchant:menu.merchant,dishes:menu.items.filter(row=>row.provenance||row.evidence.length).map(row=>row.dish)
    }:null};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}
