import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest
import tempfile
import json

from core.speech_filter import SpeechFilterManager


@pytest.fixture
def fresh_filter():
    mgr = SpeechFilterManager()
    mgr.block_keywords = []
    mgr.replace_keywords = {}
    mgr.remove_urls = True
    mgr.remove_emoji = True
    mgr.remove_pure_numbers = False
    return mgr


class TestProcessMessage:
    def test_plain_text(self, fresh_filter):
        assert fresh_filter.process_message("hello") == "hello"

    def test_remove_url(self, fresh_filter):
        assert fresh_filter.process_message("see https://example.com/img.png") == "see"

    def test_remove_emoji(self, fresh_filter):
        result = fresh_filter.process_message("hi \U0001F600")
        assert result == "hi"

    def test_keep_url_when_disabled(self, fresh_filter):
        fresh_filter.remove_urls = False
        msg = "see https://example.com/img.png"
        assert fresh_filter.process_message(msg) == msg

    def test_block_keyword(self, fresh_filter):
        fresh_filter.block_keywords = ["bad"]
        assert fresh_filter.process_message("that is bad word") == "that is  word"

    def test_replace_keyword(self, fresh_filter):
        fresh_filter.replace_keywords = {"bad": "good"}
        assert fresh_filter.process_message("this is bad") == "this is good"

    def test_block_before_replace(self, fresh_filter):
        fresh_filter.block_keywords = ["remove"]
        fresh_filter.replace_keywords = {"test": "passed"}
        result = fresh_filter.process_message("remove this test")
        assert "remove" not in result
        assert "passed" in result

    def test_remove_pure_numbers(self, fresh_filter):
        fresh_filter.remove_pure_numbers = True
        assert fresh_filter.process_message("hello 123 world") == "hello  world"

    def test_non_string_input(self, fresh_filter):
        assert fresh_filter.process_message(None) == ""
        assert fresh_filter.process_message(123) == ""

    def test_empty_string(self, fresh_filter):
        assert fresh_filter.process_message("") == ""

    def test_multiple_replacements(self, fresh_filter):
        fresh_filter.replace_keywords = {"a": "x", "b": "y"}
        assert fresh_filter.process_message("a b c") == "x y c"

    def test_emoji_pattern(self, fresh_filter):
        result = fresh_filter.process_message("test\u2600more")
        assert result == "testmore"

    def test_url_pattern_edge(self, fresh_filter):
        assert fresh_filter.process_message("check http://localhost:8080/path") == "check"

    def test_strip_result(self, fresh_filter):
        assert fresh_filter.process_message("  hello  ") == "hello"
