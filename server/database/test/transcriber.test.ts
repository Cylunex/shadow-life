import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredTranscriber } from "../src/recording-worker.js";
test("Whisper-compatible adapter sends bounded audio and preserves validated segment timestamps",async t=>{
 let observed="";let invalid=false;const server=createServer(async(req,res)=>{for await(const data of req)observed+=data;assert.equal(req.headers.authorization,"Bearer synthetic-test-token");res.setHeader("content-type","application/json");res.end(JSON.stringify({segments:[{start:0.1,end:invalid?5:0.9,text:"合成转写"}]}));});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const folder=await mkdtemp(join(tmpdir(),"life-transcriber-test-"));t.after(()=>rm(folder,{recursive:true,force:true}));const path=join(folder,"processor.json"),token=join(folder,"token.txt");await writeFile(token,"synthetic-test-token",{mode:0o600});const address=server.address() as {port:number};await writeFile(path,JSON.stringify({url:`http://127.0.0.1:${address.port}/transcribe`,model:"synthetic-model",token_file:token}));
 const processor=configuredTranscriber(path);assert.equal(processor.available,true);assert.deepEqual((await processor.process(Buffer.from("synthetic-wave"),"audio/wav",1000)).spans,[{start_ms:100,end_ms:900,text:"合成转写",speaker:null}]);assert.match(observed,/segment\.wav/);assert.match(observed,/verbose_json/);
 invalid=true;await assert.rejects(()=>processor.process(Buffer.from("synthetic-wave"),"audio/wav",1000),/时间戳/);assert.equal(configuredTranscriber(join(folder,"missing.json")).available,false);
 await writeFile(path,JSON.stringify({url:"http://processor.example.com/transcribe",model:"synthetic"}));assert.equal(configuredTranscriber(path).available,false);
});
