# GYMRECORD

GYMRECORD 是一款手機優先、可離線使用的重量訓練紀錄 PWA。它以每組重量、次數與 RIR 為核心，協助你在訓練中快速輸入，並從歷史紀錄查看進步趨勢、PR 與肌群訓練量。

## 立即使用

正式網址：[https://shaochun04.github.io/gymrecord/](https://shaochun04.github.io/gymrecord/)

網站透過 GitHub Pages 提供，支援 HTTPS、離線快取與安裝到手機主畫面。所有訓練資料只儲存在目前裝置與瀏覽器的 IndexedDB，不會上傳到伺服器。

## 主要功能

- 建立、編輯、複製與排序 Push、Pull、Leg、Upper、Lower 等訓練菜單。
- 從全域動作庫挑選基礎動作，管理可用器材、變化、主要／次要肌群及封存狀態。
- 快速記錄重量、次數、暖身／正式組、完成狀態與 RIR，並支援 kg／lb 顯示。
- 依最近一次同動作紀錄預填重量與次數，同時保留「上次」資料方便比較。
- 設定目標次數區間，依上次表現顯示簡單的漸進超負荷建議。
- 完成組後自動啟動休息倒數，可加減 15 秒或直接跳過。
- 訓練中可選擇當次實際器材與變化並自動儲存；關閉或重新整理後會直接恢復未完成的 Session。
- 查看訓練日曆、逐組歷史、重量 PR、同重量次數 PR 與 Epley 估算 1RM。
- 查看每週主要肌群有效組數、訓練天數及未分類組數。
- 修正已完成訓練的器材、變化、重量、次數、RIR、完成狀態及組別類型，也可增刪組數；統計會自動重算。
- 匯出／匯入完整 JSON 備份，並可匯出 CSV 訓練紀錄。

## 安裝到 Android Chrome

1. 使用 Android Chrome 開啟[正式網址](https://shaochun04.github.io/gymrecord/)。
2. 等待 App 載入完成。
3. 開啟右上角選單，選擇「安裝應用程式」或「加到主畫面」。
4. 安裝完成後，從手機主畫面的 GYMRECORD 圖示開啟。

Chrome 不同版本的選單文字可能略有差異。若沒有出現安裝選項，請確認使用的是上述 HTTPS 網址並重新載入頁面。

## 本機資料與備份

GYMRECORD 沒有帳號、後端資料庫或雲端同步。每台裝置、每個瀏覽器網站來源都有獨立的 IndexedDB；電腦 `localhost`、GitHub Pages 與未來 APK 的資料不會自動共用。

請定期從設定頁匯出 JSON 備份。換手機、清除 Chrome 網站資料或移除 PWA 前，應先匯出並確認備份檔可讀。手機與電腦之間可透過 JSON 匯出／匯入轉移完整資料。目前備份格式為 v4，仍可匯入 v1、v2 與 v3 備份。匯入前會顯示內容摘要，確認後先下載現有資料的 emergency backup，再執行原子還原。

## 本機開發

需要 Node.js 與 npm。

```powershell
npm install
npm run dev
```

開發網址為 `http://127.0.0.1:5173/gymrecord/`。

```powershell
npm test
npm run build
npm run preview
```

正式建置輸出在 `dist/`。推送到 `main` 後，GitHub Actions 會依序執行 `npm ci`、`npm test`、`npm run build`，通過後部署至 GitHub Pages。

## 技術棧

- React 19、TypeScript、Vite
- Dexie 與 IndexedDB
- Vite PWA Plugin 與 Workbox
- Vitest 與 fake-indexeddb
- GitHub Actions 與 GitHub Pages

## Android APK 方向

未來可保留現有 React 介面，以 Capacitor 建立 Android 專案，並透過符合 `WorkoutRepository` 的 SQLite adapter 儲存資料。瀏覽器與 APK 仍是各自獨立的本機資料空間，資料轉移將繼續使用 JSON 備份。

## 專案文件

- [Architecture](docs/ARCHITECTURE.md)
- [Testing](docs/TESTING.md)
- [Development history](docs/DEVELOPMENT.md)
