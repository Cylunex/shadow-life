import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkill } from "../src/skill.js";

test("skill uses private config, authorized HTTP schemas and preserves command envelope on errors", async t => {
  const calls: Array<{url: string; body: unknown}> = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push({url:req.url!,body:raw?JSON.parse(raw):undefined});
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/capabilities?include_schemas=true") res.end(JSON.stringify({capabilities:[{name:"life.link_meal_consumption",description:"link",input_schema:{type:"object"}}]}));
    else { res.statusCode=409; res.end(JSON.stringify({protocol:"shadow.error",code:"conflict",message:"synthetic conflict"})); }
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(() => new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const dir=await mkdtemp(join(tmpdir(),"life-skill-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,"config.json"),address=server.address() as {port:number};
  await writeFile(file,JSON.stringify({api:`http://127.0.0.1:${address.port}`,token:"synthetic-token"}),{mode:0o600});
  const catalog=await runSkill(file,"catalog") as Array<{name:string;inputSchema:any}>;
  assert.equal(catalog[0]?.name,"life.link_meal_consumption");
  assert.deepEqual(catalog[0]?.inputSchema.required,["command_id","input"]);
  const args={command_id:"cmd_skill_link_test",input:{meal_id:"meal_example123",consumption_record_id:"record_example123",evidence:"user_confirmed"}};
  const result=await runSkill(file,"call","life.link_meal_consumption",args) as {isError:boolean;code:string};
  assert.equal(result.isError,true);assert.equal(result.code,"conflict");
  assert.equal(calls[1]?.url,"/api/commands/life.link_meal_consumption");
  const launch = await promisify(execFile)(fileURLToPath(new URL("../../../skills/life-operator/scripts/life", import.meta.url)), ["--config",file,"catalog"], {cwd:tmpdir()});
  assert.equal(JSON.parse(launch.stdout)[0].name,"life.link_meal_consumption");
  assert.deepEqual(calls[1]?.body,{protocol:"shadow.command",capability:"life.link_meal_consumption",...args});
});
