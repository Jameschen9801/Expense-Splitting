import { useMemo } from 'react';
import type { Group } from '../types';
import { summarizeExpenses } from '../lib/categories';
import { utils } from '../lib/utils';

export function Statistics({ group, myName, month, onMonth }: { group: Group; myName: string; month: string; onMonth: (month: string) => void }) {
  const stats = useMemo(() => summarizeExpenses(group.expenses, myName, month), [group.expenses, myName, month]);
  const months = [...new Set([...group.expenses, ...group.transfers].map(record => record.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  return <div className="panel">
    <div className="panel-header p-4 border-b border-line"><span className="section-label">支出統計</span></div>
    <div className="p-4">
      <label className="field-label" htmlFor="stats-month">期間</label>
      <select id="stats-month" value={month} onChange={event => onMonth(event.target.value)}>
        <option value="">全部月份</option>
        {months.map(value => <option key={value} value={value}>{value.replace('-', ' 年 ')} 月</option>)}
      </select>
      <div className="grid grid-cols-2 gap-3 mt-4">
        {[['群組支出', stats.total], ['我的分攤', stats.mine], ['我先付款', stats.paid], ['費用筆數', stats.count]].map(([label, value]) =>
          <div className="rounded-2xl border border-line p-3" key={label}><div className="text-xs text-ink-3 mb-1">{label}</div><div className="text-base font-medium">{label === '費用筆數' ? value + ' 筆' : 'NT$ ' + utils.fmt(value as number)}</div></div>
        )}
      </div>
      <div className="field-label mt-5 mb-3">分類花費</div>
      {stats.categories.filter(category => category.count > 0).map(category => <div className="mb-4" key={category.id}>
        <div className="flex items-center justify-between text-sm gap-2"><span>{category.label}</span><span>NT$ {utils.fmt(category.total)}</span></div>
        <div className="h-1.5 bg-paper-2 rounded-full mt-2 overflow-hidden"><div className="h-full bg-ink rounded-full" style={{ width: (stats.total > 0 ? category.total / stats.total * 100 : 0) + '%' }} /></div>
        <div className="text-xs text-ink-3 mt-1">{category.count} 筆 · 我的分攤 NT$ {utils.fmt(category.mine)}</div>
      </div>)}
      {stats.count === 0 && <p className="text-sm text-ink-3 py-5 text-center">這段期間沒有費用</p>}
      <p className="text-xs text-ink-3 leading-relaxed border-t border-line pt-3">只統計費用，不把還款轉帳重複算成支出。舊紀錄列為「其他」，編輯時可調整分類。</p>
    </div>
  </div>;
}
