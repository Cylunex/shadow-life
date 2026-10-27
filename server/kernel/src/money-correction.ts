import { correctMoneyEntryInputSchema } from "@shadow/contracts";
import { invalidInput } from "./errors.js";

type Correction = ReturnType<typeof correctMoneyEntryInputSchema.parse>;
type OptionalField = NonNullable<Correction["clear_fields"]>[number];
type Patch = { [K in OptionalField]: Correction[K] | null };

// Omission preserves a fact; only an explicit clear removes it. Do not introduce
// defaults into the command itself: old command IDs must keep their fingerprints.
export function moneyCorrectionPatch(input: Correction, currentOccurredAt: string | null): Patch {
  const clear = new Set(input.clear_fields);
  const patch: Patch = {
    occurred_at: clear.has("occurred_at") ? null : input.occurred_at,
    category: clear.has("category") ? null : input.category,
    counterparty: clear.has("counterparty") ? null : input.counterparty,
    payment_method: clear.has("payment_method") ? null : input.payment_method,
    note: clear.has("note") ? null : input.note
  };
  const occurredAt = patch.occurred_at === undefined ? currentOccurredAt : patch.occurred_at;
  if (!correctMoneyEntryInputSchema.safeParse({ ...input, occurred_at: occurredAt ?? undefined,
    clear_fields: input.clear_fields?.filter(field => field !== "occurred_at") }).success) {
    throw invalidInput("Retained occurred_at does not fall on occurred_on in time_zone; supply a matching occurred_at or explicitly clear it with clear_fields.", ["occurred_at"]);
  }
  return patch;
}
