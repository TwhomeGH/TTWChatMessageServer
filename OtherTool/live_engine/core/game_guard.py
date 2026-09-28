"""Detect known anti-cheat processes and expose a "game mode" state.

This module only *reads the process list* and the foreground window — it
installs no hooks, injects nothing, touches no game handles, and does not open
the protected process. This avoids invasive inspection while letting the
UI step out of the way when a protected game starts.

Game mode only turns on when a known anti-cheat is present **and** the
foreground window covers a whole monitor (i.e. a fullscreen game). The extra
fullscreen gate keeps always-resident clients such as Vanguard's ``vgtray.exe``
from hiding the overlay permanently.
"""

import ctypes
from ctypes import wintypes

from PyQt6.QtCore import QObject, QTimer, pyqtSignal

from core.debug_log import log, log_warn

TH32CS_SNAPPROCESS = 0x00000002
_MAX_PATH = 260
_INVALID_HANDLE = ctypes.c_void_p(-1).value


class _PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * _MAX_PATH),
    ]


# Lower-cased executable names of common anti-cheat clients / launchers.
ANTICHEAT_PROCESSES = {
    # Tencent ACE
    "sguard64.exe", "sguardsvc64.exe", "sguardsvc.exe",
    "anticheatexpert.exe", "acegame.exe", "ace-base.exe", "tency.exe",
    # EasyAntiCheat
    "easyanticheat.exe", "easyanticheat_eos.exe",
    "easyanticheat_launcher.exe", "eac_launcher.exe",
    # BattlEye
    "beservice.exe", "beservice_x64.exe", "belauncher.exe", "battleye.exe",
    # Riot Vanguard
    "vgc.exe", "vgtray.exe",
    # nProtect GameGuard
    "npggsvc.exe", "npgame.exe", "npkcrypt.exe", "gamemon.des",
    # XIGNCODE3 / Wellbia
    "xigncode.exe", "xigncode3.exe", "xmag.xem", "xnina.xem",
    # FACEIT
    "faceitclient.exe", "faceitclientapp.exe",
    # Misc
    "perfectworldanticheat.exe", "esrv.exe",
}


def _iter_process_names():
    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PROCESSENTRY32W)]
    k32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PROCESSENTRY32W)]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]

    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snap or snap == _INVALID_HANDLE:
        raise OSError("process snapshot failed")
    try:
        entry = _PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
        if not k32.Process32FirstW(snap, ctypes.byref(entry)):
            raise OSError("process enumeration failed")
        while True:
            yield entry.szExeFile
            if not k32.Process32NextW(snap, ctypes.byref(entry)):
                if k32.GetLastError() != 18:  # ERROR_NO_MORE_FILES
                    raise OSError("process enumeration interrupted")
                break
    finally:
        k32.CloseHandle(snap)


def detect_anticheat():
    """Return the matched anti-cheat executable name, or None."""
    try:
        for name in _iter_process_names():
            if name and name.lower() in ANTICHEAT_PROCESSES:
                return name
    except Exception as e:  # pragma: no cover - defensive
        log_warn("GameGuard: process scan failed:", e)
    return None


# Process-name matching only; keep this list extensible when game binaries change.
GAME_PROCESSES = {"endfield.exe", "arknightsendfield.exe"}


def detect_drag_risk():
    """Stricter than auto-hide: background anti-cheat also blocks editing.

    Unknown scan state is not permission to enter drag mode.
    """
    try:
        for name in _iter_process_names():
            if name and name.lower() in ANTICHEAT_PROCESSES | GAME_PROCESSES:
                return f"偵測到遊戲／反作弊程序：{name}"
    except Exception as exc:
        log_warn("Drag guard: process scan failed:", exc)
        return "無法確認遊戲／反作弊狀態，暫停拖曳"
    return ""


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("rcMonitor", wintypes.RECT),
        ("rcWork", wintypes.RECT),
        ("dwFlags", wintypes.DWORD),
    ]


def _foreground_covers_monitor():
    """True when the foreground window spans its whole monitor (a game)."""
    try:
        user32 = ctypes.windll.user32
        user32.GetForegroundWindow.argtypes = []
        user32.GetForegroundWindow.restype = wintypes.HWND
        user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
        user32.GetWindowRect.restype = wintypes.BOOL
        user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
        user32.MonitorFromWindow.restype = wintypes.HANDLE
        user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_MONITORINFO)]
        user32.GetMonitorInfoW.restype = wintypes.BOOL
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return False
        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return False
        MI_DEFAULTTONEAREST = 2
        mon = user32.MonitorFromWindow(hwnd, MI_DEFAULTTONEAREST)
        if not mon:
            return False
        info = _MONITORINFO()
        info.cbSize = ctypes.sizeof(_MONITORINFO)
        if not user32.GetMonitorInfoW(mon, ctypes.byref(info)):
            return False
        m = info.rcMonitor
        return (
            rect.left <= m.left and rect.top <= m.top
            and rect.right >= m.right and rect.bottom >= m.bottom
        )
    except Exception:
        return False


class GameGuard(QObject):
    """Polls for anti-cheat presence and emits on state changes only."""

    active_changed = pyqtSignal(bool, str)  # active, triggering exe name

    def __init__(self, interval_ms=3000, parent=None):
        super().__init__(parent)
        self._active = False
        self._name = ""
        self._timer = QTimer(self)
        self._timer.setInterval(interval_ms)
        self._timer.timeout.connect(self._poll)

    @property
    def active(self) -> bool:
        return self._active

    def start(self):
        self._poll()
        self._timer.start()

    def stop(self):
        self._timer.stop()

    def _poll(self):
        name = detect_anticheat() or ""
        # Require a fullscreen game in the foreground too: some anti-cheat
        # clients (e.g. Vanguard's vgtray.exe, service processes) stay resident
        # all the time and must not keep the overlay hidden permanently.
        active = bool(name) and _foreground_covers_monitor()
        if active == self._active:
            return
        self._active = active
        self._name = name
        if active:
            log(f"GameGuard: anti-cheat detected ({name})")
        else:
            log("GameGuard: anti-cheat cleared")
        self.active_changed.emit(active, name)
