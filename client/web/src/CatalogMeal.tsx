import { useState, type FormEvent } from "react";
import { canonicalDecimal, positiveDecimal } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";
import type { CatalogFood, RecipeMealFields } from "./food-catalog.js";

// Intake items store the supplied quantity and the fraction actually eaten.
const oneServing = { value: "1", label: "一份", servings: 1, fraction: "1" };
const portions = [
  { value: "0.25", label: "四分之一份", servings: 1, fraction: "0.25" },
  { value: "0.5", label: "半份", servings: 1, fraction: "0.5" },
  { value: "0.75", label: "四分之三份", servings: 1, fraction: "0.75" },
  oneServing,
  { value: "1.5", label: "一份半", servings: 2, fraction: "0.75" },
  { value: "2", label: "两份", servings: 2, fraction: "1" },
  { value: "3", label: "三份", servings: 3, fraction: "1" },
];
const nutrients = [
  ["energy_kcal", "热量", "kcal"], ["protein_g", "蛋白质", "g"], ["fat_g", "脂肪", "g"],
  ["carb_g", "碳水", "g"], ["fiber_g", "膳食纤维", "g"], ["sodium_mg", "钠", "mg"],
  ["calcium_mg", "钙", "mg"], ["iron_mg", "铁", "mg"],
] as const;
const energyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
type Selected = { food: CatalogFood; portion: typeof portions[number] };

function forServings(value: string, servings: number) {
  const [whole, decimal = ""] = value.split(".");
  const digits = (BigInt(whole + decimal) * BigInt(servings)).toString().padStart(decimal.length + 1, "0");
  if (!decimal.length) return digits;
  const integer = digits.slice(0, -decimal.length);
  const remainder = digits.slice(-decimal.length).replace(/0+$/u, "");
  return remainder ? integer + "." + remainder : integer;
}

function serving(food: CatalogFood, servings = 1) {
  const quantity = positiveDecimal.safeParse(food.serving_amount);
  if (food.serving_unit && quantity.success) {
    return { quantity: forServings(quantity.data, servings), unit: food.serving_unit };
  }
}

function knownNutrients(food: CatalogFood, servings = 1): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key] of nutrients) {
    const raw = food.nutrients[key];
    const parsed = canonicalDecimal.safeParse(typeof raw === "number" ? raw.toString() : raw);
    if (parsed.success) result[key] = forServings(parsed.data, servings);
  }
  return result;
}

function intake({ food, portion }: Selected) {
  const base = serving(food, portion.servings);
  const evidence = [`食物档案第 ${food.revision} 版`, food.provenance];
  if (base && portion.servings > 1) evidence.unshift(`按档案 ${portion.servings} 份计算原份量`);
  const item = {
    name: food.name, food_ref_id: food.id, provenance: "reference_snapshot",
    evidence_note: evidence.filter(Boolean).join(" · ").slice(0, 500),
  };
  if (!base) return item;
  return {
    ...item, ...base, ...knownNutrients(food, portion.servings), consumed_fraction: portion.fraction,
    ...(["g", "克"].includes(base.unit.toLowerCase()) ? { amount_g: base.quantity } : {}),
  };
}

type Props = {
  foods: CatalogFood[]; canRecord: boolean; date: string; timeZone: string;
  execute: Execute; onRecorded: () => void;
};
export function CatalogMeal({ foods, canRecord, date, timeZone, execute, onRecorded }: Props) {
  const [selected, setSelected] = useState<Selected[]>([]);
  const [mealType, setMealType] = useState<RecipeMealFields["mealType"]>("other");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const energy = selected.flatMap(({ food, portion }) => {
    const kcal = knownNutrients(food).energy_kcal;
    return serving(food) && kcal !== undefined ? [Number(kcal) * Number(portion.value)] : [];
  });

  function toggle(food: CatalogFood) {
    setReceipt("");
    setError("");
    setSelected(current => current.some(row => row.food.id === food.id)
      ? current.filter(row => row.food.id !== food.id)
      : [...current, { food, portion: oneServing }]);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canRecord || !selected.length || pending) return;
    setPending(true);
    setError("");
    try {
      await execute("life.record_meal", {
        occurred_on: date, time_zone: timeZone, meal_type: mealType, items: selected.map(intake),
      }, "food-catalog:selected-meal");
      setReceipt(`已记入 ${date} 的饮食日记，共 ${selected.length} 项食物。`);
      setSelected([]);
      onRecorded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "这餐尚未保存，请重试。");
    } finally {
      setPending(false);
    }
  }

  return <>
    {canRecord && selected.length > 0 && <form className="catalog-form" aria-label="本餐已选食物" onSubmit={save}>
      <h3>本餐已选食物</h3>
      <p>用餐日 {date}</p>
      {energy.length > 0 && <p>已知热量 {energyFormat.format(energy.reduce((sum, value) => sum + value, 0))} kcal · {energy.length}／{selected.length} 项有依据</p>}
      <label>餐次<select value={mealType} disabled={pending} onChange={event => setMealType(event.target.value as typeof mealType)}>
        <option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option>
        <option value="snack">加餐</option><option value="other">其他</option>
      </select></label>
      <ul className="catalog-list">{selected.map(({ food, portion }) => {
        const base = serving(food);
        return <li key={food.id}><b>{food.name}</b>
          {base ? <label>每份 {base.quantity} {base.unit} · 实际食用
            <select aria-label={`${food.name}食用份量`} value={portion.value} disabled={pending} onChange={event => {
              const next = portions.find(option => option.value === event.target.value);
              if (next) setSelected(current => current.map(row => row.food.id === food.id ? { ...row, portion: next } : row));
            }}>
              {portions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label> : <small>档案缺少每份用量，本次仅记录食物名称。</small>}
          <button type="button" className="secondary catalog-add" aria-label={`移除${food.name}`}
            disabled={pending} onClick={() => toggle(food)}>移除</button>
        </li>;
      })}</ul>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>{pending ? "保存中…" : "保存为一餐"}</button>
    </form>}
    {receipt && <p role="status">{receipt}</p>}
    <ul className="catalog-list">{foods.map(food => {
      const base = serving(food), values = knownNutrients(food);
      const added = selected.some(row => row.food.id === food.id);
      return <li key={food.id}>
        <details>
          <summary><b>{food.name}</b> · {base ? `每份 ${base.quantity} ${base.unit}` : "份量未填写"}
            {food.state === "archived" && " · 已归档"}{values.energy_kcal !== undefined && ` · ${values.energy_kcal} kcal`}</summary>
          {nutrients.filter(([key]) => values[key] !== undefined).map(([key, label, unit]) =>
            <div key={key}>{label} {values[key]} {unit}</div>)}
          {!Object.keys(values).length && <p>尚无营养数据。</p>}
          <small>{[food.provenance, `档案第 ${food.revision} 版`].filter(Boolean).join(" · ")}</small>
        </details>
        {canRecord && food.state === "active" && <button type="button" className="secondary catalog-add"
          aria-label={`${food.name}加入本餐`} aria-pressed={added} disabled={pending || (!added && selected.length >= 100)}
          onClick={() => toggle(food)}>{added ? "已选" : "加入本餐"}</button>}
      </li>;
    })}</ul>
  </>;
}
