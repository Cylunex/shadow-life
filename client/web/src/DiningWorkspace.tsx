import { useEffect, useState, type FormEvent } from "react";
import { buildCapabilityHttpRequest, merchantMenuInputSchema, merchantMenuResultSchema } from "@shadow/contracts";
import { CanteenMenuPanel } from "./CanteenMenuPanel.js";
import type { Execute } from "./command-controller.js";
import { dailyHref } from "./daily-navigation.js";
import "./dining-workspace.css";

type Menu = ReturnType<typeof merchantMenuResultSchema.parse>;
type Directory = NonNullable<Menu["directory"]>;
type Statistics = NonNullable<Menu["statistics"]>;
type View = "statistics" | "menu";
type Filter = { view: View; merchant: string; query: string };

function readFilter(): Filter {
  const params = new URLSearchParams(location.search);
  const name = merchantMenuInputSchema.shape.merchant.safeParse(params.get("merchant") ?? undefined);
  return {
    view: params.get("dining_view") === "menu" ? "menu" : "statistics",
    merchant: name.success ? name.data ?? "" : "", query: (params.get("dish_query") ?? "").trim().slice(0, 160),
  };
}

async function readMenu(input: Record<string, unknown>, headers: HeadersInit, signal: AbortSignal) {
  const request = buildCapabilityHttpRequest("", "life.merchant_menu", input);
  const response = await fetch(request.url, { headers, signal });
  if (!response.ok) throw new Error(`门店数据读取失败（HTTP ${response.status}）`);
  return merchantMenuResultSchema.parse(await response.json());
}

export function DiningWorkspace({ day, timeZone, headers, execute, capabilities, onDay }: {
  day: string; timeZone: string; headers: HeadersInit; execute: Execute;
  capabilities: ReadonlySet<string>; onDay: (date: string) => void;
}) {
  const [filter, setFilter] = useState(readFilter);
  const [storeName, setStoreName] = useState("");
  const storeInput = merchantMenuInputSchema.shape.merchant.safeParse(storeName);
  const [retry, setRetry] = useState(0);
  const [directory, setDirectory] = useState<{ day: string; data?: Directory; error?: string }>();
  const current = directory?.day === day ? directory : undefined;

  useEffect(() => {
    const restore = () => { setFilter(readFilter()); setStoreName(""); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setDirectory(undefined);
    void readMenu({ browse: "1", on: day, time_zone: timeZone, limit: 1 }, headers, abort.signal)
      .then(result => {
        if (!result.directory) throw new Error("门店总览暂不可用");
        if (!abort.signal.aborted) setDirectory({ day, data: result.directory });
      }).catch(error => {
        if (!abort.signal.aborted) setDirectory({ day, error: error instanceof Error ? error.message : "门店总览读取失败" });
      });
    return () => abort.abort();
  }, [day, timeZone, headers, retry]);

  function select(next: Filter) {
    const params = new URLSearchParams(location.search);
    if (next.merchant) params.set("merchant", next.merchant); else params.delete("merchant");
    if (next.query) params.set("dish_query", next.query); else params.delete("dish_query");
    if (next.view === "menu") params.set("dining_view", next.view); else params.delete("dining_view");
    if (params.toString() !== location.search.slice(1)) history.pushState(null, "", `?${params}${location.hash}`);
    setFilter(next);
    setStoreName("");
  }

  const options = new Map<string, string>();
  for (const name of [current?.data?.default_merchant, ...(current?.data?.merchants.map(store => store.name) ?? []),
    ...(current?.data?.takeout.map(order => order.merchant) ?? []), filter.merchant]) {
    if (name && merchantMenuInputSchema.shape.merchant.safeParse(name).success && !options.has(name.toLowerCase())) options.set(name.toLowerCase(), name);
  }
  const stores = current?.data?.merchants ?? [];
  const selectedStore = stores.find(store => store.name.toLowerCase() === filter.merchant.toLowerCase());
  const menuShortcuts = (filter.merchant ? (selectedStore ? [selectedStore] : []) : [...stores].sort((a, b) => b.menu_items - a.menu_items))
    .filter(store => store.menu_items > 0).slice(0, 3);
  return <section className="dining-workspace" aria-label="门店菜单与菜品统计">
    <div className="dining-heading"><h2>门店菜单与菜品统计</h2>
      <div className="dining-views" aria-label="查看内容">{([["statistics", "菜品统计"], ["menu", "门店菜单"]] as const).map(([view, label]) =>
      <button type="button" className="secondary" key={view} aria-pressed={filter.view === view} onClick={() => select({ ...filter, view })}>{label}</button>)}</div>
    </div>
    <div className="dining-filters">
      <label>选择门店<select value={filter.merchant.toLowerCase()} onChange={e =>
        select({ ...filter, merchant: options.get(e.target.value) ?? "" })}>
        <option value="">全部门店</option>
        {[...options].map(([key, name]) => {
          const count = stores.find(store => store.name.toLowerCase() === key)?.menu_items;
          return <option key={key} value={key}>{name}{count !== undefined ? ` · 已收录 ${count} 道` : ""}</option>;
        })}
      </select></label>
      <label>截至日期<input type="date" value={day} max={new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())}
        onChange={e => { if (e.target.value) onDay(e.target.value); }}/></label>
    </div>
    {current?.error && <p role="alert">{current.error} <button type="button" onClick={() => setRetry(n => n + 1)}>重试门店列表</button></p>}
    {filter.view === "statistics" && menuShortcuts.length > 0 && <div className="dining-shortcuts">
      <span>已收录菜单</span>{menuShortcuts.map(store => <button type="button" key={store.name} className="secondary"
        onClick={() => select({ view: "menu", merchant: store.name, query: "" })}>{store.name} · {store.menu_items} 道菜</button>)}
    </div>}
    {filter.view === "statistics" ? <DishStatistics key={JSON.stringify([day, timeZone, filter.merchant, filter.query])}
      day={day} timeZone={timeZone} headers={headers} merchant={filter.merchant} query={filter.query}
      onQuery={query => select({ ...filter, query })} canOpenMeal={capabilities.has("life.get_record")} canOpenDiary={capabilities.has("life.list_meals")}/> : <>
      {filter.merchant ? <CanteenMenuPanel key={JSON.stringify([day, filter.merchant])} merchant={filter.merchant}
        day={day} headers={headers} execute={execute} canEdit={capabilities.has("life.remember_merchant_dish")} onSaved={() => setRetry(n => n + 1)}/> :
        <section aria-label="门店列表"><h3>我的门店</h3>
          {!current ? <p role="status">正在读取门店…</p> : current.data && (options.size ? <ul className="dining-rows">
            {[...options.values()].map(name => {
              const store = current.data!.merchants.find(item => item.name.toLowerCase() === name.toLowerCase());
              return <li key={name}><button className="secondary" onClick={() => select({ ...filter, merchant: name })}>{name}</button>
                <span>{store ? `已收录 ${store.menu_items} 道 · 近 30 天实吃 ${store.meals} 餐` : name === current.data!.default_merchant ? "常去食堂" : "来自外卖记录"}</span></li>;
            })}</ul> : <p>还没有已收录的门店，可以按名称打开。</p>)}
        </section>}
      <form className="dining-search" onSubmit={e => { e.preventDefault(); if (storeInput.success && storeInput.data) select({ view: "menu", merchant: storeInput.data, query: "" }); }}>
        <label>按名称打开门店<input required maxLength={160} value={storeName} onChange={e => setStoreName(e.target.value)}/></label>
        <button disabled={!storeInput.success}>打开门店</button>
        {storeName.trim() && !storeInput.success && <small>门店名称中不能包含竖线或控制字符。</small>}
      </form>
    </>}
  </section>;
}

function DishStatistics({ day, timeZone, merchant, query, headers, onQuery, canOpenMeal, canOpenDiary }: {
  day: string; timeZone: string; merchant: string; query: string; headers: HeadersInit;
  onQuery: (query: string) => void; canOpenMeal: boolean; canOpenDiary: boolean;
}) {
  const [term, setTerm] = useState(query);
  const [data, setData] = useState<Statistics>();
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError("");
    void readMenu({ on: day, time_zone: timeZone, stats: "1", stats_offset: offset, limit: 20,
      ...(merchant ? { merchant } : {}), ...(query ? { query } : {}) }, headers, abort.signal).then(result => {
      const page = result.statistics;
      if (!page) throw new Error("当前服务暂未提供菜品统计");
      if (!abort.signal.aborted) setData(previous => {
        if (!offset || !previous) return page;
        const byDish = new Map([...previous.items, ...page.items].map(row => [JSON.stringify([row.food_id, row.merchant, row.name]), row]));
        return { ...page, items: [...byDish.values()] };
      });
    }).catch(reason => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "菜品统计暂不可用");
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [day, timeZone, merchant, query, headers, offset, retry]);

  function search(event: FormEvent) { event.preventDefault(); onQuery(term.trim()); }
  return <section className="dish-statistics" aria-label="实吃菜品统计">
    <form className="dining-search" onSubmit={search}>
      <label>搜索吃过的菜<input value={term} maxLength={160} onChange={e => setTerm(e.target.value)}/></label>
      <button>搜索</button>{query && <button type="button" className="secondary" onClick={() => onQuery("")}>清除搜索</button>}
    </form>
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>重试统计</button></p>}
    {loading && <p role="status">正在读取菜品统计…</p>}
    {data && <>
      <h3>近 30 天实吃</h3>
      <p>{data.from} 至 {data.to} · <strong>{data.dishes} 道菜 · {data.meals} 餐</strong></p>
      <p className="dining-note">按实际吃过的餐次统计，同一道菜在同一餐只计一次。</p>
      {!data.items.length && <p>{query ? "没有匹配的实吃菜品。" : "这段时间还没有实吃记录。"}</p>}
      <ol className="dining-rows">{data.items.map(row => {
        const detail = canOpenDiary ? dailyHref("food", row.last_eaten_on, { domain: "meals", kind: "meal", id: row.meal_id })
          : `?${new URLSearchParams({ tab: "record", section: "timeline", domain: "meals", kind: "meal", id: row.meal_id })}`;
        return <li key={JSON.stringify([row.food_id, row.merchant, row.name])}>
          <div><b>{row.name}</b><small>{[row.merchant ?? "门店未记录", row.stall].filter(Boolean).join(" · ")}</small></div>
          <div><b>{row.meals} 餐</b>{canOpenMeal ? <a href={detail} aria-label={`查看${row.name}最近一餐，${row.last_eaten_on}`}>最近 {row.last_eaten_on}</a>
            : <small>最近 {row.last_eaten_on}</small>}</div>
        </li>;
      })}</ol>
      {data.next_offset != null && !error && <button type="button" className="secondary" disabled={loading}
        onClick={() => setOffset(data.next_offset!)}>加载更多菜品统计</button>}
    </>}
  </section>;
}
