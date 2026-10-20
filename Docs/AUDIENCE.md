# 常客分析（audience）

## 邊界

- `traffic` 管主播／場次／時段與分類，不管理個別觀眾。
- `audience` 管個別觀眾的互動聚合與常客等級，使用獨立的 `data/audience.sqlite`。
- `monitor` 只負責顯示；標記由 audience 計算後附在監控訊息上。
- `useTTS` 仍是單則訊息「要不要朗讀」的可選提示。常客等級不直接改寫 `useTTS`，而是作為 optional metadata，讓對端 app 自己決定優先權或解鎖政策。

## 身分

- key 優先使用平台 `userId`；沒有時才用 `平台 + 正規化顯示名稱`。
- 顯示名稱會更新為最近一次看到的值；同一 key 的舊名稱不會另開新觀眾。
- 目前 socket payload 还没有統一的 `userId` 欄位；userscript 沒帶 ID 時會以名稱合併，這是已知限制。

## 資料表

- `audience_users`：`platform`、`user_key`、`display_name`、`first_seen`、`last_seen`。
- `audience_attendance`：每個 `(platform, session, user_key)` 一列，存 `messages`、`gifts`、`joins`、`day`、`last_seen`。
- `audience_days`：`(platform, user_key, day)`，用來算活躍天數；沒有 traffic 場次時仍可記錄。
- 不存原始訊息；只存聚合。預設保留 180 天，可用 tracker 的 `prune()` 清理。

## 場次邊界

- 以 `traffic` 的 sessions 為準：訊息時間落在哪一場，就記到那一場。
- 沒有 traffic 場次時（例如只有 userscript）仍記 `audience_days` 與使用者最後出現，但不計出席／連續。
- 出席的定義是：該場至少有一則非系統互動（聊天、送禮、加入、點讚等）。只在線不算。

## 分數（0–100）

最近 30 天，五個分量各自有上限，等級在讀取時計算，不存 XP：

| 分量 | 公式 | 上限 |
| --- | --- | --- |
| 出席 | `min(activeStreams / 20, 1) × 35` | 20 場 |
| 連續 | `min(streak / 8, 1) × 25` | 8 場 |
| 廣度 | `min(activeDays / 15, 1) × 15` | 15 天 |
| 互動 | `min(cappedMessages / 100, 1) × 15` | 100 則 |
| 支持 | `min(giftEvents / 10, 1) × 10` | 10 次 |

- 連續場次從最近一場往回算；中斷一場即歸零。
- 訊息：排除指令與被過濾訊息，每場最多 10 則、每分鐘最多 2 則。
- 送禮：只計次數，不計金額，每場最多 5 次。
- 滿分 100；65 分的例子是「15 場、連續 6 場、12 個活躍日、50 則訊息、1 次送禮」。

## 等級

| 等級 | 最低分 | 額外條件 |
| --- | --- | --- |
| L1 常客 | 20 | 出席 ≥ 3 場 |
| L2 熟客 | 40 | 連續 ≥ 3 場 |
| L3 老友 | 65 | 出席 ≥ 10 場 |
| L4 鐵粉 | 85 | 連續 ≥ 6 場 |

L0 是尚未達到常客門檻。關係（新朋友／朋友／老朋友／元老）依 `first_seen` 天數獨立顯示，不會因為久未出現而消失。

## 標記

- 送禮常客：送禮 ≥ 3 次且跨 ≥ 2 場。
- 每次都來：連續 ≥ 3 場。
- 常打字：出席 ≥ 3 場且有效訊息 ≥ 20 則。
- 新朋友：首次出現 < 7 天。

標記不寫入資料庫，門檻調整後立即生效。

## 頁面與 API

- `/audience`：常客列表、搜尋、平台／排序、分頁；點選觀眾可看分數組成、等級門檻與最近場次。
- `GET /api/audience?platform=&q=&sort=&page=`：列表。
- `GET /api/audience/user?platform=&user=`：單一觀眾的完整明細。
- 頁面與 API 都要求主服務登入；API 只回聚合，不回原始訊息。

## 測試

```bash
node --test Test/audience_tracker.test.cjs Test/audience_routes.test.cjs
node Test/audience_ui.cjs
```

UI 冒煙測試使用記憶體追蹤器與假場次，不需要啟動正式服務；會自動尋找 Chrome/Edge，必要時用 `TRAFFIC_TEST_BROWSER` 指定執行檔。
