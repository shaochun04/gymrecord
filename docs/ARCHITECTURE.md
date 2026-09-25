# GYMRECORD Architecture

## 整體結構

GYMRECORD 目前是 React／Vite PWA。畫面不直接操作 Dexie，而是透過資料存取介面與變更通知介面取得資料。

```text
React UI
  ├─ WorkoutRepository ── IndexedDbWorkoutRepository ── Dexie / IndexedDB
  └─ WorkoutChangeSource ─ IndexedDbWorkoutChanges ───── Dexie liveQuery
```

這個邊界讓查詢、寫入與 UI 更新保持分離，也讓未來 Android 版可替換儲存實作，而不必重寫訓練畫面與統計邏輯。

## WorkoutRepository

`WorkoutRepository` 是資料存取契約，提供：

- 動作定義、菜單、Session 與設定的個別查詢及寫入。
- 依 ID 或日期範圍查詢 Session。
- 取得目前進行中的 Session。
- 供完整備份使用的一致性 `readAll()` snapshot。
- 原子還原完整資料的 `replaceAll()`。
- 封存及合併全域動作定義。

契約規定菜單依 `order` 排序、Session 依 `startedAt` 由新到舊排序，設定必須存在且 ID 為 `main`。同一時間最多只能有一筆 active Session；偵測到多筆時會回報資料異常，不會任意取第一筆。

## WorkoutChangeSource

`WorkoutChangeSource` 與 repository 分開，負責通知 UI 哪一類資料已更新：

- `exerciseDefinitions`
- `routines`
- `sessions`
- `settings`

網頁版的 `IndexedDbWorkoutChanges` 使用 Dexie `liveQuery` 實作。取消訂閱會停止後續 callback。未來 SQLite adapter 可在 transaction 成功後透過簡單事件來源送出相同通知，不需要模擬 Dexie 的 reactive query。

## IndexedDB

網頁版使用名為 `gymrecord` 的 IndexedDB，現行 schema 為 v3：

- `exerciseDefinitions`
- `routines`
- `sessions`
- `settings`

Dexie database upgrade 負責既有瀏覽器資料的升級：

- v1 → v2：加入目標次數區間與 RIR 欄位。舊菜單以原 reps 建立相同的上下限，舊歷史的目標區間與 RIR 保持空值。
- v2 → v3：建立全域 `ExerciseDefinition`，並讓菜單及 Session 以穩定 ID 引用。舊資料只在正規化後的名稱與器材完全相同時自動視為同一動作。

僅存在舊歷史、未被菜單引用的動作會建立為封存狀態，歷史仍可正常顯示。

## ExerciseDefinition 與快照

`ExerciseDefinition` 保存全域動作身分、名稱、器材、變化、肌群分類與封存狀態。`RoutineExercise` 透過 `exerciseDefinitionId` 引用全域動作，並保存該菜單自己的重量、次數、目標區間、組數、休息時間與備註。

開始訓練時，`SessionExercise` 會保存名稱、器材、變化、備註及目標區間快照。之後修改全域動作或菜單，不會改變舊 Session 當時顯示的內容；歷史與統計仍可利用穩定的全域 ID 對應同一動作。

## JSON 備份 migration

JSON 備份與 IndexedDB schema 各自有版本流程。目前輸出格式為 `gymrecord-backup` v3，匯入流程為：

```text
解析 JSON
  → 驗證 format 與來源版本
  → v1 → v2 → v3 逐版 migration
  → 以 v3 schema 完整驗證資料與動作引用
  → repository.replaceAll()
```

v1 備份會先加入 RIR 與目標次數結構，v2 再建立全域動作資料。所有驗證與 migration 都在清除既有資料前完成，因此格式錯誤不會啟動還原 transaction。

## 原子操作

以下操作必須完整成功或完整回滾：

- `replaceAll()`：清除並重建動作定義、菜單、Session 與設定。
- `mergeExerciseDefinitions()`：更新所有菜單與 Session 引用，再封存來源動作。
- active Session 寫入：檢查唯一性並保存 Session。

網頁版使用單一 Dexie transaction 實作。transaction 內任何清除、驗證後寫入或批次更新失敗，原有資料都不會只完成一部分。

## 未來 Android SQLite adapter

Android APK 可沿用目前的 domain model、`WorkoutRepository` 與 `WorkoutChangeSource`：

- 以 SQLite 查詢實作個別 repository 方法。
- `replaceAll()`、動作合併與 active Session 唯一性檢查使用單一 SQLite transaction。
- 寫入 commit 後，再由獨立事件來源通知 UI。
- JSON v1／v2／v3 migration 仍可沿用，作為瀏覽器與 APK 之間的離線資料轉移方式。

SQLite adapter 不代表瀏覽器與 Android 會自動同步；兩者仍是獨立的本機資料庫。
