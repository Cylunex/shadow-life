import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { agentCatalogSnapshotSchema, diffAgentCatalogs, type AgentCapability, type AgentDiscoverResult, type AgentScenario, type AgentScenarioName, type AgentTerm } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";
import { canDebugExecute, loadAgentGlossary, loadAgentScenarios, loadAgentSnapshot, loadAgentTools, runAgentTool, validateToolInput } from "./agent-tools.js";

const message = (error: unknown) => error instanceof Error ? error.message : "操作失败";
export function AgentToolsPanel({ headers, execute, onClose, onChanged }: { headers: HeadersInit; execute: Execute; onClose: () => void; onChanged: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null), generation = useRef(0);
  const [query, setQuery] = useState(""), [scenario, setScenario] = useState<AgentScenarioName | "">(""), [readOnly, setReadOnly] = useState(false);
  const [scenarios, setScenarios] = useState<AgentScenario[]>([]), [terms, setTerms] = useState<AgentTerm[]>([]), [catalog, setCatalog] = useState<AgentDiscoverResult>();
  const [selected, setSelected] = useState<AgentCapability>(), [input, setInput] = useState("{}"), [result, setResult] = useState<unknown>(), [resultTitle, setResultTitle] = useState("");
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string>(), [elapsed, setElapsed] = useState<number>();
  const [diff, setDiff] = useState<ReturnType<typeof diffAgentCatalogs>>();
  const [offset, setOffset] = useState(0);
  useEffect(() => { dialog.current?.showModal(); return () => { generation.current++; }; }, []);
  async function search(offset = 0) {
    const current = ++generation.current; setLoading(true); setError(undefined);
    try {
      const value = await loadAgentTools(fetch, headers, { query, ...(scenario ? { scenario } : {}), offset, readOnly });
      if (current !== generation.current) return;
      setCatalog(value); setOffset(offset); setSelected(undefined); setResult(undefined); setElapsed(undefined); setDiff(undefined);
    } catch (caught) { if (current === generation.current) setError(message(caught)); }
    finally { if (current === generation.current) setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void Promise.all([loadAgentScenarios(fetch, headers), loadAgentGlossary(fetch, headers)]).then(([bundles, glossary]) => { if (active) { setScenarios(bundles.scenarios); setTerms(glossary.terms); } }).catch(caught => { if (active) setError(message(caught)); });
    void search(); return () => { active = false; };
  }, []);
  function choose(tool: AgentCapability) {
    setSelected(tool); setResult(undefined); setElapsed(undefined); setError(undefined);
    const example = tool.example;
    setInput(JSON.stringify(tool.mode === "write" ? example?.input ?? {} : example ?? {}, null, 2));
  }
  async function invoke(action: "validate" | "execute") {
    if (!selected) return;
    setPending(true); setError(undefined); setResult(undefined); const started = performance.now();
    try {
      const parsed: unknown = JSON.parse(input);
      if (action === "validate") {
        const value = await validateToolInput(fetch, headers, selected.name, parsed);
        setResultTitle(value.valid ? "参数校验通过 · 未执行" : "参数校验未通过 · 未执行"); setResult(value);
      } else {
        const value = await runAgentTool(fetch, headers, execute, selected.name, parsed);
        setResultTitle(value.mode === "write" ? "已提交 · 服务端执行回执" : "查询结果"); setResult(value.value);
        if (value.mode === "write") { try { await onChanged(); } catch { setError("操作已提交，页面刷新失败；请根据回执重新读取记录。"); } }
      }
    } catch (caught) { setError(message(caught)); }
    finally { setElapsed(Math.round(performance.now() - started)); setPending(false); }
  }
  async function exportSnapshot() {
    setPending(true); setError(undefined);
    try {
      const value = await loadAgentSnapshot(fetch, headers), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `life-agent-catalog-${value.catalog_revision.slice(0, 12)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setError(message(caught)); } finally { setPending(false); }
  }
  async function compareSnapshot(file: File | undefined) {
    if (!file) return; setPending(true); setError(undefined); setDiff(undefined);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("目录文件超过 10 MiB。");
      const previous = agentCatalogSnapshotSchema.parse(JSON.parse(await file.text()));
      setDiff(diffAgentCatalogs(previous, await loadAgentSnapshot(fetch, headers)));
    } catch (caught) { setError(message(caught)); } finally { setPending(false); }
  }
  return <dialog ref={dialog} className="agent-tools-dialog" onCancel={onClose} aria-labelledby="agent-tools-title">
    <div className="panel-heading"><div><span className="eyebrow">AGENT TOOLS</span><h2 id="agent-tools-title">能力目录与调试</h2><p>术语、场景与工具来自 Life 的同一份公开合同。</p></div><button type="button" aria-label="关闭能力目录" onClick={onClose}>关闭</button></div>
    <form className="agent-tool-search" onSubmit={(event: FormEvent) => { event.preventDefault(); void search(); }}>
      <label>任务或术语<input value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：退款、照常、次卡、复购" maxLength={200}/></label>
      <label>场景<select value={scenario} onChange={event => setScenario(event.target.value as AgentScenarioName | "")}><option value="">全部场景</option>{scenarios.map(item => <option key={item.name} value={item.name}>{item.title}</option>)}</select></label>
      <label className="agent-read-toggle"><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)}/>只看查询工具</label>
      <button disabled={loading || pending}>{loading ? "检索中…" : "检索"}</button>
    </form>
    {scenario && <aside className="agent-scenario-note">{scenarios.find(item => item.name === scenario)?.instructions.map(item => <p key={item}>{item}</p>)}</aside>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="agent-tool-layout"><section aria-label="工具检索结果"><p>{catalog ? `${catalog.total} 个匹配工具` : "正在读取目录…"}</p>
      {catalog && !catalog.capabilities.length && <p className="empty-copy">没有匹配的获准工具，请更换术语或场景。</p>}
      {catalog?.capabilities.map(tool => <button disabled={pending} className={`agent-tool-card ${selected?.name === tool.name ? "active" : ""}`} key={tool.name} onClick={() => choose(tool)}><b>{tool.name}</b><span>{tool.mode === "read" ? "查询" : "写入"}</span><p>{tool.description}</p></button>)}
      {catalog && <div className="agent-tool-pages"><button disabled={loading || pending || offset === 0} onClick={() => void search(Math.max(0, offset - 20))}>上一页</button><button disabled={loading || pending || catalog.next_offset === null} onClick={() => void search(catalog.next_offset ?? 0)}>下一页</button></div>}
    </section><section aria-label="工具参数与结果">{selected ? <><h3>{selected.name}</h3><p>{selected.mode === "write" ? "实际执行会保存数据，并使用正常命令、版本检查和回执恢复机制。" : "执行查询不会写入生活事实。"}</p>
      {catalog?.terms.filter(term => selected.matched_terms.includes(term.id)).map(term => <article key={term.id}><b>{term.title}</b><p>{term.definition}</p><ul>{term.boundaries.map(item => <li key={item}>{item}</li>)}</ul></article>)}
      <label>输入参数 JSON<textarea className="agent-tool-input" spellCheck={false} value={input} disabled={pending} onChange={event => setInput(event.target.value)}/></label>
      {selected.example && <small>示例为虚构数据；记录 ID、日期和事实请替换为实际值。</small>}
      <div className="agent-tool-actions"><button disabled={pending} onClick={() => void invoke("validate")}>仅校验参数</button><button disabled={pending || !canDebugExecute(selected.name)} onClick={() => void invoke("execute")}>{pending ? "处理中…" : selected.mode === "write" ? "执行并保存" : "执行查询"}</button></div>
      {!canDebugExecute(selected.name) && <p>此工具通过专用入口执行；这里可以查看合同和校验参数。</p>}
      <details><summary>输入与结果 Schema</summary><pre>{JSON.stringify({ input: selected.input_schema, result: selected.result_schema }, null, 2)}</pre></details>
      {result !== undefined && <><h4>{resultTitle}</h4><pre className="agent-tool-result">{JSON.stringify(result, null, 2)}</pre></>}{elapsed !== undefined && <small>本次耗时 {elapsed} ms</small>}
    </> : <p className="empty-copy">选择工具查看口径、示例、Schema 和执行结果。</p>}</section></div>
    <details><summary>业务术语与事实边界</summary>{terms.map(term => <article key={term.id}><h4>{term.title}</h4><p>{term.aliases.join("、")}</p><p>{term.definition}</p><ul>{term.boundaries.map(item => <li key={item}>{item}</li>)}</ul></article>)}</details>
    <details><summary>目录快照与变更比较</summary><p>快照仅含当前获准能力和公开合同。不同账号或权限范围也会造成差异；比较不会发布或恢复配置。</p><div className="agent-tool-actions"><button disabled={pending} onClick={() => void exportSnapshot()}>导出当前目录</button><label>选择旧目录比较<input disabled={pending} type="file" accept="application/json,.json" onChange={event => { void compareSnapshot(event.target.files?.[0]); event.target.value = ""; }}/></label></div>{catalog && <small>目录摘要 {catalog.catalog_revision.slice(0, 12)}</small>}{diff && <pre>{JSON.stringify(diff, null, 2)}</pre>}</details>
  </dialog>;
}
