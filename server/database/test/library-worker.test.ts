import assert from "node:assert/strict";
import test from "node:test";
import { splitLibraryText } from "../src/library-worker.js";

test("library text snippets preserve bounded source offsets",()=>{
  const text="第一段\n第二段内容\n第三段";
  const snippets=splitLibraryText(text,8);
  assert.ok(snippets.length>=2);assert.equal(snippets.map(item=>item.text).join("\n"),text);
  assert.ok(snippets.every(item=>item.text.length<=8&&item.locator.end>item.locator.start));
});

test("library text processor ignores whitespace-only originals",()=>assert.deepEqual(splitLibraryText(" \r\n "),[]));
