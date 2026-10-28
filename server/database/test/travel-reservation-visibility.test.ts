import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { CommandExecutor, QueryService, sha256Fingerprinter, systemClock, uuidIds } from "@shadow/kernel";
import { PostgresUnitOfWork, migrate } from "../src/index.js";

test("trip detail and portable export omit voided reservations while preserving cancelled facts and private fields", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const name = `travel_visibility_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create database "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${name}`;
  const unitOfWork = new PostgresUnitOfWork({ connectionString: url.toString() });
  try {
    await migrate(unitOfWork.pool);
    await unitOfWork.ensurePrincipal("subject_owner"); await unitOfWork.ensurePrincipal("subject_viewer");
    const executor = new CommandExecutor({ unitOfWork, ids: uuidIds, clock: systemClock, fingerprinter: sha256Fingerprinter });
    const queries = new QueryService(unitOfWork);
    const context = { actorId: "subject_owner", subjectId: "subject_owner", clientId: "client_test", traceId: "trace_test", effects: new Set(["travel.trip.write", "travel.trip.read", "travel.reservation.write", "travel.member.manage"]) };
    const run = (capability: string, input: unknown) => executor.execute(context, { protocol: "shadow.command", capability, command_id: `cmd_${randomUUID()}`, input });
    const trip = await run("travel.create_trip", { title: "合成行程", starts_on: "2026-10-27", ends_on: "2026-10-29", time_zone: "Asia/Shanghai" });
    const tripId = String(trip.actual_values.trip_id);
    // Set the read-only fixture member without granting production membership authority.
    await unitOfWork.pool.query("insert into trip_members(trip_id,subject_id,role,visibility) values($1,'subject_viewer','viewer','shared')", [tripId]);
    const base = { trip_id: tripId, reservation_type: "hotel", state: "confirmed", visibility: "shared", confirmation_code: "SYNTHETIC-CODE", seat: "05A" };
    const wrong = await run("travel.add_reservation", { ...base, title: "误录预订" });
    await run("travel.void_reservation", { reservation_id: wrong.actual_values.reservation_id, expected_revision: 1, reason: "测试误录作废" });
    await run("travel.add_reservation", { ...base, title: "取消记录", state: "cancelled" });
    await run("travel.add_reservation", { ...base, title: "私人预订", visibility: "private" });
    for (const subject of ["subject_owner", "subject_viewer"]) {
      const ctx = { ...context, subjectId: subject, actorId: subject };
      const detail = await queries.travelTrip(ctx, tripId);
      const bundle = JSON.parse((await queries.travelExport(ctx, { trip_id: tripId, format: "bundle" })).content).exported_trip;
      for (const reservations of [detail.reservations, bundle.reservations]) {
        assert.equal(reservations.some((item: { title: string }) => item.title === "误录预订"), false);
        const cancelled = reservations.find((item: { title: string }) => item.title === "取消记录");
        assert.equal(cancelled.state, "cancelled");
        assert.equal("confirmation_code" in cancelled, subject === "subject_owner");
        assert.equal("seat" in cancelled, subject === "subject_owner");
        assert.equal(reservations.some((item: { title: string }) => item.title === "私人预订"), subject === "subject_owner");
      }
    }
    assert.equal((await unitOfWork.pool.query("select count(*)::int n from reservation_revisions where reservation_id=$1", [wrong.actual_values.reservation_id])).rows[0].n, 1);
  } finally {
    await unitOfWork.close();
    try { await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
  }
});
