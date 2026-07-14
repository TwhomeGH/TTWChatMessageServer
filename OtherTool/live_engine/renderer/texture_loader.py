import os
import hashlib
import requests
from PyQt6.QtGui import QImage, QPainter, QPainterPath
from PyQt6.QtCore import QRectF, Qt
from OpenGL.GL import *


EMOJI_DISK_CACHE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "cache", "emojis"
)


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


MAX_EMOJI_CACHE = 20


class TextureLoader:

    def __init__(self):
        self.cache = {}
        self._emoji_order = []
        self._pending_emojis = {}
        self._emoji_failed = set()
        os.makedirs(EMOJI_DISK_CACHE, exist_ok=True)

    def load_emoji(self, url, size=24):
        if not url:
            return None
        key = f"emoji:{url}:{size}"
        tex = self.cache.get(key)
        if tex is not None:
            self._emoji_order.remove(key)
            self._emoji_order.append(key)
        return tex

    def preload_emoji(self, url, size=24):
        if not url:
            return
        key = f"emoji:{url}:{size}"
        if key in self.cache or key in self._pending_emojis or key in self._emoji_failed:
            return

        disk_path = _emoji_disk_path(url)
        if os.path.exists(disk_path):
            img = QImage(disk_path)
            if not img.isNull():
                img = img.convertToFormat(QImage.Format.Format_RGBA8888)
                img = img.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
                self._pending_emojis[key] = img
                print(f"emoji disk cache hit: {url[-40:]}")
                return
            else:
                os.remove(disk_path)

        try:
            res = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
            if res.status_code != 200:
                self._emoji_failed.add(key)
                print(f"emoji fail cached: {res.status_code} {url[-40:]}")
                return
            os.makedirs(os.path.dirname(disk_path), exist_ok=True)
            with open(disk_path, "wb") as f:
                f.write(res.content)
            img = QImage.fromData(res.content)
            if img.isNull():
                self._emoji_failed.add(key)
                os.remove(disk_path)
                print(f"emoji QImage null, removed: {url[-40:]}")
                return
            img = img.convertToFormat(QImage.Format.Format_RGBA8888)
            img = img.scaled(size, size, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            self._pending_emojis[key] = img
        except Exception as e:
            self._emoji_failed.add(key)
            print("emoji preload error:", e)

    def process_pending(self):
        if not self._pending_emojis:
            return
        for key, img in list(self._pending_emojis.items()):
            w, h = img.width(), img.height()
            data = qimage_to_bytes(img)

            glPixelStorei(GL_UNPACK_ALIGNMENT, 1)
            tex = glGenTextures(1)
            glBindTexture(GL_TEXTURE_2D, tex)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, data)

            self.cache[key] = tex
            self._emoji_order.append(key)
            del self._pending_emojis[key]
            print(f"emoji texture created: {key}")

            if len(self._emoji_order) > MAX_EMOJI_CACHE:
                old_key = self._emoji_order.pop(0)
                old_tex = self.cache.pop(old_key)
                glDeleteTextures(old_tex)

    def load_url(self, url):
        if not url:
            return None
        
        if url in self.cache:
            return self.cache[url]

        try:
            res = requests.get(url, headers={
                "User-Agent": "Mozilla/5.0"
            }, timeout=5)

            if "image" not in res.headers.get("Content-Type", ""):
                print("❌ not image:", res.url)
                return None

            img = QImage.fromData(res.content)

            print("status:", res.status_code)
            print("content-type:", res.headers.get("Content-Type"))
            print("size:", len(res.content))
            print("isNull:", img.isNull())

            if img.isNull():
                print("❌ QImage failed:", url)
                return None

            # PyQt6: 直接轉成 RGBA8888
            img = img.convertToFormat(QImage.Format.Format_RGBA8888)

            w, h = img.width(), img.height()

            data = qimage_to_bytes(img)

            glPixelStorei(GL_UNPACK_ALIGNMENT, 1)

            tex = glGenTextures(1)
            glBindTexture(GL_TEXTURE_2D, tex)

            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)

            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0,
                         GL_RGBA, GL_UNSIGNED_BYTE, data)

            self.cache[url] = tex
            return tex

        except Exception as e:
            print("texture error:", e)
            return None

    def load_url_circular(self, url, size):
        if not url:
            return None

        cache_key = f"circ:{url}:{size}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        try:
            res = requests.get(url, headers={
                "User-Agent": "Mozilla/5.0"
            }, timeout=5)

            if "image" not in res.headers.get("Content-Type", ""):
                print("❌ not image:", res.url)
                return None

            src = QImage.fromData(res.content)
            if src.isNull():
                print("❌ QImage failed:", url)
                return None

            src = src.convertToFormat(QImage.Format.Format_RGBA8888)

            # square crop from center
            side = min(src.width(), src.height())
            offset_x = (src.width() - side) // 2
            offset_y = (src.height() - side) // 2
            src = src.copy(offset_x, offset_y, side, side)

            # scale to target size
            src = src.scaled(size, size)

            # paint circle mask onto a transparent RGBA image
            circle = QImage(size, size, QImage.Format.Format_RGBA8888)
            circle.fill(0)  # transparent

            painter = QPainter(circle)
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            path = QPainterPath()
            path.addEllipse(QRectF(0, 0, size, size))
            painter.setClipPath(path)
            painter.drawImage(0, 0, src)
            painter.end()

            data = qimage_to_bytes(circle)

            glPixelStorei(GL_UNPACK_ALIGNMENT, 1)

            tex = glGenTextures(1)
            glBindTexture(GL_TEXTURE_2D, tex)

            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)

            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, size, size, 0,
                         GL_RGBA, GL_UNSIGNED_BYTE, data)

            self.cache[cache_key] = tex
            return tex

        except Exception as e:
            print("texture_loader circular error:", e)
            return None

    def draw(self, tex, x, y, w, h):


        if tex is None:
            return
        
        #print("draw tex:", tex, "at", x, y, w, h)


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