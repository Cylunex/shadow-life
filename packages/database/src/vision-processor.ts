import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libraryVisionCandidateSchema } from "@shadow/contracts";

export const visionProcessorName="configured-vision-v1";
export type VisionCandidate={title:string;document_date:string|null;category:string|null;summary:string;content:string;locators:Array<{page:number;quote:string|null}>};
export interface VisionProcessor{readonly available:boolean;readonly reason:string|null;process(bytes:Buffer,mediaType:string):Promise<{candidate:VisionCandidate;processorVersion:string}>;}
type VisionPage={page:number;media_type:string;data_base64:string};
const images=new Set(["image/png","image/jpeg","image/tiff","image/webp"]);

function endpoint(env:NodeJS.ProcessEnv):URL|null{
  if(!env.SHADOW_LIBRARY_VISION_URL)return null;
  try{const url=new URL(env.SHADOW_LIBRARY_VISION_URL);if(url.protocol==="https:"||(url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))return url;}catch{}
  return null;
}
export function visionAvailability(env:NodeJS.ProcessEnv=process.env):{available:boolean;reason:string|null;processor:string}{
  const url=endpoint(env);
  return{available:Boolean(url),reason:url?null:env.SHADOW_LIBRARY_VISION_URL?"视觉处理端点必须使用 HTTPS 或本机 HTTP":"视觉模型未配置（SHADOW_LIBRARY_VISION_URL）",processor:visionProcessorName};
}

async function command(binary:string,args:string[],timeoutMs:number):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{stdio:["ignore","pipe","pipe"]});let output="",error="",settled=false;
    const timer=setTimeout(()=>{child.kill("SIGKILL");if(!settled){settled=true;reject(new Error("PDF page rendering timed out"));}},timeoutMs);
    child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
    child.stdout.on("data",value=>{output+=String(value);if(output.length>100_000)child.kill("SIGKILL");});
    child.stderr.on("data",value=>{error+=String(value);if(error.length>2_000)error=error.slice(-2_000);});
    child.on("error",failure=>{clearTimeout(timer);if(!settled){settled=true;reject(failure);}});
    child.on("close",code=>{clearTimeout(timer);if(settled)return;settled=true;code===0?resolve(output):reject(new Error(`PDF page rendering failed (${code}): ${error.slice(-200)}`));});
  });
}

export async function visionPages(bytes:Buffer,mediaType:string,env:NodeJS.ProcessEnv=process.env):Promise<VisionPage[]>{
  if(bytes.length>10_000_000)throw new Error("vision original exceeds 10 MB");
  if(images.has(mediaType))return[{page:1,media_type:mediaType,data_base64:bytes.toString("base64")}];
  if(mediaType!=="application/pdf")throw new Error(`vision does not support ${mediaType}`);
  const directory=await mkdtemp(join(tmpdir(),"shadow-life-vision-"));
  try{
    const original=join(directory,"original.pdf");await writeFile(original,bytes,{mode:0o600});
    const info=await command(env.SHADOW_LIBRARY_PDFINFO_BIN||"pdfinfo",[original],10_000);
    const count=Number(/^Pages:\s*(\d+)\s*$/mu.exec(info)?.[1]);
    if(!Number.isInteger(count)||count<1||count>8)throw new Error("PDF must have 1 to 8 pages for vision processing");
    await command(env.SHADOW_LIBRARY_PDFTOPPM_BIN||"pdftoppm",["-f","1","-l",String(count),"-scale-to","1600","-png",original,join(directory,"page")],60_000);
    const names=(await readdir(directory)).filter(name=>/^page-\d+\.png$/u.test(name)).sort((a,b)=>Number(a.match(/\d+/u)![0])-Number(b.match(/\d+/u)![0]));
    if(names.length!==count)throw new Error("PDF rendering did not produce every page");
    const pages:VisionPage[]=[];let total=0;
    for(const [index,name] of names.entries()){const image=await readFile(join(directory,name));total+=image.length;if(image.length>4_000_000||total>16_000_000)throw new Error("rendered PDF pages exceed the vision input limit");pages.push({page:index+1,media_type:"image/png",data_base64:image.toString("base64")});}
    return pages;
  }finally{await rm(directory,{recursive:true,force:true});}
}

export function configuredVisionProcessor(env:NodeJS.ProcessEnv=process.env):VisionProcessor{
  const url=endpoint(env),status=visionAvailability(env);
  return{available:status.available,reason:status.reason,async process(bytes,mediaType){
    if(!url)throw new Error(status.reason??"vision processor unavailable");
    const pages=await visionPages(bytes,mediaType,env);
    const response=await fetch(url,{method:"POST",signal:AbortSignal.timeout(90_000),headers:{"content-type":"application/json",accept:"application/json",...(env.SHADOW_LIBRARY_VISION_TOKEN?{authorization:`Bearer ${env.SHADOW_LIBRARY_VISION_TOKEN}`}:{})},body:JSON.stringify({protocol:"shadow.library.vision.request",model:env.SHADOW_LIBRARY_VISION_MODEL||null,instruction:"Return only evidence-grounded candidate fields. Unknown date/category must be null. Do not claim a visit, payment, or other event occurred.",pages})});
    if(!response.ok)throw new Error(`vision processor returned HTTP ${response.status}`);
    const raw=await response.text();if(raw.length>100_000)throw new Error("vision response exceeds 100 KB");
    const wire=JSON.parse(raw) as Record<string,unknown>;
    if(wire.protocol!=="shadow.library.vision.response")throw new Error("invalid vision response protocol");
    const candidate=libraryVisionCandidateSchema.parse(wire.candidate);
    if(candidate.locators.some(locator=>locator.page>pages.length))throw new Error("vision candidate references a page outside the original");
    const processorVersion=String(wire.processor_version??"");if(!processorVersion||processorVersion.length>100)throw new Error("invalid vision processor version");
    return{candidate,processorVersion};
  }};
}
