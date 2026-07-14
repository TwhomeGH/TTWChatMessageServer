# live_engine — 即時聊天室訊息疊加畫面 + 表情 + TTS 朗讀

透明穿透的直播聊天室 Overlay，接收 TCP 訊息後以 OpenGL 渲染在畫面上，支援內嵌圖片 URL 解析、系統字型選擇、觀眾人數、直播計時器，並可透過 edge-tts 朗讀訊息。

---

## 功能

- **透明疊層視窗** — 無邊框、支援點擊穿透/拖曳調整位置
- **頭像 + 用戶名 + 內嵌表情 + 禮物圖示** 渲染
- **文字自動換行**，可選系統字型
- **訊息平滑動畫** — 進場、滾動、淡出
- **超出視窗自動滾動** — 最新訊息保持在可見區域
- **內嵌圖片 URL 解析** — 自動下載並渲染訊息中的圖片 URL（Discord CDN 等）
- **表情快取** — 最近 20 張自動快取，同 URL 不重複下載；**本地磁碟快取**（`cache/emojis/`）跨啟動復用，不重複下載已快取圖片
- **表情跟隨字體** — 大小比例跟隨字體設定（font_size × 1.6），不再寫死
- **觀眾人數顯示** — 從 `userNum` / `userList` 欄位讀取，顯示於疊層頂部
- **直播計時器** — Socket 連線自動啟動、斷線停止，可手動控制
- **系統托盤** — 懸浮圖示，滑鼠右鍵選單管理疊層與設定視窗
- **設定視窗縮小到托盤** — 關閉按鈕（X）改為隱藏到托盤而非結束程式
- **全域熱鍵 R → 8** — 開啟 TTS 設定視窗
- **TTS 朗讀** — 使用 Microsoft Edge 雲端語音（edge-tts）
- **語音過濾器** — 排除/替換關鍵字、移除 URL、Emoji、純數字
- **佇列管理** — 佇列上限、滿載策略（跳過/停止舊/清空）
- **可調參數** — 語速、音量、語音、最小/最大字數
- **疊加層設定 GUI** — 四頁分頁：基本（字型、大小）、間距、位置（拖曳）、計時器
- **字型選擇** — GDI EnumFontFamiliesW 列舉系統所有已安裝字型
- **pytest 測試** — 核心邏輯 42 項單元測試

---

## 目錄結構

```
live_engine/
├── main.py                      # 進入點
├── config.py                    # 預設設定
├── README.md                    # 本文件
├── requirements.txt             # 依賴套件
├── shaders/
│   ├── sdf_font.vert            # SDF 字型頂點著色器
│   └── sdf_font.frag            # SDF 字型片段著色器
├── renderer/
│   ├── overlay.py               # 透明疊層視窗 (QOpenGLWidget)
│   ├── font_system.py           # 文字 → OpenGL 紋理
│   ├── texture_loader.py        # 頭像/禮物/表情圖片下載 + 紋理載入
│   ├── gl_renderer.py           # 背景方塊繪製
│   └── shader.py                # GLSL 著色器編譯
├── core/
│   ├── engine.py                # 主更新迴圈、佈局計算、計時器、觀眾人數
│   ├── scene.py                 # ChatNode 資料模型（含分段解析）
│   ├── emoji_parser.py          # 訊息中圖片 URL 擷取與分段
│   ├── tts.py                   # edge-tts 語音朗讀服務
│   ├── speech_filter.py         # 語音過濾器（關鍵字、URL、Emoji）
│   ├── hotkey.py                # 全域熱鍵 R+8
│   └── debug_log.py             # 日誌系統
├── gui/
│   ├── system_tray.py           # 系統托盤（右鍵選單、雙擊開啟設定）
│   ├── overlay_settings.py      # 疊加層設定（大小/位置拖曳/計時器）
│   ├── tts_settings_window.py   # TTS 設定視窗
│   ├── filter_settings.py       # 過濾器管理視窗
│   └── settings_manager.py      # JSON 設定讀寫
├── network/
│   └── socket_server.py         # TCP Server (port 9322)
├── config/
│   ├── tts_settings.json        # TTS 設定（執行期自動產生）
│   ├── tts_filter.json          # 過濾規則（執行期自動產生）
│   └── overlay_settings.json    # 疊加層位置/大小（執行期自動產生）
└── logs/
    └── live_engine.log          # 執行日誌（自動產生）
```

---

## 安裝

```bash
pip install -r requirements.txt
pip install pynput        # 全域熱鍵（建議安裝）
```

---

## 執行

### 疊層視窗 + 訊息接收

```bash
python main.py
```

### 僅開啟 TTS 設定

```bash
python main.py --settings
```

---

## 系統托盤

啟動後工作列通知區域會出現藍色 **L** 圖示：

| 操作 | 行為 |
|------|------|
| 雙擊圖示 | 開啟疊加層設定視窗 |
| 右鍵 → 隱藏/顯示疊加層 | 切換疊層可見性 |
| 右鍵 → 疊加層設定 | 基本、間距、位置、計時器四頁設定 |
| 右鍵 → TTS 朗讀設定 | 語音參數與佇列設定 |
| 右鍵 → 過濾器設定 | 關鍵字過濾與排除規則 |
| 右鍵 → 關閉 | 結束整個應用程式 |

所有設定視窗（疊加層、TTS、過濾器）點擊 **X** 按鈕時會縮小到系統托盤而非關閉，可從托盤選單重新開啟。

---

## 疊加層設定 GUI

可從系統托盤 → 疊加層設定 開啟，分為四個頁籤：

**基本**
- **寬度/高度** — 視窗尺寸調整（立即生效，自動儲存）
- **字型** — 系統所有已安裝字型（可自訂輸入），生效時清除字型快取
- **字體大小** — 訊息字體大小 10~30px
- **[開啟 TTS 朗讀設定]** — 直接跳轉 TTS 設定頁面，無需熱鍵或托盤

**間距**
- **行間距** — 節點與節點之間的垂直間距 (0~30px)
- **內容間距** — 用戶名與訊息文字之間的垂直間距 (0~20px)

**位置**
- **啟用拖曳調整位置** — 勾選後關閉點擊穿透，可用滑鼠拖動疊層視窗，顯示藍色邊框
- **儲存目前位置 / 重設預設位置** — 手動管理視窗座標

**計時器**
- 顯示目前計時（HH:MM:SS），可手動開始/停止/重設

---

## 通訊協定

Socket port **9322**，每行一個 JSON：

```json
{"user":"觀眾名","message":"哈囉","img":"頭像網址","giftImg":"禮物網址","type":"StreamMessage","isMain":true,"userNum":0,"userList":[]}
```

| 欄位 | 說明 |
|------|------|
| `user` | 用戶名稱 |
| `message` | 訊息內容（含圖片 URL 時自動解析為內嵌表情） |
| `img` | 頭像圖片 URL |
| `giftImg` | 禮物圖片 URL |
| `type` | `"StreamMessage"` 才會觸發 TTS |
| `isMain` | 是否為主訊息 |
| `userNum` | 觀眾人數（顯示於疊層頂部） |
| `userList` | 觀眾列表（有提供時顯示其長度為人數） |

### 圖片 URL 解析

`message` 欄位中的 `png`/`jpg`/`jpeg`/`gif`/`webp` 圖片 URL 會被自動偵測，下載後內嵌顯示於對話中（大小跟隨字體設定）。快取保留最近 20 張，避免重複下載。

### 系統事件（自動計時）

Socket 連線/斷線時引擎會自動觸發計時器啟停，無需手動操作。

---

## 全域熱鍵

**按 R 再按 8**（一秒內）→ 開啟 TTS 設定視窗

---

## TTS 設定

可在 GUI 中調整：

| 頁籤 | 項目 |
|------|------|
| 一般 | 啟用開關、只讀主訊息、朗讀用戶名、中間詞、打斷 |
| 聲音 | 語音選擇、語速 (-100~+100%)、音量 (-100~+100%) |
| 限制 | 最小字數、最大字數、佇列上限、滿載動作 |

### 佇列滿載三種行為

1. **跳過新訊息** — 直接丟棄
2. **停止舊的，朗讀最新的** — 打斷當前朗讀，新的接上
3. **清空全部佇列** — 停止播放 + 清除計數 + 朗讀新的

---

## 過濾器

可在 GUI 中管理：

- 排除關鍵字（完全移除）
- 替換關鍵字（取代為指定文字）
- 移除 URL
- 移除 Emoji
- 移除純數字

---

## 設定檔

| 檔案 | 說明 |
|------|------|
| `config/tts_settings.json` | TTS 設定（GUI 修改後自動儲存） |
| `config/tts_filter.json` | 過濾規則（GUI 修改後自動儲存） |
| `config/overlay_settings.json` | 疊加層位置、大小、字型、間距（修改立即儲存） |

設定修改後引擎會自動偵測並同步，無需重啟。

---

## 日誌

所有事件寫入 `logs/live_engine.log`，包含時間戳。可搭配 `--settings` GUI 進行除錯。

---

## 測試

```bash
python -m pytest tests/
```

執行 42 項單元測試，涵蓋：

| 模組 | 測試內容 |
|------|----------|
| `test_emoji_parser` | 圖片 URL 解析、文字分段、`strip_image_urls` |
| `test_speech_filter` | URL/Emoji 過濾、關鍵字封鎖與取代、數字過濾 |
| `test_scene` | ChatNode 資料欄位、生命週期（alpha/dead） |
| `test_overlay_config` | JSON 讀寫、預設值合併、遺漏鍵值處理 |
