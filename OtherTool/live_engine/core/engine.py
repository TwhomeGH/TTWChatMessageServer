import os
from network.socket_server import message_queue
from core.scene import ChatNode
from core.ad_overlay import AdOverlayNode
from core.tts import tts_service
from core.emoji_parser import strip_image_urls

from PyQt6.QtGui import QColor
from renderer.font_system import FontSystem
import config
import time

SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "config", "tts_settings.json"
)

class Engine:
    def __init__(self, widget=None):
        self.nodes = []
        self.font_system = FontSystem()

        self.widget = widget
        self._last_settings_mtime = 0
        self._last_settings_check = 0.0
        tts_service.update_default()

        self.viewer_count = 0
        self.stream_active = False
        self.stream_start_time = 0.0
        self.stream_paused = False
        self._stream_elapsed_at_pause = 0.0
        self._manual_control = False
        self.node_spacing = 8
        self.content_gap = 2
        self.message_ttl = 15
        self.fade_speed = 0.02

        self.ad_overlay = None
        self.ad_overlay_duration = 10
        self.ad_overlay_font_size = 16
        self.ad_avatar_size = 40
        self.ad_show_avatar = True
        self.ad_avatar_offset = 3
        self.ad_bg_color = QColor("#1E1E2E")
        self.ad_accent_color = QColor("#4C9EFF")
        self.ad_user_color = QColor("#8AB4FF")
        self.ad_text_color = QColor("#FFFFFF")
        self.ad_bg_opacity = 0.88

    def set_node_spacing(self, px):
        self.node_spacing = max(0, int(px))

    def set_content_gap(self, px):
        self.content_gap = max(0, int(px))

    def set_message_ttl(self, seconds):
        self.message_ttl = max(3, int(seconds))

    def set_fade_speed(self, rate):
        self.fade_speed = max(0.001, min(0.5, rate / 100.0))

    def set_ad_overlay_duration(self, seconds):
        self.ad_overlay_duration = max(1, int(seconds))

    def set_ad_overlay_font_size(self, size):
        self.ad_overlay_font_size = max(8, int(size))

    def set_ad_avatar_size(self, size):
        self.ad_avatar_size = max(20, min(80, int(size)))

    def set_ad_show_avatar(self, enabled):
        self.ad_show_avatar = bool(enabled)

    def set_ad_avatar_offset(self, px):
        self.ad_avatar_offset = max(-20, min(20, int(px)))

    def set_ad_bg_color(self, color):
        self.ad_bg_color = QColor(color)

    def set_ad_accent_color(self, color):
        self.ad_accent_color = QColor(color)

    def set_ad_user_color(self, color):
        self.ad_user_color = QColor(color)

    def set_ad_text_color(self, color):
        self.ad_text_color = QColor(color)

    def set_ad_bg_opacity(self, pct):
        self.ad_bg_opacity = max(0, min(100, int(pct))) / 100.0

    def start_timer(self):
        self.stream_active = True
        self.stream_start_time = time.time()
        self.stream_paused = False

    def stop_timer(self):
        if self.stream_active and not self.stream_paused:
            self._stream_elapsed_at_pause = time.time() - self.stream_start_time
        self.stream_active = False
        self.stream_paused = True

    def reset_timer(self):
        self.stream_start_time = time.time()
        self._stream_elapsed_at_pause = 0.0
        self.stream_active = True
        self.stream_paused = False
        self._manual_control = True

    def set_manual_control(self, enabled):
        self._manual_control = enabled

    def get_elapsed(self):
        if not self.stream_active:
            return self._stream_elapsed_at_pause
        return time.time() - self.stream_start_time

    def get_elapsed_str(self):
        s = int(self.get_elapsed())
        h, m, s = s // 3600, (s % 3600) // 60, s % 60
        return f"{h:02d}:{m:02d}:{s:02d}"

    def _sync_tts_settings(self):
        now = time.time()
        if now - self._last_settings_check < 1.0:
            return
        self._last_settings_check = now
        try:
            if os.path.exists(SETTINGS_PATH):
                mtime = os.path.getmtime(SETTINGS_PATH)
                if mtime != self._last_settings_mtime:
                    self._last_settings_mtime = mtime
                    tts_service.update_default()
        except Exception:
            pass

    def height(self):
        if self.widget is not None:
            return self.widget.height()
        else:
            return config.HEIGHT

    def width(self):
        if self.widget is not None:
            return self.widget.width()
        else:
            return config.WIDTH

    def update(self):
        self._sync_tts_settings()
        while not message_queue.empty():
            data = message_queue.get()

            if data.get("type") == "SystemEvent":
                event = data.get("event", "")
                if event == "connected" and not self._manual_control:
                    self.start_timer()
                    self._manual_control = False
                elif event == "disconnected" and not self._manual_control:
                    self.stop_timer()
                continue

            if data.get("type") == "AdOverlay":
                self._handle_ad_overlay(data)
                continue

            if data.get("type") == "audience":
                viewer = data.get("userNum")
                viewer_list = data.get("userList")
                if viewer is not None:
                    self.viewer_count = int(viewer)
                elif viewer_list is not None:
                    self.viewer_count = len(viewer_list)
                continue

            if data.get("type") != "StreamMessage":
                continue

            raw_text = data.get("message") or ""
            viewer = data.get("userNum")
            viewer_list = data.get("userList")
            if viewer is not None:
                self.viewer_count = int(viewer)
            elif viewer_list is not None:
                self.viewer_count = len(viewer_list)

            new_node = ChatNode(data)

            if not self.nodes:
                new_node.target_y = 50
                new_node.y = 50
            else:
                last_node = self.nodes[-1]
                new_node.target_y = last_node.target_y + last_node.get_height(self.font_system, self.content_gap) + self.node_spacing
                new_node.y = self.height() - 20

            self.nodes.append(new_node)

            if new_node.has_emoji:
                w = self.widget
                has_tl = hasattr(w, 'texture_loader') if w else False
                if w and has_tl:
                    tl = w.texture_loader
                    for seg in new_node.segments:
                        if seg["type"] == "image":
                            print(f"preloading emoji: {seg['url'][-40:]}")
                            tl.preload_emoji(seg["url"])

            if raw_text and data.get("type") == "StreamMessage":
                tts_text = strip_image_urls(raw_text)
                if tts_text:
                    tts_service.speak_stream_message(
                        new_node.user, tts_text, data.get("isMain", True)
                    )

        if self.ad_overlay is not None:
            if time.time() - self.ad_overlay.start_time > self.ad_overlay.duration:
                self.ad_overlay = None
            else:
                self.ad_overlay.duration = self.ad_overlay_duration
                self.ad_overlay.font_size = self.ad_overlay_font_size
                self.ad_overlay.icon_size = self.ad_avatar_size
                self.ad_overlay.avatar_offset = self.ad_avatar_offset
                self.ad_overlay.invalidate_height()

        banner_offset = 0
        if self.ad_overlay is not None:
            ad_h = self.ad_overlay.get_height(
                self.font_system, self.width() - 16,
                self.ad_user_color, self.ad_text_color, self.ad_show_avatar
            )
            banner_offset = ad_h + self.node_spacing

        current_y = 50 + banner_offset
        for n in self.nodes:
            row_h = n.get_height(self.font_system, self.content_gap)
            n.target_y = current_y
            current_y += row_h + self.node_spacing

        total_height = current_y - 50
        window_height = self.height()
        header_height = 30
        if self.ad_overlay is None and total_height > window_height - header_height:
            overflow = total_height - (window_height - header_height) + 10
            for n in self.nodes:
                n.target_y -= overflow
                if n.target_y < -80 and not n.dead:
                    n.dead = True

        for n in self.nodes:
            if self.ad_overlay is not None and not n.dead:
                n.timestamp = time.time()
            n.update(ttl=self.message_ttl, fade=self.fade_speed)

        self.nodes = [n for n in self.nodes if n.alpha > 0]

    def _handle_ad_overlay(self, data):
        node = AdOverlayNode(data, font_size=self.ad_overlay_font_size)
        node.duration = self.ad_overlay_duration
        node.icon_size = self.ad_avatar_size
        node.avatar_offset = self.ad_avatar_offset
        self.ad_overlay = node

        w = self.widget
        if w is not None and hasattr(w, 'texture_loader'):
            tl = w.texture_loader
            if node.has_emoji:
                emoji_size = int(self.ad_overlay_font_size * 1.6)
                for seg in node.segments:
                    if seg["type"] == "image":
                        print(f"preloading ad emoji: {seg['url'][-40:]}")
                        tl.preload_emoji(seg["url"], emoji_size)

        if node.use_tts:
            tts_text = strip_image_urls(node.text)
            if tts_text:
                tts_service.speak_ad(node.user, tts_text)
