import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MoneyImportHistoryInput, MoneyImportHistoryItem } from "@shadow/contracts";
import type * as schema from "./schema.js";

type Database=NodePgDatabase<typeof schema>;
type Transaction=Parameters<Parameters<Database["transaction"]>[0]>[0];
type Options=Omit<MoneyImportHistoryInput,"cursor"> & {asOf?:string;before?:{at:string;id:string}};

export async function readMoneyImportHistory(database:Database|Transaction,subjectId:string,input:Options){
  const clock=await database.execute<{as_of:string}>(sql`select to_char(coalesce(${input.asOf??null}::timestamptz,now()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as_of`);
  const asOf=clock.rows[0]!.as_of;
  const result=await database.execute<MoneyImportHistoryItem>(sql`
    with selected as (
      select batch.* from money_import_batches batch
      where batch.subject_id=${subjectId} and batch.created_at<=${asOf}::timestamptz
        ${input.platform?sql`and batch.platform=${input.platform}`:sql``}
        ${input.source_account?sql`and batch.source_account=${input.source_account}`:sql``}
        ${input.status?sql`and batch.status=${input.status}`:sql``}
        ${input.before?sql`and (batch.created_at,batch.id)<(${input.before.at}::timestamptz,${input.before.id})`:sql``}
      order by batch.created_at desc,batch.id desc limit ${input.limit+1}
    )
    select batch.id,batch.source_name,batch.platform,batch.source_account,batch.parser_version,batch.format,batch.status,
      to_char(batch.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
      count(candidate.id)::int total,
      count(*) filter(where candidate.status='pending')::int pending,
      count(*) filter(where candidate.status='invalid')::int invalid,
      count(*) filter(where candidate.status='confirmed')::int confirmed,
      count(*) filter(where candidate.status='ignored')::int ignored,
      count(*) filter(where candidate.status in ('pending','invalid') and
        (candidate.duplicate_of_record_id is not null or exists(
          select 1 from money_import_candidates prior
          where prior.subject_id=candidate.subject_id and prior.platform=candidate.platform and prior.source_account=candidate.source_account
            and prior.external_id=candidate.external_id
            and ((prior.identity_kind='refund') is not distinct from (candidate.identity_kind='refund') or prior.identity_kind is null or candidate.identity_kind is null)
            and prior.id<>candidate.id and (prior.status='confirmed' or (prior.id=candidate.duplicate_of_candidate_id and prior.status in ('pending','invalid')))
        )))::int duplicates,
      min(candidate.proposed->>'occurred_on') first_occurred_on,
      max(candidate.proposed->>'occurred_on') last_occurred_on
    from selected batch left join money_import_candidates candidate on candidate.batch_id=batch.id and candidate.subject_id=${subjectId}
    group by batch.id,batch.source_name,batch.platform,batch.source_account,batch.parser_version,batch.format,batch.status,batch.created_at
    order by batch.created_at desc,batch.id desc
  `);
  return{items:result.rows.slice(0,input.limit),hasMore:result.rows.length>input.limit,asOf};
}
