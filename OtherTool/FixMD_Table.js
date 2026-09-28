import { markdownTable } from "markdown-table";

const data = [
  ["操作", "行為"],
  ["雙擊圖示", "開啟疊加層設定視窗"],
  ["右鍵 → 隱藏/顯示疊加層", "切換疊層可見性"],
  ["右鍵 → 疊加層設定", "基本、間距、位置、計時器、贊助橫幅五頁設定"],
  ["右鍵 → TTS 朗讀設定", "語音參數與佇列設定"],
  ["右鍵 → 過濾器設定", "關鍵字過濾與排除規則"],
  ["右鍵 → rt關閉", "結束整個應用程式"],
];

console.log(markdownTable(data, { alignDelimiters: false }));
