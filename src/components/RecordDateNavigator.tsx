import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Group } from '../types';
import { shiftRecordMonth } from '../lib/recordViews';
import { utils } from '../lib/utils';

export function RecordDateNavigator({ group, period, day, view, months, onPeriod, onDay, onView, onToday }: {
  group: Group; period: string; day: string; view: 'day' | 'month'; months: string[];
  onPeriod: (period: string) => void; onDay: (day: string) => void; onView: (view: 'day' | 'month') => void; onToday: () => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const today = utils.todayStr();
  const month = period.length === 7 ? period : today.slice(0,7);
  const dates = Array.from({ length: new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 0)).getUTCDate() }, (_,index) => `${month}-${String(index+1).padStart(2,'0')}`);
  const monthChoices = [...new Set([month, period, today.slice(0,7), ...months].filter(value=>value.length===7))].sort().reverse();
  const yearChoices = [...new Set([...monthChoices.map(value=>value.slice(0,4)), ...(period.length===4?[period]:[])])].sort().reverse();
  const daysWithExpense = useMemo(() => new Set(group.expenses.filter(record=>record.date.startsWith(month+'-')).map(record=>record.date)),[group.expenses,month]);
  useEffect(() => {
    const selected = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected && strip.current) strip.current.scrollLeft = Math.max(0, selected.offsetLeft - (strip.current.clientWidth - selected.offsetWidth)/2);
  }, [day, month, view]);
  return <div className="record-date-navigator">
    <div className="record-month-nav">
      <button type="button" className="icon-btn" aria-label={period.length===4?"明細上一年":"明細上一個月"} disabled={!period} onClick={()=>onPeriod(period.length===4?String(Number(period)-1):shiftRecordMonth(period,-1))}><ChevronLeft size={19}/></button>
      <label className="sr-only" htmlFor="record-month">明細期間</label><select id="record-month" value={period} onChange={event=>onPeriod(event.target.value)}>
        <option value="">全部期間</option><optgroup label="全年">{yearChoices.map(year=><option key={year} value={year}>{year} 全年</option>)}</optgroup><optgroup label="月份">{monthChoices.map(value=><option key={value} value={value}>{value.replace('-',' / ')}</option>)}</optgroup>
      </select>
      <button type="button" className="icon-btn" aria-label={period.length===4?"明細下一年":"明細下一個月"} disabled={!period} onClick={()=>onPeriod(period.length===4?String(Number(period)+1):shiftRecordMonth(period,1))}><ChevronRight size={19}/></button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onToday}>今天</button>
    </div>
    <div className="record-view-mode" role="group" aria-label="帳本瀏覽方式"><button type="button" aria-pressed={view==='day'} onClick={()=>{if(period.length!==7){onPeriod(today.slice(0,7));onDay(today);}onView('day');}}>按日看</button><button type="button" aria-pressed={view==='month'} onClick={()=>onView('month')}>整月看</button></div>
    {view==='day'&&<div className="record-date-strip" ref={strip} role="tablist" aria-label="選擇記帳日期">{dates.map(date=><button type="button" role="tab" key={date} aria-selected={date===day} aria-label={utils.fmtDate(date)+(date===today?'，今天':'')} tabIndex={date===day?0:-1} onClick={()=>onDay(date)} onKeyDown={event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
      event.preventDefault();const index=dates.indexOf(date)+(event.key==='ArrowRight'?1:-1),next=dates[index];
      if(next){onDay(next);requestAnimationFrame(()=>strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({preventScroll:true}));}
    }}><span>{date===today?'今天':['日','一','二','三','四','五','六'][new Date(date+'T12:00:00').getDay()]}</span><strong>{Number(date.slice(8))}</strong><i data-spending={daysWithExpense.has(date)} aria-hidden="true"/></button>)}</div>}
  </div>;
}
