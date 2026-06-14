import os
from network.socket_server import message_queue
from core.scene import ChatNode
from core.tts import tts_service

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
        tts_service.update_default()

    def _sync_tts_settings(self):
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

            if data.get("type") != "StreamMessage":
                continue

            new_node = ChatNode(data)

            if not self.nodes:
                new_node.target_y = 50
                new_node.y = 50
            else:
                last_node = self.nodes[-1]
                new_node.target_y = last_node.target_y + last_node.get_height(self.font_system) + 8
                new_node.y = self.height() - 20

            self.nodes.append(new_node)

            if new_node.text:
                tts_service.speak_stream_message(
                    new_node.user, new_node.text, data.get("isMain", True)
                )

        current_y = 50
        for n in self.nodes:
            row_h = n.get_height(self.font_system)
            spacing = 8
            n.target_y = current_y
            current_y += row_h + spacing

        total_height = current_y - 50
        window_height = self.height()
        if total_height > window_height:
            overflow = total_height - window_height + 10
            for n in self.nodes:
                n.target_y -= overflow
                if n.target_y < -80 and not n.dead:
                    n.dead = True

        for n in self.nodes:
            n.update()

        self.nodes = [n for n in self.nodes if n.alpha > 0]













