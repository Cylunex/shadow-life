import { correctPurchaseInputSchema } from "@shadow/contracts";

export interface PurchaseExperienceFields { rating: string; wouldRepeat: "" | "yes" | "no"; note: string; }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function initialPurchaseExperience(detail: Record<string, unknown>): PurchaseExperienceFields {
  const purchase = object(detail.purchase);
  return { rating: purchase.rating === null || purchase.rating === undefined ? "" : String(purchase.rating), wouldRepeat: purchase.would_repeat === true ? "yes" : purchase.would_repeat === false ? "no" : "", note: String(purchase.note ?? detail.note ?? "") };
}
export function buildPurchaseExperience(detail: Record<string, unknown>, fields: PurchaseExperienceFields) {
  const purchase = object(detail.purchase);
  // The existing correction replaces this aggregate, so carry all unchanged business fields.
  return correctPurchaseInputSchema.parse({
    record_id: detail.record_id, expected_revision: detail.revision,
    occurred_on: purchase.occurred_on ?? detail.occurred_on, time_zone: purchase.time_zone ?? detail.time_zone,
    ...(purchase.occurred_at ?? detail.occurred_at ? { occurred_at: purchase.occurred_at ?? detail.occurred_at } : {}),
    scene: purchase.scene,
    ...(purchase.merchant ? { merchant_name_raw: purchase.merchant } : {}),
    ...(purchase.channel_name_raw ? { channel_name_raw: purchase.channel_name_raw } : {}),
    ...(purchase.place_ref ? { place_ref: purchase.place_ref } : {}),
    ...(fields.rating ? { rating: Number(fields.rating) } : {}),
    ...(fields.wouldRepeat ? { would_repeat: fields.wouldRepeat === "yes" } : {}),
    ...(fields.note.trim() ? { note: fields.note.trim() } : {}), reason: "补充或修正消费体验"
  });
}
