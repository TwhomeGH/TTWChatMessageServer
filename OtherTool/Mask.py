import os
import sys, subprocess, json
from PyQt6.QtWidgets import (
    QApplication, QGraphicsLineItem, QWidget, QVBoxLayout, QPushButton, QFileDialog,
    QGraphicsView, QGraphicsScene, QGraphicsPixmapItem, QGraphicsRectItem, QGraphicsTextItem,
    QSlider, QLabel, QHBoxLayout, QGraphicsItem
)
from PyQt6.QtGui import QPen, QPixmap, QColor, QTransform
from PyQt6.QtCore import Qt, QUrl
from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
from PyQt6.QtMultimediaWidgets import QVideoWidget

from PyQt6.QtMultimediaWidgets import QGraphicsVideoItem
from PyQt6.QtCore import QRectF

import re

class ResizeHandle(QGraphicsRectItem):
    def __init__(self, parent, corner):
        super().__init__(-5, -5, 10, 10, parent)
        self.corner = corner
        self.setBrush(QColor("blue"))
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        


    def mousePressEvent(self, event):
        # 攔截事件，不讓場景誤判成紅線跳轉
        event.accept()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        event.accept()
        super().mouseMoveEvent(event)
        
    def mouseReleaseEvent(self, event):
        parent = self.parentItem()
        if isinstance(parent, ResizableRectItem):
            parent.updateRectFromHandles(self.corner)
        super().mouseReleaseEvent(event)

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionChange:
            # 拖曳尾巴 → 更新父方塊寬度
            new_width = max(10, value.x())  # 最小寬度避免消失
            self.parent_block.updateDuration(new_width)
            # 控制點跟著移動
            value.setX(new_width)
            value.setY(0)
        return super().itemChange(change, value)



class ResizableRectItem(QGraphicsRectItem):
    def __init__(self, x, y, w, h):
        super().__init__(0, 0, w, h)
        self._updating = False
        self.setBrush(QColor("lightgray"))
        self.setPos(x, y)


        self.handles = [ResizeHandle(self, i) for i in range(4)]
        self.updateHandlesPos()

    def updateHandlesPos(self):
        rect = self.rect()
        self.handles[0].setPos(rect.topLeft())
        self.handles[1].setPos(rect.topRight())
        self.handles[2].setPos(rect.bottomLeft())
        self.handles[3].setPos(rect.bottomRight())

    def updateRectFromHandles(self, corner):
        rect = self.rect()
        pos = self.pos()

        if corner == 0:  # 左上角
            p0 = self.handles[0].scenePos()
            p3 = self.handles[3].scenePos()
            new_width  = max(1, p3.x() - p0.x())
            new_height = max(1, p3.y() - p0.y())
            self.setPos(p0.x(), p0.y())
            self.setRect(0, 0, new_width, new_height)

        elif corner == 1:  # 右上角
            p1 = self.handles[1].scenePos()
            p2 = self.handles[2].scenePos()
            new_width  = max(1, p1.x() - p2.x())
            new_height = max(1, p2.y() - p1.y())
            self.setPos(p2.x(), p1.y())
            self.setRect(0, 0, new_width, new_height)

        elif corner == 2:  # 左下角
            p2 = self.handles[2].scenePos()
            p1 = self.handles[1].scenePos()
            new_width  = max(1, p1.x() - p2.x())
            new_height = max(1, p2.y() - p1.y())
            self.setPos(p2.x(), p1.y())
            self.setRect(0, 0, new_width, new_height)

        elif corner == 3:  # 右下角
            p0 = self.handles[0].scenePos()
            p3 = self.handles[3].scenePos()
            new_width  = max(1, p3.x() - p0.x())
            new_height = max(1, p3.y() - p0.y())
            self.setRect(0, 0, new_width, new_height)

        self.updateHandlesPos()













class ResizablePixmapItem(QGraphicsPixmapItem):
    def __init__(self, pixmap):
        super().__init__(pixmap)
        self._updating = False
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)

        self.handles = [ResizeHandle(self, i) for i in range(4)]
        self.updateHandlesPos()

    def updateHandlesPos(self):
        rect = self.boundingRect()
        self.handles[0].setPos(rect.topLeft())
        self.handles[1].setPos(rect.topRight())
        self.handles[2].setPos(rect.bottomLeft())
        self.handles[3].setPos(rect.bottomRight())

    def updatePixmapFromHandles(self):
        p0 = self.mapFromScene(self.handles[0].scenePos())
        p1 = self.mapFromScene(self.handles[1].scenePos())
        p2 = self.mapFromScene(self.handles[2].scenePos())
        p3 = self.mapFromScene(self.handles[3].scenePos())

        left   = min(p0.x(), p2.x())
        right  = max(p1.x(), p3.x())
        top    = min(p0.y(), p1.y())
        bottom = max(p2.y(), p3.y())

        new_width  = max(1, int(right - left))
        new_height = max(1, int(bottom - top))


        if new_width > 0 and new_height > 0:
            scaled = self.pixmap().scaled(new_width, new_height)
            self.setPixmap(scaled)

            self._updating = True
            self.updateHandlesPos()
            self._updating = False


class TimelineScene(QGraphicsScene):
    def __init__(self, editor, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.editor = editor

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            clicked_x = event.scenePos().x()
            scale = self.editor.timeline_scale
            clicked_time = clicked_x / scale   # 秒數
            clicked_ms = int(clicked_time * 1000)  # 轉毫秒

            item = self.itemAt(event.scenePos(), QTransform())
            if item is None or not isinstance(item, TimelineBlock):
                # 點擊空白 → 取消選中
                self.editor.selected_block = None
                print("取消選中方塊")

                # 紅線跳轉到點擊時間
                self.editor.playhead.setPos(clicked_x, 0)
                print("紅線跳轉到時間:", clicked_time)

                # ⚠️ 同步影片播放位置
                if self.editor.player is not None:
                    self.editor.player.setPosition(clicked_ms)
                    print("影片跳轉到毫秒:", clicked_ms)

        super().mousePressEvent(event)


class Time_ResizeHandle(QGraphicsRectItem):
    def __init__(self, parent_block):
        super().__init__(0, 0, 8, 20, parent_block)
        self.parent_block = parent_block
        self.setBrush(QColor("red"))
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges, True)


    def mousePressEvent(self, event):
        # 攔截事件，不讓場景誤判成紅線跳轉
        event.accept()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        event.accept()
        super().mouseMoveEvent(event)

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionChange:
            new_width = max(10, value.x())
            self.parent_block.updateDuration(new_width)
            value.setX(new_width)
            value.setY(0)
        return super().itemChange(change, value)
    
class TimelineBlock(QGraphicsRectItem):
    def __init__(self, start, end, scale=10, editor=None, linked_item=None):
        super().__init__(0, 0, (end-start)*scale, 20)  # 固定寬度
        self.setBrush(QColor(100, 200, 250, 180))
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges, True)
        self.start = start
        self.end = end
        self.scale = scale
        self.editor = editor
        
        self.linked_item = linked_item
        self.setPos(start*scale, 60)  # 初始位置


        # 加上尾巴控制點
        self.handle = Time_ResizeHandle(self)
        self.handle.setParentItem(self)
        self.handle.setPos(self.rect().width(), 0)
        
    def updateDuration(self, new_width):
        # 更新持續時間
        self.setRect(0, 0, new_width, 20)
        self.end = self.start + new_width / self.scale
        print("Block time:", self.start, self.end)

        if self.editor and self.linked_item:
            self.editor.object_times[self.linked_item] = (self.start, self.end)


    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            if self.editor is not None:
                if self.editor.selected_block == self:
                    # 再點一次 → 取消選中
                    self.editor.selected_block = None
                    print("取消選中方塊")
                else:
                    self.editor.selected_block = self
                    print("選中方塊")
        super().mousePressEvent(event)



    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionChange:
            new_x = max(0, value.x())
            value.setX(new_x)
            value.setY(60)

            # 用 pos().x() + rect().width() 計算時間
            scale = self.editor.timeline_scale if self.editor else self.scale
            self.start = new_x / scale
            self.end = (new_x + self.rect().width()) / scale
            print("Block time:", self.start, self.end)

            if self.editor and self.linked_item:
                self.editor.object_times[self.linked_item] = (self.start, self.end)

            if self.editor:
                self.editor.ensure_ticks_cover(new_x + self.rect().width())

        return super().itemChange(change, value)


class Playhead(QGraphicsLineItem):
    def __init__(self, scale, player):
        super().__init__(0, 0, 0, 80)  # 本地座標固定一條垂直線
        self.setPen(QPen(Qt.GlobalColor.red, 2))
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges, True)
        self.scale = scale
        self.player = player
        self._dragging = False  # 旗標：是否使用者正在拖曳

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionChange:
            if self._dragging:  # 只有拖曳時才更新影片位置
                new_x = value.x()
                new_time_ms = int(new_x / self.scale * 1000)
                self.player.setPosition(new_time_ms)
        return super().itemChange(change, value)

    def mousePressEvent(self, event):
        self._dragging = True
        super().mousePressEvent(event)

    def mouseReleaseEvent(self, event):
        self._dragging = False
        super().mouseReleaseEvent(event)






def get_video_fps(path):
    """使用 ffprobe 讀取影片 fps"""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-of", "json", path
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        info = json.loads(result.stdout)
        # r_frame_rate 通常是字串 "30000/1001" 或 "25/1"
        rate_str = info["streams"][0]["r_frame_rate"]
        num, den = rate_str.split("/")
        fps = float(num) / float(den)
        return fps
    except Exception:
        return None
    
def seconds_to_frames(seconds, fps):
    """把秒數轉換成幀號"""
    return int(round(seconds * fps))

class OverlayEditor(QWidget):


    def draw_ticks(self, start_sec, end_sec):
        # 改成增量式：只補新的刻度，不清除舊的
        if not hasattr(self, "_tick_items"):
            self._tick_items = {}

        scale = self.timeline_scale
        for t in range(int(start_sec), int(end_sec)+1):
            if t not in self._tick_items:  # 只畫沒畫過的
                x = t * scale
                line = self.timeline_scene.addLine(x, 60, x, 80, QPen(Qt.GlobalColor.black, 1))
                self._tick_items[t] = line
                if t % 10 == 0:
                    text = self.timeline_scene.addText(str(t))
                    text.setPos(x, 40)
                    self._tick_items[f"text_{t}"] = text





    def ensure_ticks_cover(self, x):
        rect = self.timeline_scene.sceneRect()
        left, right = rect.left(), rect.right()

        # 超出右邊 → 延伸
        if x > right - 200:
            new_right = x + 1000
            self.timeline_scene.setSceneRect(left, 0, new_right - left, 80)
            self.draw_ticks(right/self.timeline_scale, new_right/self.timeline_scale)

        # 超出左邊 → 延伸
        if x < left + 200:
            new_left = max(0, x - 1000)
            self.timeline_scene.setSceneRect(new_left, 0, right - new_left, 80)
            self.draw_ticks(new_left/self.timeline_scale, left/self.timeline_scale)


    # 播放時更新紅線位置
    def update_playhead(self, pos_ms):
        x = pos_ms * (self.timeline_scale / 1000.0)  # 毫秒 → 像素
        self.playhead._dragging = False
        self.playhead.setPos(x, 0)

        # 以紅線為中心更新 sceneRect
        margin = 1000  # 可見範圍一半 (像素)
        start_x = max(0, x - margin)
        end_x   = x + margin

        # ⚠️ 更新時間軸場景範圍
        self.timeline_scene.setSceneRect(start_x, 0, end_x - start_x, 80)

        # 更新刻度 (線 + 文字)
        start_sec = start_x / self.timeline_scale
        end_sec   = end_x / self.timeline_scale
        self.draw_ticks(start_sec, end_sec)


        # 確保刻度涵蓋紅線位置
        self.ensure_ticks_cover(x)

        # 視圖跟著紅線移動
        self.timeline_view.centerOn(x, 40)

        print("x=", x, "sceneRect", start_x, end_x, "ticks range", start_sec, end_sec)





    def toggle_play_pause(self):
        if self.player is not None:
            if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.player.pause()
            else:
                self.player.play()



    def delete_selected(self):
        for item in self.scene.selectedItems():
            # 刪掉主場景物件
            self.scene.removeItem(item)

            # 刪掉時間紀錄
            if item in self.object_times:
                del self.object_times[item]

            # 如果有綁定時間軸 block，也刪掉
            if hasattr(item, "timeline_block"):
                block = item.timeline_block
                if block is not None:
                    self.timeline_scene.removeItem(block)



    def export_mode_change(self):
        if self.export_mode_state == "auto":

            self.export_mode_state = "manual"
            self.export_mode.setText("匯出模式: 手動")
            
        else:

            self.export_mode_state = "auto"
            self.export_mode.setText("匯出模式: 自動")



    def apply_display_mode(self):
        if self.keep_aspect:
            self.view.fitInView(self.video_item, Qt.AspectRatioMode.KeepAspectRatio)
            self.toggle_display_btn.setText("顯示模式: 保持比例")
        else:
            self.view.fitInView(self.video_item, Qt.AspectRatioMode.IgnoreAspectRatio)
            self.toggle_display_btn.setText("顯示模式: 拉伸填滿")


    def toggle_display_mode(self):
        self.keep_aspect = not self.keep_aspect
        self.apply_display_mode()



    def update_visible_objects(self, current_time):
        fixTime = current_time/1000.0

        for item, (start, end) in self.object_times.items():
            print("S",start,"E",end,"CTime",current_time,fixTime)
            item.setVisible(start <= fixTime <= end)
            


    


    def __init__(self):
        super().__init__()
        self.setWindowTitle("QtMultimedia Overlay 編輯器")
        self.resize(1200, 800)

        layout = QVBoxLayout()

        

        # 影片播放區
        self.player = QMediaPlayer()
        self.audio_output = QAudioOutput()
        self.player.setAudioOutput(self.audio_output)

        self.scene = QGraphicsScene()
        self.view = QGraphicsView(self.scene)
        layout.addWidget(self.view)

        self.video_item = QGraphicsVideoItem()
        self.scene.addItem(self.video_item)

        self.view.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.view.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)

        self.view.fitInView(self.video_item, Qt.AspectRatioMode.KeepAspectRatio)
        self.keep_aspect = True

        self.player.setVideoOutput(self.video_item)




        # 播放器位置改變時，自動更新 slider
        self.player.positionChanged.connect(self.sync_slider)



        self.play_pause_btn = QPushButton("播放/暫停")
        self.play_pause_btn.clicked.connect(self.toggle_play_pause)
        layout.addWidget(self.play_pause_btn)

        


        # 時間軸
        time_layout = QHBoxLayout()
        self.time_label = QLabel("時間軸 (秒):")
        self.time_slider = QSlider(Qt.Orientation.Horizontal)
        self.time_slider.setMinimum(0)
        self.time_slider.setMaximum(300)  # 預設，載入影片後更新
        self.time_slider.valueChanged.connect(self.update_time)
        time_layout.addWidget(self.time_label)
        time_layout.addWidget(self.time_slider)
        layout.addLayout(time_layout)

        self.timeline_scale = 10  # 每秒 10px



        # 建立時間軸場景


        self.timeline_scene = TimelineScene(editor=self)
        self.selected_block = None

        
        # self.timeline_scene = QGraphicsScene()

        self.video_duration = 300

        # 設定時間軸寬度 = 總秒數 * scale
        timeline_width = int(self.video_duration * self.timeline_scale)
        self.timeline_scene.setSceneRect(0, 0, timeline_width, 80)

        # 紅色播放指示線
        # 方法 2：用 QColor 物件
        # 建立紅色播放指示線 (Playhead)
        self.playhead = Playhead(self.timeline_scale, self.player)
        self.timeline_scene.addItem(self.playhead)   # 關鍵：加到 timeline_scene

        # 建立時間軸視圖
        self.timeline_view = QGraphicsView(self.timeline_scene)
        self.timeline_view.setFixedHeight(80)
        self.timeline_view.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOn)
        layout.addWidget(self.timeline_view)

        # 功能按鈕
        self.load_video_btn = QPushButton("載入影片")
        self.load_video_btn.clicked.connect(self.load_video)
        layout.addWidget(self.load_video_btn)


        self.toggle_display_btn = QPushButton("顯示模式: 保持比例")
        self.toggle_display_btn.clicked.connect(self.toggle_display_mode)
        layout.addWidget(self.toggle_display_btn)

        # 預設模式
        self.keep_aspect = True

        self.delete_btn = QPushButton("刪除選取物件")
        self.delete_btn.clicked.connect(self.delete_selected)
        layout.addWidget(self.delete_btn)



        # self.add_image_btn = QPushButton("添加圖片遮擋")
        # self.add_image_btn.clicked.connect(self.add_image)
        # layout.addWidget(self.add_image_btn)

        self.add_rect_btn = QPushButton("添加顏色方塊")
        self.add_rect_btn.clicked.connect(self.add_rect)
        layout.addWidget(self.add_rect_btn)

        # self.add_text_btn = QPushButton("添加文字")
        # self.add_text_btn.clicked.connect(self.add_text)
        # layout.addWidget(self.add_text_btn)

        self.export_btn = QPushButton("匯出 FFmpeg 指令")
        self.export_btn.clicked.connect(self.export_ffmpeg)
        layout.addWidget(self.export_btn)

        self.setLayout(layout)


        self.export_mode = QPushButton("匯出模式 : 自動")
        self.export_mode.clicked.connect(self.export_mode_change)
        self.export_mode_state = "auto"

        layout.addWidget(self.export_mode)

        self.setLayout(layout)

        # 物件時間設定
        self.object_times = {}  # {item: (start, end)}
        self.video_path = None
        self.video_duration = 0

        self.video_item.nativeSizeChanged.connect(self.on_video_size_ready)

    def on_video_size_ready(self):
        self.apply_display_mode()





    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.apply_display_mode()


    def get_video_resolution(self, path):
        """使用 ffprobe 讀取影片寬高 (像素)"""
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json", path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            info = json.loads(result.stdout)
            width = int(info["streams"][0]["width"])
            height = int(info["streams"][0]["height"])
            return width, height
        except Exception:
            return None, None


    def item_to_drawbox(self, item, scene, video_w, video_h, start, end,nType=True):
        """把 QGraphicsRectItem 映射到影片座標並生成 drawbox"""
        # 場景大小
        scene_rect = scene.sceneRect()
        scene_w, scene_h = scene_rect.width(), scene_rect.height()

        # 矩形座標 (場景座標)
        rect = item.rect()
        rect_x = item.pos().x() + rect.x()
        rect_y = item.pos().y() + rect.y()
        rect_w = rect.width()
        rect_h = rect.height()

        # 映射到影片座標
        video_x = rect_x / scene_w * video_w
        video_y = rect_y / scene_h * video_h
        video_wd = rect_w / scene_w * video_w
        video_hd = rect_h / scene_h * video_h

        if nType:
            return f"drawbox=x={int(video_x)}:y={int(video_y)}:w={int(video_wd)}:h={int(video_hd)}:color=black@1.0:thickness=fill:enable='between(n,{start},{end})'"
        else:
            return f"drawbox=x={int(video_x)}:y={int(video_y)}:w={int(video_wd)}:h={int(video_hd)}:color=black@1.0:thickness=fill:enable='between(t,{start},{end})'"


    

    
    def rect_to_drawbox(self,rect, scene_w, scene_h, video_w, video_h, start, end):
        video_x = rect.x() / scene_w  * video_w
        video_y = rect.y() / scene_h * video_h
        video_wd = rect.width()  / scene_w  * video_w
        video_hd = rect.height() / scene_h * video_h

        return f"drawbox=x={int(video_x)}:y={int(video_y)}:w={int(video_wd)}:h={int(video_hd)}:color=black@1.0:enable='between(n,{start},{end})'"

    def get_video_duration(self, path):
        """使用 ffprobe 讀取影片長度 (秒)"""
        cmd = [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration", "-of", "json", path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            info = json.loads(result.stdout)
            duration = float(info["format"]["duration"])
            return duration
        except Exception:
            return 300

    def load_video(self):
        path, _ = QFileDialog.getOpenFileName(self, "選擇影片", "", "Video Files (*.mp4 *.mov)")
        if path:
            self.video_path = path
            self.player.setSource(QUrl.fromLocalFile(path))
            self.player.play()


            # 更新時間軸
            self.video_duration = float(self.get_video_duration(path))

            video_w, video_h = self.get_video_resolution(path)

            print("影片長度:", self.video_duration, "秒")
            print("影片解析度:", video_w, "x", video_h)
            
            fps = get_video_fps(path)
            print("影片 FPS:", fps)


            self.time_slider.setMaximum(int(self.video_duration * 1000))  # 毫秒精度

            self.time_label.setText(f"時間軸 (秒): 0.00 / {self.video_duration:.2f}")

    def add_image(self):
        path, _ = QFileDialog.getOpenFileName(self, "選擇圖片", "", "Image Files (*.png *.jpg)")
        if path:
            pixmap = QPixmap(path)

            
            item = ResizablePixmapItem(pixmap)

            item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
            item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
            item.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsFocusable, True)
            self.scene.addItem(item)  
            self.object_times[item] = (10, 20)


    def add_rect(self):
        rect = ResizableRectItem(100, 100, 200, 100)
        rect.setBrush(QColor(0, 0, 0, 255))
        rect.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        rect.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        rect.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsFocusable, True)
        self.scene.addItem(rect)

        # 取得影片當前播放時間 (毫秒 → 秒)
        current_time = self.player.position() / 1000.0

        # 預設區間：從當前時間開始，持續 10 秒
        start, end = current_time, current_time + 10
        print("RECTTime", start, end, self.video_duration)

        # 建立時間軸 block
        block = TimelineBlock(start, end, editor=self, linked_item=rect)
        self.timeline_scene.addItem(block)

        # 綁定彼此
        rect.timeline_block = block
        block.linked_item = rect

        # 更新字典
        self.object_times[rect] = (block.start, block.end)



    def add_text(self):
        text = QGraphicsTextItem("遮擋文字")
        text.setDefaultTextColor(QColor("red"))
        text.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsMovable, True)
        text.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        text.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsFocusable, True)
        self.scene.addItem(text)  
        self.object_times[text] = (50, 60)


    def sync_slider(self, pos):
        # pos 是播放器的毫秒位置
        self.time_slider.blockSignals(True)
        self.time_slider.setValue(pos)

        current_time = pos / 1000.0

        self.update_visible_objects(pos)

        self.update_playhead(pos)

        self.time_label.setText(f"時間軸 (秒): {current_time:.2f} / {self.video_duration:.2f}")
        self.time_slider.blockSignals(False)


    # 在 update_time 裡
    def update_time(self, value):
        # value 是 slider 的值 (毫秒)
        current_time = value / 1000.0

        self.update_visible_objects(current_time)
        
        self.time_label.setText(f"時間軸 (秒): {current_time:.2f} / {self.video_duration:.2f}")
        if self.player is not None:
            self.player.setPosition(value)

    
    def build_ffplay_cmd(self,video_path, start, duration, filters, width, height):
        
        print("FPLAY",start,duration)
        cmd = [
            "ffplay",
            "-ss", str(start),
            "-t", str(duration),
            "-i", video_path,
            "-vf",filters,
            "-x", str(width),
            "-y", str(height),
            "-window_title", "FFplay_預覽"
        ]
        return cmd
    

    def run_exp_ffmpeg(self,video_path, filters,filters_main, output_dir=".", mode="auto"):
        # 取原始檔名（不含副檔名）
        base_name = os.path.splitext(os.path.basename(video_path))[0]

        # 檢查檔案是否存在，自動累加 index
        index = 0
        while True:
            output_file = os.path.join(output_dir, f"{base_name}_{index}.mp4")
            if not os.path.exists(output_file):
                break
            index += 1


        self.width,self.height= self.get_video_resolution(video_path)

        print(f"FFPLAY 寬高得到 {self.width}x{self.height}")
        for f in filters:
            # 用正則取出 between(...) 裡的數字
            match = re.search(r"between\(\w+,([\d\.]+),([\d\.]+)\)", f)
            if match:
                start = match.group(1)
                end   = match.group(2)
                duration = float(end) - float(start)
                

                # 組合 ffplay 命令
                cmd = self.build_ffplay_cmd(video_path, start, duration, f, self.width, self.height)
                



                print("執行命令:", " ".join(cmd))

                self.player.pause()

                # 呼叫 ffmpeg 並顯示日誌
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    universal_newlines=True,
                    encoding="utf-8",   # 強制用 UTF-8 解碼
                    errors="replace"    # 遇到非法字元就跳過，不要丟例外
                )

                try:
                    output, _ = process.communicate(timeout=duration)
                except subprocess.TimeoutExpired:
                    print("超過時間，強制結束 ffplay")
                    process.kill()
                    output, _ = process.communicate()

                for line in output.splitlines():
                    print(line.strip())

                print("檔案檢視完成:",video_path)


                # 模式選擇
                if mode == "auto":
                    # 自動判斷：檢查輸出日誌是否有錯誤
                    if "Error" in output or "not connected" in output:
                        return False
                    return True
                elif mode == "manual":
                    # 人工確認：詢問使用者
                    ISOK_FFPLAY = input("FFPLAY結果正確嗎 進行最終導出? (y/n) ")
                    return ISOK_FFPLAY.lower() == "y"
                else:
                    raise ValueError("未知的模式，請使用 'auto' 或 'manual'")


    def run_ffmpeg(self,video_path, filters,output_dir=None):

        # 如果沒有指定 output_dir，就取 video_path 的所在目錄
        if output_dir is None:
            output_dir = os.path.dirname(video_path)
        # 取原始檔名（不含副檔名）
        base_name = os.path.splitext(os.path.basename(video_path))[0]

        # 檢查檔案是否存在，自動累加 index
        index = 0
        while True:
            output_file = os.path.normpath(
                os.path.join(output_dir, f"EDIT{base_name}_{index}.mp4")
                )
            if not os.path.exists(output_file):
                break
            index += 1

        # 組合命令
        cmd = [
            "ffmpeg",
            "-i", video_path,
            "-vf", ",".join(filters),
            "-c:a", "copy",
            output_file
        ]

        print("執行命令:", " ".join(cmd))

        # 呼叫 ffmpeg 並顯示日誌
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            encoding="utf-8",   # 強制用 UTF-8 解碼
            errors="replace"    # 遇到非法字元就跳過，不要丟例外
        )

        for line in process.stdout:
            print(line.strip())

        process.wait()
        print("完成，輸出檔案:", output_file)


    def export_ffmpeg(self):
        filters = []
        filters_play = []
        start = 0
        end   = 10

        if self.video_path is None:
            print('需要加載視頻')
            return
        
        for item, (start, end) in self.object_times.items():
            if isinstance(item, QGraphicsPixmapItem):
                pos = item.pos()

                fps = get_video_fps(self.video_path)
                print("影片 FPS:", fps)

                video_w, video_h = self.get_video_resolution(self.video_path)


                start_frame = start 
                end_frame = end     

                print("幀範圍:", start_frame, "到", end_frame)

                start_time = seconds_to_frames(start_frame,fps)
                end_time   = seconds_to_frames(end_frame,fps)

                #filters.append(f"[0:v][1:v] overlay=x={int(pos.x())}:y={int(pos.y())}:enable='between(t,{start_time},{end_time})'")

            elif isinstance(item, QGraphicsRectItem):
                pos = item.rect()

                fps = get_video_fps(self.video_path)
                print("影片 FPS:", fps)

                video_w, video_h = self.get_video_resolution(self.video_path)


                start_frame = start 
                end_frame = end

                filters_play.append(
                self.item_to_drawbox(item, self.scene, video_w, video_h, start_frame, end_frame,nType=False)
                )

                print("幀範圍:", start_frame, "到", end_frame)

                start_time = seconds_to_frames(start_frame,fps)
                end_time   = seconds_to_frames(end_frame,fps)

                
                
                # 改成使用 item_to_drawbox

                filters.append(
                    self.item_to_drawbox(item, self.scene, video_w, video_h, start_time, end_time)
                )


                # filters.append(f"drawbox=x={int(pos.x())}:y={int(pos.y())}:w={int(pos.width())}:h={int(pos.height())}:color=black@1.0:enable='between(t,{start},{end})'")

            elif isinstance(item, QGraphicsTextItem):
                pos = item.pos()
                filters.append(
                    self.item_to_drawbox(item, self.scene, video_w, video_h, start_time, end_time)
                )

                filters_play.append(
                    self.item_to_drawbox(item, self.scene, video_w, video_h, start_time, end_time,nType=False)
                )
                #filters.append(f"drawtext=text='{item.toPlainText()}':x={int(pos.x())}:y={int(pos.y())}:fontsize=24:fontcolor=red:enable='between(t,{start},{end})'")

        print("FFmpeg 指令:")
        print(f"ffmpeg -i \"{self.video_path}\" -filter_complex \"" + ";".join(filters) + "\" -c:a copy output.mp4")

        # 快速預覽用 ffplay
        print("FFplay 預覽指令: 使用T定位")
        
        print(f"ffplay -ss {start} -t {end-start} \"{self.video_path}\" -vf \"" + ";".join(filters_play) + "\"")

        ISOK=self.run_exp_ffmpeg(self.video_path,filters=filters_play,filters_main=filter,mode=self.export_mode_state)


        if ISOK:
            print("開始輸出 FFMPEG")
            self.run_ffmpeg(video_path=self.video_path, filters=filters)
        else:
            print("預覽有問題，繼續編輯")
        



        
if __name__ == "__main__":
    app = QApplication(sys.argv)
    editor = OverlayEditor()
    editor.show()
    sys.exit(app.exec())
