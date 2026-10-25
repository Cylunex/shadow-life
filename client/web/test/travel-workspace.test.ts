import assert from "node:assert/strict";
import test from "node:test";
import { nextTravelStop, placePlot, type TravelRun } from "../src/travel-workspace.js";

test("in-transit view stays on its immutable run snapshot",()=>{const run:TravelRun={id:"trip_run_demo",trip_id:"trip_demo",plan_version_id:"trip_plan_demo",state:"active",plan_snapshot:{days:[{plan_date:"2026-10-01",items:[{stop_id:"trip_stop_a",title:"车站"},{stop_id:"trip_stop_b",title:"西湖"}]}]},outcomes:[{stop_id:"trip_stop_a",state:"arrived",revision:1}]};assert.equal(nextTravelStop(run)?.stop_id,"trip_stop_b");run.outcomes.push({stop_id:"trip_stop_b",state:"skipped",revision:1});assert.equal(nextTravelStop(run),null);});
test("relative map plots only places with valid coordinates",()=>{const points=placePlot([{id:"place_a",name:"A",address:null,latitude:"30",longitude:"120",favorite:true,tags:[],revision:1},{id:"place_b",name:"B",address:null,latitude:null,longitude:null,favorite:false,tags:[],revision:1},{id:"place_c",name:"C",address:null,latitude:"31",longitude:"121",favorite:false,tags:[],revision:1}]);assert.equal(points.length,2);assert.deepEqual(points.map(point=>[point.name,point.x,point.y]),[["A",8,92],["C",92,8]]);});

test("daily navigation includes empty days and keeps saved plans outside revised trip dates reachable",async()=>{
  const {itineraryDates,selectedItineraryDate}=await import("../src/travel-workspace.js");
  const dates=itineraryDates({starts_on:"2026-10-01",ends_on:"2026-10-03"},[{id:"day",trip_id:"trip",plan_date:"2026-10-05",items:[],revision:1}]);
  assert.deepEqual(dates,["2026-10-01","2026-10-02","2026-10-03","2026-10-05"]);
  assert.equal(selectedItineraryDate(dates,undefined,"2026-10-02"),"2026-10-02");
  assert.equal(selectedItineraryDate(dates,"2026-10-03","2026-10-02"),"2026-10-03");
  assert.equal(selectedItineraryDate(dates,"2025-01-01","2025-01-02"),"2026-10-01");
});
test("a day map follows itinerary order without leaking the other days or fabricating missing coordinates",async()=>{
  const {placesForDay,hasPlaceCoordinates}=await import("../src/travel-workspace.js");
  const place={id:"place_a",name:"A",address:null,latitude:"0",longitude:"0",favorite:false,tags:[],revision:1};
  assert.equal(hasPlaceCoordinates(place),true);
  for(const latitude of [null,"","NaN","91"]){assert.equal(hasPlaceCoordinates({...place,latitude}),false);}
  const other={...place,id:"place_b"};
  assert.deepEqual(placesForDay([place,other],{id:"day",trip_id:"trip",plan_date:"2026-10-01",revision:1,items:[{stop_id:"b",title:"B",place_id:"place_b"},{stop_id:"a",title:"A",place_id:"place_a"},{stop_id:"b2",title:"B2",place_id:"place_b"}]}).map(item=>item.id),["place_b","place_a"]);
  assert.deepEqual(placesForDay([place],undefined),[]);
  assert.deepEqual(placePlot([place]).map(({x,y})=>[x,y]),[[50,50]]);
});
test("day map numbers repeated places and breaks lines at unlocated stops",async()=>{
  const {routeForDay}=await import("../src/travel-workspace.js");
  const located=(id:string,longitude:string)=>({id,name:id,address:null,latitude:"30",longitude,favorite:false,tags:[],revision:1});
  const places=[located("a","120"),located("b","121"),located("c","122"),{...located("unknown","123"),latitude:null}];
  const plan={id:"day",trip_id:"trip",plan_date:"2026-10-01",revision:1,items:[{stop_id:"1",title:"A",place_id:"a"},{stop_id:"2",title:"B",place_id:"b"},{stop_id:"3",title:"Missing",place_id:"unknown"},{stop_id:"4",title:"C",place_id:"c"},{stop_id:"5",title:"A again",place_id:"a"}]};
  const result=routeForDay(places,plan);
  assert.deepEqual(result.lines,[[{latitude:30,longitude:120},{latitude:30,longitude:121}],[{latitude:30,longitude:122},{latitude:30,longitude:120}]]);
  assert.deepEqual(result.stopNumbers.get("a"),[1,5]);
  assert.equal(result.stopNumbers.has("unknown"),false);
  assert.deepEqual(routeForDay(places,undefined).lines,[]);
});
test("trip map includes only its planned places and optional stops never connect routes",async()=>{
  const {placesForTrip,routeForDay,googleDirectionsUrl}=await import("../src/travel-workspace.js");
  const place=(id:string,longitude:string)=>({id,name:id,address:null,latitude:"13",longitude,favorite:false,tags:[],revision:1});
  const places=[place("hotel","100"),place("market","101"),place("option","102"),place("other-trip","103")];
  const plan={id:"day",trip_id:"thailand",plan_date:"2026-09-25",revision:1,items:[{stop_id:"a",title:"酒店",place_id:"hotel"},{stop_id:"meal",title:"早餐休息"},{stop_id:"b",title:"夜市",place_id:"market"},{stop_id:"c",title:"弹性备选",place_id:"option"},{stop_id:"d",title:"返回酒店",place_id:"hotel"}]};
  assert.deepEqual(placesForTrip(places,[plan]).map(item=>item.id),["hotel","market","option"]);
  const route=routeForDay(places,plan);assert.deepEqual(route.lines,[[{latitude:13,longitude:100},{latitude:13,longitude:101}]]);assert.deepEqual(route.stopNumbers.get("option"),[4]);
  assert.equal(googleDirectionsUrl(route.lines[0]![0]!,route.lines[0]![1]!).startsWith("https://www.google.com/maps/dir/?api=1&origin=13%2C100&destination=13%2C101"),true);
});
