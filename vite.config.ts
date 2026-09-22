import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
    base: process.env.GITHUB_PAGES ? '/Expense-Splitting/' : './',
    plugins: [react(), tailwindcss()],
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
