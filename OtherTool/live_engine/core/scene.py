from PyQt6.QtGui import QColor
import time

class ChatNode:
    def __init__(self, data):
        self.user = data.get("user")
        self.text = data.get("message")
        self.avatar_url = data.get("img")
        self.gift_url = data.get("giftImg")

        # 🔑 新訊息一開始就定位在頂部
        self.x = 20
        self.y = 20
        self.target_y = 20

        self.alpha = 1.0
        self.dead = False
        self.timestamp = time.time()

        self.w = 360
        self.h = 50

    def get_height(self, font_system):
        avatar_h = 28
        _, _, uh = font_system.get_text_texture(self.user, QColor(0, 128, 255))
        _, _, mh = font_system.get_text_texture(self.text, QColor("white"))
        gift_h = 28

        # 🔑 用戶名和訊息上下排，但高度取最大值 + 少量行距
        text_block_h = max(uh, mh) + 4

        # 🔑 最終 box 高度：取最大值 + padding
        base_h = max(avatar_h, text_block_h, gift_h) + 6
        return base_h

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

