import os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest

from core.ad_overlay import AdOverlayNode
from network.socket_server import message_queue


class FakeFontSystem:
    def get_text_texture(self, text, color, max_width=360, font_size=16, outline_color=None):
        return (None, 100, 20)


class TestAdOverlayNode:
    def test_basic_fields(self):
        data = {"user": "sponsor", "message": "歡迎光臨", "iconURL": "https://e.com/icon.png", "useTTS": True}
        n = AdOverlayNode(data)
        assert n.user == "sponsor"
        assert n.text == "歡迎光臨"
        assert n.icon_url == "https://e.com/icon.png"
        assert n.use_tts is True

    def test_server_payload_uses_text_key(self):
        data = {"user": "sponsor", "text": "Test33 useTTS", "iconURL": "https://e.com/icon.png", "useTTS": True}
        n = AdOverlayNode(data)
        assert n.text == "Test33"
        assert n.use_tts is True

    def test_use_tts_token_stripped_from_text(self):
        n = AdOverlayNode({"user": "u", "text": "歡迎光臨 useTTS"})
        assert n.text == "歡迎光臨"
        n2 = AdOverlayNode({"user": "u", "text": "UseTts 特惠"})
        assert n2.text == "特惠"
        n3 = AdOverlayNode({"user": "u", "text": "useTTS"})
        assert n3.text == ""

    def test_use_tts_false_by_default(self):
        n = AdOverlayNode({"user": "u", "message": "hi"})
        assert n.use_tts is False

    def test_emoji_parsing(self):
        n = AdOverlayNode({"user": "u", "message": "hello https://e.com/a.png"})
        assert n.has_emoji
        assert any(s["type"] == "image" for s in n.segments)

    def test_default_duration(self):
        n = AdOverlayNode({"user": "u", "message": "hi"})
        assert n.duration == 10.0

    def test_get_height_and_invalidate(self):
        n = AdOverlayNode({"user": "u", "message": "hi"})
        h = n.get_height(FakeFontSystem(), 400)
        assert h > 0
        assert n.get_height(FakeFontSystem(), 400) == h
        n.invalidate_height()
        assert n.get_height(FakeFontSystem(), 400) == h

    def test_layout_without_avatar(self):
        n = AdOverlayNode({"user": "u", "message": "hi"})
        lay = n.layout(FakeFontSystem(), 400, show_avatar=False)
        assert lay["icon"][2] == 0
        assert lay["items"][0][2] == 10

    def test_layout_custom_colors(self):
        from PyQt6.QtGui import QColor
        n = AdOverlayNode({"user": "u", "message": "hi"})
        lay = n.layout(FakeFontSystem(), 400, QColor("red"), QColor("blue"))
        assert lay["user_color"] == QColor("red")
        assert lay["text_color"] == QColor("blue")


class TestEngineAdOverlay:
    def _drain(self):
        while not message_queue.empty():
            message_queue.get()

    def _make_engine(self):
        from core.engine import Engine
        eng = Engine()
        eng.font_system = FakeFontSystem()
        return eng

    def test_ad_overlay_received(self):
        self._drain()
        eng = self._make_engine()
        message_queue.put({"type": "AdOverlay", "user": "s", "message": "hello", "iconURL": "x", "useTTS": False})
        eng.update()
        assert eng.ad_overlay is not None
        assert eng.ad_overlay.user == "s"
        assert eng.ad_overlay.text == "hello"
        self._drain()

    def test_ad_overlay_clears_after_duration(self):
        self._drain()
        eng = self._make_engine()
        eng.set_ad_overlay_duration(1)
        message_queue.put({"type": "AdOverlay", "user": "s", "message": "hello"})
        eng.update()
        assert eng.ad_overlay is not None
        eng.ad_overlay.start_time = time.time() - 2
        eng.update()
        assert eng.ad_overlay is None
        self._drain()

    def test_ad_style_setters(self):
        self._drain()
        eng = self._make_engine()
        eng.set_ad_bg_color("#112233")
        eng.set_ad_accent_color("#ff0000")
        eng.set_ad_user_color("#00ff00")
        eng.set_ad_text_color("#0000ff")
        eng.set_ad_avatar_size(48)
        eng.set_ad_show_avatar(False)
        eng.set_ad_bg_opacity(50)
        assert eng.ad_bg_color.name() == "#112233"
        assert eng.ad_accent_color.name() == "#ff0000"
        assert eng.ad_user_color.name() == "#00ff00"
        assert eng.ad_text_color.name() == "#0000ff"
        assert eng.ad_avatar_size == 48
        assert eng.ad_show_avatar is False
        assert abs(eng.ad_bg_opacity - 0.5) < 0.001
        self._drain()

    def test_chat_moves_down_during_ad(self):
        self._drain()
        eng = self._make_engine()
        eng.set_ad_overlay_duration(10)
        eng.set_ad_overlay_font_size(16)
        message_queue.put({"type": "StreamMessage", "user": "u", "message": "hi", "isMain": True})
        message_queue.put({"type": "AdOverlay", "user": "s", "message": "sponsor msg"})
        eng.update()
        assert len(eng.nodes) == 1
        assert eng.nodes[0].target_y > 50
        self._drain()

    def test_chat_returns_to_top_after_ad(self):
        self._drain()
        eng = self._make_engine()
        eng.set_ad_overlay_duration(1)
        message_queue.put({"type": "StreamMessage", "user": "u", "message": "hi", "isMain": True})
        message_queue.put({"type": "AdOverlay", "user": "s", "message": "sponsor"})
        eng.update()
        y_during = eng.nodes[0].target_y
        assert y_during > 50
        eng.ad_overlay.start_time = time.time() - 2
        eng.update()
        assert eng.ad_overlay is None
        assert eng.nodes[0].target_y == 50
        self._drain()

    def test_ttl_paused_during_ad(self):
        self._drain()
        eng = self._make_engine()
        eng.set_ad_overlay_duration(1)
        eng.set_message_ttl(3)
        message_queue.put({"type": "StreamMessage", "user": "u", "message": "hi", "isMain": True})
        eng.update()
        node = eng.nodes[0]
        node.timestamp = time.time() - 10
        message_queue.put({"type": "AdOverlay", "user": "s", "message": "sponsor"})
        eng.update()
        assert not node.dead
        eng.ad_overlay.start_time = time.time() - 2
        eng.update()
        assert eng.ad_overlay is None
        assert not node.dead
        node.timestamp = time.time() - 10
        eng.update()
        assert node.dead
        self._drain()
