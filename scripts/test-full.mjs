import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";

const roots=["apps","importers","packages"];
const ignored=new Set(["node_modules","dist","build","coverage"]),tests=[];
function discover(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory()&&!ignored.has(entry.name))discover(path);
    else if(entry.isFile()&&entry.name.endsWith(".test.ts")&&directory.split(sep).includes("test"))tests.push(path);
  }
}
for(const root of roots)discover(root);
tests.sort();

if(!tests.length)throw new Error("no test files discovered");
const result=spawnSync(process.execPath,["--import","tsx","--test","--test-concurrency=1",...tests],{stdio:"inherit",env:process.env});
process.exit(result.status??1);
