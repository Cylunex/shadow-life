const scenario = process.argv.at(-1);
if (scenario !== "record-daily-life") { console.error("Available evaluation: record-daily-life"); process.exit(64); }
console.error("No verified Agent Runtime is configured. R2 evaluation is intentionally unavailable rather than reported as passed.");
process.exit(78);
