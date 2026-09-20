export interface MapCoordinate{latitude:number;longitude:number;}

const earthRadius=6_378_245,ellipsoidEccentricity=0.00669342162296594323;

/**
 * Life stores portable GPS/GPX coordinates as WGS-84. AMap tiles use GCJ-02
 * inside mainland China, so presentation converts a copy without rewriting facts.
 */
export function wgs84ToGcj02(point:MapCoordinate):MapCoordinate{
  if(outsideMainlandChina(point))return point;
  let latitudeOffset=transformLatitude(point.longitude-105,point.latitude-35),longitudeOffset=transformLongitude(point.longitude-105,point.latitude-35);
  const radians=point.latitude/180*Math.PI,sine=Math.sin(radians),magic=1-ellipsoidEccentricity*sine*sine,squareRoot=Math.sqrt(magic);
  latitudeOffset=latitudeOffset*180/((earthRadius*(1-ellipsoidEccentricity))/(magic*squareRoot)*Math.PI);
  longitudeOffset=longitudeOffset*180/(earthRadius/squareRoot*Math.cos(radians)*Math.PI);
  return{latitude:point.latitude+latitudeOffset,longitude:point.longitude+longitudeOffset};
}

export function sampleTrack<T>(points:readonly T[],maximum=1_200):T[]{
  if(points.length<=maximum)return[...points];
  const step=(points.length-1)/(maximum-1);
  return Array.from({length:maximum},(_,index)=>points[Math.min(points.length-1,Math.round(index*step))]!);
}

function outsideMainlandChina(point:MapCoordinate):boolean{return point.longitude<72.004||point.longitude>137.8347||point.latitude<0.8293||point.latitude>55.8271;}
function transformLatitude(x:number,y:number){let value=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));value+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;value+=(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;value+=(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;return value;}
function transformLongitude(x:number,y:number){let value=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));value+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;value+=(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;value+=(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;return value;}
