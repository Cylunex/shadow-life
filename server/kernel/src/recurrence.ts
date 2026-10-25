export type RecurrenceCadence = "daily" | "weekly" | "monthly" | "yearly" | "interval";
export type MissingDatePolicy = "skip" | "last_day";

interface RecurrenceRule {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  month?: number;
  monthDay?: number;
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error(`Invalid recurrence date: ${value}`);
  const parts={ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if(parts.month<1||parts.month>12||parts.day<1||parts.day>daysInMonth(parts.year,parts.month))throw new Error(`Invalid recurrence date: ${value}`);
  return parts;
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(value: string, days: number): string {
  const { year, month, day } = dateParts(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addMonths(year: number, month: number, count: number): { year: number; month: number } {
  const index = year * 12 + month - 1 + count;
  return { year: Math.floor(index / 12), month: index % 12 + 1 };
}

export function parseRecurrenceRule(rule: string): RecurrenceRule {
  const entries=rule.split(";").map((part) => {
    const [key, value, ...rest] = part.split("=");
    if (!key || !value || rest.length) throw new Error(`Unsupported recurrence rule: ${rule}`);
    return [key, value] as const;
  });
  if(new Set(entries.map(([key])=>key)).size!==entries.length)throw new Error(`Duplicate recurrence rule field: ${rule}`);
  const values = new Map(entries);
  const allowed = new Set(["FREQ", "INTERVAL", "BYMONTH", "BYMONTHDAY"]);
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error(`Unsupported recurrence rule: ${rule}`);
  const frequency = values.get("FREQ");
  if (frequency !== "DAILY" && frequency !== "WEEKLY" && frequency !== "MONTHLY" && frequency !== "YEARLY") throw new Error(`Unsupported recurrence frequency: ${frequency ?? "missing"}`);
  const interval = Number(values.get("INTERVAL") ?? "1");
  const month = values.has("BYMONTH") ? Number(values.get("BYMONTH")) : undefined;
  const monthDay = values.has("BYMONTHDAY") ? Number(values.get("BYMONTHDAY")) : undefined;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) throw new Error("Recurrence interval must be between 1 and 366");
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) throw new Error("BYMONTH must be between 1 and 12");
  if (monthDay !== undefined && (!Number.isInteger(monthDay) || monthDay === 0 || monthDay < -1 || monthDay > 31)) throw new Error("BYMONTHDAY must be -1 or between 1 and 31");
  if (month !== undefined && frequency !== "YEARLY") throw new Error("BYMONTH is only supported for yearly recurrence");
  if (monthDay !== undefined && frequency !== "MONTHLY" && frequency !== "YEARLY") throw new Error("BYMONTHDAY is only supported for monthly or yearly recurrence");
  return { frequency, interval, ...(month === undefined ? {} : { month }), ...(monthDay === undefined ? {} : { monthDay }) };
}

export function buildRecurrenceRule(input: { cadence: RecurrenceCadence; intervalDays?: number | undefined; anchorOn: string; missingDatePolicy: MissingDatePolicy }): string {
  const anchor = dateParts(input.anchorOn);
  if (input.cadence === "daily") return "FREQ=DAILY";
  if (input.cadence === "weekly") return "FREQ=WEEKLY";
  if (input.cadence === "interval") {const interval=input.intervalDays??1;if(!Number.isInteger(interval)||interval<1||interval>366)throw new Error("Recurrence interval must be between 1 and 366");return `FREQ=DAILY;INTERVAL=${interval}`;}
  if (input.cadence === "monthly") return `FREQ=MONTHLY;BYMONTHDAY=${input.missingDatePolicy === "last_day" ? -1 : anchor.day}`;
  return `FREQ=YEARLY;BYMONTH=${anchor.month};BYMONTHDAY=${input.missingDatePolicy === "last_day" && anchor.day === daysInMonth(anchor.year, anchor.month) ? -1 : anchor.day}`;
}

export function nextRecurrenceDate(input: { recurrenceRule: string; currentDueOn: string; anchorOn: string; missingDatePolicy: MissingDatePolicy }): string {
  const rule = parseRecurrenceRule(input.recurrenceRule);
  if (rule.frequency === "DAILY") return addDays(input.currentDueOn, rule.interval);
  if (rule.frequency === "WEEKLY") return addDays(input.currentDueOn, rule.interval * 7);

  const current = dateParts(input.currentDueOn);
  const anchor = dateParts(input.anchorOn);
  if (rule.frequency === "MONTHLY") {
    const desiredDay = rule.monthDay ?? anchor.day;
    for (let step = rule.interval; step <= rule.interval * 2400; step += rule.interval) {
      const candidate = addMonths(current.year, current.month, step);
      const last = daysInMonth(candidate.year, candidate.month);
      if (desiredDay === -1) return formatDate(candidate.year, candidate.month, last);
      if (desiredDay <= last) return formatDate(candidate.year, candidate.month, desiredDay);
      if (input.missingDatePolicy === "last_day") return formatDate(candidate.year, candidate.month, last);
    }
  } else {
    const desiredMonth = rule.month ?? anchor.month;
    const desiredDay = rule.monthDay ?? anchor.day;
    for (let year = current.year + rule.interval; year <= current.year + rule.interval * 400; year += rule.interval) {
      const last = daysInMonth(year, desiredMonth);
      if (desiredDay === -1) return formatDate(year, desiredMonth, last);
      if (desiredDay <= last) return formatDate(year, desiredMonth, desiredDay);
      if (input.missingDatePolicy === "last_day") return formatDate(year, desiredMonth, last);
    }
  }
  throw new Error(`Unable to materialize recurrence after ${input.currentDueOn}`);
}
