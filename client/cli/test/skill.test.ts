import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilityRegistry } from "@shadow/contracts";
import { runSkill } from "../src/skill.js";

test("skill uses private config, authorized HTTP schemas and preserves command envelope on errors", async t => {
  const calls: Array<{url: string; body: unknown}> = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push({url:req.url!,body:raw?JSON.parse(raw):undefined});
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/capabilities?include_schemas=true") res.end(JSON.stringify({capabilities:[{name:"life.link_meal_consumption",description:"link",input_schema:{type:"object"}},{name:"life.correct_intake",description:"correct intake",input_schema:capabilityRegistry["life.correct_intake"].inputSchema.toJSONSchema()}]}));
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
  const correction = catalog.find(tool => tool.name === "life.correct_intake")?.inputSchema.properties.input;
  assert.equal(correction.type, "object");
  assert.ok(correction.properties.item && correction.properties.consumed_fraction);
  assert.deepEqual(correction.oneOf, [{ required: ["item"] }, { required: ["consumed_fraction"] }]);
  const args={command_id:"cmd_skill_link_test",input:{meal_id:"meal_example123",consumption_record_id:"record_example123",evidence:"user_confirmed"}};
  const result=await runSkill(file,"call","life.link_meal_consumption",args) as {isError:boolean;code:string};
  assert.equal(result.isError,true);assert.equal(result.code,"conflict");
  assert.equal(calls[1]?.url,"/api/commands/life.link_meal_consumption");
  const launch = await promisify(execFile)(fileURLToPath(new URL("../../../skills/life-operator/scripts/life", import.meta.url)), ["--config",file,"catalog"], {cwd:tmpdir()});
  assert.equal(JSON.parse(launch.stdout)[0].name,"life.link_meal_consumption");
  assert.deepEqual(calls[1]?.body,{protocol:"shadow.command",capability:"life.link_meal_consumption",...args});
});

test("source discloses only the authenticated scope, requires a real issuer on older servers and fails closed on revocation", async t => {
  let status = 200;
  const scope = "ab".repeat(32), paths: string[] = [];
  const me = { issuer: "https://identity.example.com/tenant", environment_id: "测试空间", life_subject_id: "subject_source_test", effects: ["life.meal.read"] };
  const server = createServer((req, res) => {
    paths.push(req.url!);
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/source") { res.statusCode = status; res.end(JSON.stringify({scope, extra: "hidden"})); }
    else { res.end(JSON.stringify(me)); }
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const dir = await mkdtemp(join(tmpdir(),"life-source-")); t.after(() => rm(dir,{recursive:true,force:true}));
  const file = join(dir,"config.json"), address = server.address() as {port:number};
  await writeFile(file, JSON.stringify({api:`http://127.0.0.1:${address.port}`, token:"synthetic-token"}));
  assert.deepEqual(await runSkill(file, "source"), {scope});
  status = 404;
  const expected = (await import("node:crypto")).createHash("sha256").update(JSON.stringify(["shadow-life-source-v1", me.issuer, me.environment_id, me.life_subject_id])).digest("hex");
  assert.deepEqual(await runSkill(file, "source"), {scope:expected});
  me.issuer = "shadow:trusted-proxy";
  assert.deepEqual(await runSkill(file, "source"), {isError:true,code:"source_unavailable"});
  paths.length = 0;
  status = 403;
  assert.deepEqual(await runSkill(file, "source"), {isError:true,code:"permission_denied"});
  assert.deepEqual(paths, ["/api/source"]);
  paths.length = 0;
  status = 200;
  assert.deepEqual(await runSkill(file,"call-scoped","health.trend",{scope:"c".repeat(64),arguments:{}}), {isError:true,code:"permission_denied"});
  assert.deepEqual(paths, ["/api/source"]);
});
