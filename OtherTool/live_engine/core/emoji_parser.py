import re

INLINE_IMAGE_RE = re.compile(
    r'data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}',
    re.IGNORECASE
)

IMAGE_URL_RE = re.compile(
    r'(?:https?://[^\s]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?'
    # MediaCache 舊版或自訂路徑可能沒有副檔名；/media/<sha256> 仍是明確圖片。
    r'|https?://[^\s]+/media/[a-f0-9]{64}(?:\.[a-z0-9]+)?(?:\?[^\s]*)?'
    r'|data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2})',
    re.IGNORECASE
)


def display_image_url(url: str, tail: int = 40) -> str:
    """日誌用短字串；data URI 只印類型與長度，不寫入 base64。"""
    if isinstance(url, str) and url.lower().startswith('data:image/'):
        mime = url.split(';', 1)[0]
        return f"{mime};base64,<{len(url)} chars>"
    return (url or '')[-tail:]


def parse_message(text):
    if not text:
        return [{"type": "text", "content": ""}]

    segments = []
    last_end = 0
    for m in IMAGE_URL_RE.finditer(text):
        if m.start() > last_end:
            segments.append({"type": "text", "content": text[last_end:m.start()]})
        segments.append({"type": "image", "url": m.group()})
        last_end = m.end()
    if last_end < len(text):
        segments.append({"type": "text", "content": text[last_end:]})
    if not segments:
        segments.append({"type": "text", "content": text})
    return segments


def strip_image_urls(text):
    if not text:
        return text
    return IMAGE_URL_RE.sub("", text).strip()
