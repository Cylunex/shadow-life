import assert from "node:assert/strict";
import test from "node:test";
import { projectDraftKey, readProjectDraft, writeProjectDraft } from "../src/project-draft.js";
test("project draft restores only the matching account and recent valid data",()=>{
  const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const key=projectDraftKey("issuer:alice:client");writeProjectDraft(key,{title:"搬家",goal:"整理",milestones:[],links:[],actionTitle:"打包",actionTime:"09:30"},storage,1000);
  assert.equal(readProjectDraft(key,storage,2000)?.actionTime,"09:30");
  assert.equal(readProjectDraft(projectDraftKey("issuer:bob:client"),storage,2000),null);
  assert.equal(readProjectDraft(key,storage,1000+31*86400000),null);
  storage.setItem(key,"{invalid");assert.equal(readProjectDraft(key,storage,2000),null);
});
