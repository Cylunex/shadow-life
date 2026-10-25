import { existsSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const workspaceRoot=resolve(import.meta.dirname,"..");
const ignored=new Set(["node_modules","dist","build","coverage",".git",".gradle"]);
// These exercise real server implementations through a client and belong to the
// complete integration run, even though their fixtures remain beside the client.
export const crossSideIntegrationTests=Object.freeze([
  "client/web/test/agent-tools.test.ts",
  "client/web/test/purchase-experience-journey.test.ts"
]);
const serverIntegrationTest="scripts/fixtures/personal-foundation-mcp.test.ts";
const toolsTest="scripts/test/workspace-tools.test.mjs";

export function parseTestScope(args){
  if(args.length===0)return "all";
  if(args.length===2&&args[0]==="--scope"&&["server","client","all"].includes(args[1]))return args[1];
  throw new Error("Usage: test-full.mjs [--scope server|client|all]");
}

export function selectTestFiles(scope,root=workspaceRoot){
  if(!["server","client","all"].includes(scope))throw new Error(`Unknown test scope: ${scope}`);
  const tests=[];
  function discover(directory){
    const absolute=join(root,directory);
    if(!existsSync(absolute))throw new Error(`Test directory is missing: ${directory}`);
    for(const entry of readdirSync(absolute,{withFileTypes:true})){
      const path=join(directory,entry.name);
      if(entry.isDirectory()&&!ignored.has(entry.name))discover(path);
      else if(entry.isFile()&&entry.name.endsWith(".test.ts")&&directory.split(sep).includes("test"))tests.push(path.split(sep).join("/"));
    }
  }
  for(const directory of scope==="all"?["server","client","shared"]:[scope,"shared"])discover(directory);
  if(scope==="all"){
    for(const path of crossSideIntegrationTests)if(!existsSync(join(root,path)))throw new Error(`Integration test is missing: ${path}`);
  }
  if(scope!=="client"){
    if(!existsSync(join(root,serverIntegrationTest)))throw new Error(`Integration test is missing: ${serverIntegrationTest}`);
    tests.push(serverIntegrationTest);
  }
  const selected=scope==="client"?tests.filter(path=>!crossSideIntegrationTests.includes(path)):tests;
  if(existsSync(join(root,toolsTest)))selected.push(toolsTest);
  return selected.sort();
}

export function testEnvironment(scope,environment=process.env,root=workspaceRoot){
  return{...environment,TSX_TSCONFIG_PATH:scope==="server"?join(root,"tsconfig.base.json"):environment.TSX_TSCONFIG_PATH??join(root,"client/web/tsconfig.json")};
}

function main(){
  let scope;
  try{scope=parseTestScope(process.argv.slice(2));}catch(error){console.error(error.message);return 64;}
  const tests=selectTestFiles(scope);
  if(!tests.length)throw new Error("no test files discovered");
  console.log(`Running ${tests.length} test files (scope: ${scope}).`);
  if(scope==="client")console.log(`Cross-side integration: ${crossSideIntegrationTests.length} client fixture files are reserved for test:full; client unit tests need no server runtime.`);
  const result=spawnSync(process.execPath,["--import","tsx","--test","--test-concurrency=1",...tests],{cwd:workspaceRoot,stdio:"inherit",env:testEnvironment(scope)});
  if(result.error)console.error(result.error.message);
  return result.status??1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=main();
