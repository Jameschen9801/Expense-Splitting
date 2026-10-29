import { memo, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, PiggyBank, ReceiptText, SearchX, TrendingUp } from 'lucide-react';
import type { Expense, Income, Saving, Transfer } from '../types';
import { utils } from '../lib/utils';
import { categoryLabel } from '../lib/categories';
import { recordDateLabel } from '../lib/ui';
import { CategoryIcon } from './CategoryIcon';
import { memberExpenseAmount } from '../lib/sharedExpenses';
import { recordTotals, type RecordItem } from '../lib/recordViews';

export type { RecordItem } from '../lib/recordViews';

export const RecordsList = memo(function RecordsList({ groups, myName, personal = false, filtered, resetKey, onClear, onExpense, onTransfer, onCashflow, showDayHeadings = true, dailyLabel, emptyTitle }: {
  personal?: boolean;
  groups: Record<string, RecordItem[]>; myName: string; filtered: boolean; resetKey: string; onClear: () => void;
  onExpense: (expense: Expense) => void; onTransfer: (transfer: Transfer) => void;
  onCashflow?: (record: Income|Saving, kind:'income'|'saving')=>void;
  showDayHeadings?: boolean; dailyLabel?: string; emptyTitle?: string;
}) {
  const [limit, setLimit] = useState(50);
  // Cloud updates must not collapse an already expanded list while it is being read.
  useEffect(() => { setLimit(50); }, [resetKey]);
  const visible = useMemo(() => {
    let remaining = limit;
    return Object.entries(groups).flatMap(([date, items]) => {
      const batch = items.slice(0, Math.max(0, remaining));
      remaining -= batch.length;
      return batch.length ? [{ date, items: batch }] : [];
    });
  }, [groups, limit]);
  const total = Object.values(groups).reduce((sum, items) => sum + items.length, 0);

  return <div className="records-list">
    {total === 0 ? <div className="empty-state">
      <span className="empty-icon">{filtered ? <SearchX size={28} aria-hidden="true" /> : <ReceiptText size={28} aria-hidden="true" />}</span>
      <h3>{filtered ? '找不到符合條件的記錄' : emptyTitle || '尚無任何記錄'}</h3>
      <p>{filtered ? '換個關鍵字，或清除篩選再看看。' : personal ? '按下新增，記錄第一筆支出、收入或儲蓄。' : '按下新增，記錄這個帳本的第一筆花費。'}</p>
      {filtered && <button type="button" className="btn btn-ghost mt-2" onClick={onClear}>清除搜尋與篩選</button>}
    </div> : visible.map(({ date, items }) => <section className="record-day" key={date} aria-label={date === '未設定日期' ? date : utils.fmtDate(date)}>
      {showDayHeadings && <div className="record-day-heading"><div className="record-day-date"><time dateTime={date === '未設定日期' ? undefined : date}>{recordDateLabel(date, utils.todayStr())}</time><span>{groups[date].length} 筆</span></div>{(() => {
        const rows=groups[date],total=recordTotals(rows,myName,personal);
        const hasExpense=rows.some(row=>row.type==='expense'),hasSaving=rows.some(row=>row.type==='saving');
        const savingCents=rows.reduce((sum,row)=>sum+(row.type==='saving'?(row.direction==='in'?-1:1)*utils.toCents(row.amount):0),0);
        return <div className="record-day-totals">{hasExpense&&<span className="record-day-expense">{dailyLabel || (personal ? '支出' : '我的分攤')} NT$ {utils.fmt(utils.fromCents(total.expenseCents))}</span>}{total.incomeCents>0&&<span className="finance-income">收入 NT$ {utils.fmt(utils.fromCents(total.incomeCents))}</span>}{hasSaving&&<span>儲蓄淨存入 NT$ {utils.fmt(utils.fromCents(savingCents))}</span>}</div>;
      })()}</div>}
      <div className="day-items">
      {items.map(item => {
        if(item.type==='income'||item.type==='saving'){
          const label=item.type==='income'?'收入':item.direction==='in'?'儲蓄轉回':'存入儲蓄';
          return <button type="button" key={item.id} className="record-row" onClick={()=>onCashflow?.(item,item.type)} aria-label={`${item.desc}，${label} NT$${utils.fmt(item.amount)}`}><span className="record-kind">{item.type==='income'?<TrendingUp size={20}/>:<PiggyBank size={20}/>}</span><div className="min-w-0"><div className="record-name">{item.desc}</div><div className="record-meta">{label}{item.date>utils.todayStr()?' · 預排':''}</div></div><div className="record-amount"><div className="record-amount-label">{label}</div><div className={`money ${item.type==='income'?'finance-income':''}`}><span className="currency">NT$</span>{utils.fmt(item.amount)}</div></div></button>;
        }
        if (item.type === 'expense') {
          const myCost = memberExpenseAmount(item, myName);
          const showAmount = personal || myCost > 0;
          const shownAmount = utils.fmt(personal ? item.amount : myCost);
          return <button type="button" key={item.id} onClick={() => onExpense(item)} className="record-row"
            aria-label={personal ? `${item.desc}，${categoryLabel(item.category)}，支出 NT$${shownAmount}${item.sharedSource ? '，來自' + item.sharedSource.groupName : ''}` : `${item.desc}，${categoryLabel(item.category)}，${item.payer}先付 NT$${utils.fmt(item.amount)}，${myCost > 0 ? '你的分攤 NT$' + shownAmount : '你不需負擔'}`}>
            <span className="record-kind"><CategoryIcon category={item.category} /></span>
            <div className="min-w-0">
              <div className="record-name">{item.desc}</div>
              <div className="record-meta">{personal ? (item.sharedSource ? `分攤 · ${item.sharedSource.groupName}` : categoryLabel(item.category))+(item.date>utils.todayStr()?' · 預排':'') : item.payer + '先付 NT$' + utils.fmt(item.amount)}</div>
            </div>
            {showAmount && <div className={`record-amount ${!personal ? 'record-own-expense' : ''}`}><div className="record-amount-label">{personal ? '支出' : '你的分攤'}</div>
              <div className={`money ${shownAmount.length > 11 ? 'amount-long' : ''}`}><span className="currency">NT$</span>{shownAmount}</div>
            </div>}
          </button>;
        }
        const shownAmount = utils.fmt(item.amount);
        return <button type="button" key={item.id} onClick={() => onTransfer(item)} className="record-row">
          <span className="record-kind"><ArrowLeftRight size={20} aria-hidden="true" /></span>
          <div className="min-w-0">
            <div className="record-name">{item.from} <span className="text-ink-3 font-normal text-xs">轉給</span> {item.to}</div>
            <div className="record-meta">{item.note || '分攤款轉帳'}</div>
          </div>
          <div className="record-amount"><div className="record-amount-label">轉帳金額</div><div className={`money ${shownAmount.length > 11 ? 'amount-long' : ''}`}><span className="currency">NT$</span>{shownAmount}</div></div>
        </button>;
      })}
      </div>
    </section>)}
    {limit < total && <div className="py-4 text-center">
      <button type="button" className="btn btn-ghost w-full" onClick={() => setLimit(value => value + 50)}>載入更多（還有 {total - limit} 筆）</button>
    </div>}
  </div>;
});
