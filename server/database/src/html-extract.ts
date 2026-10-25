import { Worker } from "node:worker_threads";

export const htmlProcessorName="builtin-html-v1";
export interface HtmlExtraction { text:string;title:string;sourceUrl?:string;warnings:string[]; }

// The parser has no browser, network loader or JS evaluation. Its entire synchronous
// workload lives in a disposable worker so timeout means termination, not Promise.race.
export async function extractHtml(bytes:Buffer,options:{timeoutMs?:number}={}):Promise<HtmlExtraction>{
  if(bytes.length>10*1024*1024)throw new Error("HTML 超过 10 MiB 处理上限；原件仍可下载。");
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./html-extract-worker.mjs",import.meta.url),{workerData:bytes,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    let settled=false;
    const finish=(error?:Error,result?:HtmlExtraction)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate().then(()=>error?reject(error):resolve(result!));};
    const timer=setTimeout(()=>finish(new Error("HTML 处理超时（5 秒上限）；原件仍可下载。")),options.timeoutMs??5000);
    worker.once("message",(message:{result?:HtmlExtraction;error?:string})=>finish(message.error?new Error(message.error):undefined,message.result));
    worker.once("error",()=>finish(new Error("HTML 解析超过资源限制或无法完成；原件仍可下载。")));
    worker.once("exit",()=>{if(!settled)finish(new Error("HTML 处理器未返回正文；原件仍可下载。"));});
  });
}
