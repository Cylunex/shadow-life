function decimalParts(value: string): { integer: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(value);
  if (!match) throw new Error(`Invalid decimal: ${value}`);
  const fraction = match[3] ?? "";
  return { integer: BigInt(`${match[1] ?? ""}${match[2]}${fraction}`), scale: fraction.length };
}

function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left), b = decimalParts(right), scale = Math.max(a.scale, b.scale);
  const leftInteger = a.integer * 10n ** BigInt(scale - a.scale);
  const rightInteger = b.integer * 10n ** BigInt(scale - b.scale);
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

export function reconcileActivityEnergy(deviceSummary: string | null, workoutSum: string | null): { caloriesKcal: string | null; source: "device_summary" | "workout_sum" | "equal" | null } {
  if (deviceSummary === null && workoutSum === null) return { caloriesKcal: null, source: null };
  if (deviceSummary === null) return { caloriesKcal: workoutSum, source: "workout_sum" };
  if (workoutSum === null) return { caloriesKcal: deviceSummary, source: "device_summary" };
  const compared = compareDecimal(deviceSummary, workoutSum);
  if (compared === 0) return { caloriesKcal: deviceSummary, source: "equal" };
  return compared > 0 ? { caloriesKcal: deviceSummary, source: "device_summary" } : { caloriesKcal: workoutSum, source: "workout_sum" };
}
