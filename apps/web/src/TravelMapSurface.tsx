import {useEffect,useRef,useState} from "react";
import {isAMapConfigured,loadAMap} from "./amap-runtime.js";
import {sampleTrack,wgs84ToGcj02} from "./travel-coordinates.js";
import {hasPlaceCoordinates,placePlot,type TravelPlace,type TravelWorkspace} from "./travel-workspace.js";

type TravelTrack=TravelWorkspace["tracks"][number];

export function TravelMapSurface({places,tracks}:{places:readonly TravelPlace[];tracks:readonly TravelTrack[]}){
  const containerRef=useRef<HTMLDivElement>(null),mapRef=useRef<AMap.Map|null>(null),apiRef=useRef<typeof AMap|null>(null),overlaysRef=useRef<Array<AMap.Marker|AMap.Polyline>>([]);
  const[status,setStatus]=useState<"loading"|"ready"|"error">(isAMapConfigured()?"loading":"error"),[message,setMessage]=useState(isAMapConfigured()?"正在加载高德地图…":"地图暂不可用");
  const fallback=placePlot(places);
  useEffect(()=>{
    let disposed=false,map:AMap.Map|undefined;
    loadAMap().then(api=>{
      if(disposed||!containerRef.current)return;
      map=new api.Map(containerRef.current,{viewMode:"2D",zoom:places.length?11:4,center:initialCenter(places),mapStyle:"amap://styles/normal",showLabel:true,pitch:0});
      apiRef.current=api;mapRef.current=map;setStatus("ready");
    }).catch(caught=>{if(!disposed){setMessage("地图暂时无法连接");setStatus("error");}});
    return()=>{disposed=true;map?.destroy();mapRef.current=null;apiRef.current=null;};
  },[]);
  useEffect(()=>{
    if(!containerRef.current)return;
    const observer=new ResizeObserver(()=>{(mapRef.current as (AMap.Map&{resize?:()=>void})|undefined)?.resize?.();});
    observer.observe(containerRef.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const map=mapRef.current,api=apiRef.current;if(!map||!api||status!=="ready")return;
    if(overlaysRef.current.length)map.remove(overlaysRef.current);
    const markers=locatedPlaces(places).map(place=>{
      const point=wgs84ToGcj02(place);
      const content=document.createElement("button");content.type="button";content.className="life-map-marker";content.title=place.address??place.name;content.textContent=place.favorite?`★ ${place.name}`:place.name;
      return new api.Marker({position:[point.longitude,point.latitude],anchor:"bottom-center",content,title:place.name});
    });
    const lines=tracks.flatMap(track=>{
      const points=sampleTrack(track.points.filter(validPoint)).map(wgs84ToGcj02).map(point=>new api.LngLat(point.longitude,point.latitude));
      return points.length>1?[new api.Polyline({path:points,strokeColor:"#1677d2",strokeWeight:6,strokeOpacity:.82,borderWeight:2,outlineColor:"#ffffff",lineJoin:"round",lineCap:"round",showDir:true,zIndex:80})]:[];
    });
    const overlays:Array<AMap.Marker|AMap.Polyline>=[...markers,...lines];overlaysRef.current=overlays;
    if(overlays.length){map.add(overlays);map.setFitView(overlays,false,[48,48,48,48],15);}
  },[places,status,tracks]);
  return <div className="travel-map-shell">
    <div ref={containerRef} className="life-amap-container" aria-label="高德旅行地图"/>
    {status!=="ready"&&<div className={`life-map-state ${status}`}><b>{status==="loading"?"地图加载中":message}</b><span>{status==="error"?"仍可浏览日程和已保存地点。":"正在加载当天地图。"}</span>{status==="error"&&<button type="button" onClick={()=>location.reload()}>重新加载</button>}</div>}
    {status==="error"&&fallback.length>0&&<div className="coordinate-map map-fallback" aria-label="地图加载失败时的地点坐标预览">{fallback.map(point=><span key={point.id} style={{left:`${point.x}%`,top:`${point.y}%`}} title={point.address??point.name}><i/>{point.name}</span>)}</div>}
    <span className="life-map-badge">{status==="ready"?"高德地图":"地点预览"}</span>
  </div>;
}

function locatedPlaces(places:readonly TravelPlace[]){return places.filter(hasPlaceCoordinates).flatMap(place=>{const latitude=Number(place.latitude),longitude=Number(place.longitude);return validPoint({latitude,longitude})?[{...place,latitude,longitude}]:[];});}
function validPoint(point:{latitude:number;longitude:number}){return Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180;}
function initialCenter(places:readonly TravelPlace[]):[number,number]{const located=locatedPlaces(places).map(wgs84ToGcj02);if(!located.length)return[104.1954,35.8617];const total=located.reduce((value,place)=>({latitude:value.latitude+place.latitude,longitude:value.longitude+place.longitude}),{latitude:0,longitude:0});return[total.longitude/located.length,total.latitude/located.length];}
