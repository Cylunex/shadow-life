import {load} from "@amap/amap-jsapi-loader";

const plugins=["AMap.ToolBar","AMap.Scale"];
let loaderPromise:Promise<typeof AMap>|undefined;

export function isAMapConfigured():boolean{
  return Boolean(__SHADOW_AMAP_CONFIG__?.key&&__SHADOW_AMAP_CONFIG__?.securityJsCode);
}

export function loadAMap():Promise<typeof AMap>{
  if(!__SHADOW_AMAP_CONFIG__)return Promise.reject(new Error("高德网页地图尚未配置"));
  if(!loaderPromise){
    // 高德 JSAPI 2.0 默认使用 WebGL。部分浏览器/GPU 会先显示一帧再清成黑色；
    // 官方兼容开关可强制使用 2D 栅格底图，网页调试和内嵌浏览器统一采用此路径。
    window.forbidenWebGL=true;
    window._AMapSecurityConfig={securityJsCode:__SHADOW_AMAP_CONFIG__.securityJsCode};
    const loading=load({key:__SHADOW_AMAP_CONFIG__.key,version:"2.0",plugins}) as Promise<typeof AMap>;
    loaderPromise=withTimeout(loading,15_000).catch(error=>{loaderPromise=undefined;throw error;});
  }
  return loaderPromise;
}

function withTimeout<T>(promise:Promise<T>,timeoutMs:number):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error("高德地图加载超时")),timeoutMs);
    promise.then(value=>{window.clearTimeout(timer);resolve(value);},error=>{window.clearTimeout(timer);reject(error);});
  });
}
