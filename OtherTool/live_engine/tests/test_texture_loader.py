import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest

from renderer.texture_loader import inline_data_bytes


def test_inline_data_uri_decodes_locally():
    raw = b"fake-png-bytes"
    url = "data:image/png;base64," + base64.b64encode(raw).decode()
    assert inline_data_bytes(url) == raw


def test_inline_data_uri_rejects_svg_and_oversize():
    with pytest.raises(ValueError):
        inline_data_bytes("data:image/svg+xml;base64,AAAA")
    huge = "data:image/png;base64," + "A" * (260 * 1024)
    with pytest.raises(ValueError):
        inline_data_bytes(huge)
