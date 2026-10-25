import { sql } from "drizzle-orm";
import { saveServiceCardInputSchema, recordServiceCardUseInputSchema, type ServiceCardsInput } from "@shadow/contracts";
import { assertServiceCardUsage, assertServiceCardUseDate, serviceCardBalance, conflict, type ServiceCardFacts, type ServiceCardUsage, type TransactionStore } from "@shadow/kernel";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema.js";
type Database=Pick<NodePgDatabase<typeof schema>,"execute">;
type CardRow=ServiceCardFacts&Record<string,unknown>&{id:string;revision:number;time_zone:string;today:string};
type UsageRow=ServiceCardUsage&Record<string,unknown>;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

async function usage(database:Database,cardId:string,excluding?:string):Promise<UsageRow>{
  const result=await database.execute<UsageRow>(sql`select coalesce(sum(units),0)::int used_units,min(occurred_on)::text first_on,max(occurred_on)::text last_on from service_card_uses where card_id=${cardId} and state='active' and (${excluding??null}::text is null or id<>${excluding??null})`);
  return result.rows[0]!;
}
async function snapshotCard(database:Database,cardId:string,reason:string){
  await database.execute(sql`insert into service_card_revisions(card_id,revision,snapshot,reason) select id,revision,to_jsonb(card),${reason} from service_cards card where id=${cardId}`);
}

export async function writeServiceCard(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  if(command.capability==="money.save_service_card"){
    const input=saveServiceCardInputSchema.parse(command.input),id=input.card_id??nextId("plan");let revision=1;
    if(input.purchase_record_id){
      const linked=await database.execute(sql`select id from consumption_records where id=${input.purchase_record_id} and subject_id=${subjectId} and state='confirmed' for share`);
      if(!linked.rows.length)throw conflict("关联购买记录不存在或不属于当前用户");
    }
    if(input.card_id){
      const current=(await database.execute<CardRow>(sql`select * from service_cards where id=${id} and subject_id=${subjectId} for update`)).rows[0];
      if(!current||current.revision!==input.expected_revision)throw conflict("次卡版本已变化或不存在，请重新读取");
      assertServiceCardUsage({...input,expires_on:input.expires_on??null},await usage(database,id));
      await snapshotCard(database,id,input.reason!);revision=current.revision+1;
      await database.execute(sql`update service_cards set name=${input.name},merchant_name=${input.merchant_name??null},purchase_record_id=${input.purchase_record_id??null},total_units=${input.total_units},unit_label=${input.unit_label},started_on=${input.started_on}::date,expires_on=${input.expires_on??null}::date,time_zone=${input.time_zone},state=${input.state},note=${input.note??null},revision=${revision},updated_at=now() where id=${id}`);
    }else{
      await database.execute(sql`insert into service_cards(id,subject_id,name,merchant_name,purchase_record_id,total_units,unit_label,started_on,expires_on,time_zone,state,note) values(${id},${subjectId},${input.name},${input.merchant_name??null},${input.purchase_record_id??null},${input.total_units},${input.unit_label},${input.started_on}::date,${input.expires_on??null}::date,${input.time_zone},${input.state},${input.note??null})`);
    }
    return{resources:[{type:"service_card",id,revision}],actualValues:{card_id:id,revision,total_units:input.total_units}};
  }
  const input=recordServiceCardUseInputSchema.parse(command.input);
  // One aggregate lock serializes edits and all deductions, including different command IDs.
  const card=(await database.execute<CardRow>(sql`select id,total_units,started_on::text,expires_on::text,state,revision,time_zone,(now() at time zone time_zone)::date::text today from service_cards where id=${input.card_id} and subject_id=${subjectId} for update`)).rows[0];
  if(!card||card.revision!==input.expected_revision)throw conflict("次卡版本已变化或不存在，请重新读取");
  const id=input.use_id??nextId("event");let useRevision=1;
  if(input.use_id){
    const old=(await database.execute<{revision:number}>(sql`select revision from service_card_uses where id=${id} and card_id=${card.id} and subject_id=${subjectId}`)).rows[0];
    if(!old)throw conflict("使用记录不存在或不属于这张次卡");useRevision=old.revision+1;
  }
  const totals=await usage(database,card.id,input.use_id);
  if(input.state==="active"){
    assertServiceCardUseDate(card,input.occurred_on,card.today,!input.use_id);
    totals.used_units+=input.units;
    totals.first_on=totals.first_on&&totals.first_on<input.occurred_on?totals.first_on:input.occurred_on;
    totals.last_on=totals.last_on&&totals.last_on>input.occurred_on?totals.last_on:input.occurred_on;
  }
  assertServiceCardUsage(card,totals);
  await snapshotCard(database,card.id,input.reason??"记录实际用卡");
  if(input.use_id){
    await database.execute(sql`insert into service_card_use_revisions(use_id,revision,snapshot,reason) select id,revision,to_jsonb(use),${input.reason!} from service_card_uses use where id=${id}`);
    await database.execute(sql`update service_card_uses set occurred_on=${input.occurred_on}::date,units=${input.units},state=${input.state},note=${input.note??null},revision=${useRevision},updated_at=now() where id=${id}`);
  }else await database.execute(sql`insert into service_card_uses(id,card_id,subject_id,occurred_on,units,state,note) values(${id},${card.id},${subjectId},${input.occurred_on}::date,${input.units},${input.state},${input.note??null})`);
  const revision=card.revision+1;
  await database.execute(sql`update service_cards set revision=${revision},updated_at=now() where id=${card.id}`);
  return{resources:[{type:"service_card",id:card.id,revision},{type:"service_card_use",id,revision:useRevision}],actualValues:{card_id:card.id,use_id:id,revision,...serviceCardBalance(card,totals.used_units,card.today)}};
}

export async function readServiceCards(database:Database,subjectId:string,input:ServiceCardsInput){
  const result=await database.execute<CardRow&{used_units:number;uses:unknown[];next_uses_before_id:string|null}>(sql`
    select card.id,card.name,card.merchant_name,card.purchase_record_id,card.total_units,card.unit_label,card.started_on::text,card.expires_on::text,card.time_zone,card.state,card.note,card.revision,
      (now() at time zone card.time_zone)::date::text today,
      (select coalesce(sum(units),0)::int from service_card_uses where card_id=card.id and state='active') used_units,
      coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'occurred_on',u.occurred_on::text,'units',u.units,'state',u.state,'note',u.note,'revision',u.revision) order by u.occurred_on desc,u.id desc) from (
        select * from service_card_uses u where u.card_id=card.id and ${input.id!==undefined}
          and (${input.uses_before_id??null}::text is null or (u.occurred_on,u.id)<(select occurred_on,id from service_card_uses where id=${input.uses_before_id??null} and card_id=card.id))
        order by occurred_on desc,id desc limit 101
      ) u),'[]'::jsonb) uses
    from service_cards card where card.subject_id=${subjectId}
      and (${input.id??null}::text is null or card.id=${input.id??null})
      and (${input.purchase_record_id??null}::text is null or card.purchase_record_id=${input.purchase_record_id??null})
      and (${input.after_id??null}::text is null or card.id>${input.after_id??null})
      and (${input.query??null}::text is null or strpos(lower(card.name||' '||coalesce(card.merchant_name,'')),lower(${input.query??null}))>0)
    order by card.id limit ${input.limit+1}`);
  const more=result.rows.length>input.limit,rows=result.rows.slice(0,input.limit);
  const items=rows.map(({today,uses,...row})=>{
    const page=uses.slice(0,100) as Array<{id:string}>;
    return{...row,...serviceCardBalance(row,row.used_units,today),uses:page,next_uses_before_id:uses.length>100?page.at(-1)!.id:null};
  });
  return{items,next_after_id:more?items.at(-1)!.id:null,as_of:new Date().toISOString()};
}
