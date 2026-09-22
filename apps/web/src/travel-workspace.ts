export interface TravelPlace {id:string;name:string;address:string|null;latitude:string|null;longitude:string|null;favorite:boolean;tags:string[];revision:number;}
export interface TravelMapItem {place_id:string;position:number;status:"candidate"|"anchor"|"planned"|"visited";note:string|null;}
export interface TravelMap {id:string;title:string;description:string|null;state:"active"|"archived";revision:number;items:TravelMapItem[];}
export interface TravelTrip {id:string;title:string;starts_on:string;ends_on:string;time_zone:string;revision:number;is_owner:boolean;role:string;visibility:string;latest_plan_version_id:string|null;}
export interface TravelStop {stop_id:string;title:string;starts_at?:string;place_id?:string;note?:string;plan_date:string;}
export interface TravelRun {id:string;trip_id:string;plan_version_id:string;state:string;plan_snapshot:{days:Array<{plan_date:string;items:Array<Omit<TravelStop,"plan_date">>}>};outcomes:Array<{stop_id:string;state:"arrived"|"skipped";revision:number}>;}
export interface TravelDayPlan {id:string;trip_id:string;plan_date:string;items:Array<Omit<TravelStop,"plan_date">>;revision:number;}
export interface TravelSegment {id:string;trip_id:string;mode:string;origin:string;destination:string;starts_at:string|null;ends_at:string|null;distance_km:string|null;note:string|null;visibility:"shared"|"private";revision:number;}
export interface TravelWorkspace {places:TravelPlace[];maps:TravelMap[];trips:TravelTrip[];selected_trip_id:string|null;active_run:TravelRun|null;tracks:Array<{id:string;name:string;points:Array<{latitude:number;longitude:number}>;original_sha256:string}>;day_plans:TravelDayPlan[];segments:TravelSegment[];as_of:string;}

export function nextTravelStop(run:TravelRun|null):TravelStop|null{if(!run)return null;const completed=new Set(run.outcomes.map(item=>item.stop_id)),stops=run.plan_snapshot.days.flatMap(day=>day.items.map(item=>({...item,plan_date:day.plan_date})));return stops.find(stop=>!completed.has(stop.stop_id))??null;}

export function placePlot(places:readonly TravelPlace[]):Array<TravelPlace&{x:number;y:number}>{const located=places.flatMap(place=>{if(!hasPlaceCoordinates(place))return[];const latitude=Number(place.latitude),longitude=Number(place.longitude);return Number.isFinite(latitude)&&Number.isFinite(longitude)?[{place,latitude,longitude}]:[];});if(!located.length)return[];const minLat=Math.min(...located.map(item=>item.latitude)),maxLat=Math.max(...located.map(item=>item.latitude)),minLon=Math.min(...located.map(item=>item.longitude)),maxLon=Math.max(...located.map(item=>item.longitude));return located.map(({place,latitude,longitude})=>({...place,x:maxLon===minLon?50:8+84*(longitude-minLon)/(maxLon-minLon),y:maxLat===minLat?50:92-84*(latitude-minLat)/(maxLat-minLat)}));}

export function itineraryDates(trip:Pick<TravelTrip,"starts_on"|"ends_on">,plans:readonly TravelDayPlan[]):string[]{
  const start=Date.parse(`${trip.starts_on}T00:00:00Z`),end=Date.parse(`${trip.ends_on}T00:00:00Z`);
  const count=Math.min(3660,Math.max(0,Math.round((end-start)/86_400_000)));
  const dates=Number.isFinite(count)?Array.from({length:count+1},(_,index)=>new Date(start+index*86_400_000).toISOString().slice(0,10)):[];
  return [...new Set([...dates,...plans.map(plan=>plan.plan_date)])].sort();
}
export function selectedItineraryDate(dates:readonly string[],selected:string|undefined,today:string):string|undefined{return selected&&dates.includes(selected)?selected:dates.includes(today)?today:dates[0];}
export function placesForDay(places:readonly TravelPlace[],plan:TravelDayPlan|undefined):TravelPlace[]{const byId=new Map(places.map(place=>[place.id,place]));return [...new Set(plan?.items.map(item=>item.place_id).filter(Boolean)??[])].flatMap(id=>{const place=byId.get(id!);return place?[place]:[];});}
export function hasPlaceCoordinates(place:Pick<TravelPlace,"latitude"|"longitude">):boolean{return place.latitude!==null&&place.longitude!==null&&place.latitude.trim()!==""&&place.longitude.trim()!==""&&Number.isFinite(Number(place.latitude))&&Number.isFinite(Number(place.longitude))&&Math.abs(Number(place.latitude))<=90&&Math.abs(Number(place.longitude))<=180;}
