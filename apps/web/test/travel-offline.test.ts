import assert from "node:assert/strict";
import test from "node:test";
import { renderOfflineItinerary } from "../src/travel-offline.js";

test("offline itinerary escapes source text and separates plans from actual visits in trip time zone",()=>{
  const html=renderOfflineItinerary({trip:{title:"上海 <出行>",starts_on:"2026-09-10",ends_on:"2026-09-11",time_zone:"Asia/Shanghai"},day_plans:[{id:"day_1",trip_id:"trip_1",plan_date:"2026-09-11",revision:1,items:[{stop_id:"stop_1",title:"酒店 <script>",starts_at:"2026-09-10T17:00:00Z"}]}],reservations:[{title:"车票",reservation_type:"rail",state:"confirmed",starts_at:"2026-09-10T17:00:00Z",ends_at:null,origin:"A",destination:"B",confirmation_code:null,seat:null}],segments:[],visits:[{place_name:"实际到访点",occurred_on:"2026-09-11",occurred_at:null,time_zone:"Asia/Shanghai"}]},{id:"check_1",trip_id:"trip_1",revision:1,items:[{id:"item_1",title:"证件",state:"packed",note:null}]});
  assert.match(html,/上海 &lt;出行&gt;/u);assert.match(html,/酒店 &lt;script&gt;/u);assert.doesNotMatch(html,/<script>/u);
  assert.match(html,/<h2>2026-09-11<\/h2>[\s\S]*01:00 · 车票/u);
  assert.match(html,/旅程清单[\s\S]*证件（已备好）/u);
  assert.match(html,/实际到访（独立记录）[\s\S]*实际到访点/u);
});
