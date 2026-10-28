import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onRequest } from 'firebase-functions/v2/https';
import { createBankApi } from './api';

const emulator = process.env.FUNCTIONS_EMULATOR === 'true';
initializeApp({ databaseURL: emulator ? 'https://demo-expense-splitting-default-rtdb.firebaseio.com' : 'https://expense-splitting-a9b78-default-rtdb.firebaseio.com' });
const handle = createBankApi({ database: getDatabase(), auth: getAuth() });
export const bankInboxApi = onRequest({
  region: 'asia-east1', memory: '256MiB', cpu: 'gcf_gen1', concurrency: 1,
  minInstances: 0, maxInstances: 1, timeoutSeconds: 30, invoker: 'public',
  cors: emulator ? ['https://jameschen9801.github.io', /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/] : ['https://jameschen9801.github.io'],
}, async (request, response) => { await handle(request, response); });
