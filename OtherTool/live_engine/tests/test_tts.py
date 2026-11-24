from core.tts import tts_service


def test_use_tts_false_suppresses_stream_message(monkeypatch):
    spoken = []
    monkeypatch.setattr(tts_service, "is_enabled", True)
    monkeypatch.setattr(tts_service, "read_main_only", False)
    monkeypatch.setattr(tts_service, "_speak_async", lambda text: spoken.append(text))

    tts_service.speak_stream_message("u", "hello", True, False)
    assert spoken == []

    tts_service.speak_stream_message("u", "hello", True, True)
    assert len(spoken) == 1


def test_read_main_only_still_wins_over_explicit_use_tts(monkeypatch):
    spoken = []
    monkeypatch.setattr(tts_service, "is_enabled", True)
    monkeypatch.setattr(tts_service, "read_main_only", True)
    monkeypatch.setattr(tts_service, "_speak_async", lambda text: spoken.append(text))

    tts_service.speak_stream_message("u", "hello", False, True)
    assert spoken == []
