import os
from network.socket_server import message_queue
from core.scene import ChatNode
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

    def start_timer(self):
        self.stream_active = True
        self.stream_start_time = time.time()
        self.stream_paused = False
        self._manual_control = True

    def stop_timer(self):
        if self.stream_active and not self.stream_paused:
            self._stream_elapsed_at_pause = time.time() - self.stream_start_time
        self.stream_active = False
        self.stream_paused = True
        self._manual_control = True

    def reset_timer(self):
        self.stream_start_time = time.time()
        self._stream_elapsed_at_pause = 0.0
        self.stream_active = True
        self.stream_paused = False
        self._manual_control = True

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

    def update(self):
        self._sync_tts_settings()
        while not message_queue.empty():
            data = message_queue.get()

            if data.get("type") == "SystemEvent":
                event = data.get("event", "")
                if event == "connected" and not self._manual_control:
                    self.start_timer()
                elif event == "disconnected" and not self._manual_control:
                    self.stop_timer()
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
                new_node.target_y = last_node.target_y + last_node.get_height(self.font_system) + 8
                new_node.y = self.height() - 20

            self.nodes.append(new_node)

            if new_node.has_emoji:
                w = self.widget
                has_tl = hasattr(w, 'texture_loader') if w else False
                print(f"ENGINE: has_emoji={new_node.has_emoji} widget={'OK' if w else 'NONE'} has_tl={has_tl}")
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

        current_y = 50
        for n in self.nodes:
            row_h = n.get_height(self.font_system)
            spacing = 8
            n.target_y = current_y
            current_y += row_h + spacing

        total_height = current_y - 50
        window_height = self.height()
        header_height = 30
        if total_height > window_height - header_height:
            overflow = total_height - (window_height - header_height) + 10
            for n in self.nodes:
                n.target_y -= overflow
                if n.target_y < -80 and not n.dead:
                    n.dead = True

        for n in self.nodes:
            n.update()

        self.nodes = [n for n in self.nodes if n.alpha > 0]
