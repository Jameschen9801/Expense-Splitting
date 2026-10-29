import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Expense, Group, Income, Saving, Transfer } from '../types';
import { detailCategoryLabel, recordGroups, recordTotals, type RecordItem, type StatisticsDetail } from '../lib/recordViews';
import { personalPeriodLabel } from '../lib/personalFinance';
import { utils } from '../lib/utils';
import { RecordsList } from './RecordsList';

export const statisticsDetailTitle = (detail: StatisticsDetail) => detail.tag ? `${detail.tag}明細` : detailCategoryLabel(detail.category)+'明細';
export function StatisticsRecords({group,myName,detail,onBack,onExpense,onTransfer,onCashflow}:{
  group:Group;myName:string;detail:StatisticsDetail;onBack:()=>void;onExpense:(expense:Expense)=>void;onTransfer:(transfer:Transfer)=>void;onCashflow:(record:Income|Saving,kind:'income'|'saving')=>void;
}) {
  const [search,setSearch]=useState('');
  const groups:Record<string,RecordItem[]>=useMemo(()=>recordGroups(group,myName,{...detail,search}),[group.expenses,group.incomes,group.savings,group.transfers,myName,detail,search]);
  const rows=Object.values(groups).flat(),totals=recordTotals(rows,myName,group.kind==='personal');
  const amount=group.kind!=='personal'?rows.reduce((sum,record)=>sum+(record.type==='expense'?utils.toCents(record.amount):0),0):detail.category==='income'?totals.incomeCents:detail.category==='saving'?rows.reduce((sum,record)=>sum+(record.type==='saving'?(record.direction==='in'?-1:1)*utils.toCents(record.amount):0),0):totals.expenseCents;
  return <section className="statistics-records" aria-label="統計明細">
    <div className="report-detail-overview"><p>{detail.period ? detail.period.length===10?utils.fmtDate(detail.period):personalPeriodLabel(detail.period) : '全部期間'} · {group.name}</p><h2>{statisticsDetailTitle(detail)}</h2>{detail.tag&&<span>支出</span>}<div className={`money ${detail.category==='income'?'finance-income':''}`}>NT$ {utils.fmt(utils.fromCents(amount))}</div><span>{rows.length} 筆{detail.category==='saving'?' · 資金移轉，不計入收支':''}</span>{detail.tag&&totals.incomeCents>0&&<p>另有收入 NT$ {utils.fmt(utils.fromCents(totals.incomeCents))}</p>}{group.kind!=='personal'&&<p>我的分攤 NT$ {utils.fmt(utils.fromCents(totals.expenseCents))}</p>}</div>
    <div className="record-search-wrap"><Search size={18} aria-hidden="true"/><label className="sr-only" htmlFor="statistics-record-search">搜尋統計明細</label><input id="statistics-record-search" type="search" className="record-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜尋這份明細" enterKeyHint="search"/></div>
    <RecordsList groups={groups} personal={group.kind==='personal'} myName={myName} filtered={!!search} resetKey={JSON.stringify([detail,search])} onClear={()=>setSearch('')} onExpense={onExpense} onTransfer={onTransfer} onCashflow={onCashflow} dailyLabel="明細小計"/>
    <button type="button" className="btn btn-ghost w-full mt-4" onClick={onBack}>返回統計</button>
  </section>;
}
