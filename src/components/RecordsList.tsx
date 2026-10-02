import { memo, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Expense, Transfer } from '../types';
import { utils } from '../lib/utils';

export type RecordItem = (Expense & { type: 'expense' }) | (Transfer & { type: 'transfer' });

export const RecordsList = memo(function RecordsList({ groups, myName, filtered, onExpense, onTransfer }: {
  groups: Record<string, RecordItem[]>; myName: string; filtered: boolean;
  onExpense: (expense: Expense) => void; onTransfer: (transfer: Transfer) => void;
}) {
  const [limit, setLimit] = useState(50);
  useEffect(() => { setLimit(50); }, [groups]);
  const visible = useMemo(() => {
    let remaining = limit;
    return Object.entries(groups).flatMap(([date, items]) => {
      const batch = items.slice(0, Math.max(0, remaining));
      remaining -= batch.length;
      return batch.length ? [{ date, items: batch }] : [];
    });
  }, [groups, limit]);
  const total = Object.values(groups).reduce((sum, items) => sum + items.length, 0);

  return <div className="px-4.5">
    {total === 0 ? <div className="text-center py-10 text-ink-3 text-sm leading-relaxed">
      {filtered ? '找不到符合條件的記錄' : '尚無任何記錄'}
    </div> : visible.map(({ date, items }) => <div key={date}>
      <div className="flex justify-between items-center py-2.5 border-b border-line mt-1.5 uppercase text-[11px] tracking-[2px] text-ink-3">
        <span>{date === '未設定日期' ? date : utils.fmtDate(date)}</span>
      </div>
      {items.map(item => {
        if (item.type === 'expense') {
          const myCost = item.participants.includes(myName)
            ? (item.splitMode === 'equal' ? utils.equalShares(item.amount, item.participants) : item.shares || []).find(share => share.name === myName)?.amount || 0
            : 0;
          return <button type="button" key={item.id} onClick={() => onExpense(item)}
            className="w-[calc(100%+2.25rem)] text-left py-3 border-b border-line last:border-b-0 flex items-center justify-between gap-3 cursor-pointer hover:bg-paper-2 -mx-4.5 px-4.5 focus-visible:bg-paper-2">
            <div className="min-w-0 flex-1">
              <div className="text-[16px] tracking-wide font-medium text-ink truncate">{item.desc}</div>
              <div className="text-[12px] text-ink-3 tracking-tight mt-0.5 truncate">{item.payer} 先付 NT${utils.fmt(item.amount)}</div>
            </div>
            {myCost > 0 && <div className="text-right shrink-0">
              <div className="text-[11px] text-ink-3 mb-0.5">你的分攤</div>
              <div className="text-[18px] font-medium tracking-[0.5px] text-red-700">NT${utils.fmt(myCost)}</div>
            </div>}
          </button>;
        }
        return <button type="button" key={item.id} onClick={() => onTransfer(item)}
          className="w-[calc(100%+2.25rem)] text-left py-3 border-b border-line last:border-b-0 flex items-center gap-2.5 cursor-pointer hover:bg-paper-2 focus-visible:bg-paper-2 -mx-4.5 px-4.5">
          <ArrowRight size={14} className="text-ink-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-ink truncate">{item.from} <span className="text-ink-3 font-normal text-[12px] mx-1">轉給</span> {item.to}</div>
            {item.note && <div className="text-[11px] text-ink-3 mt-0.5 truncate">{item.note}</div>}
          </div>
          <div className="ml-auto text-right"><div className="text-[17px] font-medium tracking-[0.5px]">NT${utils.fmt(item.amount)}</div></div>
        </button>;
      })}
    </div>)}
    {limit < total && <div className="py-4 text-center">
      <button type="button" className="btn btn-ghost w-full" onClick={() => setLimit(value => value + 50)}>載入更多（還有 {total - limit} 筆）</button>
    </div>}
  </div>;
});
