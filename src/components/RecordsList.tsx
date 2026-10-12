import { memo, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ReceiptText, SearchX } from 'lucide-react';
import type { Expense, Transfer } from '../types';
import { utils } from '../lib/utils';
import { categoryLabel } from '../lib/categories';
import { recordDateLabel } from '../lib/ui';
import { CategoryIcon } from './CategoryIcon';

export type RecordItem = (Expense & { type: 'expense' }) | (Transfer & { type: 'transfer' });

export const RecordsList = memo(function RecordsList({ groups, myName, filtered, resetKey, onClear, onExpense, onTransfer }: {
  groups: Record<string, RecordItem[]>; myName: string; filtered: boolean; resetKey: string; onClear: () => void;
  onExpense: (expense: Expense) => void; onTransfer: (transfer: Transfer) => void;
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
      <h3>{filtered ? '找不到符合條件的記錄' : '尚無任何記錄'}</h3>
      <p>{filtered ? '換個關鍵字，或清除篩選再看看。' : '按下新增，記錄這個群組的第一筆花費。'}</p>
      {filtered && <button type="button" className="btn btn-ghost mt-2" onClick={onClear}>清除搜尋與篩選</button>}
    </div> : visible.map(({ date, items }) => <section className="record-day" key={date} aria-label={date === '未設定日期' ? date : utils.fmtDate(date)}>
      <div className="record-day-heading"><time dateTime={date === '未設定日期' ? undefined : date}>{recordDateLabel(date, utils.todayStr())}</time><span>{groups[date].length} 筆</span></div>
      <div className="day-items">
      {items.map(item => {
        if (item.type === 'expense') {
          const myCost = item.participants.includes(myName)
            ? (item.splitMode === 'equal' ? utils.equalShares(item.amount, item.participants) : item.shares || []).find(share => share.name === myName)?.amount || 0
            : 0;
          const included = item.participants.includes(myName);
          const shownAmount = utils.fmt(included ? myCost : item.amount);
          return <button type="button" key={item.id} onClick={() => onExpense(item)} className="record-row"
            aria-label={`${item.desc}，${categoryLabel(item.category)}，${item.payer}先付 NT$${utils.fmt(item.amount)}，${included ? '你的分攤' : '費用總額'} NT$${shownAmount}`}>
            <span className="record-kind"><CategoryIcon category={item.category} /></span>
            <div className="min-w-0">
              <div className="record-name">{item.desc}</div>
              <div className="record-meta">{item.payer}先付 NT${utils.fmt(item.amount)}</div>
            </div>
            <div className="record-amount"><div className="record-amount-label">{included ? '你的分攤' : '費用總額'}</div>
              <div className={`money ${shownAmount.length > 11 ? 'amount-long' : ''}`}><span className="currency">NT$</span>{shownAmount}</div>
            </div>
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
