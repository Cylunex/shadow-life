import assert from "node:assert/strict";
import test from "node:test";
import { dirname, relative, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { moduleSpecifiers, sourceBoundaryViolations } from "../check-boundaries.mjs";
import { crossSideIntegrationTests, parseTestScope, selectTestFiles, testEnvironment } from "../test-full.mjs";

const root=resolve(import.meta.dirname,"../..");
const packages=new Map([
  ["@shadow/contracts","shared/contracts/"],["@shadow/kernel","server/kernel/"],
  ["@shadow/database","server/database/"],["@shadow/agent-adapter","server/agent-adapter/"],
  ["@shadow/api","server/api/"],["@shadow/worker","server/worker/"],
  ["@shadow/web","client/web/"],["@shadow/mcp","server/mcp/"]
]);
const violations=(path,text)=>sourceBoundaryViolations(resolve(root,path),text,packages,root);

test("runtime boundaries reject package, relative, re-export, dynamic and type-only back doors",()=>{
  for(const source of [
    'import { QueryService } from "@shadow/kernel";',
    'export * from "@shadow/database/internal";',
    'const impl=await import("../../../server/api/src/app.js");',
    'const impl=require("@shadow/agent-adapter");',
    'import {LifeClient} from "@shadow/mcp";',
    'type Data=import("@shadow/database").Data;',
    'import value = require("@shadow/kernel");'
  ])assert.ok(violations("client/web/src/example.ts",source).length,source);
  assert.ok(violations("server/api/src/example.ts",'import "../../../client/web/src/main.js";').length);
  assert.ok(violations("shared/contracts/src/example.ts",'export * from "../../../server/kernel/src/index.js";').length);
});
test("shared contracts and local client modules stay legal while cross-side tests are explicit",()=>{
  assert.deepEqual(violations("client/web/src/example.ts",'import {schema} from "@shadow/contracts"; import "./utils.js";'),[]);
  assert.deepEqual(violations("client/web/test/example.test.ts",'import "../../../server/api/src/app.js";'),[]);
  assert.deepEqual(violations("server/api/src/example.ts",'import {QueryService} from "@shadow/kernel";'),[]);
  assert.deepEqual(moduleSpecifiers("example.ts",'// import "@shadow/database";\nconst note=\'require("pg")\';'),[]);
});
test("kernel and contract framework boundaries also cover dynamic imports and relative adapters",()=>{
  assert.ok(violations("server/kernel/src/example.ts",'const db=await import("../../database/src/index.js");').length);
  assert.ok(violations("server/kernel/src/example.ts",'const driver=require("pg");').length);
  assert.ok(violations("shared/contracts/src/example.ts",'import "hono/jsx";').length);
  assert.ok(violations("client/web/src/example.ts",'import "drizzle-orm/node-postgres";').length);
});
test("server MCP keeps HTTP transport boundaries while its integration tests may use server fixtures",()=>{
  for(const source of [
    'import {QueryService} from "@shadow/kernel";',
    'export * from "@shadow/database/internal";',
    'const app=await import("../../api/src/app.js");',
    'const db=require("pg");',
    'type Data=import("../../database/src/index.js").Data;',
    'import "@shadow/agent-adapter";'
  ])assert.ok(violations("server/mcp/src/example.ts",source).length,source);
  assert.deepEqual(violations("server/mcp/src/example.ts",'import {schema} from "@shadow/contracts"; import "./client.js";'),[]);
  assert.deepEqual(violations("server/mcp/test/example.test.ts",'import "../../api/src/app.js"; import "@shadow/database";'),[]);
});
test("scoped test selection keeps every integration in all and isolates both independent suites",()=>{
  const all=selectTestFiles("all",root),server=selectTestFiles("server",root),client=selectTestFiles("client",root);
  assert.ok(server.length&&client.length&&all.length);
  for(const path of crossSideIntegrationTests){assert.ok(all.includes(path));assert.ok(!client.includes(path));assert.ok(!server.includes(path));}
  assert.ok(all.includes("scripts/fixtures/personal-foundation-mcp.test.ts"));
  assert.ok(server.includes("scripts/fixtures/personal-foundation-mcp.test.ts"));
  assert.ok(!client.includes("scripts/fixtures/personal-foundation-mcp.test.ts"));
  const mcpTests=all.filter(path=>path.startsWith("server/mcp/test/"));
  assert.ok(mcpTests.length);
  for(const path of mcpTests)assert.ok(server.includes(path),`${path} must be covered by server tests`);
  assert.ok(!server.some(path=>path.startsWith("client/")));
  assert.ok(!client.some(path=>path.startsWith("server/")));
  for(const path of client.filter(path=>path.startsWith("client/"))){
    for(const specifier of moduleSpecifiers(path,readFileSync(resolve(root,path),"utf8"))){
      const destination=specifier.startsWith(".")?relative(root,resolve(root,dirname(path),specifier)):packages.get(specifier.split("/").slice(0,2).join("/"));
      assert.ok(!destination?.startsWith("server/"),`${path} imports ${specifier}; register this cross-side test in the integration suite`);
    }
  }
  assert.equal(new Set(all).size,all.length);
  assert.deepEqual([...new Set([...server,...client,...crossSideIntegrationTests])].sort(),all);
});
test("server test loader cannot inherit a Web config and malformed scopes fail before launching",()=>{
  assert.equal(parseTestScope([]),"all");assert.equal(parseTestScope(["--scope","server"]),"server");
  for(const args of [["server"],["--scope","unknown"],["--scope","client","extra"]])assert.throws(()=>parseTestScope(args),/Usage/);
  const server=testEnvironment("server",{TSX_TSCONFIG_PATH:"/client/only.json",EXAMPLE:"kept"},root);
  assert.equal(server.TSX_TSCONFIG_PATH,resolve(root,"tsconfig.base.json"));assert.equal(server.EXAMPLE,"kept");
  assert.equal(testEnvironment("client",{},root).TSX_TSCONFIG_PATH,resolve(root,"client/web/tsconfig.json"));
});
