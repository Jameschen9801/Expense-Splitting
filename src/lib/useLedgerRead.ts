import { useCallback, useEffect, useRef, useState } from 'react';
import type { Group } from '../types';
import { fetchGroupFromServer, subscribeToGroup } from './firebase';
import { storage } from './utils';
import { sync } from './sync';
import { readFailure, storageFailure, withTimeout, type ReadIssue } from './syncFeedback';

type ReadState = { code?: string; phase: 'loading' | 'ready' | 'error'; issue: ReadIssue | null; retrying: boolean };
type UploadStatus = { pending: number; error: boolean; reason?: string; connected: boolean };
export type LedgerReadServices = {
  subscribe: typeof subscribeToGroup;
  read: (code: string, signal: AbortSignal) => Promise<Group | null>;
  save: (code: string, group: Group) => void;
  merge: (group: Group) => Group;
  flush: (code: string) => Promise<boolean>;
  uploadStatus: (code: string) => UploadStatus;
};
const services: LedgerReadServices = {
  subscribe: subscribeToGroup, read: fetchGroupFromServer, save: storage.saveGroup,
  merge: sync.merge, flush: sync.flush, uploadStatus: sync.getStatus,
};
type Scope = { code: string; retry: () => Promise<string | null>; current: () => Group | null };

export function useLedgerRead(code: string | undefined, onGroup: (group: Group) => void, onDeleted: () => void, sessionKey = '', io = services) {
  const [state, setState] = useState<ReadState>({ phase: 'loading', issue: null, retrying: false });
  const callbacks = useRef({ onGroup, onDeleted });
  callbacks.current = { onGroup, onDeleted };
  const scope = useRef<Scope | null>(null);
  useEffect(() => {
    if (!code) { scope.current = null; return; }
    let disposed = false, subscription = 0, sequence = 0, cacheUnavailable = false;
    let stop: (() => void) | undefined, timer: ReturnType<typeof setTimeout>;
    let latest: Group | null = null, issue: ReadIssue | null = null;
    let running: Promise<string | null> | undefined;
    let request: AbortController | undefined;
    const patch = (value: Partial<ReadState>) => { if (!disposed) setState(previous => ({ ...previous, code, ...value })); };
    const fail = (error: unknown) => { issue = readFailure(error); patch({ phase: 'error', issue }); };
    const accept = (cloud: Group | null) => {
      if (disposed) return;
      if (!cloud) { issue = { kind: 'read', message: '找不到雲端帳本，暫時保留此裝置的資料，請確認原本帳號與帳本。' }; patch({ phase: 'error', issue }); return; }
      latest = cloud; issue = null;
      const merged = io.merge(cloud);
      // Cache failures must not hide a new cloud inbox or restore old records.
      callbacks.current.onGroup(merged);
      try { io.save(code, merged); cacheUnavailable = false; }
      catch (error) { cacheUnavailable = true; issue = { kind: 'cache', message: '雲端帳本已讀取。' + storageFailure(error) }; }
      patch({ phase: issue ? 'error' : 'ready', issue });
    };
    const attach = async () => {
      const id = ++subscription;
      stop?.(); stop = undefined; clearTimeout(timer);
      timer = setTimeout(() => { if (!disposed && id === subscription) fail({ code: 'read/timeout' }); }, 15000);
      try {
        const unsubscribe = await io.subscribe(code, cloud => {
          if (disposed || id !== subscription) return;
          clearTimeout(timer); sequence++; accept(cloud);
        }, error => { if (!disposed && id === subscription) { clearTimeout(timer); fail(error); } }, () => {
          if (!disposed && id === subscription) { clearTimeout(timer); callbacks.current.onDeleted(); }
        });
        if (disposed || id !== subscription) unsubscribe(); else stop = unsubscribe;
      } catch (error) { if (!disposed && id === subscription) { clearTimeout(timer); fail(error); } }
    };
    const retry = (): Promise<string | null> => {
      if (running) return running;
      running = (async () => {
        patch({ retrying: true });
        request = new AbortController();
        try {
          // A permission error may have cancelled the old realtime listener.
          await withTimeout(attach(), 15000);
          // Empty outbox success alone never means the cloud read succeeded.
          await withTimeout(io.flush(code), 12000, 'upload/timeout').catch(() => false);
          if (disposed) return null;
          let before = sequence;
          let cloud = await withTimeout(io.read(code, request.signal), 15000);
          if (disposed) return null;
          // A delayed initial SDK snapshot can also be stale. Verify once more
          // after an intervening event instead of blindly preferring either one.
          if (before !== sequence) {
            before = sequence;
            cloud = await withTimeout(io.read(code, request.signal), 15000);
            if (disposed) return null;
          }
          // A newer live event may include an edit made while this read was in flight.
          if (before === sequence) accept(cloud);
          if (issue) return issue.message;
          const upload = io.uploadStatus(code);
          if (upload.pending || upload.error) return upload.reason || `帳本已重新讀取，仍有 ${upload.pending} 筆變更待上傳，資料保留在此裝置`;
          return upload.connected ? '帳本與待確認記帳已更新' : '帳本已讀取，正在恢復即時連線';
        } catch (error) {
          if (disposed) return null;
          fail(error); return issue!.message;
        } finally { request?.abort(); patch({ retrying: false }); running = undefined; }
      })();
      return running;
    };
    const session: Scope = { code, retry, current: () => cacheUnavailable && latest ? io.merge(latest) : null };
    scope.current = session;
    setState({ code, phase: 'loading', issue: null, retrying: false });
    void attach();
    // Retry a failed read when an iOS home-screen app resumes.
    const resume = () => { if (issue && document.visibilityState === 'visible') void retry(); };
    window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true; request?.abort(); clearTimeout(timer); stop?.();
      if (scope.current === session) scope.current = null;
      window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume);
    };
  }, [code, io, sessionKey]);
  return {
    ...(state.code === code ? state : { code, phase: 'loading' as const, issue: null, retrying: false }),
    retry: useCallback(() => scope.current?.retry() || Promise.resolve(null), []),
    current: useCallback((forCode: string) => scope.current?.code === forCode ? scope.current.current() : null, []),
  };
}
