import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import type {StockRecipeQuery} from "@shadow/contracts";
import {conflict} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
export async function stockRecipes(database:Database,subject:string,v:StockRecipeQuery){
  const lot=(await database.execute<{id:string;name:string;revision:number;quantity:string;unit:string;expires_on:string|null}>(sql`
    select id,name,revision,quantity::text,unit,expires_on::text from food_stock_lots where subject_id=${subject} and id=${v.lot_id}`)).rows[0];
  if(!lot)throw conflict("食材批次不可用");
  if(Number(lot.quantity)<=0||(lot.expires_on&&lot.expires_on<v.on))return {lot,items:[],next_offset:null};
  const result=await database.execute(sql`
    with candidates as (
      select r.id,r.title,r.revision,r.servings from recipes r where r.subject_id=${subject} and r.state='active'
      and exists(select 1 from recipe_items i where i.recipe_id=r.id and lower(trim(i.snapshot->>'name'))=lower(trim(${lot.name})) and i.snapshot->>'unit'=${lot.unit})
    ), ingredients as (
      select r.id,lower(trim(i.snapshot->>'name')) ingredient,min(i.snapshot->>'name') name,i.snapshot->>'unit' unit,
        case when count(i.snapshot->>'quantity')=count(*) then sum((i.snapshot->>'quantity')::numeric) end need
      from candidates r join recipe_items i on i.recipe_id=r.id group by r.id,lower(trim(i.snapshot->>'name')),i.snapshot->>'unit'
    ), totals as (
      select lower(trim(name)) ingredient,unit,sum(quantity) have from food_stock_lots
      where subject_id=${subject} and (expires_on is null or expires_on>=${v.on}::date) group by lower(trim(name)),unit
    ), gaps as (
      select i.*,t.have,case when i.need is not null and t.have is not null then greatest(i.need-t.have,0) end gap
      from ingredients i left join totals t on t.ingredient=i.ingredient and t.unit=i.unit
    ), matches as (
      select r.id,r.title,r.revision,r.servings::text,count(*) filter(where g.gap>0)::int short_count,
        count(*) filter(where g.gap is null)::int unknown_count,
        jsonb_agg(jsonb_build_object('name',g.name,'unit',g.unit,'required',g.need::text,'available',g.have::text,'missing',g.gap::text)
          order by g.ingredient,g.unit) ingredients
      from candidates r join gaps g on g.id=r.id group by r.id,r.title,r.revision,r.servings
    )
    select * from matches order by case when unknown_count=0 and short_count=0 then 0 when unknown_count=0 and short_count=1 then 1
      when unknown_count=0 then 2 else 3 end,short_count,unknown_count,title,id offset ${v.offset} limit ${v.limit+1}`);
  return {lot,items:result.rows.slice(0,v.limit),next_offset:result.rows.length>v.limit?v.offset+v.limit:null};
}

/** Derive the deficit from all currently valid lots; a missing inventory row is unknown. */
export async function subtractStock(database:Database,subject:string,on:string,rows:Array<{name:string;quantity?:string;unit?:string;sourceIds:string[]}>){
  const result=await database.execute<{name:string;unit:string|null;quantity:string|null;sources:string[]}>(sql`
    with requested as (
      select elem->>'name' name,elem->>'unit' unit,(elem->>'quantity')::numeric need,elem->'sourceIds' sources
      from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) elem
    ), stock as (
      select lower(trim(name)) name,unit,sum(quantity) have from food_stock_lots where subject_id=${subject}
      and (expires_on is null or expires_on>=${on}::date) group by lower(trim(name)),unit
    ) select r.name,case when s.have is not null and r.need is not null then r.unit end unit,(r.need-s.have)::text quantity,r.sources
      from requested r left join stock s on s.name=lower(trim(r.name)) and s.unit=r.unit
      where r.need is null or s.have is null or r.need>s.have order by r.name,r.unit`);
  return result.rows.map(r=>({name:r.name,...(r.unit&&r.quantity?{unit:r.unit,quantity:r.quantity}:{}),sourceIds:r.sources}));
}
