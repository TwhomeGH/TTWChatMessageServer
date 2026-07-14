import sys
from PyQt6.QtWidgets import QApplication

from renderer.overlay import Overlay
from network.socket_server import start_socket
from gui.system_tray import SystemTray
from gui.tts_settings_window import TTSSettingsWindow
from gui.filter_settings import FilterSettingsWindow
from gui.overlay_settings import OverlaySettingsWindow
from core.debug_log import log
import threading

if __name__ == "__main__":

    if "--settings" in sys.argv:
        from gui.tts_settings_window import launch_gui
        launch_gui()
        sys.exit(0)

    threading.Thread(target=start_socket, daemon=True).start()

    app = QApplication(sys.argv)

    w = Overlay()
    w.show()

    _tray_wins = {"settings": None, "filter": None, "overlay": None}

    def _open_settings():
        if _tray_wins["settings"] is None:
            _tray_wins["settings"] = TTSSettingsWindow()
        _tray_wins["settings"].show()
        _tray_wins["settings"].raise_()

    def _open_filter():
        if _tray_wins["filter"] is None:
            _tray_wins["filter"] = FilterSettingsWindow()
        _tray_wins["filter"].show()
        _tray_wins["filter"].raise_()

    def _open_overlay_settings():
        if _tray_wins["overlay"] is None:
            _tray_wins["overlay"] = OverlaySettingsWindow(overlay=w, engine=w.engine)
        _tray_wins["overlay"].show()
        _tray_wins["overlay"].raise_()

    def _toggle_overlay():
        if w.isVisible():
            w.hide()
            tray.set_overlay_visible(False)
            log("Overlay hidden via tray")
        else:
            w.show()
            tray.set_overlay_visible(True)
            log("Overlay shown via tray")

    tray = SystemTray()
    tray.toggle_overlay.connect(_toggle_overlay)
    tray.show_settings.connect(_open_settings)
    tray.show_filter.connect(_open_filter)
    tray.show_overlay_settings.connect(_open_overlay_settings)
    tray.show()

    log("Live Engine started with system tray")

    sys.exit(app.exec())