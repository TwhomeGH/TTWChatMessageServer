# live_engine — 即時聊天室訊息疊加畫面 + TTS 朗讀

透明穿透的直播聊天室 Overlay，接收 TCP 訊息後以 OpenGL 渲染在畫面上，並可透過 edge-tts 朗讀訊息。

---

## 功能

- **透明疊層視窗** — 無邊框、穿透滑鼠、永遠在最上層
- **頭像 + 用戶名 + 多行訊息 + 禮物圖示** 渲染
- **文字自動換行**，支援中文字型（Microsoft JhengHei）
- **訊息平滑動畫** — 進場、滾動、淡出
- **超出視窗自動滾動** — 最新訊息保持在可見區域
- **全域熱鍵 R → 8** — 開啟 TTS 設定視窗
- **TTS 朗讀** — 使用 Microsoft Edge 雲端語音（edge-tts）
- **語音過濾器** — 排除/替換關鍵字、移除 URL、Emoji、純數字
- **佇列管理** — 佇列上限、滿載策略（跳過/停止舊/清空）
- **可調參數** — 語速、音量、語音、最小/最大字數

---

## 目錄結構

```
live_engine/
├── main.py                      # 進入點
├── config.py                    # 預設設定
├── requirements.txt             # 依賴套件
├── shaders/
│   ├── sdf_font.vert            # SDF 字型頂點著色器
│   └── sdf_font.frag            # SDF 字型片段著色器
├── renderer/
│   ├── overlay.py               # 透明疊層視窗 (QOpenGLWidget)
│   ├── font_system.py           # 文字 → OpenGL 紋理
│   ├── texture_loader.py        # 頭像/禮物圖片下載 + 紋理載入
│   ├── gl_renderer.py           # 背景方塊繪製
│   └── shader.py                # GLSL 著色器編譯
├── core/
│   ├── engine.py                # 主更新迴圈、佈局計算
│   ├── scene.py                 # ChatNode 資料模型
│   ├── tts.py                   # edge-tts 語音朗讀服務
│   ├── speech_filter.py         # 語音過濾器（關鍵字、URL、Emoji）
│   ├── hotkey.py                # 全域熱鍵 R+8
│   └── debug_log.py             # 日誌系統
├── gui/
│   ├── tts_settings_window.py   # TTS 設定視窗
│   ├── filter_settings.py       # 過濾器管理視窗
│   └── settings_manager.py      # JSON 設定讀寫
├── network/
│   └── socket_server.py         # TCP Server (port 9322)
├── config/
│   ├── tts_settings.json        # TTS 設定（執行期自動產生）
│   └── tts_filter.json          # 過濾規則（執行期自動產生）
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

## 通訊協定

Socket port **9322**，每行一個 JSON：

```json
{"user":"觀眾名","message":"哈囉","img":"頭像網址","giftImg":"禮物網址","type":"StreamMessage","isMain":true}
```

| 欄位 | 說明 |
|------|------|
| `user` | 用戶名稱 |
| `message` | 訊息內容 |
| `img` | 頭像圖片 URL |
| `giftImg` | 禮物圖片 URL |
| `type` | `"StreamMessage"` 才會觸發 TTS |
| `isMain` | 是否為主訊息 |

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

設定修改後引擎會自動偵測並同步，無需重啟。

---

## 日誌

所有事件寫入 `logs/live_engine.log`，包含時間戳。可搭配 `--settings` GUI 進行除錯。
