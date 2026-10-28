# 免費背景通知接收

`expense-bank-background` 是獨立的 Cloudflare Workers Free 服務，不修改帳號中其他 Worker。既有帳目與待確認仍存於 Firebase Spark；不建立 Firebase Cloud Functions、不啟用 Blaze、不綁付費資源。

## 請求與資料

- `POST /manage`：驗證 Firebase Email 帳號 ID token 的 RS256 簽章、專案、期限與身分。本人可查看接收結果、建立或停用綁定。
- `POST /capture`：接受 256 位隨機綁定憑證，只能依雲端銀行規則送入自己的個人帳本待確認。測試模式不新增帳目。金額、卡號、交易種類有疑義時略過。
- `GET /health`：公開健康狀態，不讀取任何帳戶資料。

公開捷徑無個人憑證；綁定透過 `shortcuts:` 本機交接存於使用者的 Shortcuts 文字檔。HTTP URL 不包含憑證或通知。服務只保存憑證雜湊、解析後的待確認及最近接收結果；不保存或記錄原始通知，關閉 Worker 日誌與觀測功能。

Richart 已知來源變體、舊版 ID、正式帳目和已處理墓碑一起去重；交易時間不同仍視為不同通知。服務只讀既有紀錄的 ID 清單，使用一次原子多路徑更新建立待確認和歷史，不覆寫帳本。待確認由前端本人補資料後才確認入帳。

## Firebase 受限服務身分

後端使用獨立的匿名 Firebase Auth UID。管理者在 `bankBackgroundServices/<uid>` 登錄 `true`；前端及服務身分都不能修改此登錄。Cloudflare 加密 secret `FIREBASE_SERVICE_SESSION` 保存 `{ "uid": "...", "refreshToken": "..." }`，不可加入版本控制、公開範本、CI 產物或終端輸出。這不是管理者憑證，也不使用 service-account 私鑰。

資料庫規則排除此服務 UID 的一般前端權限，只開放銀行規則、個人帳本身分資料、收據判斷及接收管理所需路徑；只能建立新的待確認與對應歷史。服務不能編輯正式帳目、覆寫待確認、修改群主或銀行設定、加入共用群組、刪除／重建帳本。已刪帳本及墓碑繼續受原本規則保護。

撤銷方式：管理者移除該 UID 的 `bankBackgroundServices` 登錄，並刪除 Firebase Auth 服務使用者及 Cloudflare secret。若需輪換，先建立並登錄新服務 UID、更新 secret，驗證後再撤銷舊 UID。使用者自己的綁定可直接在 App 停用，毋須更換服務 UID。

## 部署

使用 Node.js 22 以上，先確認 Cloudflare 控制台的 Workers Free 是目前方案。不要啟用付費方案或新增付費綁定。

1. `npm ci --prefix worker`，執行下方測試與 `npm --prefix worker run build`。
2. 由管理者備份並部署 `database.rules.json`，只部署 database 規則。
3. 建立專用匿名服務 UID，私下保存 session，透過管理者權限登錄服務 UID。
4. `npm --prefix worker run deploy`，以 Wrangler secret stdin 設定 `FIREBASE_SERVICE_SESSION`；不要把值寫在參數或設定檔。
5. 核對 `/health` 與 App 綁定／連線測試，再發布 GitHub Pages。

固定入口：`https://expense-bank-background.poetes-wine-catalog.workers.dev`。端點若改動，需同步修改 `bankBackgroundProtocol.ts`、重新產生／簽署並分享主捷徑，再發布前端。通知來源範本只呼叫主捷徑名稱。

## 本機測試

啟動 Firebase Auth（9099）與 Database（9000）模擬器，專案必須是 `demo-expense-splitting`：

```sh
firebase emulators:start --only auth,database --project demo-expense-splitting
npm run test:rules
npm run test:background
npm run test:logic
npm run lint
npm --prefix worker run build
```

`test:background` 自動建立本機服務 session、啟動真正的 workerd 執行環境、測試 HTTP API 與 JWT，結束後移除暫存憑證。模擬器只接受固定 demo 專案與 localhost 位址；正式環境不接受未簽名 token 或模擬器設定。

免費方案目前上限為每日 100,000 次請求、每次 10 ms CPU、50 次外部子請求；超額會失敗，不自動計費。請依 [Cloudflare 官方限制](https://developers.cloudflare.com/workers/platform/limits/) 核對最新規則。網路斷線、免費額度或 iOS 中止時不保證送達，不會自動補送；App 接收結果才是確認依據。鎖定執行需在 iPhone 完成權限與真實通知測試。
