import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Group, MyGroup } from '../types';
import type { BankSetup as SetupInput } from '../lib/bankShortcuts';
import { isPersonalLedger } from '../lib/ledgers';
import { storage } from '../lib/utils';
import { Modal } from './Modal';
import { BankShortcutSettings } from './BankShortcutSettings';

export function BankSetup({ setup, groups, currentGroup, onCreateLedger, onClose }: {
  setup: SetupInput; groups: MyGroup[]; currentGroup: Group | null; onCreateLedger: () => void; onClose: () => void;
}) {
  const books = useMemo(() => groups.flatMap(item => {
    const cached = item.code === currentGroup?.code ? currentGroup : storage.getGroup(item.code);
    return cached ? [cached] : [];
  }).sort((a, b) => Number(isPersonalLedger(b)) - Number(isPersonalLedger(a))), [groups, currentGroup]);
  const preferred = books.find(book => book.code === currentGroup?.code && isPersonalLedger(book)) || books.find(isPersonalLedger) || books[0];
  const [selected, setSelected] = useState(preferred?.code || '');
  useEffect(() => {
    if (!books.some(book => book.code === selected)) setSelected(preferred?.code || '');
  }, [books, preferred?.code, selected]);
  const target = books.find(book => book.code === selected) || null;
  return <Modal title="設定銀行記帳" onClose={onClose}>
    <p className="text-sm text-ink-2 leading-relaxed mb-4">{setup.needsLink ? '捷徑還沒綁定帳本，尚未新增任何帳目。先選擇個人帳本，在 App 儲存銀行規則，再按「已加入，完成綁定」，設定會自動傳入捷徑。' : '這次是手動開啟設定，沒有新增帳目。可在下方確認銀行規則，所有銀行與卡片資料都在 App 修改。'}</p>
    {books.length > 0 && <div className="mb-4"><label className="field-label" htmlFor="bank-setup-ledger">要記入哪個帳本？</label><select id="bank-setup-ledger" value={selected} onChange={event => setSelected(event.target.value)}>{books.map(book => <option key={book.code} value={book.code}>{book.name}（{isPersonalLedger(book) ? '個人帳本' : '共用帳本'}）</option>)}</select></div>}
    {!books.some(isPersonalLedger) && <div className="mb-5"><p className="text-sm text-ink-2 leading-relaxed mb-3">這個 Safari 還沒有個人帳本。若帳目原本在主畫面 App，請保留原 App 資料；新建帳本會是獨立的一本。</p><button type="button" className="btn btn-primary w-full" onClick={onCreateLedger}>建立個人帳本</button></div>}
    {target && <Fragment key={target.code}><BankShortcutSettings group={target} /></Fragment>}
    <button type="button" className="btn w-full mt-2" onClick={onClose}>關閉設定</button>
  </Modal>;
}
