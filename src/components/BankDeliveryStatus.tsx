import { useEffect, useState } from 'react';
import { bankDeliveryEvent, bankDeliveryKey, readBankDelivery, type BankDeliveryState } from '../lib/bankDelivery';

const labels: Record<BankDeliveryState, string> = {
  received: '已收到，正在處理', pending: '已收進待確認', saved: '已保存記帳紀錄',
  duplicate: '重複通知，已略過', review: '已收到，等你核對', error: '已收到，尚未保存', setup: '捷徑已開啟，未傳入消費',
};

export function BankDeliveryStatus() {
  const [delivery, setDelivery] = useState(() => readBankDelivery(localStorage));
  useEffect(() => {
    const refresh = () => setDelivery(readBankDelivery(localStorage));
    const changed = (event: StorageEvent) => { if (event.key === bankDeliveryKey || event.key === null) refresh(); };
    window.addEventListener(bankDeliveryEvent, refresh);
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener(bankDeliveryEvent, refresh); window.removeEventListener('storage', changed); };
  }, []);
  return <div className="rounded-2xl border border-line bg-paper-2 p-4 mt-4 text-sm leading-relaxed" role="status">
    <strong>最近一次捷徑接收</strong>
    <p className="mt-2">{delivery ? labels[delivery.state] : '這個瀏覽器尚未收到捷徑資料'}</p>
    {delivery && <><p className="text-xs text-ink-3 mt-1">{new Date(delivery.at).toLocaleString('zh-TW', { hour12: false })}</p><p className="text-ink-2 mt-2">{delivery.message}</p></>}
    <p className="text-xs text-ink-3 mt-2">捷徑通常開啟 Safari，請在 Safari 查看這個結果。若沒有新接收時間，請檢查 iOS 自動化是否啟用、通知文字有沒有傳入，以及鎖定時的執行權限。接收結果只保留在這個瀏覽器。</p>
  </div>;
}
