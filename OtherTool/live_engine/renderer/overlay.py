from PyQt6 import QtGui
from PyQt6.QtOpenGLWidgets import QOpenGLWidget
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QFontMetrics, QFont

from OpenGL.GL import *

from renderer.font_system import FontSystem
from renderer.shader import ShaderProgram
from renderer.gl_renderer import GLRenderer

from renderer.texture_loader import TextureLoader

from core.engine import Engine
import config



from PyQt5.QtGui import QFontMetrics, QFont


def get_text_baseline_y(center_y):
    font = QFont("Microsoft JhengHei", 16)
    fm = QFontMetrics(font)

    # 👉 讓文字「視覺中心對齊」
    return center_y + (fm.ascent() - fm.descent()) // 2

def get_text_width(text, size=16):
    font = QFont("Microsoft JhengHei", size)
    fm = QFontMetrics(font)
    return fm.boundingRect(text).width()


import os

# 取得當前執行檔案所在的目錄
base_dir = os.path.dirname(os.path.abspath(__file__))


from PyQt6.QtGui import QColor

from PyQt6 import QtCore, QtWidgets

class Overlay(QOpenGLWidget):

    def __init__(self):
        super().__init__()


        fmt = QtGui.QSurfaceFormat()
        fmt.setAlphaBufferSize(8)   # 🔑 要有 alpha buffer
        self.setFormat(fmt)



        # 新版 PyQt6 寫法：
        self.setContentsMargins(0, 0, 0, 0)
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_NoSystemBackground)

        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_TranslucentBackground)   
        
        # 允許滑鼠事件穿透
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_TransparentForMouseEvents)

        # 新版 PyQt6 寫法：
        self.setWindowFlags(
            QtCore.Qt.WindowType.FramelessWindowHint |
            QtCore.Qt.WindowType.WindowStaysOnTopHint |
            QtCore.Qt.WindowType.Tool
        )


        screen = QtWidgets.QApplication.primaryScreen()
        screen_geometry = screen.geometry()
        screen_width = screen_geometry.width()
        screen_height = screen_geometry.height()

        # 視窗大小
        win_w = config.WIDTH
        win_h = config.HEIGHT

        # 計算靠右位置
        x = screen_width - win_w - 20   # 右邊留 20px margin
        y = 100                        # 距離上方 100px

        self.setGeometry(x, y, win_w, win_h)



        self.engine = Engine(widget=self)
        self.renderer = GLRenderer()

        self.texture_loader = TextureLoader()

        self.font_system = FontSystem()

        self.timer = QTimer()
        self.timer.timeout.connect(self.loop)
        self.timer.start(int(1000 / config.FPS))


    
    def initializeGL(self):
        print("🔥 initializeGL triggered")

        
        glViewport(0, 0, self.width(), self.height())

        # =====================
        # 🔥 固定 2D 座標系（一定要穩）
        # =====================
        glMatrixMode(GL_PROJECTION)

        glLoadIdentity()


        # ✔ y 向下（UI常用）
        glOrtho(0, self.width(), self.height(), 0, -1, 1)

        glMatrixMode(GL_MODELVIEW)
        glLoadIdentity()

        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)

        # 🔑 關鍵：不要留背景顏色
        glClearColor(0.0, 0.0, 0.0, 0.0)

        # 拼接路徑
        sdf_vert_path = os.path.join(base_dir,"..", "shaders", "sdf_font.vert")
        # 轉成絕對路徑，避免相對路徑混淆
        sdf_vert_path = os.path.abspath(sdf_vert_path)

        sdf_frag_path = os.path.join(base_dir,"..", "shaders", "sdf_font.frag")

        sdf_frag_path = os.path.abspath(sdf_frag_path)

        print("VERT",sdf_frag_path)
        print("FRAG",sdf_vert_path)


        # shader
        with open(sdf_vert_path ) as f:
            vert = f.read()

        with open(sdf_frag_path) as f:
            frag = f.read()

        self.font_shader = ShaderProgram(vert, frag)

        self.font_texture = 1




    # =====================
    def loop(self):
        self.engine.update()
        self.update()

    # =====================
    # 畫面處理
    # =====================
    def paintGL(self):
        

        # =====================
        # ✔ 真正透明背景
        # =====================

        # 🔑 全透明清除
        glClearColor(0.0, 0.0, 0.0, 0.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)



        # =====================
        # ✔ projection 不動（你已在 init 設好）
        # =====================
        glMatrixMode(GL_MODELVIEW)
        glLoadIdentity()

        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)

        # =====================
        # UI layer
        # =====================
        self.renderer.begin()




        # =====================
        # 主要 render_text
        # =====================
        self.render_text()




    
    # =====================
    # 🔥 SDF TEXT RENDER
    # =====================
    def render_text(self):
        
        for n in self.engine.nodes:
            # 統一 box 定義
            box_x, box_y, box_w, box_h = 20, int(n.y), 360, 56   # 高度加大，容納兩行

            # =====================
            # avatar + username (第一行)
            # =====================
            avatar_size = 28
            avatar_tex = self.texture_loader.load_url(n.avatar_url)

            avatar_x = box_x + 6
            avatar_y = box_y + 6   # 第一行靠上

            if avatar_tex:
                self.texture_loader.draw(avatar_tex, avatar_x, avatar_y, avatar_size, avatar_size)

            username_tex, uw, uh = self.font_system.get_text_texture(n.user, QColor(0, 128, 255))
            username_x = avatar_x + avatar_size + 6
            username_y = avatar_y + (avatar_size - uh) // 2   # 與頭像垂直置中

            self.texture_loader.draw(username_tex, username_x, username_y, uw, uh)

            # =====================
            # message + gift (第二行)
            # =====================
            message_tex, mw, mh = self.font_system.get_text_texture(n.text, QColor("white"))

            message_x = box_x + 6
            message_y = box_y + 12   # 第二行靠下，避免重疊

            self.texture_loader.draw(message_tex, message_x, message_y, mw, mh)

            gift_size = 28
            gift_tex = self.texture_loader.load_url(n.gift_url)

            if gift_tex:
                gift_x = box_x + box_w - gift_size - 6
                gift_y = message_y + (mh - gift_size) // 2   # 與訊息垂直置中

                self.texture_loader.draw(gift_tex, gift_x, gift_y, gift_size, gift_size)




