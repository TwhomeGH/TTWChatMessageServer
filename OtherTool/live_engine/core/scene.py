from PyQt6.QtGui import QColor
import time
import config

class ChatNode:
    def __init__(self, data):
        self.user = data.get("user") or ""
        self.text = data.get("message") or ""
        self.avatar_url = data.get("img")
        self.gift_url = data.get("giftImg")

        self.x = 20
        self.y = 20
        self.target_y = 20

        self.alpha = 1.0
        self.dead = False
        self.timestamp = time.time()

        self.w = 360
        self.h = 50

    def get_height(self, font_system):
        _, _, uh = font_system.get_text_texture(
            self.user, QColor(0, 128, 255), max_width=config.USERNAME_MAX_WIDTH,
            outline_color=QColor("white")
        )
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
        return content_h + 4

    def update(self):
        # 平滑收斂到目標位置
        self.y += (self.target_y - self.y) * 0.25


        # 檢查時間是否超過 15 秒
        if time.time() - self.timestamp > 15:
            self.dead = True

        if self.dead:
            self.alpha -= 0.02
            if self.alpha <= 0:
                self.alpha = 0

