import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Group, MyGroup } from '../types';
import type { BankSetup as SetupInput } from '../lib/bankShortcuts';
import { isPersonalLedger } from '../lib/ledgers';
import { storage } from '../lib/utils';
import { Modal } from './Modal';
import { BankShortcutSettings } from './BankShortcutSettings';
import { AccountSyncSettings } from './AccountSyncSettings';
import { bankInstallationHash } from '../lib/bankInstallation';

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
    <p className="text-sm text-ink-2 leading-relaxed mb-4">{isPersonalLedger(target) ? '個人帳本的銀行資料與捷徑安裝已整合到三步設定頁，請從下方繼續。這次沒有新增帳目。' : setup.needsLink ? '捷徑還沒綁定帳本，尚未新增任何帳目。先選擇帳本並儲存銀行規則，再完成綁定。' : '這次是手動開啟設定，沒有新增帳目。可在下方確認銀行規則。'}</p>
    {books.length > 0 && <div className="mb-4"><label className="field-label" htmlFor="bank-setup-ledger">要記入哪個帳本？</label><select id="bank-setup-ledger" value={selected} onChange={event => setSelected(event.target.value)}>{books.map(book => <option key={book.code} value={book.code}>{book.name}（{isPersonalLedger(book) ? '個人帳本' : '共用帳本'}）</option>)}</select></div>}
    {!target && <div className="mb-5"><p className="text-sm text-ink-2 leading-relaxed mb-3">原本的帳目在桌面 App？先在那裡開啟帳本同步，再於此登入，就能連回原本帳本。</p><AccountSyncSettings preferLogin /><details className="expense-more mt-4"><summary>我確定要另外建立一本帳本</summary><p className="text-xs text-ink-3 py-3">這會建立獨立的新帳本，不會連回桌面 App 的帳目。</p><button type="button" className="btn w-full" onClick={onCreateLedger}>建立新的個人帳本</button></details></div>}
    {target && (isPersonalLedger(target) ? <a className="btn btn-primary w-full mb-3" href={bankInstallationHash} onClick={onClose}>前往三步設定</a> : <Fragment key={target.code}><BankShortcutSettings group={target} /></Fragment>)}
    <button type="button" className="btn w-full mt-2" onClick={onClose}>關閉設定</button>
  </Modal>;
}
