import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PiggyBank, TrendingUp } from 'lucide-react';
import type { ExpenseCategory, Group } from '../types';
import { summarizePersonal, personalPeriodLabel } from '../lib/personalFinance';
import { utils } from '../lib/utils';
import { CategoryIcon } from './CategoryIcon';

const colors:Record<ExpenseCategory,string>={food:'#c46b45',shopping:'#4679b8',transport:'#74965f',stay:'#7767a6',bills:'#bf954d',health:'#4b9a98',entertainment:'#b86d91',social:'#bf6d71',insurance:'#64879f',travel:'#598aa9',education:'#9c8d55',haircut:'#8c7a70',other:'#8c9292'};
export const moneyFromCents=(value:number)=>utils.fmt(utils.fromCents(value));
export function FinanceTotals({incomeCents,expenseCents,balanceCents}:{incomeCents:number;expenseCents:number;balanceCents:number}) {
  return <div className="finance-totals">{([{label:'收入',value:incomeCents,className:'finance-income'},{label:'支出',value:expenseCents,className:''},{label:'結餘',value:balanceCents,className:balanceCents<0?'finance-negative':''}]).map(item=><div key={item.label}><div className="stat-label">{item.label}</div><div className={`money ${item.className}`}><span className="currency">NT$</span>{moneyFromCents(item.value)}</div></div>)}</div>;
}
export function PersonalStatistics({group,period:requested,onPeriod,onRecords}:{group:Group;period:string;onPeriod:(period:string)=>void;onRecords?:(category:string,period:string,tag?:string)=>void}) {
  const period=/^\d{4}(?:-\d{2})?$/.test(requested)?requested:utils.todayStr().slice(0,7);
  const yearly=period.length===4;
  const [metric,setMetric]=useState<'expense'|'income'>('expense');
  const [selection,setSelection]=useState<{period:string;index:number}|null>(null);
  const [category,setCategory]=useState<ExpenseCategory|null>(null);
  const stats=useMemo(()=>summarizePersonal(group,period),[group,period]);
  const years=[...new Set([utils.todayStr().slice(0,4),period.slice(0,4),...[...group.expenses,...group.incomes||[],...group.savings||[]].map(record=>record.date.slice(0,4))])].sort().reverse();
  const selected=selection?.period===period?stats.points[selection.index]:null;
  const values=stats.points.map(point=>metric==='expense'?point.expenseCents:point.incomeCents);
  const maximum=Math.max(...values,0), total=metric==='expense'?stats.expenseCents:stats.incomeCents;
  const metricLabel=metric==='expense'?'支出':'收入';
  const changePeriod=(direction:number)=>{
    if(yearly)onPeriod(String(Number(period)+direction));
    else {const date=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5))-1+direction,1));onPeriod(`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`);}
  };
  const selectedCategory=stats.categories.find(item=>item.id===category);
  let offset=0;
  return <div className="personal-statistics">
    <div className="report-mode" role="group" aria-label="統計期間"><button type="button" aria-pressed={!yearly} onClick={()=>onPeriod(yearly?period+'-'+utils.todayStr().slice(5,7):period)}>月報</button><button type="button" aria-pressed={yearly} onClick={()=>onPeriod(period.slice(0,4))}>年報</button></div>
    <div className="report-period"><button type="button" className="icon-btn" aria-label={yearly?'上一年':'上一個月'} onClick={()=>changePeriod(-1)}><ChevronLeft size={20}/></button><div><label className="sr-only" htmlFor="report-year">年份</label><select id="report-year" value={period.slice(0,4)} onChange={event=>onPeriod(event.target.value+(yearly?'':period.slice(4)))}>{years.map(year=><option key={year} value={year}>{year} 年</option>)}</select>{!yearly&&<><label className="sr-only" htmlFor="report-month">月份</label><select id="report-month" value={period.slice(5)} onChange={event=>onPeriod(period.slice(0,4)+'-'+event.target.value)}>{Array.from({length:12},(_,index)=><option key={index} value={String(index+1).padStart(2,'0')}>{index+1} 月</option>)}</select></>}</div><button type="button" className="icon-btn" aria-label={yearly?'下一年':'下一個月'} onClick={()=>changePeriod(1)}><ChevronRight size={20}/></button></div>
    <section className="report-card report-overview" aria-label={personalPeriodLabel(period)+'收支總覽'}><FinanceTotals {...stats}/><p className="report-caption">結餘＝收入－支出，儲蓄另列</p>{stats.futureCount>0&&<p className="report-caption">含 {stats.futureCount} 筆未到期記錄，預排支出 NT$ {moneyFromCents(stats.futureExpenseCents)}</p>}</section>
    <section className="report-card" aria-label={yearly?'每月收支趨勢':'每日收支趨勢'}>
      <div className="report-card-heading"><h3>{yearly?'每月':'每日'}{metricLabel}</h3><div className="report-metric" role="group" aria-label="圖表項目"><button type="button" aria-pressed={metric==='expense'} onClick={()=>setMetric('expense')}>支出</button><button type="button" aria-pressed={metric==='income'} onClick={()=>setMetric('income')}>收入</button></div></div>
      <div className="report-chart-summary"><span>最高 NT$ {moneyFromCents(maximum)}</span><span>{yearly?'月均':'日均'} NT$ {moneyFromCents(Math.round(total/stats.divisor))}</span></div>
      <svg className="report-bars" viewBox="0 0 640 190" role="group" aria-label={`${personalPeriodLabel(period)}${yearly?'每月':'每日'}${metricLabel}，點選長條可查看金額`}>
        {[0,1,2,3].map(line=><line key={line} x1="2" x2="638" y1={14+line*46} y2={14+line*46} className="report-grid-line"/>)}
        {stats.points.map((point,index)=>{const width=636/stats.points.length,value=values[index],height=maximum?value/maximum*138:0;return <g key={point.key} role="button" tabIndex={0} aria-label={`${point.key} ${metricLabel} NT$${moneyFromCents(value)}`} onClick={()=>setSelection({period,index})} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelection({period,index});}}}><title>{point.key} · {metricLabel} NT$ {moneyFromCents(value)}</title><rect x={2+index*width} y="8" width={width} height="146" fill="transparent"/><rect x={3+index*width} y={152-Math.max(height,value>0?2:0)} width={Math.max(3,width-5)} height={Math.max(height,value>0?2:0)} rx="4" className={selection?.period===period&&selection.index===index?'report-bar selected':'report-bar'}/>{(yearly||index===0||(index+1)%5===0||index===stats.points.length-1&&stats.points.length%5>=3)&&<text x={2+index*width+width/2} y="180" textAnchor="middle">{point.label}{yearly?'月':''}</text>}</g>;})}
      </svg>
      {selected?<div className="report-selection"><span>{selected.key} · {metricLabel} NT$ {moneyFromCents(metric==='expense'?selected.expenseCents:selected.incomeCents)}</span>{onRecords&&<button type="button" className="btn btn-sm" onClick={()=>onRecords(metric==='income'?'income':'expense',selected.key)}>{yearly?'查看該月明細':'查看當日明細'}</button>}</div>:<p className="report-caption">點選長條查看{yearly?'月份':'日期'}金額</p>}
    </section>
    <section className="report-card" aria-label="支出分類分布"><div className="report-card-heading"><h3>支出分布</h3><span>{stats.expenseCount} 筆</span></div>
      {stats.expenseCount>0?<><div className="report-donut"><svg viewBox="0 0 240 240" role="group" aria-label="支出分類圓環圖">{stats.categories.map(bucket=>{const size=bucket.cents/stats.expenseCents*100,start=offset;offset+=size;return <circle key={bucket.id} cx="120" cy="120" r="84" fill="none" stroke={colors[bucket.id]} strokeWidth={category===bucket.id?46:40} pathLength="100" strokeDasharray={`${size} ${100-size}`} strokeDashoffset={-start} transform="rotate(-90 120 120)" role="button" tabIndex={0} aria-label={`${bucket.label} ${size.toFixed(1)}%，NT$${moneyFromCents(bucket.cents)}`} onClick={()=>setCategory(bucket.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setCategory(bucket.id);}}}><title>{bucket.label} {size.toFixed(1)}%</title></circle>;})}</svg><div className="report-donut-center"><strong>{selectedCategory?.label||'支出'}</strong><span>{selectedCategory?(selectedCategory.cents/stats.expenseCents*100).toFixed(1)+'%':`${stats.categories.length} 個分類`}</span></div></div>
        {stats.categories.map(bucket=><button type="button" className="report-category-row" key={bucket.id} onClick={()=>onRecords?onRecords(bucket.id,period):setCategory(bucket.id)}><span className="report-category-dot" style={{background:colors[bucket.id]}}/><CategoryIcon category={bucket.id} size={19}/><div><strong>{bucket.label}</strong><p>{bucket.count} 筆 · {(bucket.cents/stats.expenseCents*100).toFixed(1)}%{bucket.count>1?` · 平均 ${moneyFromCents(Math.round(bucket.cents/bucket.count))}`:''}</p></div><span className="money">NT$ {moneyFromCents(bucket.cents)}</span><ChevronRight size={16}/></button>)}</>:<div className="report-empty">這段期間還沒有支出</div>}
    </section>
    <section className="report-card"><div className="report-card-heading"><h3>收入與儲蓄</h3></div><button type="button" className="report-income-row" onClick={()=>onRecords?.('income',period)}><TrendingUp size={21}/><div><strong>收入</strong><p>{stats.incomeCount} 筆</p></div><span className="money finance-income">NT$ {moneyFromCents(stats.incomeCents)}</span><ChevronRight size={16}/></button><button type="button" className="report-income-row" onClick={()=>onRecords?.('saving',period)}><PiggyBank size={21}/><div><strong>儲蓄</strong><p>{stats.savingCount} 筆 · 資金移轉</p></div><span className="money">NT$ {moneyFromCents(stats.savingOutCents-stats.savingInCents)}</span><ChevronRight size={16}/></button>{stats.savingInCents>0&&<p className="report-caption">存入 NT$ {moneyFromCents(stats.savingOutCents)} · 轉回 NT$ {moneyFromCents(stats.savingInCents)}</p>}</section>
    {stats.tags.length>0&&<section className="report-card"><div className="report-card-heading"><h3>付款標籤</h3></div>{stats.tags.map(tag=><button type="button" className="report-tag-row" key={tag.label} onClick={()=>onRecords?.('cashflow',period,tag.label)}><span>{tag.label}<small>{tag.count} 筆</small></span><div><span>支出 NT$ {moneyFromCents(tag.expenseCents)}</span>{tag.incomeCents>0&&<small>收入 NT$ {moneyFromCents(tag.incomeCents)}</small>}</div></button>)}</section>}
  </div>;
}
