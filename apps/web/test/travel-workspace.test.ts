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
