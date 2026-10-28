import { BankBackgroundError } from '../../src/lib/bankBackground';

export type Env = { FIREBASE_PROJECT_ID: string; FIREBASE_DATABASE_URL: string; FIREBASE_API_KEY: string; FIREBASE_SERVICE_SESSION?: string; AUTH_EMULATOR_ORIGIN?: string };
export class RestFailure extends Error { constructor(public status: number, public operation = '') { super('Database request failed'); } }
const fail = (code = 'service_unavailable') => new BankBackgroundError(code, '背景接收服務暫時無法連線，請稍後重試', 503);
let sessionCache: { key: string; token: string; until: number } | undefined;
let refreshing: { key: string; promise: Promise<string> } | undefined;

export function localEmulator(env: Env) {
  const local = env.FIREBASE_PROJECT_ID === 'demo-expense-splitting' && env.FIREBASE_DATABASE_URL === 'http://127.0.0.1:9000' && env.AUTH_EMULATOR_ORIGIN === 'http://127.0.0.1:9099';
  if (!local && (env.FIREBASE_PROJECT_ID !== 'expense-splitting-a9b78' || env.FIREBASE_DATABASE_URL !== 'https://expense-splitting-a9b78-default-rtdb.firebaseio.com' || env.AUTH_EMULATOR_ORIGIN)) throw fail();
  return local;
}
async function serviceToken(env: Env) {
  const key = env.FIREBASE_SERVICE_SESSION;
  if (!key) throw fail('service_not_configured');
  if (sessionCache?.key === key && sessionCache.until > Date.now()) return sessionCache.token;
  if (refreshing?.key === key) return refreshing.promise;
  const pending = (async () => {
    let saved: { uid: string; refreshToken: string };
    try { saved = JSON.parse(key); } catch { throw fail('service_config_invalid'); }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(saved.uid) || typeof saved.refreshToken !== 'string' || saved.refreshToken.length < 20) throw fail('service_config_invalid');
    const endpoint = localEmulator(env) ? env.AUTH_EMULATOR_ORIGIN + '/securetoken.googleapis.com/v1/token' : 'https://securetoken.googleapis.com/v1/token';
    const response = await fetch(endpoint + '?key=' + encodeURIComponent(env.FIREBASE_API_KEY), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refreshToken }), signal: AbortSignal.timeout(10000) });
    const value = await response.json() as any;
    if (!response.ok || typeof value.id_token !== 'string' || value.user_id !== saved.uid) throw fail('service_session_invalid');
    sessionCache = { key, token: value.id_token, until: Date.now() + Math.max(1, Math.min(Number(value.expires_in) || 3600, 3600) - 300) * 1000 };
    return value.id_token as string;
  })();
  refreshing = { key, promise: pending };
  try { return await pending; } finally { if (refreshing?.promise === pending) refreshing = undefined; }
}

export class FirebaseRest {
  constructor(private env: Env) { localEmulator(env); }
  async request(path: string, method = 'GET', value?: unknown, options: { shallow?: boolean; etag?: boolean; ifMatch?: string } = {}) {
    const url = new URL('/' + path.split('/').map(encodeURIComponent).join('/') + '.json', this.env.FIREBASE_DATABASE_URL);
    // ID tokens are required in Firebase's auth parameter. Only our scoped
    // service identity is used, never a user's refresh token or administrator key.
    url.searchParams.set('auth', await serviceToken(this.env));
    if (localEmulator(this.env)) url.searchParams.set('ns', 'demo-expense-splitting-default-rtdb');
    if (options.shallow) url.searchParams.set('shallow', 'true');
    let response: Response;
    try {
      response = await fetch(url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(options.etag ? { 'X-Firebase-ETag': 'true' } : {}), ...(options.ifMatch ? { 'If-Match': options.ifMatch } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(10000) });
    } catch { throw fail(); }
    if (!response.ok) throw new RestFailure(response.status, path.split('/')[0] || 'root');
    return { value: await response.json() as any, etag: response.headers.get('etag') || '' };
  }
  async get(path: string, shallow = false) { return (await this.request(path, 'GET', undefined, { shallow })).value; }
  async set(path: string, value: unknown) { return this.request(path, 'PUT', value); }
  async patch(path: string, value: unknown) { return this.request(path, 'PATCH', value); }
  async transaction(path: string, change: (current: any) => any) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.request(path, 'GET', undefined, { etag: true });
      const next = change(current.value);
      if (next === undefined) return { committed: false, value: current.value };
      try { const saved = await this.request(path, 'PUT', next, { ifMatch: current.etag }); return { committed: true, value: saved.value }; }
      catch (error) { if (!(error instanceof RestFailure) || error.status !== 412) throw error; }
    }
    throw new BankBackgroundError('busy', '正在處理另一筆通知，請稍後重試', 503);
  }
}
