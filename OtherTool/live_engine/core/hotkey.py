"""Global hotkey via Win32 RegisterHotKey — no low-level keyboard hooks.

Why not pynput/hooks: a ``WH_KEYBOARD_LL`` hook receives *every* keystroke on
the machine, which is exactly what anti-cheat (ACE etc.) scores as a keylogger
and flags as a "hacker tool". ``RegisterHotKey`` is an OS-provided facility
that only reports the single combination we registered, so it never observes
other keystrokes.

The combination model is Win32's: one or more modifier keys
(Ctrl/Alt/Shift/Win) plus a single main key. Two bare keys pressed together
(e.g. "R+8") is intentionally not supported because Win32 cannot express it
without a hook.

WM_HOTKEY is retrieved with ``GetMessage`` in a dedicated worker thread (the
hotkey is registered with a NULL window on that thread's message queue). This
avoids running a Python callback inside Qt/Windows native code — overriding
``QWidget.nativeEvent`` on a ``QOpenGLWidget`` or installing a
``QAbstractNativeEventFilter`` both hard-crash this environment with
STATUS_FATAL_USER_CALLBACK_EXCEPTION / STATUS_STACK_BUFFER_OVERRUN.
"""

import ctypes
import threading
from ctypes import wintypes

from PyQt6.QtCore import QObject, pyqtSignal

from core.debug_log import log, log_error, log_warn

# ---------------------------------------------------------------------------
# Win32 constants
# ---------------------------------------------------------------------------
WM_HOTKEY = 0x0312
WM_QUIT = 0x0012

MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000


class _POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class _MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", _POINT),
        ("lPrivate", wintypes.DWORD),
    ]


# Canonical named keys -> Virtual-Key code (used both ways).
_NAMED_VK = {
    "BACKSPACE": 0x08,
    "TAB": 0x09,
    "ENTER": 0x0D,
    "RETURN": 0x0D,
    "ESC": 0x1B,
    "ESCAPE": 0x1B,
    "SPACE": 0x20,
    "PAGEUP": 0x21,
    "PGUP": 0x21,
    "PAGEDOWN": 0x22,
    "PGDN": 0x22,
    "END": 0x23,
    "HOME": 0x24,
    "LEFT": 0x25,
    "UP": 0x26,
    "RIGHT": 0x27,
    "DOWN": 0x28,
    "INSERT": 0x2D,
    "INS": 0x2D,
    "DELETE": 0x2E,
    "DEL": 0x2E,
    "NUMPAD0": 0x60, "NUMPAD1": 0x61, "NUMPAD2": 0x62, "NUMPAD3": 0x63,
    "NUMPAD4": 0x64, "NUMPAD5": 0x65, "NUMPAD6": 0x66, "NUMPAD7": 0x67,
    "NUMPAD8": 0x68, "NUMPAD9": 0x69,
    "NUMPADMUL": 0x6A, "NUMPADADD": 0x6B, "NUMPADSUB": 0x6D,
    "NUMPADDEC": 0x6E, "NUMPADDIV": 0x6F,
}

# Printable punctuation -> VK.
_PUNCT_VK = {
    "`": 0xC0, "-": 0xBD, "=": 0xBB, "[": 0xDB, "]": 0xDD, "\\": 0xDC,
    ";": 0xBA, "'": 0xDE, ",": 0xBC, ".": 0xBE, "/": 0xBF,
}

# Display names for formatting (keyed by VK, canonical spelling).
_VK_DISPLAY = {
    0x08: "Backspace", 0x09: "Tab", 0x0D: "Enter", 0x1B: "Esc", 0x20: "Space",
    0x21: "PgUp", 0x22: "PgDn", 0x23: "End", 0x24: "Home",
    0x25: "Left", 0x26: "Up", 0x27: "Right", 0x28: "Down",
    0x2D: "Insert", 0x2E: "Delete",
}
for _i in range(10):
    _VK_DISPLAY[0x60 + _i] = f"Num{_i}"
for _sym, _vk in _PUNCT_VK.items():
    _VK_DISPLAY.setdefault(_vk, _sym)

_MODIFIER_NAMES = (
    (MOD_CONTROL, "Ctrl", ("CTRL", "CONTROL", "CTR")),
    (MOD_ALT, "Alt", ("ALT",)),
    (MOD_SHIFT, "Shift", ("SHIFT",)),
    (MOD_WIN, "Win", ("WIN", "META", "CMD", "SUPER", "WINDOWS")),
)


def key_token_to_vk(token: str) -> "int | None":
    """Resolve a single key token (e.g. "8", "A", "F9", "Space") to a VK code."""
    if not token:
        return None
    t = token.strip()
    if not t:
        return None
    upper = t.upper()
    if upper in _NAMED_VK:
        return _NAMED_VK[upper]
    if len(t) == 1:
        ch = t.upper()
        if ("A" <= ch <= "Z") or ("0" <= ch <= "9"):
            return ord(ch)
        if t in _PUNCT_VK:
            return _PUNCT_VK[t]
    if upper.startswith("F") and upper[1:].isdigit():
        n = int(upper[1:])
        if 1 <= n <= 24:
            return 0x70 + (n - 1)
    return None


def vk_to_token(vk: int) -> "str | None":
    if 0x30 <= vk <= 0x39 or 0x41 <= vk <= 0x5A:
        return chr(vk)
    if 0x70 <= vk <= 0x87:
        return f"F{vk - 0x70 + 1}"
    return _VK_DISPLAY.get(vk)


def format_hotkey(mods: int, vk: int) -> str:
    """Render (mods, vk) as e.g. "Ctrl+Alt+8". Returns "" if not renderable."""
    parts = [name for bit, name, _ in _MODIFIER_NAMES if mods & bit]
    key = vk_to_token(vk)
    if not parts or key is None:
        return ""
    parts.append(key)
    return "+".join(parts)


def parse_hotkey(text: str) -> "tuple[int, int] | None":
    """Parse "Ctrl+8" style text into (mods, vk).

    Requires at least one modifier and exactly one main key; returns None for
    anything Win32 RegisterHotKey cannot express.
    """
    if not isinstance(text, str):
        return None
    raw = text.strip()
    if not raw:
        return None
    tokens = [p.strip() for p in raw.replace("＋", "+").split("+") if p.strip()]
    mods = 0
    key_token = None
    for tok in tokens:
        upper = tok.upper()
        matched = False
        for bit, _name, aliases in _MODIFIER_NAMES:
            if upper in aliases:
                mods |= bit
                matched = True
                break
        if matched:
            continue
        if key_token is not None:
            return None  # more than one non-modifier key
        key_token = tok
    if key_token is None or mods == 0:
        return None
    vk = key_token_to_vk(key_token)
    if vk is None:
        return None
    return mods, vk


class GlobalHotkey(QObject):
    """Hook-free global hotkey backed by a worker message loop."""

    triggered = pyqtSignal()

    HOTKEY_ID = 0x4C45  # application-range id ('LE')

    def __init__(self, widget=None, on_trigger=None, parent=None):
        super().__init__(parent)
        # ``widget`` is accepted for API compatibility; a NULL-window hotkey is
        # used on the worker thread instead.
        self._widget = widget
        self._user32 = ctypes.windll.user32
        self._kernel32 = ctypes.windll.kernel32
        self._configure_api()

        self._registered = False
        self._mods = 0
        self._vk = 0
        self._text = ""

        self._thread = None
        self._thread_id = 0
        self._reg_event = threading.Event()
        self._reg_ok = False

        if on_trigger is not None:
            self.triggered.connect(on_trigger)

    def _configure_api(self):
        try:
            u = self._user32
            u.RegisterHotKey.argtypes = [
                wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT
            ]
            u.RegisterHotKey.restype = wintypes.BOOL
            u.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
            u.UnregisterHotKey.restype = wintypes.BOOL
            u.GetMessageW.argtypes = [
                ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.UINT
            ]
            u.GetMessageW.restype = ctypes.c_int
            u.PostThreadMessageW.argtypes = [
                wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
            ]
            u.PostThreadMessageW.restype = wintypes.BOOL
            self._kernel32.GetCurrentThreadId.restype = wintypes.DWORD
        except Exception as e:  # pragma: no cover - defensive
            log_error("GlobalHotkey: could not configure user32 API:", e)

    @property
    def text(self) -> str:
        return self._text

    @property
    def registered(self) -> bool:
        return self._registered

    def _worker(self, mods, vk):
        self._thread_id = self._kernel32.GetCurrentThreadId()
        try:
            ok = self._user32.RegisterHotKey(
                None, self.HOTKEY_ID, mods | MOD_NOREPEAT, vk
            )
        except Exception as e:  # pragma: no cover - defensive
            log_error("GlobalHotkey: RegisterHotKey raised:", e)
            ok = False
        self._reg_ok = bool(ok)
        self._reg_event.set()
        if not ok:
            return

        msg = _MSG()
        while True:
            ret = self._user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret == 0 or ret == -1:  # WM_QUIT or error
                break
            if msg.message == WM_HOTKEY and int(msg.wParam) == self.HOTKEY_ID:
                self.triggered.emit()
        self._user32.UnregisterHotKey(None, self.HOTKEY_ID)

    def set_hotkey(self, text: str) -> bool:
        """Register (or clear, when text is empty) the hotkey. Returns success."""
        self.unregister()
        self._text = ""
        if not text:
            log("GlobalHotkey: disabled (no shortcut)")
            return True

        parsed = parse_hotkey(text)
        if parsed is None:
            log_warn(
                f"GlobalHotkey: invalid combo '{text}' "
                "(need Ctrl/Alt/Shift/Win + one key)"
            )
            return False

        mods, vk = parsed
        self._reg_event = threading.Event()
        self._reg_ok = False
        self._thread = threading.Thread(
            target=self._worker, args=(mods, vk), daemon=True
        )
        self._thread.start()

        if not self._reg_event.wait(timeout=2.0):
            log_warn(f"GlobalHotkey: timed out registering '{text}'")
            self._thread = None
            return False
        if not self._reg_ok:
            log_warn(f"GlobalHotkey: RegisterHotKey failed for '{text}' (in use?)")
            self._thread.join(timeout=1.0)
            self._thread = None
            return False

        self._mods = mods
        self._vk = vk
        self._registered = True
        self._text = format_hotkey(mods, vk)
        log(f"GlobalHotkey: registered '{self._text}' (thread={self._thread_id})")
        return True

    def unregister(self):
        thread = self._thread
        if thread is not None and thread.is_alive():
            try:
                self._user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
            except Exception:
                pass
            thread.join(timeout=1.0)
        self._thread = None
        self._thread_id = 0
        self._registered = False

    def stop(self):
        self.unregister()
