from PyQt6.QtGui import QImage, QPainter, QFont, QFontMetrics
from PyQt6 import QtCore

from OpenGL.GL import *

from PyQt6.QtGui import QColor

class FontSystem:

    MAX_CACHE_SIZE = 500

    def __init__(self):
        self.cache = {}
        self._cache_order = []

    def get_text_texture(self, text, color=QColor("white"), max_width=360, font_size=16, outline_color=None):
        padding = 10 if outline_color else 5
        cache_key = (text, color.name(), max_width, font_size,
                     outline_color.name() if outline_color else None)
        if cache_key in self.cache:
            self._cache_order.remove(cache_key)
            self._cache_order.append(cache_key)
            return self.cache[cache_key]

        font = QFont("Microsoft JhengHei", font_size)
        fm = QFontMetrics(font)

        is_multiline = "\n" in text
        text_width = fm.boundingRect(text).width() + 2

        if is_multiline or text_width > max_width:
            img_width = max_width + padding * 2
            rect = fm.boundingRect(0, 0, max_width, 10000,
                QtCore.Qt.TextFlag.TextWordWrap, text)
            img_height = rect.height() + padding * 2
            flags = QtCore.Qt.AlignmentFlag.AlignLeft | QtCore.Qt.AlignmentFlag.AlignTop | QtCore.Qt.TextFlag.TextWordWrap
        else:
            img_width = text_width + padding * 2
            img_height = fm.height() + padding * 2
            flags = QtCore.Qt.AlignmentFlag.AlignLeft | QtCore.Qt.AlignmentFlag.AlignVCenter

        img = QImage(img_width, img_height, QImage.Format.Format_RGBA8888)
        img.fill(0)

        painter = QPainter(img)
        painter.setFont(font)

        if outline_color:
            painter.setPen(outline_color)
            for dx, dy in ((-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)):
                painter.drawText(
                    padding + dx, padding + dy, img_width - padding * 2, img_height - padding * 2,
                    flags, text
                )

        painter.setPen(color)
        painter.drawText(
            padding, padding, img_width - padding * 2, img_height - padding * 2,
            flags, text
        )
        painter.end()

        w = img.width()
        h = img.height()

        ptr = img.bits()
        ptr.setsize(w * h * 4)
        data = ptr.asstring()

        tex = glGenTextures(1)
        glBindTexture(GL_TEXTURE_2D, tex)

        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0,
                    GL_RGBA, GL_UNSIGNED_BYTE, data)

        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)

        self.cache[cache_key] = (tex, w, h)
        self._cache_order.append(cache_key)
        if len(self._cache_order) > self.MAX_CACHE_SIZE:
            old_key = self._cache_order.pop(0)
            old_tex, _, _ = self.cache.pop(old_key)
            glDeleteTextures(old_tex)
        return tex, w, h
