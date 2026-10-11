import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { execFileSync } from 'node:child_process';
import { appShellPlugin } from './scripts/pwa';

let revision = process.env.GITHUB_SHA?.slice(0, 7) || 'local';
try { if (revision === 'local') revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const version = revision + '-' + new Date().toISOString();

export default defineConfig({
    base: process.env.GITHUB_PAGES || process.env.GITHUB_ACTIONS ? '/Expense-Splitting/' : '/',
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), tailwindcss(), appShellPlugin(version)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // 可透過 DISABLE_HMR 關閉檔案監聽，避免部分託管環境反覆重新載入。
      hmr: process.env.DISABLE_HMR !== 'true',
    },
});
