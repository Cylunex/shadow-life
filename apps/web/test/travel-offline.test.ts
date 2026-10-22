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

test("offline export includes out-of-range bookings, end times, overnight stays and checklist states",()=>{
  const html=renderOfflineItinerary({trip:{title:"合成旅行",starts_on:"2026-10-22",ends_on:"2026-10-23",time_zone:"Asia/Shanghai"},day_plans:[],visits:[],reservations:[
    {title:"范围外酒店",reservation_type:"hotel",state:"confirmed",starts_at:"2026-10-20T16:30:00Z",ends_at:"2026-10-23T02:00:00Z",origin:null,destination:null},
    {title:"取消的酒店",reservation_type:"hotel",state:"cancelled",starts_at:"2026-10-21T16:30:00Z",ends_at:"2026-10-23T02:00:00Z",origin:null,destination:null},
    {title:"未定开始的预订",reservation_type:"rail",state:"pending",starts_at:null,ends_at:"2026-10-24T00:00:00Z",origin:null,destination:null,confirmation_code:"ABC<123>"}
  ],segments:[{origin:"出发点",destination:"范围外返程",mode:"rail",starts_at:"2026-10-24T16:00:00Z",ends_at:"2026-10-25T03:00:00Z"}]},{id:"list_test",trip_id:"trip_test",revision:1,items:[{id:"check_a",title:"证件",state:"packed",note:null},{id:"check_b",title:"厚外套",state:"skipped",note:null},{id:"check_c",title:"充电器",state:"needed",note:null}]});
  const section=(day:string)=>html.split(`<h2>${day}</h2>`)[1]?.split("</section>")[0]??"";
  assert.match(section("2026-10-21"),/旅程日期范围外的安排[\s\S]*范围外酒店/);
  assert.match(section("2026-10-22"),/当晚住宿[^]*范围外酒店/);
  assert.doesNotMatch(section("2026-10-22").split("<h3>预订</h3>")[0]!,/取消的酒店/);
  assert.doesNotMatch(section("2026-10-23").split("<h3>预订</h3>")[0]!,/范围外酒店/);
  assert.match(section("2026-10-25"),/范围外返程[^]*到达：2026-10-25 11:00/);
  assert.match(html,/结束：2026-10-23 10:00/);
  assert.match(html,/未定开始的预订[^]*确认号：ABC&lt;123&gt;/);
  assert.match(html,/☑ 证件/);assert.match(html,/− 厚外套/);assert.match(html,/☐ 充电器/);
});
