import { BankBackgroundError } from '../../src/lib/bankBackground';
import { localEmulator, type Env } from './firebaseRest';

const invalid = () => new BankBackgroundError('login_required', '登入已失效，請重新登入帳本同步', 401);
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
type PublicJwk = JsonWebKey & { kid?: string };
let keyCache: { keys: PublicJwk[]; until: number; refreshed: number } | undefined;
let loading: Promise<PublicJwk[]> | undefined;
async function publicKeys(kid: string) {
  const now = Date.now();
  if (keyCache && keyCache.until > now && (keyCache.keys.some(key => key.kid === kid) || now - keyCache.refreshed < 60000)) return keyCache.keys;
  if (loading) return loading;
  const pending = (async () => {
    const response = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const body = await response.json() as any;
    if (!response.ok || !Array.isArray(body.keys)) throw invalid();
    const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]) || 3600;
    keyCache = { keys: body.keys, until: Date.now() + Math.min(maxAge, 21600) * 1000, refreshed: Date.now() };
    return body.keys as PublicJwk[];
  })();
  loading = pending;
  try { return await pending; } finally { if (loading === pending) loading = undefined; }
}
export async function verifyFirebaseToken(token: string, project: string, keys: (kid: string) => Promise<PublicJwk[]> = publicKeys, now = Date.now()) {
  try {
    if (token.length > 12000) throw invalid();
    const pieces = token.split('.');
    if (pieces.length !== 3) throw invalid();
    const header = JSON.parse(new TextDecoder().decode(decode(pieces[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(pieces[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 150) throw invalid();
    const jwk = (await keys(header.kid)).find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) throw invalid();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(pieces[2]), new TextEncoder().encode(pieces[0] + '.' + pieces[1]))) throw invalid();
    validateClaims(claims, project, now);
    return { ...claims, uid: claims.sub };
  } catch { throw invalid(); }
}
function validateClaims(claims: any, project: string, now: number) {
  const seconds = now / 1000;
  if (claims.aud !== project || claims.iss !== 'https://securetoken.google.com/' + project || typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)
    || !Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds + 60 || !Number.isFinite(claims.auth_time) || claims.auth_time > seconds + 60) throw invalid();
}
export async function identity(request: Request, env: Env) {
  const value = request.headers.get('authorization');
  if (!value?.startsWith('Bearer ')) throw invalid();
  const token = value.slice(7);
  let claims: any;
  if (localEmulator(env)) {
    // Unsigned emulator tokens are accepted only with both fixed local hosts
    // and a demo project, and are checked against the Auth emulator itself.
    const response = await fetch(env.AUTH_EMULATOR_ORIGIN + '/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) });
    const value = await response.json() as any;
    if (!response.ok || !value.users?.[0]) throw invalid();
    try { claims = JSON.parse(new TextDecoder().decode(decode(token.split('.')[1]))); validateClaims(claims, env.FIREBASE_PROJECT_ID, Date.now()); claims.uid = claims.sub; } catch { throw invalid(); }
  } else claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  if (!claims.email || claims.firebase?.sign_in_provider === 'anonymous') throw new BankBackgroundError('sync_required', '請先把現有帳本連結到自己的 Email 同步帳號', 422);
  return claims.uid as string;
}
