import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

test("shared contract generation works without a client checkout and full generation still checks Android",async t=>{
  const packageRoot=resolve(import.meta.dirname,".."),repository=resolve(packageRoot,"../..");
  const temporary=await mkdtemp(join(tmpdir(),"life-contract-scope-"));
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const copied=join(temporary,"shared/contracts");
  await mkdir(join(copied,"scripts"),{recursive:true});
  await cp(join(packageRoot,"src"),join(copied,"src"),{recursive:true});
  await copyFile(join(packageRoot,"scripts/generate.ts"),join(copied,"scripts/generate.ts"));
  await copyFile(join(packageRoot,"package.json"),join(copied,"package.json"));
  const examples="skills/life-operator/references/examples.json";
  await mkdir(dirname(join(temporary,examples)),{recursive:true});
  await copyFile(join(repository,examples),join(temporary,examples));
  await writeFile(join(temporary,"package.json"),JSON.stringify({type:"module"}));
  await symlink(join(repository,"node_modules"),join(temporary,"node_modules"),"dir");
  await symlink(join(packageRoot,"node_modules"),join(copied,"node_modules"),"dir");
  const generate=(...args:string[])=>spawnSync(process.execPath,["--import","tsx",join(copied,"scripts/generate.ts"),...args],{cwd:temporary,encoding:"utf8"});
  const success=(...args:string[])=>{const result=generate(...args);assert.equal(result.status,0,result.stderr||result.stdout);};

  success("--scope","shared");
  success("--scope","shared","--check");
  await assert.rejects(stat(join(temporary,"client")),{code:"ENOENT"});
  for(const name of ["capabilities.json","agent-catalog.json","mcp-dispatch.json"]){
    assert.equal(await readFile(join(copied,"generated",name),"utf8"),await readFile(join(packageRoot,"generated",name),"utf8"));
  }
  assert.notEqual(generate("--check").status,0,"default scope requires the Android snapshots");
  success();
  success("--check");
  const androidFiles=["client/android/core/model/src/main/java/com/shadow/life/GeneratedApiDtos.kt","client/android/app/src/main/assets/home-workout.json"];
  for(const name of androidFiles)assert.ok((await stat(join(temporary,name))).size>0,"default generation produces Android snapshots without an existing client checkout");
  await writeFile(join(temporary,androidFiles[0]!),"stale Android snapshot");
  success("--scope","shared","--check");
  assert.notEqual(generate("--check").status,0,"full checks must detect Android contract drift");
  await writeFile(join(copied,"generated/capabilities.json"),"{}");
  assert.notEqual(generate("--scope","shared","--check").status,0,"shared checks must detect shared contract drift");
});
