import {importLibrary,setOptions} from "@googlemaps/js-api-loader";

let loading:Promise<void>|undefined;
export function isGoogleMapsConfigured():boolean{return Boolean(__SHADOW_GOOGLE_MAPS_KEY__);}
export function loadGoogleMaps():Promise<void>{
  if(!__SHADOW_GOOGLE_MAPS_KEY__)return Promise.reject(new Error("Google 地图网页密钥尚未配置"));
  if(!loading){
    setOptions({key:__SHADOW_GOOGLE_MAPS_KEY__,v:"weekly",language:"zh-CN",authReferrerPolicy:"origin"});
    loading=Promise.all([importLibrary("maps"),importLibrary("marker")]).then(()=>undefined).catch(error=>{loading=undefined;throw error;});
  }
  return loading;
}
