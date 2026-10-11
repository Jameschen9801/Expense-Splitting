import type { Group } from '../types';
import { actionLabel } from '../lib/audit';

export function HistoryLog({ group, target }: { group: Group; target?: string }) {
  const entries = Object.values(group.history || {}).filter(entry => !target || entry.target === target).sort((a, b) => b.at - a.at).slice(0, 30);
  return <details className="expense-more mt-4">
    <summary>修改紀錄{target ? '' : '（最近 30 筆）'}</summary>
    <p className="text-xs text-ink-3 my-3">從此版本起記錄新增、修改與刪除；本機與備份保留全群組最近 300 筆。待同步變更完成上傳後，其他成員才會看到。</p>
    {!entries.length && <p className="text-xs text-ink-3">尚無修改紀錄</p>}
    {entries.map(entry => <div key={entry.id} className="border-b border-line py-3 text-xs">
      <div className="flex justify-between gap-2 mb-1"><span>{entry.actor} · {actionLabel(entry.action)}</span><time className="text-ink-3 shrink-0">{new Date(entry.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
      {(entry.changes || []).map((change, index) => <p key={index} className="text-ink-3 leading-relaxed break-words">{change.label}：{change.before || '未設定'} → {change.after || '已移除'}</p>)}
    </div>)}
  </details>;
}
