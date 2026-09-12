import assert from "node:assert/strict";
import test from "node:test";
import { formatMoneyAmount } from "../src/money-display.js";

test("money display removes database padding while preserving currency precision",()=>{assert.equal(formatMoneyAmount("28.500000","CNY"),"28.50");assert.equal(formatMoneyAmount("100.000000","JPY"),"100");assert.equal(formatMoneyAmount("1.234000","KWD"),"1.234");});
test("source scale wins for editable historical and foreign amounts",()=>{assert.equal(formatMoneyAmount("28.500000","CNY",2),"28.50");assert.equal(formatMoneyAmount("1000.000000","JPY",0),"1000");assert.equal(formatMoneyAmount("1.230000","USD",4),"1.2300");});
test("money display never rounds or rewrites malformed values",()=>{assert.equal(formatMoneyAmount("1.234567","CNY",2),"1.234567");assert.equal(formatMoneyAmount("unknown","CNY"),"unknown");});
