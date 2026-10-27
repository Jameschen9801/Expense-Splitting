import type { Group } from '../types';
import { isPersonalLedger } from './ledgers';
import { bankRulesKey, readBankRules } from './bankShortcuts';
import { Outbox } from './outbox';

type Store = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export function personalLedgerDeletionUpdate(group: Group, uid: string, deletedAt: unknown) {
  if (!isPersonalLedger(group) || !/^\d{6}$/.test(group.code)) throw new Error('只能刪除個人帳本');
  if (!uid || group.security?.ownerUid !== uid) throw new Error('只有建立這本個人帳本的裝置能刪除');
  return {
    [`groups/${group.code}`]: null,
    [`deletedPersonalLedgers/${group.code}`]: { ownerUid: uid, deletedAt },
  };
}

// Remove only this ledger's data. Preserve other ledgers and device identity.
export function cleanupDeletedLedger(store: Store, code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error('帳本代碼格式錯誤');
  const updates = new Map<string, string | null>();
  const groups = JSON.parse(store.getItem('warikan_my_groups') || '[]');
  if (!Array.isArray(groups)) throw new Error('本機帳本清單無法讀取');
  updates.set('warikan_my_groups', JSON.stringify(groups.filter(item => item.code !== code)));
  if (store.getItem('warikan_outbox_v1') !== null) updates.set('warikan_outbox_v1', JSON.stringify(new Outbox(store).list().filter(item => item.groupCode !== code)));
  if (store.getItem(bankRulesKey) !== null) updates.set(bankRulesKey, JSON.stringify(readBankRules(store).filter(rule => rule.groupCode !== code)));
  updates.set('warikan_group_' + code, null);
  if (store.getItem('warikan_last_group') === code) updates.set('warikan_last_group', null);
  const keys = Array.from({length:store.length}, (_, index) => store.key(index)).filter((key): key is string => !!key);
  for (const key of keys) {
    if (key.startsWith(`warikan_draft_v1_${code}_`) || key.startsWith(`warikan_templates_v1_${code}_`) || key === `warikan_recovery_v2_${code}`) updates.set(key, null);
  }
  const originals = new Map([...updates.keys()].map(key => [key, store.getItem(key)]));
  const changed: string[] = [];
  try {
    for (const [key, value] of updates) {
      if (value === null) store.removeItem(key); else store.setItem(key, value);
      changed.push(key);
    }
  } catch (error) {
    for (const key of changed.reverse()) {
      const value = originals.get(key)!;
      if (value === null) store.removeItem(key); else store.setItem(key, value);
    }
    throw new Error('本機資料清理未完成，請重新載入 App 再試；雲端刪除狀態仍會保留', {cause:error});
  }
}
