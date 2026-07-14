import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest

pytest.importorskip("PyQt6.QtWidgets")

import json

from gui.overlay_settings import load_overlay_config, save_overlay_config, CONFIG_PATH


class TestOverlayConfig:
    def test_load_defaults_when_no_file(self, monkeypatch):
        monkeypatch.setattr("gui.overlay_settings.CONFIG_PATH", "/nonexistent/path.json")
        cfg = load_overlay_config()
        assert cfg["width"] == 420
        assert cfg["height"] == 400
        assert cfg["font_size"] == 15
        assert cfg["spacing"] == 8
        assert cfg["content_gap"] == 2

    def test_save_and_load(self, tmp_path):
        test_file = tmp_path / "test_overlay.json"
        data = {
            "width": 800,
            "height": 600,
            "font_size": 20,
            "spacing": 12,
            "content_gap": 4,
            "x": 100,
            "y": 200,
        }
        import gui.overlay_settings as ovs
        original = ovs.CONFIG_PATH
        try:
            ovs.CONFIG_PATH = str(test_file)
            save_overlay_config(data)
            loaded = load_overlay_config()
            assert loaded["width"] == 800
            assert loaded["height"] == 600
            assert loaded["font_size"] == 20
            assert loaded["spacing"] == 12
            assert loaded["content_gap"] == 4
            assert loaded["x"] == 100
            assert loaded["y"] == 200
        finally:
            ovs.CONFIG_PATH = original

    def test_merge_with_missing_keys(self, tmp_path):
        test_file = tmp_path / "partial.json"
        test_file.write_text(json.dumps({"width": 500}))
        import gui.overlay_settings as ovs
        original = ovs.CONFIG_PATH
        try:
            ovs.CONFIG_PATH = str(test_file)
            cfg = load_overlay_config()
            assert cfg["width"] == 500
            assert cfg["height"] == 400
            assert cfg["font_size"] == 15
            assert cfg["spacing"] == 8
        finally:
            ovs.CONFIG_PATH = original

    def test_save_preserves_existing_keys(self, tmp_path):
        test_file = tmp_path / "pos.json"
        import gui.overlay_settings as ovs
        original = ovs.CONFIG_PATH
        try:
            ovs.CONFIG_PATH = str(test_file)
            save_overlay_config({"width": 500, "height": 300, "font_size": 18, "spacing": 10, "content_gap": 2, "x": 10, "y": 20})
            cfg = load_overlay_config()
            assert cfg["x"] == 10
            assert cfg["y"] == 20
            assert cfg["width"] == 500
        finally:
            ovs.CONFIG_PATH = original
