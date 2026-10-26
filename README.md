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
- 手機新增／編輯記錄時，直接在原欄位輸入，鍵盤上方提供下一欄與完成按鈕；完成輸入後使用原本的儲存按鈕。新增費用預設餐飲，分類含旅遊共十一項；舊帳目分類保持相容。常用範本操作已移除。

## iOS 銀行通知捷徑

1. 在捷徑會開啟的同一個 Safari 加入記帳群組，進入「群組設定 → 資料備份、匯出與 App 更新 → iOS 銀行捷徑記帳」。主畫面 App 與 Safari 可能使用不同裝置身分，不要清除原 App 資料。
2. 新增銀行關鍵字、卡號末四碼、付款人、分攤對象與分類。先使用「先確認再新增」核對結果；通知測試不會新增帳目。
3. 儲存規則並複製連結前綴，下載本站的「銀行通知記帳」捷徑。安裝時貼上前綴，勿公開分享。捷徑檔本身不含私人設定或帳目。
4. 在 iOS 27「捷徑 → 自動化 → 通知」選銀行 App 及消費通知篩選條件，將通知標題、副標題、訊息合併成文字，再用「執行捷徑」傳給「銀行通知記帳」。文字須包含銀行名稱、卡號末四碼及新臺幣金額。參考 [Apple 的 iOS 27 通知觸發器說明](https://support.apple.com/en-ng/guide/shortcuts/apd932ff833f/10.0/ios/27)。

捷徑會開啟網站後記帳，鎖屏時可能需要解鎖。網站不會在背景監聽其他 App，也不會付款或轉帳。只有測試通知成功且勾選同意後才能啟用自動新增；超過上限、缺少當日日期及疑似重複的通知會先確認。退款、驗證碼、帳單、外幣與無法明確辨識的金額不會自動新增。

通知文字放在網址片段，啟動時即移除；不放進 HTTP 查詢參數、不保存原始通知。規則與私人 HMAC 金鑰只存此瀏覽器，不包含在一般備份。支出透過既有身分權限與離線待同步清單保存；相同通知用固定 ID 防止重送重複。本機另保留最近 500 筆通知識別碼；已刪除且超出保留範圍的舊通知不保證去重。確為另一筆相同消費時請手動新增。

捷徑原始內容在 `scripts/ios-bank-shortcut.json`，使用 macOS 內建工具產生可匯入的簽署檔：

```bash
plutil -convert xml1 scripts/ios-bank-shortcut.json -o /tmp/expense-bank-notification-unsigned.shortcut
shortcuts sign --mode anyone --input /tmp/expense-bank-notification-unsigned.shortcut --output 'public/shortcuts/銀行通知記帳.shortcut'
```

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
