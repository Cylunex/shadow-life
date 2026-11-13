import test from "node:test";
import assert from "node:assert/strict";
import {locateOrderAmount} from "../src/amount-evidence.js";
import {takeoutFixture} from "./fixtures/takeout.js";
import {readTakeoutCapture,takeoutPrefix} from "../src/takeout-order.js";
test("locators use the field label on the same line and only mark unique original coordinates",()=>{
  const text=takeoutFixture(),capture=readTakeoutCapture(text)!;
  const paid=locateOrderAmount(text,"paid","19.98");assert.equal(paid?.amount,"19.98");assert.equal(paid?.region?.image_width,1080);
  assert.equal(locateOrderAmount(text,"delivery","0.00")?.region?.x,800);
  const duplicate=capture.blocks.find(b=>b[4]==="实付￥19.98")!;capture.blocks.push([...duplicate]);
  assert.equal(locateOrderAmount(takeoutPrefix+JSON.stringify(capture),"paid","19.98")?.region,null);
  assert.deepEqual(locateOrderAmount("商品 8.90\n实付金额：8.90","paid"),{quote:"实付金额：8.90",amount:"8.90",region:null});
  assert.equal(locateOrderAmount("只有商品价格 8.90","paid"),null);
});
