import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { applyBackgroundCapture, backgroundIdentity, BankBackgroundError, matchBackgroundRule, personalBackgroundOwner, syncedBackgroundRules } from '../../src/lib/bankBackground';

type Request = { method: string; path: string; body?: any; headers: Record<string, any>; rawBody?: Buffer; query?: Record<string, any> };
type Response = { status(code: number): Response; json(body: any): unknown; setHeader(name: string, value: string): unknown };
type Auth = { verifyIdToken(token: string): Promise<{ uid: string; email?: string; firebase?: { sign_in_provider?: string } }> };
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const fail = (code: string, message: string, status = 400): never => { throw new BankBackgroundError(code, message, status); };

export function createBankApi({ database, auth, now = Date.now, newKey = () => randomBytes(32).toString('hex') }: { database: Database; auth: Auth; now?: () => number; newKey?: () => string }) {
  const ownerRef = (uid: string) => database.ref('bankIngressUsers/' + uid);
  async function rulesFor(uid: string) { return syncedBackgroundRules((await database.ref('accountSync/' + uid).get()).val()); }
  async function eligibleCount(uid: string) {
    const rules = await rulesFor(uid);
    const groups = await Promise.all([...new Set(rules.map(rule => rule.groupCode))].map(async code => ({ code, raw: (await database.ref('groups/' + code).get()).val() })));
    return rules.filter(rule => groups.some(group => group.code === rule.groupCode && personalBackgroundOwner(group.raw, uid))).length;
  }
  async function identity(req: Request) {
    const value = req.headers.authorization;
    if (typeof value !== 'string' || !value.startsWith('Bearer ')) fail('login_required', '請先登入帳本同步帳號', 401);
    let decoded: Awaited<ReturnType<Auth['verifyIdToken']>>;
    try { decoded = await auth.verifyIdToken(value.slice(7)); } catch { return fail('login_required', '登入已失效，請重新登入帳本同步', 401); }
    if (!decoded.email || decoded.firebase?.sign_in_provider === 'anonymous') fail('sync_required', '請先把現有帳本連結到自己的 Email 同步帳號', 422);
    return decoded.uid;
  }
  async function credential(req: Request) {
    const token = req.headers['x-expense-key'];
    if (!validKey(token)) return fail('key_invalid', '背景記帳尚未綁定或已停用，請回 App 重新綁定', 401);
    const digest = hash(token);
    const registry = (await database.ref('bankIngressKeys/' + digest).get()).val();
    if (!registry?.uid || !registry.uid.match(/^[A-Za-z0-9_-]{1,128}$/)) return fail('key_invalid', '背景記帳尚未綁定或已停用，請回 App 重新綁定', 401);
    const key = (await ownerRef(registry.uid).child('keys/' + digest).get()).val();
    if (key?.enabled !== true) return fail('key_invalid', '背景記帳尚未綁定或已停用，請回 App 重新綁定', 401);
    return { uid: registry.uid as string, digest };
  }
  async function delivery(uid: string, digest: string, status: string, message: string, at: number) {
    // Delivery status is useful for the PWA too; neither payload nor key is kept.
    try {
      await ownerRef(uid).child('lastDelivery').transaction(current => !current || current.at <= at ? { at, status, message } : undefined);
      await ownerRef(uid).child('keys/' + digest).update({ lastUsedAt: at });
    } catch { console.error('bankInboxApi: delivery status could not be updated'); }
  }
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    let received: { uid: string; digest: string; at: number } | undefined;
    try {
      const path = req.path.replace(/\/$/, '') || '/';
      if (req.method === 'GET' && path === '/health') return res.status(200).json({ ok: true, version: 1 });
      if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'method_not_allowed', message: '請使用背景記帳捷徑傳送' });
      if (Object.keys(req.query || {}).length) fail('invalid_request', '通知與憑證不可放在網址中');
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail('invalid_request', '請使用 JSON 傳送', 415);
      if ((req.rawBody?.byteLength || 0) > 32768 || +req.headers['content-length'] > 32768) fail('too_large', '通知資料過長', 413);
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_request', '資料格式不正確');
      if (path === '/manage') {
        if (Object.keys(body).some(key => key !== 'action')) fail('invalid_request', '設定資料格式不正確');
        const uid = await identity(req);
        if (body.action === 'status') {
          const owner = (await ownerRef(uid).get()).val() || {};
          const token = req.headers['x-expense-key'];
          return res.status(200).json({ ok: true, eligibleRules: await eligibleCount(uid), activeKeys: Object.values(owner.keys || {}).filter((key: any) => key.enabled).length,
            currentKeyActive: validKey(token) && owner.keys?.[hash(token)]?.enabled === true, lastDelivery: owner.lastDelivery || null });
        }
        if (body.action === 'revoke') {
          await ownerRef(uid).transaction(owner => ({ ...owner, keys: Object.fromEntries(Object.entries(owner?.keys || {}).map(([id, key]: [string, any]) => [id, { ...key, enabled: false }])), revokedAt: now() }));
          return res.status(200).json({ ok: true });
        }
        if (body.action !== 'create') fail('invalid_request', '設定操作不正確');
        if (!(await eligibleCount(uid))) fail('rule_required', '請先儲存屬於自己的個人帳本銀行規則', 422);
        const token = newKey(), digest = hash(token), at = now();
        let reason = '';
        const result = await ownerRef(uid).transaction(owner => {
          const current = owner || {};
          if (current.lastKeyCreatedAt && at - current.lastKeyCreatedAt < 5000) { reason = 'rate_limited'; return; }
          if (Object.values(current.keys || {}).filter((key: any) => key.enabled).length >= 5) { reason = 'key_limit'; return; }
          reason = '';
          return { ...current, lastKeyCreatedAt: at, keys: { ...current.keys, [digest]: { createdAt: at, enabled: true } } };
        });
        if (!result.committed) fail(reason || 'registration_failed', reason === 'key_limit' ? '背景綁定已達上限，請先停用舊綁定再重設' : '正在處理綁定，請稍後再試', 429);
        try { await database.ref('bankIngressKeys/' + digest).set({ uid, createdAt: at }); }
        catch (error) { await ownerRef(uid).child('keys/' + digest).update({ enabled: false }); throw error; }
        return res.status(200).json({ ok: true, token, createdAt: at });
      }
      if (path !== '/capture') return res.status(404).json({ ok: false, code: 'not_found', message: '找不到接收服務' });
      if (Object.keys(body).some(key => !['mode', 'text'].includes(key))) fail('invalid_request', '通知資料格式不正確');
      const { uid, digest } = await credential(req);
      const at = now();
      received = { uid, digest, at };
      if (body.mode === 'test') {
        if (!(await eligibleCount(uid))) fail('rule_required', '請先儲存屬於自己的個人帳本銀行規則', 422);
        await delivery(uid, digest, 'ready', '背景捷徑已連線，測試未新增帳目', at);
        return res.status(200).json({ ok: true, status: 'ready', message: '背景捷徑已綁定，測試未新增帳目' });
      }
      if (body.mode !== 'capture' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 6000) fail('invalid_request', '請傳入完整的銀行消費通知');
      const matched = matchBackgroundRule(await rulesFor(uid), body.text, at);
      if (!matched) {
        await delivery(uid, digest, 'ignored', '略過未符合銀行規則的通知', at);
        return res.status(200).json({ ok: true, status: 'ignored', message: '未符合成功消費規則，沒有新增帳目' });
      }
      const receipt = await backgroundIdentity(matched.rule, body.text);
      let duplicate = false;
      let denied: BankBackgroundError | undefined;
      const result = await database.ref('groups/' + matched.rule.groupCode).transaction(raw => {
        // A cold RTDB transaction can first see null. Proposing null cannot
        // recreate a deleted ledger; the server retries with existing data.
        if (raw === null) return null;
        denied = undefined;
        try {
          const applied = applyBackgroundCapture(raw, uid, matched, receipt, at);
          duplicate = applied.duplicate;
          return duplicate ? undefined : applied.value;
        } catch (error) {
          // RTDB wraps exceptions from transaction callbacks. Carry a known
          // validation failure out explicitly so it keeps its safe HTTP status.
          if (error instanceof BankBackgroundError) { denied = error; return; }
          throw error;
        }
      });
      if (denied) throw denied;
      if (!duplicate && (!result.committed || !result.snapshot.exists())) fail('ledger_unavailable', '個人帳本不存在或已刪除，請回 App 檢查', 403);
      const status = duplicate ? 'duplicate' : 'pending';
      const message = duplicate ? '相同通知已處理，未重複新增' : '已放入手機通知待確認';
      await delivery(uid, digest, status, message, at);
      return res.status(200).json({ ok: true, status, message });
    } catch (error) {
      if (error instanceof BankBackgroundError) {
        if (received) await delivery(received.uid, received.digest, 'error', error.message, received.at);
        return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      }
      // Do not log request, headers, notification text, or underlying SDK errors.
      console.error('bankInboxApi: request failed');
      if (received) await delivery(received.uid, received.digest, 'error', '暫時無法保存通知，請稍後重試', received.at);
      return res.status(500).json({ ok: false, code: 'temporary_failure', message: '暫時無法保存通知，請稍後重試' });
    }
  };
}
