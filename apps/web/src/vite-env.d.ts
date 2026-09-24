/// <reference types="vite/client" />
/// <reference types="@amap/amap-jsapi-types" />
/// <reference types="google.maps" />

declare const __SHADOW_AMAP_CONFIG__:{key:string;securityJsCode:string}|null;
declare const __SHADOW_GOOGLE_MAPS_KEY__:string;

interface Window{
  _AMapSecurityConfig?:{securityJsCode:string};
  forbidenWebGL?:boolean;
}
