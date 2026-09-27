import os
import sys
from datetime import datetime

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "logs")
LOG_FILE = os.path.join(LOG_DIR, "live_engine.log")


def _ensure_log_dir():
    os.makedirs(LOG_DIR, exist_ok=True)


def log(*args, **kwargs):
    _ensure_log_dir()
    msg = " ".join(str(a) for a in args)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    line = f"[{timestamp}] {msg}"
    # Never let console encoding issues (e.g. cp950 vs emoji) raise: log() may
    # be called from Qt paint/native callbacks where an exception is fatal.
    try:
        print(line, **kwargs)
    except Exception:
        try:
            print(line.encode("ascii", "replace").decode("ascii"), **kwargs)
        except Exception:
            pass
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def log_error(*args, **kwargs):
    log("[ERROR]", *args, **kwargs)


def log_warn(*args, **kwargs):
    log("[WARN]", *args, **kwargs)


def log_debug(*args, **kwargs):
    log("[DEBUG]", *args, **kwargs)


def clear_log():
    _ensure_log_dir()
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write("")