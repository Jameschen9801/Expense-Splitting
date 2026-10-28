import { bankBackgroundInstallUrl } from './bankBackgroundProtocol';
import type { BackgroundStatus } from './bankBackgroundClient';

export const bankInstallationHash = '#bank-install';
export type InstallationProgress = { revision: string; testBaselineAt: number | null; automationConfirmed: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const freshInstallation = (): InstallationProgress => ({ revision: bankBackgroundInstallUrl, testBaselineAt: null, automationConfirmed: false });
const key = (uid: string, code: string) => 'warikan_bank_install_v1:' + uid + ':' + code;
export function readInstallation(store: Store, uid: string, code: string): InstallationProgress {
  try {
    const saved = JSON.parse(store.getItem(key(uid, code)) || 'null');
    if (saved?.revision === bankBackgroundInstallUrl && typeof saved.automationConfirmed === 'boolean' && (saved.testBaselineAt === null || Number.isFinite(saved.testBaselineAt) && saved.testBaselineAt >= 0)) return saved;
  } catch { /* Only installation checkmarks are reset; ledger data is untouched. */ }
  return freshInstallation();
}
export function saveInstallation(store: Store, uid: string, code: string, progress: InstallationProgress) {
  try { store.setItem(key(uid, code), JSON.stringify(progress)); }
  catch { throw new Error('無法保存設定進度，請確認此 App 可以儲存資料後再試。帳目不受影響。'); }
}
export function installationChecks(accountReady: boolean, code: string, status: BackgroundStatus | null, progress: InstallationProgress) {
  const bank = accountReady && !!code && !!status?.eligibleGroupCodes?.includes(code);
  // A previous installation or another device's test cannot check this step.
  const connection = bank && status?.currentKeyActive === true && progress.testBaselineAt !== null && (status.currentKey?.testedAt || 0) > progress.testBaselineAt;
  const automation = connection && progress.automationConfirmed;
  return [bank, connection, automation] as const;
}
export function installationReceipt(code: string, status: BackgroundStatus | null, progress: InstallationProgress) {
  const receipt = status?.currentKey?.lastMatchedDelivery;
  return progress.testBaselineAt !== null && status?.currentKeyActive && receipt?.groupCode === code && receipt.at >= (status.currentKey?.testedAt || Infinity) && (receipt.status === 'pending' || receipt.status === 'duplicate') ? receipt : null;
}
