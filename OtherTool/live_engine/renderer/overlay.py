import ctypes

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


from PyQt6.QtGui import QColor, QPainter, QPen

from PyQt6 import QtCore, QtWidgets
from PyQt6.QtCore import QPoint

from core.debug_log import log, log_error
from core.hotkey import GlobalHotkey

from gui.overlay_settings import load_overlay_config, save_overlay_config


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
        self._inline_font_size = self.INLINE_FONT_SIZE
        self.setObjectName("Overlay")

        fmt = QtGui.QSurfaceFormat()
        fmt.setAlphaBufferSize(8)
        self.setFormat(fmt)



        self.setContentsMargins(0, 0, 0, 0)
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_NoSystemBackground)

        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_TranslucentBackground)   
        
        self.setWindowFlags(
            QtCore.Qt.WindowType.FramelessWindowHint |
            QtCore.Qt.WindowType.WindowStaysOnTopHint |
            QtCore.Qt.WindowType.Tool
        )

        self._drag_mode = False
        self._drag_start_pos = QPoint(0, 0)
        self._drag_window_start = QPoint(0, 0)

        self.engine = Engine(widget=self)
        self.renderer = GLRenderer()

        self.texture_loader = TextureLoader()

        self.font_system = FontSystem()

        self._load_position_and_size()

        self.timer = QTimer()
        self.timer.timeout.connect(self.loop)
        self.timer.start(int(1000 / config.FPS))

        self._setup_global_hotkey()

    def _setup_global_hotkey(self):
        self._hotkey = GlobalHotkey(on_trigger=_open_settings)

    def _load_position_and_size(self):
        cfg = load_overlay_config()
        win_w = cfg.get("width", config.WIDTH)
        win_h = cfg.get("height", config.HEIGHT)
        self._inline_font_size = cfg.get("font_size", self.INLINE_FONT_SIZE)
        self.set_font_face(cfg.get("font_face", "Microsoft JhengHei"))
        self._content_gap = cfg.get("content_gap", 2)
        if self.engine:
            self.engine.set_node_spacing(cfg.get("spacing", 8))
            self.engine.set_content_gap(cfg.get("content_gap", 2))
            self.engine.set_message_ttl(cfg.get("message_ttl", 15))
            self.engine.set_fade_speed(cfg.get("fade_speed", 2))
        screen = QtWidgets.QApplication.primaryScreen()
        screen_geometry = screen.geometry()
        screen_width = screen_geometry.width()
        x = cfg.get("x", -1)
        y = cfg.get("y", 50)
        if x < 0:
            x = screen_width - int(win_w * 2 - 20)
        self.setGeometry(x, y, win_w, win_h)
        log(f"Overlay positioned at ({x}, {y}), size ({win_w}x{win_h})")

    def resize_overlay(self, w, h):
        self.setFixedSize(w, h)
        self.engine.update()
        log(f"Overlay resized to {w}x{h}")

    def start_drag_mode(self):
        self._drag_mode = True
        self.setMouseTracking(True)
        self.setCursor(QtCore.Qt.CursorShape.OpenHandCursor)
        self._apply_click_through(False)
        log("Drag mode started")

    def stop_drag_mode(self):
        self._drag_mode = False
        self.setMouseTracking(False)
        self.setCursor(QtCore.Qt.CursorShape.ArrowCursor)
        self._apply_click_through(True)
        log("Drag mode stopped")

    def _apply_click_through(self, enabled):
        try:
            hwnd = int(self.winId())
            GWL_EXSTYLE = -20
            WS_EX_TRANSPARENT = 0x00000020
            current = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            if enabled:
                new_style = current | WS_EX_TRANSPARENT
            else:
                new_style = current & ~WS_EX_TRANSPARENT
            ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_style)
        except Exception:
            pass

    def showEvent(self, event):
        super().showEvent(event)
        if not self._drag_mode:
            self._apply_click_through(True)

    def mousePressEvent(self, event):
        if self._drag_mode and event.button() == QtCore.Qt.MouseButton.LeftButton:
            self._drag_start_pos = event.globalPosition().toPoint()
            self._drag_window_start = self.pos()
            self.setCursor(QtCore.Qt.CursorShape.ClosedHandCursor)
            event.accept()

    def mouseMoveEvent(self, event):
        if self._drag_mode and event.buttons() & QtCore.Qt.MouseButton.LeftButton:
            delta = event.globalPosition().toPoint() - self._drag_start_pos
            new_pos = self._drag_window_start + delta
            self.move(new_pos)
            event.accept()

    def mouseReleaseEvent(self, event):
        if self._drag_mode and event.button() == QtCore.Qt.MouseButton.LeftButton:
            self.setCursor(QtCore.Qt.CursorShape.OpenHandCursor)
            event.accept()

    
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




    HEADER_FONT_SIZE = 14
    INLINE_FONT_SIZE = 15

    def loop(self):
        self.engine.update()
        self.update()

    def paintGL(self):
        glClearColor(0.0, 0.0, 0.0, 0.0)
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

        glMatrixMode(GL_MODELVIEW)
        glLoadIdentity()

        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)

        if self._drag_mode:
            glColor4f(0.0, 0.5, 1.0, 0.6)
            glLineWidth(3)
            glBegin(GL_LINE_LOOP)
            glVertex2f(1, 1)
            glVertex2f(self.width() - 1, 1)
            glVertex2f(self.width() - 1, self.height() - 1)
            glVertex2f(1, self.height() - 1)
            glEnd()

        self.renderer.begin()

        self.texture_loader.process_pending()
        self._render_header()
        self._render_chat_nodes()

    def _render_header(self):
        engine = self.engine
        parts = []
        if engine.stream_active or engine._stream_elapsed_at_pause > 0:
            parts.append(f"\u23f1 {engine.get_elapsed_str()}")
        if engine.viewer_count > 0:
            parts.append(f"\U0001f441 {engine.viewer_count}")
        if not parts:
            return
        text = "  ".join(parts)
        tex, w, h = self.font_system.get_text_texture(
            text, QColor(255, 255, 255), max_width=self.width() - 20,
            font_size=self.HEADER_FONT_SIZE, outline_color=QColor("black")
        )
        bg_x = 8
        bg_y = 4
        bg_w = w + 4
        bg_h = h + 4
        glColor4f(0, 0, 0, 0.55)
        glBegin(GL_QUADS)
        glVertex2f(bg_x, bg_y)
        glVertex2f(bg_x + bg_w, bg_y)
        glVertex2f(bg_x + bg_w, bg_y + bg_h)
        glVertex2f(bg_x, bg_y + bg_h)
        glEnd()
        self.texture_loader.draw(tex, bg_x + 2, bg_y + 2, w, h)

    def set_inline_font_size(self, size):
        self._inline_font_size = size
        for n in self.engine.nodes:
            n.invalidate_height()

    def set_font_face(self, family):
        self.font_system.set_font_family(family)

    def set_content_gap(self, px):
        self._content_gap = px

    def _render_chat_nodes(self):
        font_size = self._inline_font_size
        emoji_size = int(font_size * 1.6)

        _font = QFont("Microsoft JhengHei", font_size)
        _fm = QFontMetrics(_font)
        _text_vc = 10 + _fm.height() / 2
        _emoji_vc = emoji_size / 2
        _vc_diff = int(_text_vc - _emoji_vc)
        if _vc_diff > 0:
            _emoji_off = _vc_diff
            _text_off = 0
        else:
            _emoji_off = 0
            _text_off = -_vc_diff

        for n in self.engine.nodes:
            box_x, box_y, box_w, box_h = 20, int(n.y), 360, 80

            avatar_size = 28
            avatar_tex = self.texture_loader.load_url_circular(n.avatar_url, 28)
            avatar_x = box_x + 6
            avatar_y = box_y + 6
            if avatar_tex:
                self.texture_loader.draw(avatar_tex, avatar_x, avatar_y, avatar_size, avatar_size)

            username_tex, uw, uh = self.font_system.get_text_texture(
                n.user, QColor(0, 128, 255), max_width=config.USERNAME_MAX_WIDTH,
                outline_color=QColor("white")
            )
            username_x = avatar_x + avatar_size + 8
            username_y = avatar_y + (avatar_size - uh) // 2
            self.texture_loader.draw(username_tex, username_x, username_y, uw, uh)

            msg_x = username_x
            msg_y = username_y + _fm.height() + self._content_gap
            max_msg_w = config.MESSAGE_MAX_WIDTH
            current_x = msg_x
            line_y = msg_y
            _single_line_h = _fm.height() + 20

            for seg in n.segments:
                if seg["type"] == "text" and seg["content"].strip():
                    remaining_w = max_msg_w - (current_x - msg_x)
                    if remaining_w < 30:
                        line_y += _single_line_h
                        current_x = msg_x
                        remaining_w = max_msg_w
                    seg_tex, tw, th = self.font_system.get_text_texture(
                        seg["content"], QColor("white"), max_width=remaining_w,
                        font_size=font_size, outline_color=QColor("black")
                    )
                    if th > _single_line_h:
                        self.texture_loader.draw(seg_tex, current_x, line_y + _text_off, tw, th)
                        line_y += th + 2
                        current_x = msg_x
                    else:
                        self.texture_loader.draw(seg_tex, current_x, line_y + _text_off, tw, th)
                        current_x += tw
                elif seg["type"] == "image":
                    remaining_w = max_msg_w - (current_x - msg_x)
                    if emoji_size + 1 > remaining_w:
                        line_y += _single_line_h
                        current_x = msg_x
                    emoji_tex = self.texture_loader.load_emoji(seg["url"], emoji_size)
                    if emoji_tex:
                        self.texture_loader.draw(emoji_tex, current_x, line_y + _emoji_off, emoji_size, emoji_size)
                        current_x += emoji_size + 1
                    else:
                        if not hasattr(n, '_emoji_logged'):
                            print(f"emoji not cached: {seg['url'][-40:]}")
                            n._emoji_logged = True

            gift_size = 28
            gift_tex = self.texture_loader.load_url(n.gift_url)
            if gift_tex:
                gift_x = box_x + box_w - gift_size - 6
                gift_y = msg_y + (emoji_size - gift_size) // 2
                self.texture_loader.draw(gift_tex, gift_x, gift_y, gift_size, gift_size)




