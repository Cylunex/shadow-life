import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "vite";

type AMapBuildConfig={key:string;securityJsCode:string}|null;

function amapConfig(propertiesFile:string|undefined):AMapBuildConfig{
  if(!propertiesFile?.trim())return null;
  let content:string;
  try{content=readFileSync(resolve(propertiesFile),"utf8");}catch{throw new Error("AMAP_PROPERTIES_FILE cannot be read");}
  const properties=new Map<string,string>();
  for(const rawLine of content.split(/\r?\n/)){
    const line=rawLine.trim();if(!line||line.startsWith("#")||line.startsWith("!"))continue;
    const separator=line.search(/[:=]/);if(separator<1)continue;
    properties.set(line.slice(0,separator).trim().toLowerCase(),line.slice(separator+1).trim());
  }
  const key=properties.get("js_api_key")??properties.get("key")??"";
  const securityJsCode=properties.get("js_api_jscode")??properties.get("jscode")??properties.get("securityjscode")??"";
  if(!key||!securityJsCode)throw new Error("AMap properties must contain a JS API key and jscode");
  return{key,securityJsCode};
}

export default defineConfig(({mode})=>{
  const environment=loadEnv(mode,process.cwd(),"");
  return{define:{__SHADOW_AMAP_CONFIG__:JSON.stringify(amapConfig(environment.AMAP_PROPERTIES_FILE)),__SHADOW_GOOGLE_MAPS_KEY__:JSON.stringify(environment.GOOGLE_MAPS_WEB_API_KEY??"")},plugins:[react()],server:{proxy:{"/api":"http://127.0.0.1:8787"}}};
});
