import { useEffect, useState, type FormEvent } from 'react';
import type { Execute } from './command-controller.js';

const day = 86400000;
export function reviewWeeks(on: string) {
  const date = new Date(on + 'T00:00:00Z');
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * day;
  return [-1, 0, 1, 2].map(offset => new Date(monday + offset * 7 * day).toISOString().slice(0, 10));
}
type Outcome = 'completed' | 'not_done';
type Goal = { id: string; revision: number; key: string; statement: string; state: string; scope: string; kind: string; goal_outcome?: Outcome | null };
const keyFor = (start: string) => 'wellness.week.' + start;
export function WeeklyWellnessAction({on, headers, execute, canWrite}: {on:string; headers:HeadersInit; execute:Execute; canWrite:boolean}) {
  const weeks = reviewWeeks(on);
  const [retry, setRetry] = useState(0), [goals, setGoals] = useState<Goal[]>(), [error, setError] = useState(''), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setGoals(undefined); setError('');
    const load = async () => {
      const response = await fetch('/api/agent/foundation/intentions', {method:'POST', signal:abort.signal, headers:{...headers, 'content-type':'application/json'},
        body:JSON.stringify({on, keys:reviewWeeks(on).slice(0,3).map(keyFor), scenario:'health', include_inactive:true, limit:10})});
      if (!response.ok) throw Error('周行动读取失败，请重试。');
      const body = await response.json();
      if (body.has_more || body.truncation?.truncated) throw Error('未读全周行动，请重试。');
      if (!abort.signal.aborted) setGoals(body.items.filter((item:Goal)=>item.scope==='health' && item.kind==='goal'));
    };
    void load().catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return () => abort.abort();
  }, [on, retry, headers]);

  async function save(index:number, outcome?:Outcome, event?:FormEvent) {
    event?.preventDefault();
    if (busy || !goals) return;
    const start=weeks[index]!, key=keyFor(start), original=goals.find(goal=>goal.key===key);
    const statement=outcome?original?.statement:draft.trim();
    if (!statement) return;
    setBusy(true); setError('');
    try {
      await execute('agent.set_intention', {scope:'health', key, kind:'goal', category:'goal', statement, assertion:'explicit', state:'active',
        valid_from:start, valid_to_exclusive:weeks[index+1], goal_outcome:outcome??null,
        ...(original?{id:original.id, expected_revision:original.revision, reason:outcome?'本人回报周行动结果':'本人调整下一周行动'}:{})}, 'wellness:' + key);
      setDraft(''); setRetry(n=>n+1);
    } catch(e) { setError(e instanceof Error?e.message:'周行动保存失败。'); } finally { setBusy(false); }
  }
  return <section className="weekly-wellness" aria-label="每周一个行动"><h3>每周一个行动</h3>
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>}
    {!goals && !error && <p role="status">正在读取周行动…</p>}
    {goals && weeks.slice(0,3).map((start,index)=>{
      const goal=goals.find(item=>item.key===keyFor(start));
      return <div key={start}><h4>{['上周','本周','下周'][index]} · {start} 起</h4>
        <p>{goal?.statement??'当周没有约定'}{goal && ' · ' + (goal.state==='archived'?'已归档':goal.goal_outcome==='completed'?'已完成':goal.goal_outcome==='not_done'?'本人记录未完成':'尚未记录执行结果')}</p>
        {canWrite && index<2 && goal?.state==='active' && <div className="actions">
          <button type="button" disabled={busy||goal.goal_outcome==='completed'} onClick={()=>void save(index,'completed')}>记为已完成</button>
          <button type="button" className="secondary" disabled={busy||goal.goal_outcome==='not_done'} onClick={()=>void save(index,'not_done')}>记为未完成</button></div>}
        {canWrite && index===2 && <form onSubmit={event=>void save(index,undefined,event)}><label>下一周想做的一件事<input value={draft} onChange={event=>setDraft(event.target.value)} maxLength={300} placeholder="例如，周三晚饭后散步一次"/></label>
          <button disabled={busy||!draft.trim()}>{goal?'更新下周行动':'保存下周行动'}</button></form>}
      </div>;
    })}
  </section>;
}
