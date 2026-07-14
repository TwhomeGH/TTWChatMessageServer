import re

IMAGE_URL_RE = re.compile(
    r'https?://[^\s]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?',
    re.IGNORECASE
)


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
    return IMAGE_URL_RE.sub("", text).strip()
