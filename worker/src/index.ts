import { BankBackgroundError, backgroundIdentity, buildBackgroundDraft, matchBackgroundRule, personalBackgroundOwner, syncedBackgroundRules } from '../../src/lib/bankBackground';
import { FirebaseRest, RestFailure, localEmulator, type Env } from './firebaseRest';
import { identity } from './firebaseToken';

const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (code: string, message: string, status = 400): never => { throw new BankBackgroundError(code, message, status); };
async function jsonBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail('invalid_request', '請使用 JSON 傳送', 415);
  if (Number(request.headers.get('content-length')) > 32768) fail('too_large', '通知資料過長', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('invalid_request', '資料格式不正確');
  const parts: Uint8Array[] = []; let length = 0;
  while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 32768) { await reader.cancel(); fail('too_large', '通知資料過長', 413); } parts.push(part.value); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let value: any;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_request', '資料格式不正確'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_request', '資料格式不正確');
  return value;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' });
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    let received: { uid: string; digest: string; at: number } | undefined;
    let db: FirebaseRest;
    const delivery = async (uid: string, digest: string, status: string, message: string, at: number) => {
      try {
        await db.transaction('bankIngressUsers/' + uid + '/lastDelivery', current => !current || current.at <= at ? { at, status, message } : undefined);
        await db.patch('bankIngressUsers/' + uid + '/keys/' + digest, { lastUsedAt: at });
      } catch { /* A lost status update must not turn an acknowledged save into an error. */ }
    };
    try {
      const local = localEmulator(env), origin = request.headers.get('origin');
      if (origin && origin !== 'https://jameschen9801.github.io' && !(local && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) fail('origin_denied', '請從自己的記帳 App 操作', 403);
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Expense-Key'); headers.set('Access-Control-Max-Age', '86400');
        return new Response(null, { status: 204, headers });
      }
      const url = new URL(request.url), path = url.pathname.replace(/\/$/, '') || '/';
      if (url.search) fail('invalid_request', '通知與憑證不可放在網址中');
      if (request.method === 'GET' && path === '/health') return respond({ ok: true, version: 2, platform: 'cloudflare-workers' });
      if (request.method !== 'POST') return respond({ ok: false, code: 'method_not_allowed', message: '請使用背景記帳捷徑傳送' }, 405);
      if (!['/manage', '/capture'].includes(path)) return respond({ ok: false, code: 'not_found', message: '找不到接收服務' }, 404);
      const body = await jsonBody(request);
      db = new FirebaseRest(env);
      const rulesFor = async (uid: string) => syncedBackgroundRules({ version: 1, bank: { rules: await db.get('accountSync/' + uid + '/bank/rules') } });
      const metadata = async (code: string) => {
        try {
          // Security is readable by this service only for personal ledgers.
          // Personal-ledger rules already require the sole member to be its owner.
          const security = await db.get('groups/' + code + '/security');
          const name = security?.users?.[security?.ownerUid]?.name;
          return { code, kind: 'personal', security, members: typeof name === 'string' ? { [name]: true } : {}, name: '', createdAt: 1 };
        } catch (error) { if (error instanceof RestFailure && error.status === 401) return null; throw error; }
      };
      const eligible = async (uid: string) => {
        const rules = await rulesFor(uid);
        const groups = await Promise.all([...new Set(rules.map(rule => rule.groupCode))].map(async code => ({ code, raw: await metadata(code) })));
        return rules.filter(rule => groups.some(group => group.code === rule.groupCode && personalBackgroundOwner(group.raw, uid))).length;
      };
      if (path === '/manage') {
        if (Object.keys(body).some(key => key !== 'action')) fail('invalid_request', '設定資料格式不正確');
        const uid = await identity(request, env), root = 'bankIngressUsers/' + uid;
        if (body.action === 'status') {
          const owner = await db.get(root) || {}, token = request.headers.get('x-expense-key');
          return respond({ ok: true, eligibleRules: await eligible(uid), activeKeys: Object.values(owner.keys || {}).filter((key: any) => key.enabled).length, currentKeyActive: validKey(token) && owner.keys?.[await hash(token)]?.enabled === true, lastDelivery: owner.lastDelivery || null });
        }
        if (body.action === 'revoke') {
          await db.transaction(root, owner => ({ ...owner, keys: Object.fromEntries(Object.entries(owner?.keys || {}).map(([id, key]: [string, any]) => [id, { ...key, enabled: false }])), revokedAt: Date.now() }));
          return respond({ ok: true });
        }
        if (body.action !== 'create') fail('invalid_request', '設定操作不正確');
        if (!await eligible(uid)) fail('rule_required', '請先儲存屬於自己的個人帳本銀行規則', 422);
        const token = randomKey(), digest = await hash(token), at = Date.now(); let reason = '';
        const result = await db.transaction(root, owner => {
          const current = owner || {};
          if (current.lastKeyCreatedAt && at - current.lastKeyCreatedAt < 5000) { reason = 'rate_limited'; return; }
          if (Object.values(current.keys || {}).filter((key: any) => key.enabled).length >= 5) { reason = 'key_limit'; return; }
          reason = ''; return { ...current, lastKeyCreatedAt: at, keys: { ...current.keys, [digest]: { createdAt: at, enabled: true } } };
        });
        if (!result.committed) fail(reason || 'registration_failed', reason === 'key_limit' ? '背景綁定已達上限，請先停用舊綁定再重設' : '正在處理綁定，請稍後再試', 429);
        try { await db.set('bankIngressKeys/' + digest, { uid, createdAt: at }); }
        catch (error) { await db.patch(root + '/keys/' + digest, { enabled: false }); throw error; }
        return respond({ ok: true, token, createdAt: at });
      }
      if (Object.keys(body).some(key => !['mode', 'text'].includes(key))) fail('invalid_request', '通知資料格式不正確');
      const token = request.headers.get('x-expense-key');
      if (!validKey(token)) fail('key_invalid', '背景記帳尚未綁定或已停用，請回 App 重新綁定', 401);
      const digest = await hash(token), registry = await db.get('bankIngressKeys/' + digest);
      if (typeof registry?.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(registry.uid)) fail('key_invalid', '背景記帳尚未綁定或已停用，請回 App 重新綁定', 401);
      const uid = registry.uid as string, at = Date.now();
      if ((await db.get('bankIngressUsers/' + uid + '/keys/' + digest))?.enabled !== true) fail('key_invalid', '背景記帳尚未綁定或已停用，請回 App 重新綁定', 401);
      received = { uid, digest, at };
      if (body.mode === 'test') {
        if (!await eligible(uid)) fail('rule_required', '請先儲存屬於自己的個人帳本銀行規則', 422);
        await delivery(uid, digest, 'ready', '背景捷徑已連線，測試未新增帳目', at);
        return respond({ ok: true, status: 'ready', message: '背景捷徑已綁定，測試未新增帳目' });
      }
      if (body.mode !== 'capture' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 6000) fail('invalid_request', '請傳入完整的銀行消費通知');
      const matched = matchBackgroundRule(await rulesFor(uid), body.text, at);
      if (!matched) { await delivery(uid, digest, 'ignored', '略過未符合銀行規則的通知', at); return respond({ ok: true, status: 'ignored', message: '未符合成功消費規則，沒有新增帳目' }); }
      const raw = await metadata(matched.rule.groupCode);
      if (!personalBackgroundOwner(raw, uid)) fail('ledger_unavailable', '個人帳本不存在或已無權限，請回 App 檢查', 403);
      const receipt = await backgroundIdentity(matched.rule, body.text), base = 'groups/' + matched.rule.groupCode;
      // Fetch IDs only; the Worker does not download existing expense contents.
      const [pending, expenses, history] = await Promise.all(['bankInbox', 'expenses', 'history'].map(field => db.get(base + '/' + field, true)));
      let duplicate = receipt.equivalentIds.some(id => pending?.[id] || expenses?.[id] || history?.['m' + id]);
      if (!duplicate) {
        const { draft, audit } = buildBackgroundDraft(raw, uid, matched, receipt.id, at);
        try {
          // Rules grant only create operations for these two records. A single
          // atomic PATCH prevents lost updates without rewriting ledger contents.
          await db.patch('', { [base + '/bankInbox/' + receipt.id]: { ...draft, _lastAudit: audit }, [base + '/history/' + audit.id]: audit });
        } catch (error) {
          if (!(error instanceof RestFailure) || error.status !== 401) throw error;
          try { duplicate = !!await db.get(base + '/bankInbox/' + receipt.id + '/id'); }
          catch (readError) { if (!(readError instanceof RestFailure) || readError.status !== 401) throw readError; }
          if (!duplicate) fail('ledger_unavailable', '個人帳本不存在或已無權限，請回 App 檢查', 403);
        }
      }
      const status = duplicate ? 'duplicate' : 'pending', message = duplicate ? '相同通知已處理，未重複新增' : '已放入手機通知待確認';
      await delivery(uid, digest, status, message, at);
      return respond({ ok: true, status, message });
    } catch (error) {
      const known = error instanceof BankBackgroundError ? error : new BankBackgroundError('temporary_failure', '暫時無法保存通知，請稍後重試', 503);
      if (received) await delivery(received.uid, received.digest, 'error', known.message, received.at);
      // Never log request headers, URLs with Firebase credentials, or raw notifications.
      return respond({ ok: false, code: known.code, message: known.message }, known.status);
    }
  },
};
