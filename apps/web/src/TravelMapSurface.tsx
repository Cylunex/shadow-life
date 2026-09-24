import {useEffect,useRef,useState} from "react";
import {isGoogleMapsConfigured,loadGoogleMaps} from "./google-maps-runtime.js";
import {sampleTrack} from "./travel-coordinates.js";
import {hasPlaceCoordinates,placePlot,routeForDay,type TravelDayPlan,type TravelPlace,type TravelWorkspace} from "./travel-workspace.js";

type TravelTrack=TravelWorkspace["tracks"][number];
type Overlay=google.maps.Marker|google.maps.Polyline;

export function TravelMapSurface({places,tracks,dayPlan,allPlans}:{places:readonly TravelPlace[];tracks:readonly TravelTrack[];dayPlan?:TravelDayPlan|undefined;allPlans?:readonly TravelDayPlan[]|undefined}){
  const containerRef=useRef<HTMLDivElement>(null),mapRef=useRef<google.maps.Map|null>(null),overlaysRef=useRef<Overlay[]>([]),boundsRef=useRef<google.maps.LatLngBounds|null>(null),fitInputRef=useRef<{places:readonly TravelPlace[];tracks:readonly TravelTrack[];dayPlan?:TravelDayPlan|undefined;allPlans?:readonly TravelDayPlan[]|undefined}|null>(null);
  const[status,setStatus]=useState<"loading"|"ready"|"error">(isGoogleMapsConfigured()?"loading":"error"),[message,setMessage]=useState(isGoogleMapsConfigured()?"正在加载 Google 地图…":"Google 地图尚未配置");
  const[satellite,setSatellite]=useState(false),[showMarkers,setShowMarkers]=useState(true),[showRoutes,setShowRoutes]=useState(true);
  const fallback=placePlot(places),dayRoute=routeForDay(places,dayPlan);
  useEffect(()=>{
    let disposed=false;
    loadGoogleMaps().then(()=>{
      if(disposed||!containerRef.current)return;
      mapRef.current=new google.maps.Map(containerRef.current,{center:initialCenter(places),zoom:places.length?13:4,mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:"greedy"});
      setStatus("ready");
    }).catch(()=>{if(!disposed){setMessage("Google 地图暂时无法连接");setStatus("error");}});
    return()=>{disposed=true;overlaysRef.current.forEach(overlay=>overlay.setMap(null));overlaysRef.current=[];mapRef.current=null;};
  },[]);
  useEffect(()=>{
    const map=mapRef.current;if(!map||status!=="ready")return;
    overlaysRef.current.forEach(overlay=>overlay.setMap(null));
    const labels=new Map<string,string[]>();
    if(dayPlan)for(const[id,numbers]of dayRoute.stopNumbers)labels.set(id,numbers.map(String));
    if(allPlans)allPlans.forEach((plan,dayIndex)=>{for(const[id,numbers]of routeForDay(places,plan).stopNumbers)labels.set(id,[...(labels.get(id)??[]),...numbers.map(number=>`${dayIndex+1}-${number}`)]);});
    map.setMapTypeId(satellite?google.maps.MapTypeId.SATELLITE:google.maps.MapTypeId.ROADMAP);
    const markers=showMarkers?locatedPlaces(places).map(place=>{const label=labels.get(place.id)?.join("/").slice(0,8);return new google.maps.Marker({map,position:{lat:place.latitude,lng:place.longitude},title:`${labels.get(place.id)?.join("、")??""} ${place.name}${place.address?` · ${place.address}`:""}`.trim(),...(label?{label}:{})});}):[];
    const lines=tracks.flatMap(track=>{const points=sampleTrack(track.points.filter(validPoint));return points.length>1?[new google.maps.Polyline({map,path:points.map(point=>({lat:point.latitude,lng:point.longitude})),strokeColor:"#1677d2",strokeWeight:5,strokeOpacity:.82})]:[];});
    const routeLines=showRoutes?dayRoute.lines.map(line=>new google.maps.Polyline({map,path:line.map(point=>({lat:point.latitude,lng:point.longitude})),strokeColor:"#e68c3f",strokeWeight:4,strokeOpacity:.9,icons:[{icon:{path:"M 0,-1 0,1",strokeOpacity:1,scale:3},offset:"0",repeat:"18px"}]})):[];
    overlaysRef.current=[...markers,...lines,...routeLines];
    const bounds=new google.maps.LatLngBounds();for(const place of locatedPlaces(places))bounds.extend({lat:place.latitude,lng:place.longitude});for(const track of tracks)for(const point of sampleTrack(track.points.filter(validPoint)))bounds.extend({lat:point.latitude,lng:point.longitude});
    boundsRef.current=bounds.isEmpty()?null:bounds;
    const prior=fitInputRef.current,shouldFit=!prior||prior.places!==places||prior.tracks!==tracks||prior.dayPlan!==dayPlan||prior.allPlans!==allPlans;
    fitInputRef.current={places,tracks,dayPlan,allPlans};
    if(shouldFit&&!bounds.isEmpty()){if(bounds.getNorthEast().equals(bounds.getSouthWest())){map.setCenter(bounds.getCenter());map.setZoom(15);}else{map.fitBounds(bounds,48);google.maps.event.addListenerOnce(map,"idle",()=>{if((map.getZoom()??0)>15)map.setZoom(15);});}}
  },[places,tracks,dayPlan,allPlans,status,satellite,showMarkers,showRoutes]);
  return <div className="travel-map-shell">
    <div ref={containerRef} className="life-amap-container" aria-label="Google 旅行地图"/>
    {status==="ready"&&<div className="life-map-controls"><button type="button" onClick={()=>setSatellite(value=>!value)} aria-pressed={satellite}>{satellite?"标准":"卫星"}</button><button type="button" onClick={()=>{const map=mapRef.current,bounds=boundsRef.current;if(map&&bounds)map.fitBounds(bounds,48);}} disabled={!boundsRef.current}>聚焦</button><button type="button" onClick={()=>setShowMarkers(value=>!value)} aria-pressed={showMarkers}>标记{showMarkers?"开":"关"}</button><button type="button" onClick={()=>setShowRoutes(value=>!value)} aria-pressed={showRoutes}>路线{showRoutes?"开":"关"}</button></div>}
    {status!=="ready"&&<div className={`life-map-state ${status}`}><b>{status==="loading"?"地图加载中":message}</b><span>{status==="error"?"仍可浏览日程和已保存地点。":"正在加载旅行地图。"}</span>{status==="error"&&isGoogleMapsConfigured()&&<button type="button" onClick={()=>location.reload()}>重新加载</button>}</div>}
    {status==="error"&&fallback.length>0&&<div className="coordinate-map map-fallback" aria-label="地图不可用时的地点坐标预览">{fallback.map(point=><span key={point.id} style={{left:`${point.x}%`,top:`${point.y}%`}} title={point.address??point.name}><i/>{dayRoute.stopNumbers.get(point.id)?.join("/")??""} {point.name}</span>)}</div>}
    <span className="life-map-badge">{status==="ready"?"Google 地图":"地点预览"}</span>
  </div>;
}

function locatedPlaces(places:readonly TravelPlace[]){return places.filter(hasPlaceCoordinates).map(place=>({...place,latitude:Number(place.latitude),longitude:Number(place.longitude)}));}
function validPoint(point:{latitude:number;longitude:number}){return Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180;}
function initialCenter(places:readonly TravelPlace[]):google.maps.LatLngLiteral{const located=locatedPlaces(places);if(!located.length)return{lat:13.75,lng:100.5};const total=located.reduce((value,place)=>({lat:value.lat+place.latitude,lng:value.lng+place.longitude}),{lat:0,lng:0});return{lat:total.lat/located.length,lng:total.lng/located.length};}
