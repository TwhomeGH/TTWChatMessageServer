import json
import os

SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "config", "tts_settings.json"
)


class TTSSettings:
    _instance: "TTSSettings | None" = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._data = cls._defaults()
        return cls._instance

    @staticmethod
    def _defaults():
        from config import (
            TTS_ENABLED, TTS_MIN_LENGTH, TTS_READ_MAIN_ONLY,
            TTS_READ_USER_NAME, TTS_MAX_LENGTH, TTS_READ_MIDDLE_NAME,
            TTS_INTERRUPT_CURRENT, TTS_MAX_QUEUE_SIZE, TTS_QUEUE_OVERFLOW_ACTION,
            TTS_LANGUAGE, TTS_VOICE_IDENTIFIER, TTS_RATE, TTS_PITCH, TTS_VOLUME
        )
        return {
            "tts_enabled": TTS_ENABLED,
            "tts_min_length": TTS_MIN_LENGTH,
            "tts_read_main_only": TTS_READ_MAIN_ONLY,
            "tts_read_user_name": TTS_READ_USER_NAME,
            "tts_max_length": TTS_MAX_LENGTH,
            "tts_read_middle_name": TTS_READ_MIDDLE_NAME,
            "tts_interrupt_current": TTS_INTERRUPT_CURRENT,
            "tts_max_queue_size": TTS_MAX_QUEUE_SIZE,
            "tts_queue_overflow_action": TTS_QUEUE_OVERFLOW_ACTION,
            "tts_language": TTS_LANGUAGE,
            "tts_voice_identifier": TTS_VOICE_IDENTIFIER,
            "tts_rate": TTS_RATE,
            "tts_pitch": TTS_PITCH,
            "tts_volume": TTS_VOLUME,
        }

    def load(self) -> dict:
        try:
            if os.path.exists(SETTINGS_PATH):
                with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    merged = self._defaults()
                    merged.update(data)
                    self._data = merged
                    return merged
        except Exception:
            pass
        return self._data

    def save(self, data: dict):
        merged = self._defaults()
        merged.update(data)
        self._data = merged
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)

    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def set(self, key: str, value):
        self._data[key] = value
        self.save(self._data)


tts_settings = TTSSettings()