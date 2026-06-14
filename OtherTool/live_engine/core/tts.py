import asyncio
import tempfile
import threading
import os
from enum import IntEnum
from typing import Optional
import pygame
import edge_tts
from core.speech_filter import filter_manager
from gui.settings_manager import tts_settings


class TTSQueueOverflowAction(IntEnum):
    SKIP_NEW = 0
    STOP_OLD = 1
    CLEAR_ALL = 2


class TTSService:
    _instance: Optional["TTSService"] = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self.is_enabled: bool = False
        self.min_len: int = 3
        self.read_main_only: bool = True
        self.include_user: bool = True
        self.max_len: int = 0
        self.read_middle_name: str = "說"

        self.interrupt_current: bool = True
        self.max_queue_size: int = 0
        self.queue_overflow_action: TTSQueueOverflowAction = TTSQueueOverflowAction.SKIP_NEW
        self._pending_count: int = 0
        self._queue_lock = threading.Lock()

        self.language: str = "zh-TW"
        self.voice_identifier: str = ""
        self.rate: float = 0.0
        self.pitch: float = 0.0
        self.volume: float = 0.0

        self._temp_dir = tempfile.gettempdir()
        pygame.mixer.init()

    def update_default(self):
        cfg = tts_settings.load()
        self.is_enabled = cfg.get("tts_enabled", False)
        self.min_len = cfg.get("tts_min_length", 3)
        self.read_main_only = cfg.get("tts_read_main_only", True)
        self.include_user = cfg.get("tts_read_user_name", True)
        self.max_len = cfg.get("tts_max_length", 0)
        self.read_middle_name = cfg.get("tts_read_middle_name", "說")
        self.interrupt_current = cfg.get("tts_interrupt_current", True)
        self.max_queue_size = max(0, cfg.get("tts_max_queue_size", 0))
        self.queue_overflow_action = TTSQueueOverflowAction(cfg.get("tts_queue_overflow_action", 0))
        self.language = cfg.get("tts_language", "") or "zh-TW"
        self.voice_identifier = cfg.get("tts_voice_identifier", "")
        self.rate = cfg.get("tts_rate", 0.0)
        self.pitch = cfg.get("tts_pitch", 0.0)
        self.volume = cfg.get("tts_volume", 0.0)

    def speak_stream_message(
        self,
        user: str,
        message: str,
        is_main: bool = True
    ):
        if not self.is_enabled:
            return

        filtered = filter_manager.process_message(message)

        if len(filtered) < self.min_len:
            return

        if self.read_main_only and not is_main:
            return

        trimmed = filtered.strip()
        if not trimmed:
            return

        max_length = self.max_len if self.max_len > 0 else 120

        text_parts = []
        if self.include_user and user:
            text_parts.append(user)
        if self.read_middle_name:
            text_parts.append(self.read_middle_name)
        text_parts.append(trimmed)

        text = " ".join(text_parts)

        if len(text) > max_length:
            text = text[:max_length]

        self._speak_async(text)

    def _speak_async(self, text: str):
        if not text:
            return

        def run():
            with self._queue_lock:
                if self.max_queue_size > 0 and self._pending_count >= self.max_queue_size:
                    if self.queue_overflow_action == TTSQueueOverflowAction.SKIP_NEW:
                        print(f"[TTS] Queue full ({self._pending_count}/{self.max_queue_size}), skipping")
                        return
                    elif self.queue_overflow_action == TTSQueueOverflowAction.STOP_OLD:
                        print(f"[TTS] Queue full ({self._pending_count}/{self.max_queue_size}), stopping old, playing new")
                        pygame.mixer.music.stop()
                    elif self.queue_overflow_action == TTSQueueOverflowAction.CLEAR_ALL:
                        print(f"[TTS] Queue full ({self._pending_count}/{self.max_queue_size}), clearing all")
                        self.stop()
                        self._pending_count = 0

                if self.interrupt_current and pygame.mixer.music.get_busy():
                    pygame.mixer.music.stop()

                self._pending_count += 1

            asyncio.run(self._synthesize_and_play(text))

            with self._queue_lock:
                self._pending_count = max(0, self._pending_count - 1)

        threading.Thread(target=run, daemon=True).start()

    async def _synthesize_and_play(self, text: str):
        voice = self.voice_identifier if self.voice_identifier else None
        if not voice:
            voice = "zh-TW-HsiaoChenNeural" if self.language == "zh-TW" else "zh-CN-XiaoxiaoNeural"

        rate_str = f"{self.rate:+.0f}%" if self.rate != 0 else "+0%"
        volume_str = f"{self.volume:+.0f}%" if self.volume != 0 else "+0%"

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False, dir=self._temp_dir) as f:
            temp_path = f.name

        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate_str, volume=volume_str)
            await communicate.save(temp_path)

            pygame.mixer.music.load(temp_path)
            pygame.mixer.music.play()

            while pygame.mixer.music.get_busy():
                await asyncio.sleep(0.1)
        finally:
            try:
                os.unlink(temp_path)
            except Exception:
                pass

    def speak_preview(self):
        self._speak_async("這是一段系統朗讀測試。")

    def stop(self):
        if pygame.mixer.music.get_busy():
            pygame.mixer.music.stop()
        with self._queue_lock:
            self._pending_count = 0


tts_service = TTSService()