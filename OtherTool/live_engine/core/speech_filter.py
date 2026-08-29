import re
import json
import os
from typing import Dict, List, Optional


# 用碼點範圍 + chr() 建構 emoji 字元類別，避免在原始碼寫出 astral 平面
# \U... 字面值（CodeQL 會誤判為與 U+FFFD 重疊）。
# (起始碼點, 結束碼點, 說明)
_EMOJI_RANGES = [
    (0x1F600, 0x1F64F, "表情圖示 Emoticons"),
    (0x1F300, 0x1F5FF, "其他符號與象形圖示"),
    (0x1F680, 0x1F6FF, "運輸與地圖符號"),
    (0x1F900, 0x1F9FF, "補充符號與象形圖示"),
    (0x2600, 0x2604, "☀-☄ 天氣"),
    (0x2614, 0x2615, "傘/咖啡"),
    (0x261D, 0x261D, "手指"),
    (0x263A, 0x263A, "笑臉"),
    (0x2640, 0x2640, "女符號"),
    (0x2642, 0x2642, "男符號"),
    (0x2660, 0x2660, "黑桃"),
    (0x2663, 0x2663, "梅花"),
    (0x2665, 0x2665, "紅心"),
    (0x2666, 0x2666, "方塊"),
    (0x2668, 0x2668, "溫泉"),
    (0x267B, 0x267B, "回收"),
    (0x267F, 0x267F, "輪椅"),
    (0x26BD, 0x26BE, "足球/棒球"),
    (0x26C4, 0x26C5, "雪人/烏雲"),
    (0x26EA, 0x26EA, "神社/教堂"),
    (0x26F3, 0x26F3, "旗子"),
    (0x2702, 0x2702, "剪刀"),
    (0x2705, 0x2705, "綠色勾"),
    (0x2708, 0x270D, "飛機/信封/拳頭/勝利"),
    (0x270F, 0x270F, "鉛筆"),
    (0x2712, 0x2712, "墨水筆"),
    (0x2714, 0x2714, "勾"),
    (0x2716, 0x2716, "叉"),
    (0x2728, 0x2728, "閃光"),
    (0x274C, 0x274C, "紅叉"),
    (0x274E, 0x274E, "綠叉"),
    (0x2757, 0x2757, "驚嘆號"),
    (0x2764, 0x2764, "紅心"),
    (0x2795, 0x2797, "加減乘"),
    (0x27A1, 0x27A1, "右箭頭"),
    (0x27BF, 0x27BF, "捲曲箭頭"),
]


def _build_emoji_pattern() -> str:
    """由碼點範圍清單組出 emoji 字元類別字串。"""
    return "[" + "".join(f"{chr(lo)}-{chr(hi)}" for lo, hi, _ in _EMOJI_RANGES) + "]"


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
        self._emoji_pattern = re.compile(_build_emoji_pattern())

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