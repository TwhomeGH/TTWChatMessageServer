import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from core.scene import ChatNode
from core.emoji_parser import parse_message


class TestChatNodeBasic:
    def test_simple_message(self):
        data = {"user": "test", "message": "hello"}
        n = ChatNode(data)
        assert n.user == "test"
        assert n.text == "hello"
        assert not n.has_emoji

    def test_with_emoji_url(self):
        data = {"user": "u", "message": "https://e.com/a.png"}
        n = ChatNode(data)
        assert n.has_emoji
        assert n.segments[0]["type"] == "image"

    def test_empty_message(self):
        n = ChatNode({"user": "u"})
        assert n.text == ""
        assert not n.has_emoji

    def test_default_values(self):
        n = ChatNode({})
        assert n.user == ""
        assert n.text == ""
        assert n.avatar_url is None
        assert n.gift_url is None

    def test_avatar_url(self):
        n = ChatNode({"img": "https://example.com/avatar.png"})
        assert n.avatar_url == "https://example.com/avatar.png"

    def test_gift_url(self):
        n = ChatNode({"giftImg": "https://example.com/gift.png"})
        assert n.gift_url == "https://example.com/gift.png"


class TestChatNodeLifetime:
    def test_initial_alive(self):
        n = ChatNode({})
        assert not n.dead
        assert n.alpha == 1.0

    def test_update_reduces_alpha_when_dead(self):
        n = ChatNode({})
        n.dead = True
        initial = n.alpha
        n.update()
        assert n.alpha < initial

    def test_alpha_stops_at_zero(self):
        n = ChatNode({})
        n.dead = True
        n.alpha = 0.02
        for _ in range(5):
            n.update()
        assert n.alpha == 0
