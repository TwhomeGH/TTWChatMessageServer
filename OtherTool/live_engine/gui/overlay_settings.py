import json
import os

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QGroupBox,
    QSpinBox, QPushButton, QLabel, QCheckBox
)
from PyQt6.QtCore import Qt, QTimer

from core.debug_log import log

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "config", "overlay_settings.json"
)


def load_overlay_config() -> dict:
    defaults = {"width": 420, "height": 400, "x": -1, "y": 50}
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                defaults.update(data)
    except Exception:
        pass
    return defaults


def save_overlay_config(data: dict):
    merged = {"width": 420, "height": 400, "x": -1, "y": 50}
    merged.update(data)
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)


class OverlaySettingsWindow(QWidget):
    def __init__(self, overlay=None, engine=None):
        super().__init__()
        self._overlay = overlay
        self._engine = engine
        self.setWindowTitle("疊加層設定")
        self.setMinimumSize(400, 420)
        self._build_ui()
        self._load_config()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        size_group = QGroupBox("視窗大小")
        size_form = QFormLayout(size_group)
        self._width_spin = QSpinBox()
        self._width_spin.setRange(200, 2000)
        self._width_spin.setSuffix(" px")
        self._width_spin.valueChanged.connect(self._on_size_changed)
        size_form.addRow("寬度:", self._width_spin)
        self._height_spin = QSpinBox()
        self._height_spin.setRange(100, 1500)
        self._height_spin.setSuffix(" px")
        self._height_spin.valueChanged.connect(self._on_size_changed)
        size_form.addRow("高度:", self._height_spin)
        layout.addWidget(size_group)

        pos_group = QGroupBox("視窗位置")
        pos_layout = QVBoxLayout(pos_group)

        self._drag_cb = QCheckBox("啟用拖曳調整位置（關閉點擊穿透）")
        self._drag_cb.stateChanged.connect(self._on_drag_toggled)
        pos_layout.addWidget(self._drag_cb)

        self._pos_label = QLabel("尚未設定位置")
        self._pos_label.setStyleSheet("color: gray;")
        pos_layout.addWidget(self._pos_label)

        btn_row = QHBoxLayout()
        btn_save_pos = QPushButton("儲存目前位置")
        btn_save_pos.clicked.connect(self._save_current_position)
        btn_row.addWidget(btn_save_pos)
        btn_reset_pos = QPushButton("重設為預設位置")
        btn_reset_pos.clicked.connect(self._reset_position)
        btn_row.addWidget(btn_reset_pos)
        pos_layout.addLayout(btn_row)

        layout.addWidget(pos_group)

        timer_group = QGroupBox("直播計時器")
        timer_layout = QVBoxLayout(timer_group)

        self._timer_label = QLabel("00:00:00")
        self._timer_label.setStyleSheet("font-size: 24px; font-weight: bold; color: #ccc;")
        timer_layout.addWidget(self._timer_label)

        timer_btn_row = QHBoxLayout()
        self._timer_start_btn = QPushButton("開始")
        self._timer_start_btn.clicked.connect(self._timer_start)
        timer_btn_row.addWidget(self._timer_start_btn)
        self._timer_stop_btn = QPushButton("停止")
        self._timer_stop_btn.clicked.connect(self._timer_stop)
        timer_btn_row.addWidget(self._timer_stop_btn)
        self._timer_reset_btn = QPushButton("重設")
        self._timer_reset_btn.clicked.connect(self._timer_reset)
        timer_btn_row.addWidget(self._timer_reset_btn)
        timer_layout.addLayout(timer_btn_row)

        layout.addWidget(timer_group)

        layout.addStretch()

        save_btn = QPushButton("儲存設定")
        save_btn.clicked.connect(self._save)
        layout.addWidget(save_btn)

        self._save_timer = QTimer()
        self._save_timer.setSingleShot(True)
        self._save_timer.timeout.connect(self._save_async)

        self._timer_refresh_timer = QTimer()
        self._timer_refresh_timer.timeout.connect(self._update_timer_display)
        self._timer_refresh_timer.start(500)

        self._pos_refresh_timer = QTimer()
        self._pos_refresh_timer.timeout.connect(self._refresh_pos_label)
        self._pos_refresh_timer.start(500)

    def _on_drag_toggled(self, state):
        self.toggle_drag_mode(state == Qt.CheckState.Checked.value)

    def _update_timer_display(self):
        if self._engine:
            self._timer_label.setText(self._engine.get_elapsed_str())
            active = self._engine.stream_active
            self._timer_start_btn.setEnabled(not active)
            self._timer_stop_btn.setEnabled(active)

    def _timer_start(self):
        if self._engine:
            self._engine.start_timer()

    def _timer_stop(self):
        if self._engine:
            self._engine.stop_timer()

    def _timer_reset(self):
        if self._engine:
            self._engine.reset_timer()

    def _on_size_changed(self):
        if self._overlay:
            self._overlay.resize_overlay(self._width_spin.value(), self._height_spin.value())
        self._save_timer.start(500)

    def _save_async(self):
        data = {
            "width": self._width_spin.value(),
            "height": self._height_spin.value(),
        }
        existing = load_overlay_config()
        data["x"] = existing.get("x", -1)
        data["y"] = existing.get("y", 50)
        save_overlay_config(data)

    def _load_config(self):
        cfg = load_overlay_config()
        self._width_spin.setValue(cfg["width"])
        self._height_spin.setValue(cfg["height"])
        self._update_pos_label(cfg.get("x", -1), cfg.get("y", 50))

    def _update_pos_label(self, x, y):
        if x >= 0:
            self._pos_label.setText(f"X: {x}  Y: {y}")
            self._pos_label.setStyleSheet("")
        else:
            self._pos_label.setText("尚未設定位置")
            self._pos_label.setStyleSheet("color: gray;")

    def _refresh_pos_label(self):
        if self._overlay and self._drag_cb.isChecked():
            pos = self._overlay.pos()
            self._update_pos_label(pos.x(), pos.y())

    def toggle_drag_mode(self, enabled: bool):
        if not self._overlay:
            return
        self._drag_cb.blockSignals(True)
        self._drag_cb.setChecked(enabled)
        self._drag_cb.blockSignals(False)
        if enabled:
            self._overlay.start_drag_mode()
            log("Drag mode enabled via overlay settings")
        else:
            self._overlay.stop_drag_mode()
            log("Drag mode disabled via overlay settings")

    def _save_current_position(self):
        if self._overlay:
            pos = self._overlay.pos()
            cfg = load_overlay_config()
            cfg["x"] = pos.x()
            cfg["y"] = pos.y()
            save_overlay_config(cfg)
            self._update_pos_label(pos.x(), pos.y())
            log(f"Overlay position saved: {pos.x()}, {pos.y()}")

    def _reset_position(self):
        if self._overlay:
            screen = self._overlay.screen()
            if screen:
                sg = screen.geometry()
                default_x = sg.width() - int(420 * 2 - 20)
                default_y = 50
                self._overlay.move(default_x, default_y)
                cfg = load_overlay_config()
                cfg["x"] = default_x
                cfg["y"] = default_y
                save_overlay_config(cfg)
                self._update_pos_label(default_x, default_y)

    def _save(self):
        data = {
            "width": self._width_spin.value(),
            "height": self._height_spin.value(),
        }
        existing = load_overlay_config()
        data["x"] = existing.get("x", -1)
        data["y"] = existing.get("y", 50)
        save_overlay_config(data)
        if self._overlay:
            self._overlay.resize_overlay(self._width_spin.value(), self._height_spin.value())
        log(f"Overlay settings saved: {data}")
