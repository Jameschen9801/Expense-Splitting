<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 分帳即時通

使用 React、Vite 與 Firebase Realtime Database 製作的多人分帳工具。

## 手機記帳與同步

- 新增、編輯、刪除會先寫入此裝置的待同步清單，再依群組順序上傳。重開 App、恢復連線或回到前景時會自動補傳；雲端更新會與尚未上傳的操作合併。
- 未完成的費用／轉帳草稿依群組及使用者保存在此裝置，重新開啟記帳視窗可繼續填寫。保存記錄後會清除草稿。
- 同步狀態顯示離線、待同步筆數、同步中或已同步。裝置上的草稿與待同步清單不是跨裝置備份；清除網站資料也會清除它們。
- 手機彈窗跟隨可見畫面高度，標題與儲存列固定，中間表單獨立捲動。明細先顯示最近 50 筆，可載入更多，搜尋涵蓋全部記錄。

## 🚀 快速開始

### 1. 安裝套件
確保你已經安裝 Node.js，然後執行：
```bash
npm install
```

### 2. 啟動開發環境
啟動開發伺服器：
```bash
npm run dev
```

### 3. 執行檢查
```bash
npm run lint
npm run test:logic
npm run build
```

### 4. 建置與部署
本專案已設定 GitHub Actions。當程式碼推送到 `main` 分支時，會自動觸發 `.github/workflows/deploy.yml` 腳本，將 `dist` 的靜態網頁內容自動部署至 GitHub Pages。
- 請確認 GitHub Repository 的 **Settings -> Pages** 中的 **Source** 已設定為 **GitHub Actions**。

### 5. Git 忽略檔案設定
本專案透過 `.gitignore` 已排除：
- `node_modules/`: 第三方依賴套件
- `dist/`, `build/`: 編譯後的輸出檔案
- `.env*`: 敏感資訊與環境變數（除 `.env.example`）
- `*.log`: 各類日誌檔
- 作業系統或編輯器的快取檔 (`.DS_Store`, `.vscode/`)
