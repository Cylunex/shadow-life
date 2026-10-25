import { hasPlaceCoordinates, type TravelPlace } from "./travel-workspace.js";

export interface DraftTravelStop { stop_id?:string; title:string; starts_at:string; place_id:string; note:string }

export function stopFromPlace(place:TravelPlace):DraftTravelStop {
  return {title:place.name,starts_at:"",place_id:place.id,note:""};
}

/** Suggest a geometric order only within free, located blocks. Fixed stops keep their slots. */
export function nearbyDraftOrder(stops:readonly DraftTravelStop[],places:readonly TravelPlace[],fixedStopIds:ReadonlySet<string>=new Set(),fixedPlaceIds:ReadonlySet<string>=new Set()):DraftTravelStop[] {
  const byId=new Map(places.map(place=>[place.id,place]));
  const point=(stop:DraftTravelStop)=>{const place=byId.get(stop.place_id);return place&&hasPlaceCoordinates(place)?{latitude:Number(place.latitude),longitude:Number(place.longitude)}:undefined;};
  const movable=(stop:DraftTravelStop)=>!stop.starts_at&&!fixedStopIds.has(stop.stop_id??"")&&!fixedPlaceIds.has(stop.place_id)&&point(stop)!==undefined;
  const result=[...stops];
  for(let start=0;start<result.length;){
    if(!movable(result[start]!)){start++;continue;}
    let end=start+1;while(end<result.length&&movable(result[end]!))end++;
    const preceding=start>0?point(result[start-1]!):undefined;
    const ordered=preceding?[] as DraftTravelStop[]:[result[start]!];
    const remaining=preceding?result.slice(start,end):result.slice(start+1,end);
    let current=preceding??point(result[start]!)!;
    while(remaining.length){
      let best=0;
      for(let index=1;index<remaining.length;index++)if(distance(current,point(remaining[index]!)!)<distance(current,point(remaining[best]!)!))best=index;
      const next=remaining.splice(best,1)[0]!;ordered.push(next);current=point(next)!;
    }
    result.splice(start,end-start,...ordered);start=end;
  }
  return result;
}

function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}):number {
  const radians=Math.PI/180,average=(a.latitude+b.latitude)*radians/2;
  const north=(a.latitude-b.latitude)*radians,east=(a.longitude-b.longitude)*radians*Math.cos(average);
  return north*north+east*east;
}
