import threading
from core.debug_log import log, log_error, log_debug


class GlobalHotkey:
    def __init__(self, on_trigger):
        self.on_trigger = on_trigger
        self._r_pressed = False
        self._listener = None
        self._hook_id = None
        self._initialized = False

        self._try_pynput()

    def _try_pynput(self):
        try:
            from pynput import keyboard

            def on_press(key):
                try:
                    k = key.char.lower() if hasattr(key, "char") and key.char else None
                except Exception:
                    k = None

                if k == "r":
                    self._r_pressed = True
                    log_debug("GlobalHotkey: R pressed (awaiting 8)")
                elif k == "8" and self._r_pressed:
                    self._r_pressed = False
                    log("GlobalHotkey: R+8 sequence detected!")
                    self.on_trigger()
                else:
                    if self._r_pressed:
                        log_debug(f"GlobalHotkey: R was active, cancelled by {k}")
                    self._r_pressed = False

            self._listener = keyboard.Listener(on_press=on_press)
            self._listener.daemon = True
            self._listener.start()
            self._initialized = True
            log("GlobalHotkey: pynput listener started (R+8)")
        except ImportError:
            log_error("GlobalHotkey: pynput not installed. Run: pip install pynput")
        except Exception as e:
            log_error("GlobalHotkey: failed to start pynput listener:", e)

    def stop(self):
        if self._listener and self._listener.running:
            self._listener.stop()
            log("GlobalHotkey: listener stopped")