import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import { capabilityRegistry } from "@shadow/contracts";
import { CommandExecutor, QueryService, sha256Fingerprinter, systemClock, uuidIds, type RequestContext } from "@shadow/kernel";
import { migrate, PostgresUnitOfWork } from "../src/index.js";

// Every regression owns a fresh database inside the explicitly supplied disposable cluster.
export async function reviewFixture(t:TestContext){
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const name=`review_${randomUUID().replaceAll("-","")}`;
  await admin.query(`create database "${name}"`);
  const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname=`/${name}`;
  const pool=new Pool({connectionString:url.toString(),max:12});
  t.after(async()=>{await pool.end();await admin.query(`drop database "${name}" with (force)`);await admin.end();});
  await migrate(pool);await pool.query("update write_epochs set stage='life',epoch=epoch+1");
  const unitOfWork=new PostgresUnitOfWork(pool),executor=new CommandExecutor({unitOfWork,ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter}),queries=new QueryService(unitOfWork);
  const context:RequestContext={actorId:"subject_review_fixes",subjectId:"subject_review_fixes",clientId:"client_review_fixes",traceId:"trace_review_fixes",effects:new Set(Object.values(capabilityRegistry).flatMap(c=>c.possibleEffects))};
  await unitOfWork.ensurePrincipal(context.subjectId);
  const command=(capability:string,input:unknown)=>({protocol:"shadow.command",capability,command_id:`cmd_${randomUUID()}`,input});
  const run=(capability:string,input:unknown,ctx=context)=>executor.execute(ctx,command(capability,input));
  return{pool,unitOfWork,executor,queries,context,command,run,connectionString:url.toString()};
}
export const pgOnly={skip:!process.env.TEST_DATABASE_URL};
export const mealInput={occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",meal_type:"lunch",items:[{name:"合成米饭",quantity:"1",unit:"碗",estimate:false}]};
