from PyQt6.QtGui import QImage, QPainter, QFont, QFontMetrics
from PyQt6 import QtCore

from OpenGL.GL import *

from PyQt6.QtGui import QColor

class FontSystem:

    def __init__(self):
        self.cache = {}

    def get_text_texture(self, text, color=QColor("white"), max_width=360, font_size=16):
        cache_key = (text, color.name(), max_width, font_size)
        if cache_key in self.cache:
            return self.cache[cache_key]

        font = QFont("Microsoft JhengHei", font_size)
        fm = QFontMetrics(font)

        text_width = fm.boundingRect(text).width()

        if text_width <= max_width:
            img_width = text_width + 10
            img_height = fm.height() + 10
            flags = QtCore.Qt.AlignmentFlag.AlignLeft | QtCore.Qt.AlignmentFlag.AlignVCenter
        else:
            img_width = max_width + 10
            rect = fm.boundingRect(0, 0, max_width, 10000, 
                QtCore.Qt.TextFlag.TextWordWrap, text)
            img_height = rect.height() + 10
            flags = QtCore.Qt.AlignmentFlag.AlignLeft | QtCore.Qt.AlignmentFlag.AlignTop | QtCore.Qt.TextFlag.TextWordWrap

        img = QImage(img_width, img_height, QImage.Format.Format_RGBA8888)
        img.fill(0)

        painter = QPainter(img)
        painter.setPen(color)
        painter.setFont(font)

        painter.drawText(
            5, 5, max_width, img_height - 10,
            flags,
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
