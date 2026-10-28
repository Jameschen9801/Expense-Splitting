# 個人帳本背景收件服務

目前程式與 Apple 通用範本已完成，本機模擬器與原生 macOS 捷徑已測試；**尚未正式部署**。2026-10-28 唯讀查詢確認 `expense-splitting-a9b78` 的 `billingEnabled` 為 false。正式 Cloud Functions 需要 Blaze，須先由專案擁有者同意並完成計費設定，不能在部署過程中自行升級。

## 行為與權限

- iOS 通知來源只選 Richart，通知內文傳給「銀行背景記帳」。主捷徑直接 HTTPS POST，不含開啟網站動作。安裝／綁定時的 Apple 頁面和提示仍會顯示。
- `/manage` 使用 Firebase ID token，且需要已連結 Email 的帳本身分。建立憑證前會查驗同步規則與個人帳本所有權；可查詢最近結果或撤銷所有背景憑證。
- `/capture` 使用隨機 256-bit 的受限憑證。只可新增這個帳號目前擁有的個人帳本待確認，不可讀取、刪帳或修改設定。每次重新讀取 `accountSync/<uid>/bank/rules`，停用與卡片修改立即生效。
- 憑證原文只在建立時回傳，在裝置 App 私人儲存與 Shortcuts 的 `ExpenseSplitting-bank-background.txt` 保存。伺服器只保存 SHA-256 雜湊；兩個 `bankIngress*` 路徑由既有預設拒絕規則保護。一般 JSON 備份不包含憑證。
- 通知原文只在接收時處理，不寫入資料庫、應用程式日誌或 URL。不使用 AI；只保存解析出的金額、日期、銀行末碼與待確認資料。無日期時使用台北日期。
- 通知 ID 沿用既有 HMAC，核對 Richart／Richart Life 已知標題變體與舊 ID。根帳本交易一次寫入 `bankInbox` 和稽核；正式帳目不變。忽略／確認後的墓碑不會被重送復活。
- `/capture` 的 `mode:test` 只驗證連線與規則，不新增帳目。成功／重複／不符規則時捷徑安靜結束，伺服器拒絕則提示；網路錯誤或 iOS 中止不會自動補送。
- 鎖定時執行仍取決於 iOS 的網路、捷徑與檔案權限，不能用 macOS 測試替代 iPhone 實測。先在解鎖時完成首次連線授權。

## 本機驗證

需要 Node 22、Java 21 與 Firebase CLI。先在專案根目錄安裝依賴：

```sh
npm ci
npm ci --prefix functions
npm run build --prefix functions
firebase emulators:start --only auth,database,functions --project demo-expense-splitting
```

另一個終端機執行：

```sh
npm run lint
npm run test:logic
npm run test:background
npm run test:rules
VITE_USE_FIREBASE_EMULATOR=true npm run dev
```

`test:background` 只連 127.0.0.1 的 demo 命名空間，建立自己的假帳號及帳本。它和 `test:rules` 會重設本機測試資料，請循序執行。不得改為正式專案或對真實帳目執行。

## 發布順序

1. 取得專案擁有者對 Blaze 用量計費的明確同意，再由擁有者選擇及連結計費帳號。官方條件見 [Firebase Cloud Functions 入門](https://firebase.google.com/docs/functions/get-started)。
2. 執行上述檢查。服務設為 `asia-east1`、Node 22、256 MiB、閒置 0 台、最多 1 台、單次 30 秒；這些限制不代表費用上限，也不保證零費用。
3. 先部署服務：`firebase deploy --only functions:bank-background --project expense-splitting-a9b78`。這不更改 Database 規則或現有帳目。新增服務需要啟用 Cloud Functions 相關 API；部署可能涉及建置、執行與映像儲存費用。
4. 確認 `https://asia-east1-expense-splitting-a9b78.cloudfunctions.net/bankInboxApi/health` 回傳 `ok:true`，再推送前端 `main`，讓既有 GitHub Pages 工作流程發布。不得先發布指向尚不存在服務的綁定介面。
5. 使用者從原本的 App 加入「銀行背景記帳」、綁定並測試，再加入及啟用「Richart 背景記帳」。停用舊「Richart 通知自動化」，否則舊版仍會開 Safari。App 不會把點過安裝按鈕當成手機已啟用。

通用捷徑由根目錄 `scripts/create-background-shortcuts.mjs` 產生 JSON。更改後重新用 Apple `shortcuts sign` 簽署、更新 iCloud 分享版與 ZIP，核對公開版的固定 endpoint、文字輸入、`.txt` 設定檔和 Richart 通知觸發條件。範本與公開檔不得包含任何實際帳號憑證。

`predeploy` 會將共用解析邏輯一起包入 `functions/lib/index.js`；上傳只需 bundle、套件及 lockfile。`gcp-build` 刻意留空，避免雲端建置再執行需要專案根目錄原始碼的本機 build。此行為依 [Google Node.js runtime 的建置說明](https://docs.cloud.google.com/run/docs/runtimes/nodejs#npm_build_script) 設定。
