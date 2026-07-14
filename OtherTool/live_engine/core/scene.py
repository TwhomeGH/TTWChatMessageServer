from PyQt6.QtGui import QColor
import time
import config
from core.emoji_parser import parse_message

EMOJI_SIZE = 24

class ChatNode:
    def __init__(self, data):
        self.user = data.get("user") or ""
        self.text = data.get("message") or ""
        self.avatar_url = data.get("img")
        self.gift_url = data.get("giftImg")

        self.segments = parse_message(self.text)
        self.has_emoji = any(s["type"] == "image" for s in self.segments)

        self.x = 20
        self.y = 20
        self.target_y = 20

        self.alpha = 1.0
        self.dead = False
        self.timestamp = time.time()

        self.w = 360
        self.h = 50
        self._cached_height = None

    def get_height(self, font_system):
        if self._cached_height is not None:
            return self._cached_height
        _, _, uh = font_system.get_text_texture(
            self.user, QColor(0, 128, 255), max_width=config.USERNAME_MAX_WIDTH,
            outline_color=QColor("white")
        )

        if self.has_emoji:
            mh = EMOJI_SIZE + 4
        else:
            _, _, mh = font_system.get_text_texture(
                self.text, QColor("white"), max_width=config.MESSAGE_MAX_WIDTH,
                outline_color=QColor("black")
            )

        avatar_size = 28
        top_pad = 6
        username_offset = (avatar_size - uh) // 2
        avatar_bottom = top_pad + avatar_size
        message_bottom = top_pad + username_offset + uh + 4 + mh
        content_h = max(avatar_bottom, message_bottom)
        self._cached_height = content_h + 4
        return self._cached_height

    def update(self):
        self.y += (self.target_y - self.y) * 0.25

        if time.time() - self.timestamp > 15:
            self.dead = True

        if self.dead:
            self.alpha -= 0.02
            if self.alpha <= 0:
                self.alpha = 0

