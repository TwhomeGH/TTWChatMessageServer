from PyQt6.QtGui import QImage, QPainter, QFont
from PyQt6 import QtCore

from OpenGL.GL import *

from PyQt6.QtGui import QColor

class FontSystem:

    def __init__(self):
        self.cache = {}

    def get_text_texture(self, text, color=QColor("white")):
        # 如果 cache 要區分顏色，建議把顏色也加進 key
        cache_key = (text, color.name())
        if cache_key in self.cache:
            return self.cache[cache_key]

        img = QImage(512, 64, QImage.Format.Format_RGBA8888)
        img.fill(0)

        painter = QPainter(img)
        painter.setPen(color)   # 🔑 使用傳入的顏色
        painter.setFont(QFont("Microsoft JhengHei", 16))

        painter.drawText(
            img.rect(),
            QtCore.Qt.AlignmentFlag.AlignLeft | QtCore.Qt.AlignmentFlag.AlignVCenter,
            text
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
        return tex, w, h
