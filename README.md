<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9f732e2a-8b39-46c1-a3b7-399effa24932

## 🚀 快速開始

### 1. 安裝套件
確保你已經安裝 Node.js，然後執行：
```bash
npm install
```

### 2. 啟動環境
設定環境變數：
```bash
cp .env.example .env.local
```
將 `GEMINI_API_KEY` 填入 `.env.local`。

啟動開發伺服器：
```bash
npm run dev
```

### 3. 建置與部署
本專案已設定 GitHub Actions。當程式碼推送到 `main` 分支時，會自動觸發 `.github/workflows/deploy.yml` 腳本，將 `dist` 的靜態網頁內容自動部署至 GitHub Pages。
- 請確認 GitHub Repository 的 **Settings -> Pages** 中的 **Source** 已設定為 **GitHub Actions**。

### 4. Git 忽略檔案設定
本專案透過 `.gitignore` 已排除：
- `node_modules/`: 第三方依賴套件
- `dist/`, `build/`: 編譯後的輸出檔案
- `.env*`: 敏感資訊與環境變數（除 `.env.example`）
- `*.log`: 各類日誌檔
- 作業系統或編輯器的快取檔 (`.DS_Store`, `.vscode/`)
