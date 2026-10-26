import { useMemo } from 'react';
import type { Group } from '../types';
import { summarizeExpenses } from '../lib/categories';
import { utils } from '../lib/utils';
import { CategoryIcon } from './CategoryIcon';
import { isPersonalLedger } from '../lib/ledgers';

export function Statistics({ group, myName, month, onMonth }: { group: Group; myName: string; month: string; onMonth: (month: string) => void }) {
  const personal = isPersonalLedger(group);
  const stats = useMemo(() => summarizeExpenses(group.expenses, myName, month), [group.expenses, myName, month]);
  const months = [...new Set([...(personal ? [utils.todayStr().slice(0,7)] : []), ...[...group.expenses, ...group.transfers].map(record => record.date?.slice(0, 7)).filter(Boolean)])].sort().reverse();
  return <div className="panel">
    <div className="panel-header p-4 border-b border-line"><span className="section-label">支出統計</span></div>
    <div className="p-4">
      <label className="field-label" htmlFor="stats-month">期間</label>
      <select id="stats-month" value={month} onChange={event => onMonth(event.target.value)}>
        <option value="">全部月份</option>
        {months.map(value => <option key={value} value={value}>{value.replace('-', ' 年 ')} 月</option>)}
      </select>
      <div className="stats-summary">
        <div className="stat-label">{personal ? '個人支出' : '群組支出'}</div><div className="money stat-total"><span className="currency">NT$</span>{utils.fmt(stats.total)}</div>
        {!personal && <div className="stat-pair">
          {[['我的分攤', stats.mine], ['我先付款', stats.paid]].map(([label, value]) => <div className="min-w-0" key={label}><div className="stat-label">{label}</div><div className="money"><span className="currency">NT$</span>{utils.fmt(value as number)}</div></div>)}
        </div>}
        <div className="flex justify-between text-sm text-ink-2 mt-5"><span>費用筆數</span><span>{stats.count} 筆</span></div>
      </div>
      <h3 className="settings-heading mt-6 mb-0">分類花費</h3>
      {stats.categories.filter(category => category.count > 0).map(category => <div className="mb-5" key={category.id}>
        <div className="category-summary"><span className="record-kind"><CategoryIcon category={category.id} size={18} /></span><div><div className="text-sm font-medium">{category.label}</div><div className="text-xs text-ink-3 mt-1">{category.count} 筆</div></div><div className="money text-sm">NT$ {utils.fmt(category.total)}</div></div>
        <div className="category-bar" aria-hidden="true"><div style={{ width: (stats.total > 0 ? category.total / stats.total * 100 : 0) + '%' }} /></div>
        {!personal && <div className="text-xs text-ink-3 mt-2">我的分攤 NT$ {utils.fmt(category.mine)}</div>}
      </div>)}
      {stats.count === 0 && <p className="text-sm text-ink-3 py-5 text-center">這段期間沒有費用</p>}
      <p className="text-xs text-ink-3 leading-relaxed border-t border-line pt-3">{personal ? '依所選期間統計個人支出，可在明細編輯分類。' : '只統計費用，不把還款轉帳重複算成支出。舊紀錄列為「其他」，編輯時可調整分類。'}</p>
    </div>
  </div>;
}
