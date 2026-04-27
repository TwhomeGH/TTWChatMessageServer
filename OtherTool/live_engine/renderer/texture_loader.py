import requests
from PyQt6.QtGui import QImage
from OpenGL.GL import *


def qimage_to_bytes(img: QImage):
    w, h = img.width(), img.height()
    ptr = img.bits()
    try:
        return ptr.tobytes()
    except AttributeError:
        return ptr.asstring(w * h * 4)


class TextureLoader:

    def __init__(self):
        self.cache = {}

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