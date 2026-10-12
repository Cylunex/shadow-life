import React, { useState, type FormEvent } from "react";
import type { Execute } from "./command-controller.js";
import { buildPurchaseExperience, initialPurchaseExperience } from "./purchase-experience.js";

export function PurchaseExperiencePanel({ detail, execute, onChanged }: { detail: Record<string, unknown>; execute: Execute; onChanged: () => Promise<void> }) {
  const [fields, setFields] = useState(() => initialPurchaseExperience(detail)), [pending, setPending] = useState(false), [error, setError] = useState<string>(), [saved, setSaved] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(undefined); setSaved(false);
    try { await execute("life.correct_purchase", buildPurchaseExperience(detail, fields), `purchase-experience:${String(detail.record_id)}`); setSaved(true); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setPending(false); }
  }
  return <details className="detail-meta"><summary>消费体验与复购意愿</summary><form onSubmit={save}>
    <p>只填写明确的个人评价，未评分和未决定保持空白。</p>
    <label>体验评分<select value={fields.rating} disabled={pending} onChange={event => setFields({ ...fields, rating: event.target.value })}><option value="">未评分</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={String(value)}>{value} 分</option>)}</select></label>
    <label>以后还会买或再去吗<select value={fields.wouldRepeat} disabled={pending} onChange={event => setFields({ ...fields, wouldRepeat: event.target.value as typeof fields.wouldRepeat })}><option value="">未决定</option><option value="yes">会</option><option value="no">不会</option></select></label>
    <label>感受与备注<textarea value={fields.note} disabled={pending} maxLength={2000} onChange={event => setFields({ ...fields, note: event.target.value })}/></label>
    {error && <p className="inline-error" role="alert">{error}</p>}{saved && <p role="status">体验已保存。</p>}<button disabled={pending}>{pending ? "保存中…" : "保存体验"}</button>
  </form></details>;
}
