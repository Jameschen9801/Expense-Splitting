import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirebaseToken } from './firebaseToken';
let pair: CryptoKeyPair, publicKey: JsonWebKey;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Date.now();
const claims = { aud: 'expense-splitting-a9b78', iss: 'https://securetoken.google.com/expense-splitting-a9b78', sub: 'owner', iat: Math.floor(now / 1000) - 5, auth_time: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 3600, email: 'local@example.test', firebase: { sign_in_provider: 'password' } };
before(async () => { pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey); });
const keys = async () => [{ ...publicKey, kid: 'test-key' }];
async function sign(body: unknown, header: unknown = { alg: 'RS256', kid: 'test-key' }) {
  const message = encode(header) + '.' + encode(body);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(message));
  return message + '.' + Buffer.from(signature).toString('base64url');
}
test('正式環境會驗證 Google 格式的 RSA 簽章與專案身分', async () => {
  assert.equal((await verifyFirebaseToken(await sign(claims), claims.aud, keys, now)).uid, 'owner');
});
test('拒絕被改寫、未簽章、其他專案與不明金鑰的登入憑證', async () => {
  const valid = await sign(claims), pieces = valid.split('.');
  const changed = pieces[0] + '.' + encode({ ...claims, sub: 'victim' }) + '.' + pieces[2];
  for (const token of [changed, encode({ alg: 'none' }) + '.' + encode(claims) + '.', await sign(claims, { alg: 'RS256', kid: 'unknown' }), await sign({ ...claims, aud: 'other-project' }), await sign({ ...claims, iss: 'https://securetoken.google.com/other-project' })]) {
    await assert.rejects(verifyFirebaseToken(token, claims.aud, keys, now), /登入已失效/);
  }
});
test('拒絕過期、未生效、無效 UID 和缺少有效期的登入憑證', async () => {
  for (const body of [{ ...claims, exp: Math.floor(now / 1000) - 1 }, { ...claims, iat: Math.floor(now / 1000) + 500 }, { ...claims, auth_time: Math.floor(now / 1000) + 500 }, { ...claims, sub: 'bad/path' }, { ...claims, exp: null }]) {
    await assert.rejects(verifyFirebaseToken(await sign(body), claims.aud, keys, now), /登入已失效/);
  }
});
