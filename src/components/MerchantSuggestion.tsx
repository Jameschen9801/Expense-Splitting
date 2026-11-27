import { useEffect, useState } from 'react';
import { requestMerchantSuggestion } from '../lib/bankBackgroundClient';
import { categoryLabel } from '../lib/categories';
import { merchantHabits, type MerchantHabit, type MerchantSuggestion } from '../lib/merchantSuggestions';
import type { Expense } from '../types';

export function MerchantSuggestionPanel({ owner, book, merchant, history, onApply, disabled }: {
  owner: string;
  book: string;
  merchant: string;
  history: readonly Expense[];
  onApply: (suggestion: MerchantSuggestion) => void;
  disabled: boolean;
}) {
  const preference = 'warikan_gemini_auto_v1:' + owner + ':' + book;
  const [auto, setAuto] = useState(() => {
    try { return localStorage.getItem(preference) === '1'; } catch { return false; }
  });
  const [request, setRequest] = useState<{ habits: MerchantHabit[] } | null>(() => auto ? { habits: merchantHabits(merchant, history) } : null);
  const [result, setResult] = useState<MerchantSuggestion | null>(null);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const pending = !!request && !result && !error;
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setError('等待 Gemini 回覆逾時，可繼續手動確認');
    }, 22000);
    void requestMerchantSuggestion(owner, merchant, request.habits, controller.signal)
      .then(suggestion => { if (!controller.signal.aborted) setResult(suggestion); })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : '目前無法連到 Gemini 建議服務，可繼續手動確認');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [request, owner, merchant]);

  const requestSuggestion = () => {
    setError('');
    setResult(null);
    setApplied(false);
    setRequest({ habits: merchantHabits(merchant, history) });
  };
  const useful = result && (result.category || result.desc);
  return <section className="shared-match-notice" aria-label="Gemini 記帳建議">
    <strong>Gemini 建議 · {merchant}</strong>
    <div role="status">
      {pending && <p>正在取得建議…</p>}
      {error && <p>{error}</p>}
      {result && <p>{useful ? [result.category && categoryLabel(result.category), result.desc].filter(Boolean).join(' · ') : '店名資訊不足，請自行選擇分類。'}</p>}
      {applied && <p>建議已填入，仍可修改後確認。</p>}
    </div>
    {!request && <p>依店名與同店家的分類次數產生建議。</p>}
    {!result && !pending && <button type="button" className="btn btn-sm" disabled={disabled} onClick={requestSuggestion}>{error ? '重試建議' : '取得建議'}</button>}
    {useful && !applied && <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => { onApply(result); setApplied(true); }}>套用建議</button>}
    {(result || auto) && <label><input type="checkbox" checked={auto} onChange={event => {
      const enabled = event.target.checked;
      try {
        if (enabled) localStorage.setItem(preference, '1');
        else localStorage.removeItem(preference);
        setAuto(enabled);
      } catch { setError('無法在這台手機儲存自動建議設定'); }
    }} />這台裝置開啟待確認時，自動取得建議</label>}
  </section>;
}
