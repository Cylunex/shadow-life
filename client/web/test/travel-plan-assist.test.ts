import assert from "node:assert/strict";
import test from "node:test";
import { nearbyDraftOrder, stopFromPlace, type DraftTravelStop } from "../src/travel-plan-assist.js";
import type { TravelPlace } from "../src/travel-workspace.js";

const place=(id:string,latitude:string|null,longitude:string|null):TravelPlace=>({id,name:id,address:null,latitude,longitude,favorite:false,tags:[],revision:1});
const stop=(id:string,placeId=id,startsAt=""):DraftTravelStop=>({stop_id:id,title:id,place_id:placeId,starts_at:startsAt,note:""});

test("saved places become untimed draft stops without creating visits",()=>{
  assert.deepEqual(stopFromPlace(place("湖边","30","120")),{title:"湖边",place_id:"湖边",starts_at:"",note:""});
});

test("nearby suggestion keeps timed, anchor, completed and unlocated stops fixed",()=>{
  const places=[place("start","0","0"),place("far","0","3"),place("near","0","1"),place("middle","0","2"),place("anchor","0","4"),place("afterFar","0","7"),place("afterNear","0","5"),place("unknown",null,null)];
  const draft=[stop("start","start","2026-10-01T09:00"),stop("far"),stop("near"),stop("middle"),stop("anchor"),stop("afterFar"),stop("afterNear"),stop("unknown"),stop("done","near"),stop("tail","middle")];
  const ordered=nearbyDraftOrder(draft,places,new Set(["done"]),new Set(["anchor"]));
  assert.deepEqual(ordered.map(item=>item.stop_id),["start","near","middle","far","anchor","afterNear","afterFar","unknown","done","tail"]);
  assert.deepEqual(draft.map(item=>item.stop_id),["start","far","near","middle","anchor","afterFar","afterNear","unknown","done","tail"]);
  assert.deepEqual(ordered.map(item=>item.starts_at),draft.map(item=>item.starts_at));
});

test("nearby suggestion preserves first unanchored stop and supports an empty day",()=>{
  const places=[place("a","0","0"),place("far","0","4"),place("near","0","1")];
  assert.deepEqual(nearbyDraftOrder([],places),[]);
  assert.deepEqual(nearbyDraftOrder([stop("a"),stop("far"),stop("near")],places).map(item=>item.stop_id),["a","near","far"]);
});
