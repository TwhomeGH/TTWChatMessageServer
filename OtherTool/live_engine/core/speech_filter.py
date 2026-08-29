import re
import json
import os
from typing import Dict, List, Optional


class SpeechFilterManager:
    _instance: Optional["SpeechFilterManager"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self.config_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "config", "tts_filter.json"
        )
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)

        self.block_keywords: List[str] = []
        self.replace_keywords: Dict[str, str] = {}
        self.remove_urls: bool = True
        self.remove_emoji: bool = True
        self.remove_pure_numbers: bool = False

        self._url_pattern = re.compile(r"https?://\S+")
        self._number_pattern = re.compile(r"(?<!\d)\d+(?!\d)")
        self._emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # 表情圖示 Emoticons
            "\U0001F300-\U0001F5FF"  # 其他符號與象形圖示
            "\U0001F680-\U0001F6FF"  # 運輸與地圖符號
            "\U0001F900-\U0001F9FF"  # 補充符號與象形圖示
            "\u2600-\u2604"          # ☀-☄ 天氣
            "\u2614-\u2615"          # 傘/咖啡
            "\u261D"                 # 手指
            "\u263A"                 # 笑臉
            "\u2640\u2642"           # 男女符號
            "\u2660\u2663\u2665\u2666"  # 撲克花色
            "\u2668"                 # 溫泉
            "\u267B"                 # 回收
            "\u267F"                 # 輪椅
            "\u26BD-\u26BE"          # 足球/棒球
            "\u26C4-\u26C5"          # 雪人/烏雲
            "\u26EA"                 # 神社/教堂
            "\u26F3"                 # 旗子
            "\u2702"                 # 剪刀
            "\u2705"                 # 綠色勾
            "\u2708-\u270D"          # 飛機/信封/拳頭/勝利
            "\u270F"                 # 鉛筆
            "\u2712"                 # 墨水筆
            "\u2714"                 # 勾
            "\u2716"                 # 叉
            "\u2728"                 # 閃光
            "\u274C\u274E"           # 紅叉/綠叉
            "\u2757"                 # 驚嘆號
            "\u2764"                 # 紅心
            "\u2795-\u2797"          # 加減乘
            "\u27A1"                 # 右箭頭
            "\u27BF"                 # 捲曲箭頭
            "]"
        )

        self._load()

    def _load(self):
        if not os.path.exists(self.config_path):
            self._save()
            return
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.block_keywords = data.get("block_keywords", [])
            self.replace_keywords = data.get("replace_keywords", {})
            self.remove_urls = data.get("remove_urls", True)
            self.remove_emoji = data.get("remove_emoji", True)
            self.remove_pure_numbers = data.get("remove_pure_numbers", False)
        except Exception:
            pass

    def _save(self):
        data = {
            "block_keywords": self.block_keywords,
            "replace_keywords": self.replace_keywords,
            "remove_urls": self.remove_urls,
            "remove_emoji": self.remove_emoji,
            "remove_pure_numbers": self.remove_pure_numbers,
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def process_message(self, message: str) -> str:
        if not isinstance(message, str):
            return ""
        result = message

        if self.remove_urls:
            result = self._url_pattern.sub("", result)

        if self.remove_emoji:
            result = self._emoji_pattern.sub("", result)

        if self.remove_pure_numbers:
            result = self._number_pattern.sub("", result)

        for word in self.block_keywords:
            result = result.replace(word, "")

        for word, replacement in self.replace_keywords.items():
            result = result.replace(word, replacement)

        return result.strip()

    def add_block_keyword(self, word: str):
        if word and word not in self.block_keywords:
            self.block_keywords.append(word)
            self._save()

    def remove_block_keyword(self, word: str):
        if word in self.block_keywords:
            self.block_keywords.remove(word)
            self._save()

    def add_replace_keyword(self, word: str, replacement: str):
        if word:
            self.replace_keywords[word] = replacement
            self._save()

    def remove_replace_keyword(self, word: str):
        if word in self.replace_keywords:
            del self.replace_keywords[word]
            self._save()

    def set_remove_urls(self, enabled: bool):
        self.remove_urls = enabled
        self._save()

    def set_remove_emoji(self, enabled: bool):
        self.remove_emoji = enabled
        self._save()

    def set_remove_pure_numbers(self, enabled: bool):
        self.remove_pure_numbers = enabled
        self._save()


filter_manager = SpeechFilterManager()