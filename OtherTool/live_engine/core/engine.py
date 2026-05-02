from network.socket_server import message_queue
from core.scene import ChatNode

from PyQt6.QtGui import QColor
from renderer.font_system import FontSystem
import config
import time

class Engine:
    def __init__(self, widget=None):
        self.nodes = []
        self.font_system = FontSystem()

        self.widget = widget   # 可以傳入 Qt Widget
        # 或者直接用 config.HEIGHT

    def height(self):
        if self.widget is not None:
            return self.widget.height()   # Qt6 widget 的高度
        else:
            return config.HEIGHT          

    

    def update(self):
        while not message_queue.empty():
            data = message_queue.get()
            new_node = ChatNode(data)


            if not self.nodes:
                # 第一個訊息直接貼頂部
                new_node.target_y = 20
                new_node.y = 20
            else:
                # 後續訊息應該在最後一個下面
                last_node = self.nodes[-1]
                new_node.target_y = last_node.target_y + last_node.get_height(self.font_system) + 8

                # 🔑 新訊息初始位置放在底部，讓它往上收斂
                new_node.y = self.height() - 20

            self.nodes.append(new_node)

        # 更新所有訊息的 target_y
        current_y = 20
        for n in self.nodes:
            row_h = n.get_height(self.font_system)
            spacing = 8
            n.target_y = current_y
            current_y += row_h + spacing

        # 更新 node 狀態
        for n in self.nodes:
            n.update()

        # 清理死掉的 node
        self.nodes = [n for n in self.nodes if not n.dead]

        
        # 🔥 超出底部的訊息移除
        max_height = self.height()
        if self.nodes:
            # 找到最後一個訊息的底部位置
            last_node = self.nodes[-1]
            bottom = last_node.target_y + last_node.get_height(self.font_system)

            # 如果超過視窗高度，移除最早的訊息
            if bottom > max_height:
                self.nodes[0].dead = True











