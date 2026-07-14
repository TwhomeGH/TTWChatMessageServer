from PyQt6.QtWidgets import QApplication, QSystemTrayIcon, QMenu
from PyQt6.QtGui import QIcon, QPainter, QColor, QPixmap, QAction
from PyQt6.QtCore import QObject, pyqtSignal, Qt

from core.debug_log import log


class SystemTray(QObject):
    toggle_overlay = pyqtSignal()
    show_settings = pyqtSignal()
    show_filter = pyqtSignal()
    show_overlay_settings = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)

        icon = self._make_icon()
        self._tray = QSystemTrayIcon(icon, parent)
        self._tray.setToolTip("Live Engine - 聊天疊加層")

        me = QMenu()
        self._menu = me

        self._toggle_act = QAction("隱藏疊加層")
        self._toggle_act.triggered.connect(self._on_toggle)
        me.addAction(self._toggle_act)

        me.addSeparator()

        self._act_overlay = QAction("疊加層設定")
        self._act_overlay.triggered.connect(self.show_overlay_settings.emit)
        me.addAction(self._act_overlay)

        self._act_tts = QAction("TTS 朗讀設定")
        self._act_tts.triggered.connect(self.show_settings.emit)
        me.addAction(self._act_tts)

        self._act_filter = QAction("過濾器設定")
        self._act_filter.triggered.connect(self.show_filter.emit)
        me.addAction(self._act_filter)

        me.addSeparator()

        self._act_quit = QAction("關閉")
        self._act_quit.triggered.connect(self._quit_app)
        me.addAction(self._act_quit)

        self._tray.setContextMenu(me)
        self._tray.activated.connect(self._on_activated)

        self._visible = True
        log("System tray menu built: toggle, overlay, tts, filter, quit")

    def _quit_app(self):
        log("Quit triggered from tray menu")
        QApplication.instance().quit()

    def _make_icon(self):
        pm = QPixmap(16, 16)
        pm.fill(QColor(0, 120, 215))
        p = QPainter(pm)
        p.setPen(QColor(255, 255, 255))
        f = p.font()
        f.setBold(True)
        p.setFont(f)
        p.drawText(pm.rect(), Qt.AlignmentFlag.AlignCenter, "L")
        p.end()
        return QIcon(pm)

    def show(self):
        self._tray.show()
        log("System tray icon shown")

    def set_overlay_visible(self, visible):
        self._visible = visible
        self._toggle_act.setText("隱藏疊加層" if visible else "顯示疊加層")

    def _on_toggle(self):
        self.toggle_overlay.emit()

    def _on_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self.show_overlay_settings.emit()
