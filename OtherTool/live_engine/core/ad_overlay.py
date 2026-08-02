import re
import time
from PyQt6.QtGui import QColor, QFont, QFontMetrics
from core.emoji_parser import parse_message

USE_TTS_TOKEN_RE = re.compile(r"\buseTTS\b", re.IGNORECASE)


class AdOverlayNode:
    AD_ICON_SIZE = 40
    AD_PADDING = 10
    AD_CONTENT_GAP = 2

    def __init__(self, data, font_size=16):
        self.user = data.get("user") or ""
        raw_text = data.get("text") or data.get("message") or ""
        cleaned = USE_TTS_TOKEN_RE.sub("", raw_text)
        self.text = re.sub(r" +", " ", cleaned).strip()
        self.icon_url = data.get("iconURL") or ""
        self.use_tts = bool(data.get("useTTS", False))

        self.segments = parse_message(self.text)
        self.has_emoji = any(s["type"] == "image" for s in self.segments)

        self.font_size = font_size
        self.icon_size = self.AD_ICON_SIZE
        self.padding = self.AD_PADDING
        self.content_gap = self.AD_CONTENT_GAP
        self.avatar_offset = 0

        self.start_time = time.time()
        self.duration = 10.0

    def layout(self, font_system, banner_width, user_color=None, text_color=None, show_avatar=True):
        pad = self.padding
        gap = self.content_gap
        font_size = self.font_size
        emoji_size = int(font_size * 1.6)
        family = getattr(font_system, "_font_family", "Microsoft JhengHei")
        if user_color is None:
            user_color = QColor(255, 215, 0)
        if text_color is None:
            text_color = QColor("white")
        outline = QColor("black")
        left_pad = 10
        right_pad = 10

        font = QFont(family, font_size)
        fm = QFontMetrics(font)
        single_line_h = fm.height() + 20
        text_vc = 10 + fm.height() / 2
        emoji_vc = emoji_size / 2
        vc_diff = int(text_vc - emoji_vc)
        if vc_diff > 0:
            emoji_off = vc_diff
            text_off = 0
        else:
            emoji_off = 0
            text_off = -vc_diff

        icon_size = self.icon_size if show_avatar else 0
        if show_avatar:
            icon_x = pad
            text_x = icon_x + icon_size + pad
        else:
            icon_x = 0
            text_x = pad

        text_max_w = banner_width - pad - text_x
        if text_max_w < 30:
            text_max_w = 30

        user_tex, uw, uh = font_system.get_text_texture(
            self.user, user_color, max_width=text_max_w,
            font_size=font_size, outline_color=outline)
        username_y = pad
        if show_avatar:
            icon_y = pad + (uh - icon_size) // 2 + self.avatar_offset
        else:
            icon_y = 0

        items = [("username", self.user, text_x, username_y, uw, uh, text_max_w)]

        visual_x = text_x + left_pad
        line_y = username_y + fm.height() + gap
        for seg in self.segments:
            if seg["type"] == "text" and seg["content"].strip():
                remaining = text_max_w - (visual_x - text_x)
                if remaining < 30:
                    line_y += single_line_h
                    visual_x = text_x + left_pad
                    remaining = text_max_w
                seg_tex, tw, th = font_system.get_text_texture(
                    seg["content"], text_color, max_width=remaining,
                    font_size=font_size, outline_color=outline)
                if th > single_line_h:
                    items.append(("text", seg["content"], visual_x - left_pad, line_y + text_off, tw, th, remaining))
                    line_y += th + 2
                    visual_x = text_x + left_pad
                else:
                    items.append(("text", seg["content"], visual_x - left_pad, line_y + text_off, tw, th, remaining))
                    visual_x += (tw - left_pad - right_pad) + 1
            elif seg["type"] == "image":
                remaining = text_max_w - (visual_x - text_x)
                if emoji_size + 1 > remaining:
                    line_y += single_line_h
                    visual_x = text_x + left_pad
                items.append(("image", seg["url"], visual_x, line_y + emoji_off, emoji_size, emoji_size, None))
                visual_x += emoji_size + 1

        max_bottom = max((iy + ih for _, _, _, iy, _, ih, _ in items), default=0)
        content_h = max(icon_y + icon_size, max_bottom)
        box_h = int(content_h + pad)

        return {
            "icon": (icon_x, icon_y, icon_size),
            "items": items,
            "box_h": box_h,
            "emoji_size": emoji_size,
            "text_max_w": text_max_w,
            "user_color": user_color,
            "text_color": text_color,
            "outline_color": outline,
        }

    def get_height(self, font_system, banner_width, user_color=None, text_color=None, show_avatar=True):
        return self.layout(font_system, banner_width, user_color, text_color, show_avatar)["box_h"]

    def invalidate_height(self):
        pass
