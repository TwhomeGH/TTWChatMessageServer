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

    return center_y + (fm.ascent() - fm.descent()) // 2

def get_text_width(text, size=16):
    font = QFont("Microsoft JhengHei", size)
    fm = QFontMetrics(font)
    return fm.boundingRect(text).width()


import os
import sys
import subprocess

base_dir = os.path.dirname(os.path.abspath(__file__))


from PyQt6.QtGui import QColor

from PyQt6 import QtCore, QtWidgets

from core.debug_log import log, log_error
from core.hotkey import GlobalHotkey


def _open_settings():
    log("Global hotkey triggered: opening TTS settings GUI")
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "gui.tts_settings_window"],
            cwd=os.path.join(base_dir, "..")
        )
        log("TTS settings GUI launched, PID:", proc.pid)
    except Exception as e:
        log_error("Failed to launch TTS settings GUI:", e)


class Overlay(QOpenGLWidget):

    def __init__(self):
        super().__init__()


        fmt = QtGui.QSurfaceFormat()
        fmt.setAlphaBufferSize(8)
        self.setFormat(fmt)



        self.setContentsMargins(0, 0, 0, 0)
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_NoSystemBackground)

        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_TranslucentBackground)   
        
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_TransparentForMouseEvents)

        self.setWindowFlags(
            QtCore.Qt.WindowType.FramelessWindowHint |
            QtCore.Qt.WindowType.WindowStaysOnTopHint |
            QtCore.Qt.WindowType.Tool
        )


        screen = QtWidgets.QApplication.primaryScreen()
        screen_geometry = screen.geometry()
        screen_width = screen_geometry.width()
        screen_height = screen_geometry.height()

        win_w = config.WIDTH
        win_h = config.HEIGHT

        print("Screen:", screen_width, screen_height)
        print("Window:", win_w, win_h)
        
        x = screen_width - int(win_w*2 - 20)
        y = 50

        self.setGeometry(x, y, win_w, win_h)



        self.engine = Engine(widget=self)
        self.renderer = GLRenderer()

        self.texture_loader = TextureLoader()

        self.font_system = FontSystem()

        self.timer = QTimer()
        self.timer.timeout.connect(self.loop)
        self.timer.start(int(1000 / config.FPS))

        self._setup_global_hotkey()

    def _setup_global_hotkey(self):
        self._hotkey = GlobalHotkey(on_trigger=_open_settings)

    
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
            box_x, box_y, box_w, box_h = 20, int(n.y), 360, 80   # 增加高度容納換行

            # =====================
            # avatar + username (第一行)
            # =====================
            avatar_size = 28
            avatar_tex = self.texture_loader.load_url(n.avatar_url)

            avatar_x = box_x + 6
            avatar_y = box_y + 6   # 第一行靠上

            if avatar_tex:
                self.texture_loader.draw(avatar_tex, avatar_x, avatar_y, avatar_size, avatar_size)

            username_tex, uw, uh = self.font_system.get_text_texture(n.user, QColor(0, 128, 255), max_width=config.USERNAME_MAX_WIDTH)
            username_x = avatar_x + avatar_size + 8
            username_y = avatar_y + (avatar_size - uh) // 2   # 與頭像垂直置中

            self.texture_loader.draw(username_tex, username_x, username_y, uw, uh)

            # =====================
            # message + gift (第二行) - 緊貼 username 下方
            # =====================
            message_tex, mw, mh = self.font_system.get_text_texture(n.text, QColor("white"), max_width=config.MESSAGE_MAX_WIDTH)

            message_x = username_x  # 與 username 對齊
            message_y = username_y + uh + 4  # 緊貼 username 下方

            self.texture_loader.draw(message_tex, message_x, message_y, mw, mh)

            gift_size = 28
            gift_tex = self.texture_loader.load_url(n.gift_url)

            if gift_tex:
                gift_x = box_x + box_w - gift_size - 6
                gift_y = message_y + (mh - gift_size) // 2   # 與訊息垂直置中

                self.texture_loader.draw(gift_tex, gift_x, gift_y, gift_size, gift_size)




