import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { recordHealthMeasurementInputSchema, recordMealInputSchema, recordMoneyEntryInputSchema, createTripInputSchema, captureLibraryItemInputSchema } from "@shadow/contracts";

const path = process.argv[2];
if (path === undefined) throw new Error("fixture path is required");
const rows = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
const mapped = rows.map((row) => {
  const capability = typeof row.kind === "string" ? ({ ledger:"money.record_entry",health:"health.record_measurement",trip:"travel.create_trip",archive:"library.capture" } as const)[row.kind as "ledger"|"health"|"trip"|"archive"] : "life.record_meal";
  const candidate = capability === "money.record_entry" ? recordMoneyEntryInputSchema.parse(row.input) : capability === "health.record_measurement" ? recordHealthMeasurementInputSchema.parse(row.input) : capability === "travel.create_trip" ? createTripInputSchema.parse(row.input) : capability === "library.capture" ? captureLibraryItemInputSchema.parse(row.input) : recordMealInputSchema.parse({ occurred_on: row.date, time_zone: "Asia/Shanghai", meal_type: row.meal_type, items: (row.items as string[]).map((name) => ({ name, estimate: false })), source: { kind: "import", external_id: row.legacy_id, captured_on: row.date, original_text: row.original_text } });
  return ({
  legacy_id: row.legacy_id,
  subject_id: row.owner_mapping,
  capability,
  command_id: `cmd_import_${createHash("sha256").update(String(row.legacy_id)).digest("hex").slice(0, 16)}`,
  input: candidate,
  decision: "mapped_without_inventing_time_or_payment"
  });
});
console.log(JSON.stringify({ protocol: "shadow.import-dry-run", source: path, rows: mapped, writes: 0 }, null, 2));
