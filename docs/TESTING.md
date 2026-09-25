# GYMRECORD Testing

## 自動測試

執行：

```powershell
npm test
npm run build
```

目前的 Vitest 測試涵蓋：

- workout 計算、上次紀錄配對、單位換算與 PR。
- 全域動作定義、肌群統計與歷史修正。
- repository 契約、active Session 唯一性及 IndexedDB migration 失敗回滾。
- JSON v1／v2／v3 驗證、逐版 migration、匯出與重新匯入。

`npm run build` 同時執行 TypeScript build 與 Vite production build。

## 已完成的桌面 mobile viewport 驗證

### 訓練畫面

- 以 320、360、390、412、430 px 寬度檢查 6 組以上的訓練紀錄。
- 檢查長動作名稱、長備註、休息控制及 kg／lb 顯示，未發現橫向溢出。
- 以縮短視窗檢查數字輸入框聚焦後的捲動行為。
- 模擬切到背景超過休息時間後返回，倒數會依 `restEndsAt` 與實際時間更新。
- 確認訓練中重新整理後可恢復 active Session。
- 加入 RIR 後再次檢查 360、390、412 px；選擇器保留在卡片內，重新整理後已選 RIR 仍存在。

### 動作庫、歷史與進度

- 以 360、390、412 px 檢查菜單動作選擇、動作庫與肌群進度。
- 使用長動作名稱、長器材名稱、變化及主要／次要肌群多選測試，未發現橫向溢出。
- 檢查菜單複製、訓練中動作排序、歷史編輯與進步頁。
- 歷史編輯的固定底部儲存按鈕可在多組紀錄中保持可用。
- 修改後的重量與 RIR 在重新開啟歷史詳情後仍會保留。

### PWA 部署

- 正式網站使用 HTTPS 與 `/gymrecord/` base path。
- 已確認首頁、manifest、192／512 px 圖示、service worker、JavaScript 與 CSS 可正常載入。
- 已確認切換 App 內頁後重新整理可重新載入，瀏覽器沒有資源錯誤。

## Android 實機測試 checklist

桌面 viewport 無法驗證 Android Chrome、系統鍵盤、鎖屏及檔案存取的實際行為。開始長期使用前，建議先匯出 JSON 備份，再逐項記錄結果。

- [ ] 從 Android Chrome 安裝 PWA，關閉後由主畫面重開
- [ ] 開始訓練；關閉重開後 active Session 能恢復
- [ ] 系統數字鍵盤與重量／次數 ± 按鈕
- [ ] 完成組與 RIR 輸入
- [ ] 背景切換與鎖屏後，休息倒數仍按實際時間恢復
- [ ] 長時間訓練與當次動作排序
- [ ] 結束 Session，確認未完成組提醒及摘要
- [ ] 編輯已完成的歷史紀錄
- [ ] 檢查 PR、紀錄訓練量與肌群統計更新
- [ ] 匯出 JSON 備份並確認手機可找到檔案
- [ ] 匯入 JSON 備份並確認紀錄一致
