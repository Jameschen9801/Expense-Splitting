import { useEffect, useState } from 'react';
import { requestMerchantSuggestion } from '../lib/bankBackgroundClient';
import { categoryLabel } from '../lib/categories';
import { merchantHabits, savedBankSuggestion, type BankGeminiSuggestion, type MerchantHabit, type MerchantSuggestion } from '../lib/merchantSuggestions';
import type { Expense } from '../types';

export function MerchantSuggestionPanel({ owner, merchant, history, background, form, onApply, disabled }: {
  owner: string;
  merchant: string;
  history: readonly Expense[];
  background?: BankGeminiSuggestion;
  form: { category?: Expense['category']; desc: string };
  onApply: (suggestion: MerchantSuggestion) => void;
  disabled: boolean;
}) {
  const [request, setRequest] = useState<{ habits: MerchantHabit[] } | null>(null);
  const [manual, setManual] = useState<MerchantSuggestion | null>(null);
  const [error, setError] = useState('');
  const [timedOutJob, setTimedOutJob] = useState<number>();
  const result = savedBankSuggestion(background, merchant) ?? manual;
  const waiting = background?.state === 'running' && Date.now() - background.at < 35000 && timedOutJob !== background.at;
  const pending = !result && (waiting || (!!request && !error));
  useEffect(() => {
    if (!waiting) return;
    const timeout = window.setTimeout(() => setTimedOutJob(background.at), Math.max(0, background.at + 35000 - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [waiting, background?.at]);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setError('等待 Gemini 回覆逾時，可繼續手動確認');
    }, 22000);
    void requestMerchantSuggestion(owner, merchant, request.habits, controller.signal)
      .then(suggestion => { if (!controller.signal.aborted) setManual(suggestion); })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : '目前無法連到 Gemini 建議服務，可繼續手動確認');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [request, owner, merchant]);

  const requestSuggestion = () => {
    setError('');
    setManual(null);
    setRequest({ habits: merchantHabits(merchant, history) });
  };
  const useful = result && (result.category || result.desc);
  const applied = useful && (!result.category || result.category === form.category) && (!result.desc || result.desc === form.desc);
  const failed = error || background?.state === 'failed' || (background?.state === 'running' && !waiting && !pending);
  return <section className="shared-match-notice" aria-label="Gemini 記帳建議">
    <strong>Gemini 建議 · {merchant}</strong>
    <div role="status">
      {pending && <p>正在取得建議…</p>}
      {error && <p>{error}</p>}
      {result && <p>{useful ? [result.category && categoryLabel(result.category), result.desc].filter(Boolean).join(' · ') : '店名資訊不足，請自行選擇分類。'}</p>}
      {applied && <p>建議已填入，仍可修改後確認。</p>}
    </div>
    {!result && !pending && <button type="button" className="btn btn-sm" disabled={disabled} onClick={requestSuggestion}>{failed ? '重試建議' : '取得建議'}</button>}
    {useful && !applied && <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => onApply(result)}>套用建議</button>}
  </section>;
}
