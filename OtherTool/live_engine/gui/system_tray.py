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

        menu = QMenu()

        self._toggle_act = QAction("隱藏疊加層")
        self._toggle_act.triggered.connect(self._on_toggle)
        menu.addAction(self._toggle_act)

        menu.addSeparator()

        act_overlay = QAction("疊加層設定")
        act_overlay.triggered.connect(self.show_overlay_settings.emit)
        menu.addAction(act_overlay)

        act_settings = QAction("TTS 朗讀設定")
        act_settings.triggered.connect(self.show_settings.emit)
        menu.addAction(act_settings)

        act_filter = QAction("過濾器設定")
        act_filter.triggered.connect(self.show_filter.emit)
        menu.addAction(act_filter)

        menu.addSeparator()

        act_quit = QAction("結束程式")
        act_quit.triggered.connect(QApplication.instance().quit)
        menu.addAction(act_quit)

        self._tray.setContextMenu(menu)
        self._tray.activated.connect(self._on_activated)

        self._visible = True

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
