import assert from "node:assert/strict";
import { readdirSync,readFileSync } from "node:fs";
import { join,resolve } from "node:path";

const root=resolve(import.meta.dirname,"../apps/android");
const settings=readFileSync(join(root,"settings.gradle.kts"),"utf8");
for(const module of [":app",":core:model",":core:data",":core:designsystem",":devices"])assert.ok(settings.includes(`"${module}"`),`missing Android module ${module}`);

function sources(directory){const values=[];for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())values.push(...sources(path));else if(path.endsWith(".kt"))values.push([path,readFileSync(path,"utf8")]);}return values;}
const model=sources(join(root,"core/model/src"));
for(const [path,text] of model)assert.doesNotMatch(text,/^import (?:android|androidx)\./mu,`${path} leaks Android framework into neutral models`);
const dataBuild=readFileSync(join(root,"core/data/build.gradle.kts"),"utf8");
assert.doesNotMatch(dataBuild,/project\(":(?:devices|core:designsystem)"\)/u,"core:data must not depend on UI or device implementations");
const devicesBuild=readFileSync(join(root,"devices/build.gradle.kts"),"utf8");
assert.doesNotMatch(devicesBuild,/project\(":core:(?:data|designsystem)"\)/u,"devices must depend only on model and capture ports");
for(const [path,text] of sources(join(root,"app/src")))assert.doesNotMatch(text,/@(?:Entity|Dao|Database)\b/u,`${path} contains a Room entity outside core:data`);
console.log("Android five-module dependency boundaries are valid.");
