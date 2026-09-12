import { readdirSync,mkdtempSync,rmSync } from "node:fs";
import { homedir,tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { spawnSync } from "node:child_process";
// Uses the local Kotlin/Gradle cache without an Android device, emulator or APK task.
const cache=process.env.KOTLIN_GRADLE_CACHE??join(homedir(),".gradle/caches/modules-2/files-2.1");
function jar(group,name,version){const dir=join(cache,group,name,version);for(const hash of readdirSync(dir)){for(const file of readdirSync(join(dir,hash))){if(file.endsWith(".jar"))return join(dir,hash,file);}}throw Error(`missing ${name} ${version}`);}
const stdlib=jar("org.jetbrains.kotlin","kotlin-stdlib","2.2.21");
const json=jar("org.json","json","20250517"),coroutines=jar("org.jetbrains.kotlinx","kotlinx-coroutines-core-jvm","1.8.0");
const compiler=[jar("org.jetbrains.kotlin","kotlin-compiler-embeddable","2.2.21"),stdlib,jar("org.jetbrains.kotlin","kotlin-reflect","1.6.10"),jar("org.jetbrains.kotlinx","kotlinx-coroutines-core-jvm","1.8.0"),jar("org.jetbrains","annotations","13.0")].join(":");
const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,"bin/java"):"java",dir=mkdtempSync(join(tmpdir(),"life-health-kotlin-")),root=resolve(import.meta.dirname,"..");
function run(args){const result=spawnSync(java,args,{cwd:root,stdio:"inherit"});if(result.status!==0)throw Error(`JVM check exited ${result.status}`);}
const runtime=[dir,stdlib,json,coroutines].join(":");
try{
  run(["-cp",compiler,"org.jetbrains.kotlin.cli.jvm.K2JVMCompiler","-no-stdlib","-no-reflect","-classpath",[stdlib,json,coroutines,jar("org.jetbrains","annotations","13.0")].join(":"),"-d",dir,
    "apps/android/devices/src/main/java/com/shadow/life/HealthSyncPolicy.kt",
    "apps/android/devices/src/main/java/com/shadow/life/HealthBatchCommand.kt",
    "apps/android/devices/src/main/java/com/shadow/life/HealthSyncRound.kt",
    "apps/android/core/model/src/main/java/com/shadow/life/HealthSyncModels.kt",
    "apps/android/tests/HealthSyncPolicyTest.kt","apps/android/tests/HealthSyncRoundTest.kt"]);
  run(["-cp",runtime,"com.shadow.life.HealthSyncPolicyTestKt"]);
  const fixtures=join(dir,"production-commands.json");
  run(["-cp",runtime,"com.shadow.life.HealthSyncRoundTestKt",fixtures]);
  const contracts=spawnSync(process.execPath,["--import","tsx","scripts/verify-health-commands.ts",fixtures],{cwd:root,stdio:"inherit"});
  if(contracts.status!==0)throw Error(`Production command contract check exited ${contracts.status}`);
  const migration=spawnSync("python3",["scripts/test-health-round-migration.py",fixtures],{cwd:root,stdio:"inherit"});
  if(migration.status!==0)throw Error(`Room migration check exited ${migration.status}`);
}finally{rmSync(dir,{recursive:true,force:true});}
