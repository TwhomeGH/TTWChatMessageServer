import sys
from core.debug_log import log, log_error
log("TTS Settings GUI starting up...")
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QLineEdit, QPushButton, QCheckBox, QGroupBox,
    QSlider, QComboBox, QSpinBox, QFormLayout, QMessageBox,
    QTabWidget
)
from PyQt6.QtCore import Qt, QTimer
from gui.settings_manager import tts_settings
from gui.filter_settings import FilterSettingsWindow
from core.tts import tts_service
from core.speech_filter import filter_manager


class TTSSettingsWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("TTS 朗讀設定")
        self.setMinimumSize(520, 620)
        self._filter_window: FilterSettingsWindow | None = None
        self._build_ui()
        self._load_settings()
        self._setup_auto_save()

    def _build_ui(self):
        tabs = QTabWidget(self)
        main_layout = QVBoxLayout(self)
        main_layout.addWidget(tabs)

        general_tab = QWidget()
        general_layout = QVBoxLayout(general_tab)
        tabs.addTab(general_tab, "一般")

        voice_tab = QWidget()
        voice_layout = QVBoxLayout(voice_tab)
        tabs.addTab(voice_tab, "聲音")

        limit_tab = QWidget()
        limit_layout = QVBoxLayout(limit_tab)
        tabs.addTab(limit_tab, "限制")

        toggles_group = QGroupBox("朗讀開關")
        toggles_layout = QVBoxLayout(toggles_group)

        self.enabled_cb = QCheckBox("啟用聊天室 TTS 朗讀")
        toggles_layout.addWidget(self.enabled_cb)

        self.main_only_cb = QCheckBox("只朗讀主訊息 (Only Main MSG)")
        toggles_layout.addWidget(self.main_only_cb)

        self.read_username_cb = QCheckBox("朗讀使用者名稱 (Read User Name)")
        toggles_layout.addWidget(self.read_username_cb)

        self.interrupt_cb = QCheckBox("新訊息打斷目前朗讀")
        toggles_layout.addWidget(self.interrupt_cb)

        general_layout.addWidget(toggles_group)

        middle_group = QGroupBox("中間詞")
        middle_layout = QVBoxLayout(middle_group)
        self.middle_name_edit = QLineEdit()
        self.middle_name_edit.setPlaceholderText("請輸入用戶與訊息之間的詞...")
        middle_layout.addWidget(self.middle_name_edit)
        general_layout.addWidget(middle_group)

        btn_row = QHBoxLayout()
        test_btn = QPushButton("測試朗讀")
        test_btn.clicked.connect(self._test_tts)
        btn_row.addWidget(test_btn)

        stop_btn = QPushButton("停止朗讀")
        stop_btn.clicked.connect(self._stop_tts)
        btn_row.addWidget(stop_btn)

        filter_btn = QPushButton("過濾詞管理")
        filter_btn.clicked.connect(self._open_filter)
        btn_row.addWidget(filter_btn)

        general_layout.addLayout(btn_row)
        general_layout.addStretch()

        voice_group = QGroupBox("語音設定")
        voice_form = QFormLayout(voice_group)

        self.voice_combo = QComboBox()
        self.voice_combo.addItem("zh-TW-HsiaoChenNeural (預設)", "zh-TW-HsiaoChenNeural")
        self.voice_combo.addItem("zh-CN-XiaoxiaoNeural", "zh-CN-XiaoxiaoNeural")
        self.voice_combo.addItem("zh-CN-YunxiNeural", "zh-CN-YunxiNeural")
        self.voice_combo.addItem("zh-TW-YunJheNeural", "zh-TW-YunJheNeural")
        self.voice_combo.addItem("ja-JP-NanamiNeural", "ja-JP-NanamiNeural")
        self.voice_combo.setEditable(True)
        voice_form.addRow("語音:", self.voice_combo)

        self.rate_slider = QSlider(Qt.Orientation.Horizontal)
        self.rate_slider.setRange(-100, 100)
        self.rate_slider.setValue(0)
        self.rate_label = QLabel("語速: +0%")
        self.rate_slider.valueChanged.connect(
            lambda v: self.rate_label.setText(f"語速: {v:+.0f}%")
        )
        voice_form.addRow(self.rate_label, self.rate_slider)

        self.volume_slider = QSlider(Qt.Orientation.Horizontal)
        self.volume_slider.setRange(-100, 100)
        self.volume_slider.setValue(0)
        self.volume_label = QLabel("音量: +0%")
        self.volume_slider.valueChanged.connect(
            lambda v: self.volume_label.setText(f"音量: {v:+.0f}%")
        )
        voice_form.addRow(self.volume_label, self.volume_slider)

        voice_layout.addWidget(voice_group)
        voice_layout.addStretch()

        limit_group = QGroupBox("訊息長度限制")
        limit_form = QFormLayout(limit_group)

        self.min_len_spin = QSpinBox()
        self.min_len_spin.setRange(0, 500)
        self.min_len_spin.setValue(3)
        limit_form.addRow("最小字數 (低於此不朗讀):", self.min_len_spin)

        self.max_len_spin = QSpinBox()
        self.max_len_spin.setRange(0, 1000)
        self.max_len_spin.setSpecialValueText("無限制")
        limit_form.addRow("最大字數 (超過此截斷):", self.max_len_spin)

        limit_layout.addWidget(limit_group)

        queue_group = QGroupBox("佇列設定")
        queue_form = QFormLayout(queue_group)

        self.queue_size_spin = QSpinBox()
        self.queue_size_spin.setRange(0, 100)
        self.queue_size_spin.setSpecialValueText("無限制")
        queue_form.addRow("佇列上限:", self.queue_size_spin)

        self.overflow_combo = QComboBox()
        self.overflow_combo.addItem("跳過新訊息", 0)
        self.overflow_combo.addItem("停止舊的，朗讀最新的", 1)
        self.overflow_combo.addItem("清空全部佇列", 2)
        queue_form.addRow("佇列滿載時:", self.overflow_combo)

        limit_layout.addWidget(queue_group)
        limit_layout.addStretch()

    def _setup_auto_save(self):
        self._save_timer = QTimer()
        self._save_timer.setSingleShot(True)
        self._save_timer.timeout.connect(self._save_settings)

        widgets = [
            self.enabled_cb, self.main_only_cb, self.read_username_cb,
            self.interrupt_cb, self.middle_name_edit, self.voice_combo,
            self.rate_slider, self.volume_slider,
            self.min_len_spin, self.max_len_spin,
            self.queue_size_spin, self.overflow_combo
        ]
        for w in widgets:
            if isinstance(w, QCheckBox):
                w.stateChanged.connect(self._schedule_save)
            elif isinstance(w, QLineEdit):
                w.textChanged.connect(self._schedule_save)
            elif isinstance(w, QComboBox):
                w.currentIndexChanged.connect(self._schedule_save)
            elif isinstance(w, QSpinBox):
                w.valueChanged.connect(self._schedule_save)
            elif isinstance(w, QSlider):
                w.valueChanged.connect(self._schedule_save)

    def _schedule_save(self):
        self._save_timer.start(500)

    def _load_settings(self):
        cfg = tts_settings.load()
        self.enabled_cb.setChecked(cfg.get("tts_enabled", False))
        self.main_only_cb.setChecked(cfg.get("tts_read_main_only", True))
        self.read_username_cb.setChecked(cfg.get("tts_read_user_name", True))
        self.interrupt_cb.setChecked(cfg.get("tts_interrupt_current", True))
        self.middle_name_edit.setText(cfg.get("tts_read_middle_name", "說"))
        self.min_len_spin.setValue(cfg.get("tts_min_length", 3))
        self.max_len_spin.setValue(cfg.get("tts_max_length", 0))
        self.queue_size_spin.setValue(cfg.get("tts_max_queue_size", 0))
        self.overflow_combo.setCurrentIndex(cfg.get("tts_queue_overflow_action", 0))

        vid = cfg.get("tts_voice_identifier", "")
        idx = self.voice_combo.findData(vid)
        if idx >= 0:
            self.voice_combo.setCurrentIndex(idx)
        elif vid:
            self.voice_combo.setCurrentText(vid)
        else:
            self.voice_combo.setCurrentIndex(0)

        rate = cfg.get("tts_rate", 0.0)
        self.rate_slider.setValue(int(rate))
        self.rate_label.setText(f"語速: {int(rate):+.0f}%")

        vol = cfg.get("tts_volume", 0.0)
        self.volume_slider.setValue(int(vol))
        self.volume_label.setText(f"音量: {int(vol):+.0f}%")

    def _save_settings(self):
        voice_text = self.voice_combo.currentText()
        voice_data = self.voice_combo.currentData()
        voice_id = voice_data if voice_data is not None else voice_text

        data = {
            "tts_enabled": self.enabled_cb.isChecked(),
            "tts_read_main_only": self.main_only_cb.isChecked(),
            "tts_read_user_name": self.read_username_cb.isChecked(),
            "tts_interrupt_current": self.interrupt_cb.isChecked(),
            "tts_read_middle_name": self.middle_name_edit.text(),
            "tts_min_length": self.min_len_spin.value(),
            "tts_max_length": self.max_len_spin.value(),
            "tts_max_queue_size": self.queue_size_spin.value(),
            "tts_queue_overflow_action": self.overflow_combo.currentData(),
            "tts_voice_identifier": voice_id,
            "tts_rate": float(self.rate_slider.value()),
            "tts_volume": float(self.volume_slider.value()),
        }
        tts_settings.save(data)
        tts_service.update_default()

    def _test_tts(self):
        self._save_settings()
        tts_service.speak_preview()

    def _stop_tts(self):
        tts_service.stop()

    def _open_filter(self):
        if self._filter_window is None:
            self._filter_window = FilterSettingsWindow()
        self._filter_window.show()
        self._filter_window.raise_()


def launch_gui():
    log("TTSSettingsWindow: creating QApplication")
    app = QApplication(sys.argv)
    w = TTSSettingsWindow()
    log("TTSSettingsWindow: showing window")
    w.show()
    log("TTSSettingsWindow: entering event loop")
    sys.exit(app.exec())


if __name__ == "__main__":
    launch_gui()