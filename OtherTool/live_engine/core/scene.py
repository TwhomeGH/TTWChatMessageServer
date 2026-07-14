from PyQt6.QtGui import QColor, QFont, QFontMetrics
import time
import config
from core.emoji_parser import parse_message

INLINE_FONT_SIZE = 15

class ChatNode:
    def __init__(self, data, inline_font_size=INLINE_FONT_SIZE):
        self.user = data.get("user") or ""
        self.text = data.get("message") or ""
        self.avatar_url = data.get("img")
        self.gift_url = data.get("giftImg")

        self.segments = parse_message(self.text)
        self.has_emoji = any(s["type"] == "image" for s in self.segments)

        self._inline_font_size = inline_font_size

        self.x = 20
        self.y = 20
        self.target_y = 20

        self.alpha = 1.0
        self.dead = False
        self.timestamp = time.time()

        self.w = 360
        self.h = 50
        self._cached_height = None

    def get_height(self, font_system, content_gap=2):
        if self._cached_height is not None:
            return self._cached_height
        _, _, uh = font_system.get_text_texture(
            self.user, QColor(0, 128, 255), max_width=config.USERNAME_MAX_WIDTH,
            outline_color=QColor("white")
        )

        font = QFont("Microsoft JhengHei", self._inline_font_size)
        fm = QFontMetrics(font)
        text_th = fm.height() + 20
        emoji_size = int(self._inline_font_size * 1.6)
        mh = max(emoji_size, text_th) if self.has_emoji else text_th

        avatar_size = 28
        top_pad = 6
        username_y = top_pad + (avatar_size - uh) / 2
        msg_y = username_y + fm.height() + content_gap
        avatar_bottom = top_pad + avatar_size
        message_bottom = msg_y + mh
        content_h = max(avatar_bottom, message_bottom)
        self._cached_height = int(content_h + 4)
        return self._cached_height

    def invalidate_height(self):
        self._cached_height = None

    def update(self, ttl=15, fade=0.02):
        self.y += (self.target_y - self.y) * 0.25

        if time.time() - self.timestamp > ttl:
            self.dead = True

        if self.dead:
            self.alpha -= fade
            if self.alpha <= 0:
                self.alpha = 0

