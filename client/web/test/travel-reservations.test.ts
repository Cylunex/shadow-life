import assert from "node:assert/strict";
import test from "node:test";
import { isConfirmedOvernight, reservationDayLabel, reservationDates, reservationsForDay, type TravelReservation } from "../src/travel-reservations.js";
import { itineraryDayLabel } from "../src/travel-workspace.js";
import { renderOfflineItinerary } from "../src/travel-offline.js";

const hotel: TravelReservation = { title: "两晚住宿", reservation_type: "hotel", state: "confirmed", starts_at: "2026-10-27T07:00:00Z", ends_at: "2026-10-29T03:00:00Z", origin: null, destination: null };
const zone = "Asia/Shanghai";
test("hotel check-in, continuation and checkout preserve status without inventing nights", () => {
  assert.equal(itineraryDayLabel({ starts_on: "2026-10-27", ends_on: "2026-10-29" }, "2026-10-28"), "第 2 天");
  assert.equal(itineraryDayLabel({ starts_on: "2026-10-27", ends_on: "2026-10-29" }, "2026-10-26"), "范围外预订");
  assert.equal(reservationDayLabel(hotel, "2026-10-27", zone), "入住日");
  assert.equal(reservationDayLabel(hotel, "2026-10-28", zone), "住宿期间（按预订）");
  assert.equal(reservationDayLabel(hotel, "2026-10-29", zone), "退房日");
  assert.equal(isConfirmedOvernight(hotel, "2026-10-28", zone), true);
  assert.equal(isConfirmedOvernight(hotel, "2026-10-29", zone), false);
  for (const state of ["pending", "waitlisted", "changed", "cancelled", "refunded"]) assert.equal(isConfirmedOvernight({ ...hotel, state }, "2026-10-28", zone), false);
  for (const state of ["cancelled", "refunded"]) {
    assert.equal(reservationDayLabel({ ...hotel, state }, "2026-10-28", zone), null);
    assert.equal(reservationDayLabel({ ...hotel, state }, "2026-10-29", zone), "退房日");
  }
  assert.equal(isConfirmedOvernight({ ...hotel, ends_at: null }, "2026-10-28", zone), false);
});

test("overnight arrival and unknown start are assigned using the trip zone, including DST", () => {
  const flight = { ...hotel, reservation_type: "flight", starts_at: "2026-11-01T05:30:00Z", ends_at: "2026-11-01T06:30:00Z" };
  assert.equal(reservationDayLabel(flight, "2026-11-01", "America/New_York"), "当天开始与结束");
  const rail = { ...hotel, reservation_type: "rail", starts_at: "2026-10-27T15:00:00Z", ends_at: "2026-10-28T00:30:00Z" };
  assert.equal(reservationDayLabel(rail, "2026-10-28", zone), "结束日");
  assert.equal(reservationDayLabel({ ...rail, starts_at: null }, "2026-10-28", zone), "结束日");
  assert.deepEqual(reservationDates([rail, { ...rail, starts_at: null, ends_at: null }], zone), ["2026-10-27", "2026-10-28"]);
  assert.deepEqual(reservationsForDay([rail, hotel], "2026-10-28", zone), [hotel, rail]);
});

test("offline projection includes checkout and arrival, but pending hotels are not confirmed lodging", () => {
  const html = renderOfflineItinerary({ trip: { title: "测试", starts_on: "2026-10-27", ends_on: "2026-10-29", time_zone: zone }, day_plans: [], segments: [], visits: [], reservations: [hotel, { ...hotel, title: "候补酒店", state: "waitlisted" }, { ...hotel, title: "<夜车>", reservation_type: "rail", starts_at: "2026-10-27T15:00:00Z", ends_at: "2026-10-28T00:30:00Z", service_number: "T<1>" }] }, null);
  const day = (date: string) => html.split(`<h2>${date}</h2>`)[1]!.split("</section>")[0]!;
  assert.match(day("2026-10-29"), /两晚住宿[^]*退房日/);
  assert.doesNotMatch(day("2026-10-28").split("<h3>预订</h3>")[0]!, /候补酒店/);
  assert.match(day("2026-10-28"), /&lt;夜车&gt;[^]*开始：2026-10-27 23:00[^]*结束日[^]*T&lt;1&gt;[^]*结束：2026-10-28 08:30/);
});
