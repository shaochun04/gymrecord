# GYMRECORD Development History

這份文件整理產品主要里程碑，聚焦各階段交付的能力。

## Phase 1：訓練紀錄體驗

- 在訓練畫面同時顯示上次正式組與本次輸入內容。
- 完成組後啟動以絕對時間計算的休息倒數，支援加減 15 秒與跳過。
- 加入適合手機操作的重量／次數按鈕、直接輸入、動作備註及訓練時間。
- 完成 Session 後顯示時間、完成組數與正式組訓練量摘要。
- 統一跨菜單的最近同動作紀錄，作為上次顯示與新 Session 預填來源。
- 加入逐組動作歷史、重量 PR、同重量次數 PR 與 Epley 估算 1RM。

## Phase 2：RIR 與目標次數

- 正式組可記錄 RIR 0～4+。
- 菜單動作可設定目標次數上下限，開始 Session 時保存設定快照。
- 根據上次完成的正式組與目標區間顯示簡單的漸進超負荷建議。
- 備份格式升級至 v2，並維持 v1 匯入相容性。

## Phase 3：全域動作庫與肌群統計

- 建立具穩定 ID 的全域 `ExerciseDefinition`，支援搜尋、篩選、編輯、封存與合併。
- 菜單與歷史透過全域動作 ID 對應，同時保留 Session 顯示快照。
- 加入主要／次要肌群分類與每週主要肌群有效組數統計。
- 備份與 IndexedDB schema 升級至 v3，並維持 v1、v2 匯入相容性。

## Phase 4：日常使用與穩定性

- 加入菜單複製與訓練中動作排序。
- 完成訓練前提示未完成的正式組或動作。
- 支援修正已完成 Session 的重量、次數、RIR、完成狀態與暖身／正式組。
- 歷史修正後重新計算 PR、紀錄訓練量與肌群統計。
- 完成摘要提示新重量 PR 或同重量次數 PR，進步頁加入單一動作的紀錄訓練量趨勢。

## PWA 發布

- 設定 GitHub Pages `/gymrecord/` base path、manifest、icons 與 service worker scope。
- 建立 GitHub Actions 流程，在 `main` 更新後自動測試、建置並部署 `dist/`。
- 提供 Android Chrome 可透過 HTTPS 安裝的正式 PWA 測試版本。

## Phase 4.1：Android PWA 核心修正

- 動作模型改為基礎動作加器材／變化選項，菜單保存預設值，Session 保存當次實際快照。
- previous、預填、PR、漸進建議與訓練量趨勢改用完整 variant identity。
- 備份與 IndexedDB 升級至 v4，保留 v1～v3 匯入相容性及 active Session 資料。
- reload 直接恢復訓練，加入 pull-to-refresh 防護、瀏覽器返回層級與跨分頁唯讀保護。
- 歷史修正增加 set 增刪及器材／變化修改，CSV 改用本機日期並輸出 variation。
- 匯入前顯示內容摘要，執行原子取代前先下載現有資料的 emergency backup。
