export type ReadIssue = { kind: 'read' | 'cache'; message: string };

export function storageFailure(error: unknown) {
  const { name = '', code, message = '' } = (error || {}) as { name?: string; code?: number; message?: string };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014 || /quota/i.test(message)
    ? '此裝置的記帳暫存空間不足，尚未上傳的變更與草稿仍保留。'
    : '此裝置暫時無法保存記帳資料，尚未上傳的變更與草稿仍保留。';
}

export function readFailure(error: unknown): ReadIssue {
  const { code = '', message = '' } = (error || {}) as { code?: string; message?: string };
  return { kind: 'read', message: /permission|denied|unauthorized/i.test(code + ' ' + message) || /^auth\/(user-token-expired|invalid-user-token|user-disabled|no-current-user|session-changed)$/.test(code)
    ? '此裝置目前無法存取帳本，請在「帳號同步」確認已登入原本帳號；本機紀錄與草稿仍保留。'
    : code === 'read/timeout'
      ? '讀取雲端帳本逾時，暫時顯示上次資料。請稍後重試；本機紀錄與草稿仍保留。'
      : '尚未讀取到最新帳本，暫時顯示上次資料。請稍後重試；本機紀錄與草稿仍保留。' };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, code = 'read/timeout'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
  })]).finally(() => clearTimeout(timer));
}

// This explicit verification cannot fall back to an older SDK snapshot.
// Database rules apply to the supplied Firebase user ID token.
export async function readServerJson(url: URL, token: string, signal: AbortSignal, request: typeof fetch = fetch) {
  const endpoint = new URL(url);
  endpoint.searchParams.set('auth', token);
  const response = await request(endpoint, { cache: 'no-store', redirect: 'error', signal });
  if (!response.ok) {
    // Never expose request URLs or authentication tokens in error messages.
    throw Object.assign(new Error('Cloud read failed'), { code: response.status === 401 || response.status === 403 ? 'permission-denied' : 'read/unavailable' });
  }
  return response.json();
}
