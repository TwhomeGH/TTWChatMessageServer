import sys
from PyQt6.QtWidgets import QApplication


from renderer.overlay import Overlay
from network.socket_server import start_socket
import threading

if __name__ == "__main__":

    threading.Thread(target=start_socket, daemon=True).start()

    app = QApplication(sys.argv)

    w = Overlay()
    w.show()

    sys.exit(app.exec())