import sys
from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QLineEdit, QPushButton, QListWidget,
    QListWidgetItem, QCheckBox, QGroupBox, QMessageBox,
    QDialog, QFormLayout
)
from PyQt6.QtCore import Qt
from core.speech_filter import filter_manager


class FilterSettingsWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("TTS 過濾器設定")
        self.setMinimumSize(500, 600)
        self._build_ui()
        self._load_data()

    def closeEvent(self, event):
        self.hide()
        event.ignore()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        toggle_group = QGroupBox("自動過濾")
        toggle_layout = QVBoxLayout(toggle_group)

        self.remove_urls_cb = QCheckBox("移除 URL")
        self.remove_urls_cb.stateChanged.connect(
            lambda s: filter_manager.set_remove_urls(s == Qt.CheckState.Checked.value)
        )
        toggle_layout.addWidget(self.remove_urls_cb)

        self.remove_emoji_cb = QCheckBox("移除表情符號 Emoji")
        self.remove_emoji_cb.stateChanged.connect(
            lambda s: filter_manager.set_remove_emoji(s == Qt.CheckState.Checked.value)
        )
        toggle_layout.addWidget(self.remove_emoji_cb)

        self.remove_numbers_cb = QCheckBox("移除純數字")
        self.remove_numbers_cb.stateChanged.connect(
            lambda s: filter_manager.set_remove_pure_numbers(s == Qt.CheckState.Checked.value)
        )
        toggle_layout.addWidget(self.remove_numbers_cb)

        layout.addWidget(toggle_group)

        block_group = QGroupBox("排除關鍵字")
        block_layout = QVBoxLayout(block_group)

        add_block_row = QHBoxLayout()
        self.block_input = QLineEdit()
        self.block_input.setPlaceholderText("輸入排除字...")
        add_block_btn = QPushButton("加入")
        add_block_btn.clicked.connect(self._add_block_keyword)
        add_block_row.addWidget(self.block_input)
        add_block_row.addWidget(add_block_btn)
        block_layout.addLayout(add_block_row)

        self.block_list = QListWidget()
        block_layout.addWidget(self.block_list)

        remove_block_btn = QPushButton("刪除選中的排除字")
        remove_block_btn.clicked.connect(self._remove_block_keyword)
        block_layout.addWidget(remove_block_btn)

        layout.addWidget(block_group)

        replace_group = QGroupBox("替換關鍵字")
        replace_layout = QVBoxLayout(replace_group)

        add_replace_row = QHBoxLayout()
        self.replace_input = QLineEdit()
        self.replace_input.setPlaceholderText("原字...")
        self.replacement_input = QLineEdit()
        self.replacement_input.setPlaceholderText("替換為...")
        self.replacement_input.setMaximumWidth(100)
        add_replace_btn = QPushButton("加入")
        add_replace_btn.clicked.connect(self._add_replace_keyword)
        add_replace_row.addWidget(self.replace_input)
        add_replace_row.addWidget(self.replacement_input)
        add_replace_row.addWidget(add_replace_btn)
        replace_layout.addLayout(add_replace_row)

        self.replace_list = QListWidget()
        replace_layout.addWidget(self.replace_list)

        remove_replace_btn = QPushButton("刪除選中的替換字")
        remove_replace_btn.clicked.connect(self._remove_replace_keyword)
        replace_layout.addWidget(remove_replace_btn)

        layout.addWidget(replace_group)

    def _load_data(self):
        self.remove_urls_cb.setChecked(filter_manager.remove_urls)
        self.remove_emoji_cb.setChecked(filter_manager.remove_emoji)
        self.remove_numbers_cb.setChecked(filter_manager.remove_pure_numbers)

        self.block_list.clear()
        for word in filter_manager.block_keywords:
            item = QListWidgetItem(word)
            self.block_list.addItem(item)

        self.replace_list.clear()
        for word, replacement in filter_manager.replace_keywords.items():
            item = QListWidgetItem(f"{word} → {replacement}")
            item.setData(Qt.ItemDataRole.UserRole, word)
            self.replace_list.addItem(item)

    def _add_block_keyword(self):
        word = self.block_input.text().strip()
        if word:
            filter_manager.add_block_keyword(word)
            self.block_input.clear()
            self._load_data()

    def _remove_block_keyword(self):
        item = self.block_list.currentItem()
        if item:
            filter_manager.remove_block_keyword(item.text())
            self._load_data()

    def _add_replace_keyword(self):
        word = self.replace_input.text().strip()
        replacement = self.replacement_input.text().strip()
        if word:
            filter_manager.add_replace_keyword(word, replacement or "")
            self.replace_input.clear()
            self.replacement_input.clear()
            self._load_data()

    def _remove_replace_keyword(self):
        item = self.replace_list.currentItem()
        if item:
            word = item.data(Qt.ItemDataRole.UserRole)
            filter_manager.remove_replace_keyword(word)
            self._load_data()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    w = FilterSettingsWindow()
    w.show()
    sys.exit(app.exec())