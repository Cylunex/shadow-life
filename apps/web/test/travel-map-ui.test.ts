import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TravelItinerary} from "../src/TravelItinerary.js";
import {TravelMapItinerary} from "../src/TravelMapItinerary.js";
import {itineraryDates,placesForDay,routeForDay,tripDayPlans,type TravelDayPlan,type TravelPlace} from "../src/travel-workspace.js";

test("seven travel date tabs keep two trip versions and their map stops separate",()=>{
  const place=(id:string):TravelPlace=>({id,name:id,address:null,latitude:"13",longitude:id==="original"?"100":"101",favorite:false,tags:[],revision:1});
  const places=[place("original"),place("optimized")];
  const plans:TravelDayPlan[]=[
    {id:"original-day",trip_id:"original-trip",plan_date:"2026-09-25",revision:1,items:[{stop_id:"original-stop",title:"原版停留点",place_id:"original"}]},
    {id:"optimized-day",trip_id:"optimized-trip",plan_date:"2026-09-25",revision:1,items:[{stop_id:"optimized-stop",title:"优化版停留点",place_id:"optimized"}]},
    {id:"optimized-last",trip_id:"optimized-trip",plan_date:"2026-10-01",revision:1,items:[{stop_id:"last-stop",title:"末日停留点",place_id:"optimized"}]},
  ];
  const trip={starts_on:"2026-09-25",ends_on:"2026-10-01",time_zone:"Asia/Bangkok"};
  const original=tripDayPlans(plans,"original-trip"),optimized=tripDayPlans(plans,"optimized-trip");
  assert.equal(itineraryDates(trip,original).length,7);
  assert.equal(itineraryDates(trip,optimized).length,7);
  assert.deepEqual(placesForDay(places,original[0]).map(item=>item.id),["original"]);
  assert.deepEqual(routeForDay(places,original[0]).stopNumbers.get("original"),[1]);
  const day=renderToStaticMarkup(React.createElement(TravelItinerary,{trip,plans:original,places,date:"2026-09-25",onDate:()=>{}}));
  assert.equal((day.match(/<option/g)??[]).length,7);
  assert.match(day,/原版停留点/);
  assert.doesNotMatch(day,/优化版停留点/);
  const mapDay=renderToStaticMarkup(React.createElement(TravelMapItinerary,{places,plans:original,selectedDate:"2026-09-25",scope:"day"}));
  assert.match(mapDay,/原版停留点/);
  assert.doesNotMatch(mapDay,/优化版停留点/);
  const mapAll=renderToStaticMarkup(React.createElement(TravelMapItinerary,{places,plans:optimized,selectedDate:"2026-09-25",scope:"all"}));
  assert.match(mapAll,/优化版停留点/);
  assert.match(mapAll,/末日停留点/);
  assert.doesNotMatch(mapAll,/原版停留点/);
});
