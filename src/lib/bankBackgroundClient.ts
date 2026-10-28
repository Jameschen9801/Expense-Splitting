import { firebaseSession } from './firebase';
import { accountSync } from './accountSync';
import { bankBackgroundEndpoint, backgroundSetupUrl } from './bankBackgroundProtocol';
export { bankBackgroundName, richartBackgroundName, bankBackgroundInstallUrl, richartBackgroundInstallUrl } from './bankBackgroundProtocol';

const credentialKey = 'warikan_bank_background_v1';
const emulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
const endpoint = emulator ? 'http://127.0.0.1:8787' : bankBackgroundEndpoint;
export type BackgroundStatus = { eligibleRules: number; activeKeys: number; currentKeyActive: boolean; lastDelivery: { at: number; status: 'ready' | 'pending' | 'duplicate' | 'ignored' | 'error'; message: string } | null };
type Credential = { uid: string; token: string; createdAt: number };
function readCredential(uid: string): Credential | null {
  try {
    const value = JSON.parse(localStorage.getItem(credentialKey) || 'null');
    return value?.uid === uid && /^[a-f0-9]{64}$/.test(value.token) ? value : null;
  } catch { return null; }
}
async function manage(action: 'status' | 'create' | 'revoke') {
  if (!accountSync.getSnapshot().email || !accountSync.getSnapshot().ready) throw new Error('請先完成帳本同步，再綁定背景捷徑');
  const { auth } = await firebaseSession();
  const user = auth.currentUser;
  if (!user?.email) throw new Error('請先登入帳本同步帳號');
  const saved = readCredential(user.uid);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint + '/manage', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await user.getIdToken(), ...(saved ? { 'X-Expense-Key': saved.token } : {}) }, body: JSON.stringify({ action }), signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) throw new Error(body?.message || '背景接收服務暫時無法連線，請稍後重試');
    return { uid: user.uid, body, saved };
  } catch (error) {
    if (error instanceof TypeError || error instanceof DOMException) throw new Error('目前無法連到背景接收服務，請確認網路後重試；既有帳目不受影響');
    throw error;
  } finally { window.clearTimeout(timeout); }
}
export async function backgroundStatus(): Promise<BackgroundStatus> { return (await manage('status')).body; }
export async function bindBackgroundShortcut(): Promise<string> {
  await accountSync.refresh();
  const status = await manage('status');
  if (!status.body.eligibleRules) throw new Error('請先儲存並啟用自己的個人帳本銀行規則');
  let saved = status.saved;
  if (!saved || !status.body.currentKeyActive) {
    const created = await manage('create');
    if (!/^[a-f0-9]{64}$/.test(created.body.token)) throw new Error('背景綁定未完成，請稍後重試');
    saved = { uid: created.uid, token: created.body.token, createdAt: created.body.createdAt };
    try { localStorage.setItem(credentialKey, JSON.stringify(saved)); }
    catch { throw new Error('裝置無法保存綁定，請先釋出儲存空間，再按重新綁定'); }
  }
  return backgroundSetupUrl(saved.token);
}
export async function revokeBackgroundShortcuts() {
  const { uid } = await manage('revoke');
  if (readCredential(uid)) localStorage.removeItem(credentialKey);
}
