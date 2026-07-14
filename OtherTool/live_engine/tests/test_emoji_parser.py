import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest

from core.emoji_parser import parse_message, strip_image_urls


class TestParseMessage:
    def test_plain_text(self):
        segs = parse_message("hello")
        assert len(segs) == 1
        assert segs[0]["type"] == "text"
        assert segs[0]["content"] == "hello"

    def test_empty(self):
        segs = parse_message("")
        assert len(segs) == 1
        assert segs[0]["type"] == "text"

    def test_none(self):
        segs = parse_message(None)
        assert len(segs) == 1
        assert segs[0]["type"] == "text"

    def test_single_image(self):
        url = "https://cdn.example.com/emoji.png"
        segs = parse_message(url)
        assert len(segs) == 1
        assert segs[0]["type"] == "image"
        assert segs[0]["url"] == url

    def test_text_before_image(self):
        segs = parse_message("look https://e.com/a.png")
        assert len(segs) == 2
        assert segs[0]["type"] == "text"
        assert segs[0]["content"] == "look "
        assert segs[1]["type"] == "image"

    def test_text_after_image(self):
        segs = parse_message("https://e.com/a.png nice")
        assert len(segs) == 2
        assert segs[0]["type"] == "image"
        assert segs[1]["type"] == "text"
        assert segs[1]["content"] == " nice"

    def test_multiple_images(self):
        segs = parse_message("https://e.com/a.png https://e.com/b.jpg hello")
        assert len(segs) == 4
        assert segs[0]["type"] == "image"
        assert segs[1]["type"] == "text"
        assert segs[2]["type"] == "image"
        assert segs[3]["type"] == "text"
        assert segs[3]["content"] == " hello"

    def test_image_extensions(self):
        for ext in ["png", "jpg", "jpeg", "gif", "webp"]:
            segs = parse_message(f"https://e.com/a.{ext}")
            assert len(segs) == 1
            assert segs[0]["type"] == "image"

    def test_image_with_query(self):
        url = "https://cdn.discordapp.com/test.png?ex=abc&hm=def"
        segs = parse_message(url)
        assert len(segs) == 1
        assert segs[0]["url"] == url

    def test_http_image(self):
        url = "http://e.com/a.png"
        segs = parse_message(url)
        assert segs[0]["type"] == "image"

    def test_mixed_content(self):
        segs = parse_message("a https://e.com/x.png b https://e.com/y.gif c")
        assert len(segs) == 5
        assert [s["type"] for s in segs] == ["text", "image", "text", "image", "text"]
        assert [s.get("content", "") for s in segs if s["type"] == "text"] == ["a ", " b ", " c"]


class TestStripImageUrls:
    def test_plain_text(self):
        assert strip_image_urls("hello") == "hello"

    def test_url_only(self):
        assert strip_image_urls("https://e.com/a.png") == ""

    def test_mixed(self):
        assert strip_image_urls("a https://e.com/a.png b") == "a  b"

    def test_no_url(self):
        assert strip_image_urls("just text") == "just text"
