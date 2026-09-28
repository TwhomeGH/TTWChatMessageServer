import os
import hashlib
import threading
from collections import OrderedDict

import requests
from PyQt6.QtGui import QImage, QPainter, QPainterPath
from PyQt6.QtCore import QRectF, Qt
from OpenGL.GL import *

from core.debug_log import log_warn


EMOJI_DISK_CACHE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "cache", "emojis"
)

# Every GL texture (avatar / gift / emoji) shares one LRU budget so a long
# stream with thousands of unique viewers cannot grow VRAM without bound.
MAX_TEXTURES = 300
# Cap simultaneous downloads and per-frame texture uploads so a burst of new
# messages cannot spawn unbounded threads or stall a single paint frame.
MAX_FETCH_WORKERS = 4
MAX_UPLOADS_PER_FRAME = 4
REQUEST_TIMEOUT = 5
USER_AGENT = "Mozilla/5.0"


def _emoji_disk_path(url):
    h = hashlib.md5(url.encode()).hexdigest()
    return os.path.join(EMOJI_DISK_CACHE, f"{h}.png")


def qimage_to_bytes(img: QImage):
    w, h = img.width(), img.height()
    ptr = img.bits()
    try:
        return ptr.tobytes()
    except AttributeError:
        return ptr.asstring(w * h * 4)


def _fetch_bytes(url):
    """Blocking network fetch; only ever called on a worker thread."""
    res = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    if res.status_code != 200:
        raise ValueError(f"HTTP {res.status_code}")
    if "image" not in res.headers.get("Content-Type", ""):
        raise ValueError(f"not an image (Content-Type={res.headers.get('Content-Type')})")
    return res.content


def _decode(data):
    img = QImage.fromData(data)
    if img.isNull():
        return None
    return img.convertToFormat(QImage.Format.Format_RGBA8888)


def _scale(img, size):
    return img.scaled(
        size, size,
        Qt.AspectRatioMode.KeepAspectRatio,
        Qt.TransformationMode.SmoothTransformation,
    )


def _circular(src, size):
    side = min(src.width(), src.height())
    offset_x = (src.width() - side) // 2
    offset_y = (src.height() - side) // 2
    src = src.copy(offset_x, offset_y, side, side).scaled(size, size)

    circle = QImage(size, size, QImage.Format.Format_RGBA8888)
    circle.fill(0)
    painter = QPainter(circle)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    path = QPainterPath()
    path.addEllipse(QRectF(0, 0, size, size))
    painter.setClipPath(path)
    painter.drawImage(0, 0, src)
    painter.end()
    return circle


class TextureLoader:
    """Non-blocking URL/emoji -> GL texture cache.

    All network I/O and Qt decoding happens on daemon worker threads; the GL
    context only uploads already-decoded pixels in ``process_pending``. The
    ``load_*`` helpers never block the paint/UI thread and return ``None``
    until the texture is ready (a later frame picks it up automatically).

    Textures are LRU-evicted under a single ``MAX_TEXTURES`` budget so long
    streams cannot accumulate GPU memory indefinitely.
    """

    def __init__(self):
        self._textures = OrderedDict()   # cache key -> GL texture id
        self._lock = threading.Lock()
        self._inflight = set()           # keys currently fetching
        self._ready = OrderedDict()      # key -> decoded QImage awaiting upload
        self._failed = set()             # keys that gave up (never retried)
        self._fetch_slots = threading.Semaphore(MAX_FETCH_WORKERS)
        os.makedirs(EMOJI_DISK_CACHE, exist_ok=True)

    # ------------------------------------------------------------------
    # GL-thread cache helpers
    # ------------------------------------------------------------------
    def _cache_get(self, key):
        tex = self._textures.get(key)
        if tex is None:
            return None
        self._textures.move_to_end(key)
        return tex

    def _cache_put(self, key, tex):
        old = self._textures.pop(key, None)
        if old is not None:
            glDeleteTextures(int(old))
        self._textures[key] = tex
        while len(self._textures) > MAX_TEXTURES:
            _, old_tex = self._textures.popitem(last=False)
            glDeleteTextures(int(old_tex))

    # ------------------------------------------------------------------
    # Request scheduling (paint/UI thread -> worker thread)
    # ------------------------------------------------------------------
    def _request(self, key, url, kind, size=0):
        tex = self._cache_get(key)
        if tex is not None:
            return tex
        with self._lock:
            if key in self._inflight or key in self._failed:
                return None
            # Busy: skip this frame; a later paint retries once a slot frees up.
            if not self._fetch_slots.acquire(blocking=False):
                return None
            self._inflight.add(key)
        threading.Thread(
            target=self._fetch_worker, args=(key, url, kind, size), daemon=True
        ).start()
        return None

    def _fetch_worker(self, key, url, kind, size):
        image = None
        try:
            if kind == "emoji":
                image = self._load_emoji_image(url, size)
            else:
                image = _decode(_fetch_bytes(url))
                if image is not None and kind == "circular":
                    image = _circular(image, size)
        except Exception as error:
            log_warn(f"texture fetch failed ({kind}): {url[-60:]} -> {error}")
            image = None
        finally:
            with self._lock:
                self._inflight.discard(key)
                if image is None:
                    self._failed.add(key)
                else:
                    self._ready[key] = image
                    self._ready.move_to_end(key)
                    while len(self._ready) > MAX_TEXTURES:
                        self._ready.popitem(last=False)
            self._fetch_slots.release()

    def _load_emoji_image(self, url, size):
        disk_path = _emoji_disk_path(url)
        if os.path.exists(disk_path):
            img = QImage(disk_path)
            if not img.isNull():
                return _scale(img.convertToFormat(QImage.Format.Format_RGBA8888), size)
            try:
                os.remove(disk_path)
            except OSError:
                pass

        data = _fetch_bytes(url)
        img = _decode(data)
        if img is None:
            raise ValueError("QImage decode failed")
        try:
            os.makedirs(os.path.dirname(disk_path), exist_ok=True)
            with open(disk_path, "wb") as f:
                f.write(data)
        except OSError as error:
            log_warn(f"emoji disk cache write failed: {error}")
        return _scale(img, size)

    # ------------------------------------------------------------------
    # Public API (always called from the paint/UI thread)
    # ------------------------------------------------------------------
    def load_emoji(self, url, size=24):
        if not url:
            return None
        return self._request(f"emoji:{url}:{size}", url, "emoji", size)

    def preload_emoji(self, url, size=24):
        if not url:
            return
        self._request(f"emoji:{url}:{size}", url, "emoji", size)

    def load_url(self, url):
        if not url:
            return None
        return self._request(f"url:{url}", url, "plain")

    def load_url_circular(self, url, size):
        if not url:
            return None
        return self._request(f"circ:{url}:{size}", url, "circular", size)

    def process_pending(self):
        """Upload decoded images to GL textures. Must run on the GL thread."""
        with self._lock:
            if not self._ready:
                return
            # Bound uploads per frame; the rest carry over to the next frame.
            ready = [self._ready.popitem(last=False)
                     for _ in range(min(MAX_UPLOADS_PER_FRAME, len(self._ready)))]
        for key, img in ready:
            w, h = img.width(), img.height()
            if w <= 0 or h <= 0:
                continue
            data = qimage_to_bytes(img)

            glPixelStorei(GL_UNPACK_ALIGNMENT, 1)
            tex = glGenTextures(1)
            glBindTexture(GL_TEXTURE_2D, tex)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, data)

            self._cache_put(key, tex)

    def draw(self, tex, x, y, w, h):
        if tex is None:
            return

        glEnable(GL_TEXTURE_2D)
        glBindTexture(GL_TEXTURE_2D, tex)

        glColor4f(1, 1, 1, 1)

        glBegin(GL_QUADS)

        glTexCoord2f(0, 0); glVertex2f(x, y)
        glTexCoord2f(1, 0); glVertex2f(x + w, y)
        glTexCoord2f(1, 1); glVertex2f(x + w, y + h)
        glTexCoord2f(0, 1); glVertex2f(x, y + h)

        glEnd()

        glDisable(GL_TEXTURE_2D)
