import json
import os
import ctypes
from ctypes import wintypes

from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QGroupBox, QTabWidget,
    QSpinBox, QPushButton, QLabel, QCheckBox, QComboBox, QColorDialog
)
from PyQt6.QtCore import Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QColor

from core.debug_log import log

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "config", "overlay_settings.json"
)


def load_overlay_config() -> dict:
    defaults = {"width": 420, "height": 400, "x": -1, "y": 50, "font_face": "Microsoft JhengHei", "font_size": 15, "spacing": 8, "content_gap": 2, "message_ttl": 15, "fade_speed": 2, "ad_overlay_duration": 10, "ad_overlay_font_size": 16, "ad_avatar_size": 40, "ad_show_avatar": True, "ad_avatar_offset": 3, "ad_bg_color": "#1E1E2E", "ad_accent_color": "#4C9EFF", "ad_user_color": "#8AB4FF", "ad_text_color": "#FFFFFF", "ad_bg_opacity": 88}
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                defaults.update(data)
    except Exception:
        pass
    return defaults


def save_overlay_config(data: dict):
    merged = {"width": 420, "height": 400, "x": -1, "y": 50, "font_face": "Microsoft JhengHei", "font_size": 15, "spacing": 8, "content_gap": 2, "message_ttl": 15, "fade_speed": 2, "ad_overlay_duration": 10, "ad_overlay_font_size": 16, "ad_avatar_size": 40, "ad_show_avatar": True, "ad_avatar_offset": 3, "ad_bg_color": "#1E1E2E", "ad_accent_color": "#4C9EFF", "ad_user_color": "#8AB4FF", "ad_text_color": "#FFFFFF", "ad_bg_opacity": 88}
    merged.update(data)
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)


class LOGFONTW(ctypes.Structure):
    _fields_ = [
        ("lfHeight", wintypes.LONG),
        ("lfWidth", wintypes.LONG),
        ("lfEscapement", wintypes.LONG),
        ("lfOrientation", wintypes.LONG),
        ("lfWeight", wintypes.LONG),
        ("lfItalic", wintypes.BYTE),
        ("lfUnderline", wintypes.BYTE),
        ("lfStrikeOut", wintypes.BYTE),
        ("lfCharSet", wintypes.BYTE),
        ("lfOutPrecision", wintypes.BYTE),
        ("lfClipPrecision", wintypes.BYTE),
        ("lfQuality", wintypes.BYTE),
        ("lfPitchAndFamily", wintypes.BYTE),
        ("lfFaceName", wintypes.WCHAR * 32),
    ]


def _get_system_fonts():
    families = []
    gdi32 = ctypes.windll.gdi32
    user32 = ctypes.windll.user32

    @ctypes.WINFUNCTYPE(
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.LPARAM,
    )
    def _enum_cb(lpelfe, lpntme, fonttype, lparam):
        lf = ctypes.cast(lpelfe, ctypes.POINTER(LOGFONTW)).contents
        name = lf.lfFaceName
        if name and name[0] != '@':
            families.append(name)
        return 1

    hdc = user32.GetDC(None)
    if not hdc:
        return []
    gdi32.EnumFontFamiliesW(hdc, None, _enum_cb, 0)
    user32.ReleaseDC(None, hdc)
    return sorted(set(families)) if families else [
        "Microsoft JhengHei", "Microsoft YaHei", "SimHei", "Arial",
        "Segoe UI", "Tahoma", "Times New Roman",
    ]


class _ColorButton(QPushButton):
    colorChanged = pyqtSignal(QColor)

    def __init__(self, color="#FFFFFF", parent=None):
        super().__init__(parent)
        self._color = QColor(color)
        self._refresh_style()
        self.clicked.connect(self._pick)

    def _refresh_style(self):
        name = self._color.name().upper()
        fg = "#000" if self._color.lightness() > 128 else "#fff"
        self.setText(name)
        self.setStyleSheet(
            f"background-color: {name}; color: {fg}; border: 1px solid #666;"
        )

    def color(self):
        return self._color

    def set_color(self, color):
        self._color = QColor(color)
        self._refresh_style()

    def _pick(self):
        c = QColorDialog.getColor(self._color, self, "選擇顏色")
        if c.isValid():
            self._color = c
            self._refresh_style()
            self.colorChanged.emit(c)


class OverlaySettingsWindow(QWidget):
    def __init__(self, overlay=None, engine=None, on_open_tts=None):
        super().__init__()
        self._overlay = overlay
        self._engine = engine
        self._on_open_tts = on_open_tts
        self.setWindowTitle("疊加層設定")
        self.setMinimumSize(420, 460)
        self._build_ui()
        self._load_config()

    def closeEvent(self, event):
        self.hide()
        event.ignore()

    def _build_ui(self):
        tabs = QTabWidget(self)
        main_layout = QVBoxLayout(self)
        main_layout.addWidget(tabs)

        self._build_basic_tab(tabs)
        self._build_spacing_tab(tabs)
        self._build_position_tab(tabs)
        self._build_timer_tab(tabs)
        self._build_ad_tab(tabs)

        self._save_timer = QTimer()
        self._save_timer.setSingleShot(True)
        self._save_timer.timeout.connect(self._save_async)

        self._timer_refresh_timer = QTimer()
        self._timer_refresh_timer.timeout.connect(self._update_timer_display)
        self._timer_refresh_timer.start(500)

        self._pos_refresh_timer = QTimer()
        self._pos_refresh_timer.timeout.connect(self._refresh_pos_label)
        self._pos_refresh_timer.start(500)

    def _build_basic_tab(self, tabs):
        tab = QWidget()
        form = QFormLayout(tab)
        self._width_spin = QSpinBox()
        self._width_spin.setRange(200, 2000)
        self._width_spin.setSuffix(" px")
        self._width_spin.valueChanged.connect(self._on_size_changed)
        form.addRow("寬度:", self._width_spin)
        self._height_spin = QSpinBox()
        self._height_spin.setRange(100, 1500)
        self._height_spin.setSuffix(" px")
        self._height_spin.valueChanged.connect(self._on_size_changed)
        form.addRow("高度:", self._height_spin)
        self._font_face_combo = QComboBox()
        self._font_face_combo.setEditable(True)
        self._font_face_combo.addItems(self._get_common_fonts())
        self._font_face_combo.setCurrentText("Microsoft JhengHei")
        self._font_face_combo.currentTextChanged.connect(self._on_font_face_changed)
        form.addRow("字體:", self._font_face_combo)
        self._font_size_spin = QSpinBox()
        self._font_size_spin.setRange(10, 30)
        self._font_size_spin.setValue(15)
        self._font_size_spin.setSuffix(" px")
        self._font_size_spin.valueChanged.connect(self._on_font_size_changed)
        form.addRow("字體大小:", self._font_size_spin)

        form.addRow(" ", QWidget())
        tts_btn = QPushButton("開啟 TTS 朗讀設定")
        tts_btn.clicked.connect(self._open_tts_settings)
        form.addRow(tts_btn)

        tabs.addTab(tab, "基本")

    def _get_common_fonts(self):
        return _get_system_fonts()

    def _open_tts_settings(self):
        if self._on_open_tts:
            self._on_open_tts()

    def _build_spacing_tab(self, tabs):
        tab = QWidget()
        form = QFormLayout(tab)
        self._spacing_spin = QSpinBox()
        self._spacing_spin.setRange(0, 30)
        self._spacing_spin.setValue(8)
        self._spacing_spin.setSuffix(" px")
        self._spacing_spin.valueChanged.connect(self._on_spacing_changed)
        form.addRow("行間距（節點之間）:", self._spacing_spin)
        self._content_gap_spin = QSpinBox()
        self._content_gap_spin.setRange(0, 20)
        self._content_gap_spin.setValue(2)
        self._content_gap_spin.setSuffix(" px")
        self._content_gap_spin.valueChanged.connect(self._on_content_gap_changed)
        form.addRow("內容間距（用戶名↔訊息）:", self._content_gap_spin)
        self._ttl_spin = QSpinBox()
        self._ttl_spin.setRange(5, 120)
        self._ttl_spin.setValue(15)
        self._ttl_spin.setSuffix(" 秒")
        self._ttl_spin.valueChanged.connect(self._on_ttl_changed)
        form.addRow("訊息存活時間:", self._ttl_spin)
        self._fade_spin = QSpinBox()
        self._fade_spin.setRange(1, 50)
        self._fade_spin.setValue(2)
        self._fade_spin.setSuffix(" (越小越慢)")
        self._fade_spin.valueChanged.connect(self._on_fade_changed)
        form.addRow("淡出速度:", self._fade_spin)
        form.addRow(QLabel("提示: 淡出速度 1=最慢, 50=瞬間消失"))
        tabs.addTab(tab, "間距")

    def _build_position_tab(self, tabs):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        self._drag_cb = QCheckBox("啟用拖曳調整位置（關閉點擊穿透）")
        self._drag_cb.stateChanged.connect(self._on_drag_toggled)
        layout.addWidget(self._drag_cb)

        self._pos_label = QLabel("尚未設定位置")
        self._pos_label.setStyleSheet("color: gray;")
        layout.addWidget(self._pos_label)

        btn_row = QHBoxLayout()
        btn_save_pos = QPushButton("儲存目前位置")
        btn_save_pos.clicked.connect(self._save_current_position)
        btn_row.addWidget(btn_save_pos)
        btn_reset_pos = QPushButton("重設為預設位置")
        btn_reset_pos.clicked.connect(self._reset_position)
        btn_row.addWidget(btn_reset_pos)
        layout.addLayout(btn_row)

        layout.addStretch()
        tabs.addTab(tab, "位置")

    def _build_timer_tab(self, tabs):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        self._timer_label = QLabel("00:00:00")
        self._timer_label.setStyleSheet("font-size: 24px; font-weight: bold; color: #ccc;")
        layout.addWidget(self._timer_label)

        self._auto_timer_cb = QCheckBox("自動跟隨 Socket 連線")
        self._auto_timer_cb.setChecked(True)
        self._auto_timer_cb.toggled.connect(self._on_auto_timer_toggled)
        layout.addWidget(self._auto_timer_cb)

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
        layout.addLayout(timer_btn_row)

        layout.addStretch()
        tabs.addTab(tab, "計時器")

    def _build_ad_tab(self, tabs):
        tab = QWidget()
        root = QVBoxLayout(tab)

        basic_box = QGroupBox("基本")
        basic_form = QFormLayout(basic_box)
        self._ad_duration_spin = QSpinBox()
        self._ad_duration_spin.setRange(3, 120)
        self._ad_duration_spin.setValue(10)
        self._ad_duration_spin.setSuffix(" 秒")
        self._ad_duration_spin.valueChanged.connect(self._on_ad_duration_changed)
        basic_form.addRow("顯示時長:", self._ad_duration_spin)
        self._ad_font_size_spin = QSpinBox()
        self._ad_font_size_spin.setRange(10, 30)
        self._ad_font_size_spin.setValue(16)
        self._ad_font_size_spin.setSuffix(" px")
        self._ad_font_size_spin.valueChanged.connect(self._on_ad_font_size_changed)
        basic_form.addRow("字體大小:", self._ad_font_size_spin)
        self._ad_avatar_size_spin = QSpinBox()
        self._ad_avatar_size_spin.setRange(20, 80)
        self._ad_avatar_size_spin.setValue(40)
        self._ad_avatar_size_spin.setSuffix(" px")
        self._ad_avatar_size_spin.valueChanged.connect(self._on_ad_avatar_size_changed)
        basic_form.addRow("頭像大小:", self._ad_avatar_size_spin)
        self._ad_show_avatar_cb = QCheckBox("顯示頭像")
        self._ad_show_avatar_cb.setChecked(True)
        self._ad_show_avatar_cb.toggled.connect(self._on_ad_show_avatar_changed)
        basic_form.addRow(self._ad_show_avatar_cb)
        self._ad_avatar_offset_spin = QSpinBox()
        self._ad_avatar_offset_spin.setRange(-20, 20)
        self._ad_avatar_offset_spin.setValue(3)
        self._ad_avatar_offset_spin.setSuffix(" px")
        self._ad_avatar_offset_spin.setToolTip("正數=頭像下移，負數=上移")
        self._ad_avatar_offset_spin.valueChanged.connect(self._on_ad_avatar_offset_changed)
        basic_form.addRow("頭像垂直微調:", self._ad_avatar_offset_spin)
        root.addWidget(basic_box)

        style_box = QGroupBox("樣式")
        style_form = QFormLayout(style_box)
        self._ad_bg_color_btn = _ColorButton("#1E1E2E")
        self._ad_bg_color_btn.colorChanged.connect(self._on_ad_bg_color_changed)
        style_form.addRow("背景顏色:", self._ad_bg_color_btn)
        self._ad_accent_color_btn = _ColorButton("#4C9EFF")
        self._ad_accent_color_btn.colorChanged.connect(self._on_ad_accent_color_changed)
        style_form.addRow("邊框/強調色:", self._ad_accent_color_btn)
        self._ad_user_color_btn = _ColorButton("#8AB4FF")
        self._ad_user_color_btn.colorChanged.connect(self._on_ad_user_color_changed)
        style_form.addRow("用戶名顏色:", self._ad_user_color_btn)
        self._ad_text_color_btn = _ColorButton("#FFFFFF")
        self._ad_text_color_btn.colorChanged.connect(self._on_ad_text_color_changed)
        style_form.addRow("訊息文字顏色:", self._ad_text_color_btn)
        self._ad_bg_opacity_spin = QSpinBox()
        self._ad_bg_opacity_spin.setRange(0, 100)
        self._ad_bg_opacity_spin.setValue(88)
        self._ad_bg_opacity_spin.setSuffix(" %")
        self._ad_bg_opacity_spin.valueChanged.connect(self._on_ad_bg_opacity_changed)
        style_form.addRow("背景不透明度:", self._ad_bg_opacity_spin)
        reset_btn = QPushButton("恢復預設樣式")
        reset_btn.clicked.connect(self._on_ad_style_reset)
        style_form.addRow(reset_btn)
        root.addWidget(style_box)

        root.addStretch()
        tabs.addTab(tab, "贊助橫幅")

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

    def _on_auto_timer_toggled(self, checked):
        if self._engine:
            self._engine.set_manual_control(not checked)
        log(f"Timer auto-follow socket: {checked}")

    def _on_font_size_changed(self, size):
        if self._overlay:
            self._overlay.set_inline_font_size(size)
        self._save_timer.start(500)

    def _on_font_face_changed(self, family):
        if self._overlay:
            self._overlay.set_font_face(family)
        self._save_timer.start(500)

    def _on_spacing_changed(self, px):
        if self._engine:
            self._engine.set_node_spacing(px)
        self._save_timer.start(500)

    def _on_content_gap_changed(self, px):
        if self._overlay:
            self._overlay.set_content_gap(px)
        if self._engine:
            self._engine.set_content_gap(px)
        self._save_timer.start(500)

    def _on_ttl_changed(self, sec):
        if self._engine:
            self._engine.set_message_ttl(sec)
        self._save_timer.start(500)

    def _on_fade_changed(self, rate):
        if self._engine:
            self._engine.set_fade_speed(rate)
        self._save_timer.start(500)

    def _on_ad_duration_changed(self, sec):
        if self._engine:
            self._engine.set_ad_overlay_duration(sec)
        self._save_timer.start(500)

    def _on_ad_font_size_changed(self, size):
        if self._engine:
            self._engine.set_ad_overlay_font_size(size)
        self._save_timer.start(500)

    def _on_ad_avatar_size_changed(self, size):
        if self._engine:
            self._engine.set_ad_avatar_size(size)
        self._save_timer.start(500)

    def _on_ad_show_avatar_changed(self, checked):
        if self._engine:
            self._engine.set_ad_show_avatar(checked)
        self._save_timer.start(500)

    def _on_ad_avatar_offset_changed(self, px):
        if self._engine:
            self._engine.set_ad_avatar_offset(px)
        self._save_timer.start(500)

    def _on_ad_bg_color_changed(self, color):
        if self._engine:
            self._engine.set_ad_bg_color(color.name())
        self._save_timer.start(500)

    def _on_ad_accent_color_changed(self, color):
        if self._engine:
            self._engine.set_ad_accent_color(color.name())
        self._save_timer.start(500)

    def _on_ad_user_color_changed(self, color):
        if self._engine:
            self._engine.set_ad_user_color(color.name())
        self._save_timer.start(500)

    def _on_ad_text_color_changed(self, color):
        if self._engine:
            self._engine.set_ad_text_color(color.name())
        self._save_timer.start(500)

    def _on_ad_bg_opacity_changed(self, pct):
        if self._engine:
            self._engine.set_ad_bg_opacity(pct)
        self._save_timer.start(500)

    def _on_ad_style_reset(self):
        self._ad_avatar_size_spin.setValue(40)
        self._ad_show_avatar_cb.setChecked(True)
        self._ad_avatar_offset_spin.setValue(3)
        self._ad_bg_color_btn.set_color("#1E1E2E")
        self._ad_accent_color_btn.set_color("#4C9EFF")
        self._ad_user_color_btn.set_color("#8AB4FF")
        self._ad_text_color_btn.set_color("#FFFFFF")
        self._ad_bg_opacity_spin.setValue(88)
        self._apply_ad_style_to_engine()
        self._save_timer.start(100)

    def _apply_ad_style_to_engine(self):
        if not self._engine:
            return
        self._engine.set_ad_avatar_size(self._ad_avatar_size_spin.value())
        self._engine.set_ad_show_avatar(self._ad_show_avatar_cb.isChecked())
        self._engine.set_ad_avatar_offset(self._ad_avatar_offset_spin.value())
        self._engine.set_ad_bg_color(self._ad_bg_color_btn.color().name())
        self._engine.set_ad_accent_color(self._ad_accent_color_btn.color().name())
        self._engine.set_ad_user_color(self._ad_user_color_btn.color().name())
        self._engine.set_ad_text_color(self._ad_text_color_btn.color().name())
        self._engine.set_ad_bg_opacity(self._ad_bg_opacity_spin.value())

    def _on_size_changed(self):
        if self._overlay:
            self._overlay.resize_overlay(self._width_spin.value(), self._height_spin.value())
        self._save_timer.start(500)

    def _save_async(self):
        data = {
            "width": self._width_spin.value(),
            "height": self._height_spin.value(),
            "font_face": self._font_face_combo.currentText(),
            "font_size": self._font_size_spin.value(),
            "spacing": self._spacing_spin.value(),
            "content_gap": self._content_gap_spin.value(),
            "message_ttl": self._ttl_spin.value(),
            "fade_speed": self._fade_spin.value(),
            "ad_overlay_duration": self._ad_duration_spin.value(),
            "ad_overlay_font_size": self._ad_font_size_spin.value(),
            "ad_avatar_size": self._ad_avatar_size_spin.value(),
            "ad_show_avatar": self._ad_show_avatar_cb.isChecked(),
            "ad_avatar_offset": self._ad_avatar_offset_spin.value(),
            "ad_bg_color": self._ad_bg_color_btn.color().name(),
            "ad_accent_color": self._ad_accent_color_btn.color().name(),
            "ad_user_color": self._ad_user_color_btn.color().name(),
            "ad_text_color": self._ad_text_color_btn.color().name(),
            "ad_bg_opacity": self._ad_bg_opacity_spin.value(),
        }
        existing = load_overlay_config()
        data["x"] = existing.get("x", -1)
        data["y"] = existing.get("y", 50)
        save_overlay_config(data)

    def _load_config(self):
        cfg = load_overlay_config()
        self._width_spin.setValue(cfg["width"])
        self._height_spin.setValue(cfg["height"])
        self._font_face_combo.setCurrentText(cfg.get("font_face", "Microsoft JhengHei"))
        self._font_size_spin.setValue(cfg.get("font_size", 15))
        self._spacing_spin.setValue(cfg.get("spacing", 8))
        self._content_gap_spin.setValue(cfg.get("content_gap", 2))
        self._ttl_spin.setValue(cfg.get("message_ttl", 15))
        self._fade_spin.setValue(cfg.get("fade_speed", 2))
        self._ad_duration_spin.setValue(cfg.get("ad_overlay_duration", 10))
        self._ad_font_size_spin.setValue(cfg.get("ad_overlay_font_size", 16))
        self._ad_avatar_size_spin.setValue(cfg.get("ad_avatar_size", 40))
        self._ad_show_avatar_cb.setChecked(cfg.get("ad_show_avatar", True))
        self._ad_avatar_offset_spin.setValue(cfg.get("ad_avatar_offset", 3))
        self._ad_bg_color_btn.set_color(cfg.get("ad_bg_color", "#1E1E2E"))
        self._ad_accent_color_btn.set_color(cfg.get("ad_accent_color", "#4C9EFF"))
        self._ad_user_color_btn.set_color(cfg.get("ad_user_color", "#8AB4FF"))
        self._ad_text_color_btn.set_color(cfg.get("ad_text_color", "#FFFFFF"))
        self._ad_bg_opacity_spin.setValue(cfg.get("ad_bg_opacity", 88))
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
