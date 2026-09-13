import logging
import os
import socket
import threading
import json
import time
from queue import Queue, Empty, Full

MAX_FRAME_BYTES = 256 * 1024
message_queue = Queue(maxsize=200)
_queue_lock = threading.Lock()
_dropped = 0
_last_warning = 0.0
_active = 0
_lock = threading.Lock()


def enqueue_message(message):
    """Never block a receiver on the UI; discard oldest data at capacity."""
    global _dropped, _last_warning
    with _queue_lock:
        try:
            message_queue.put_nowait(message)
        except Full:
            try:
                message_queue.get_nowait()
                message_queue.task_done()
                _dropped += 1
            except Empty:
                pass
            message_queue.put_nowait(message)
            now = time.monotonic()
            if now - _last_warning >= 10:
                _last_warning = now
                logging.warning("Socket queue=%d dropped=%d", message_queue.qsize(), _dropped)


def drain_messages(max_messages=20, budget_seconds=0.004):
    """Bound work per UI frame, including the caller's message processing."""
    deadline = time.monotonic() + budget_seconds
    for _ in range(max_messages):
        if time.monotonic() >= deadline:
            break
        try:
            message = message_queue.get_nowait()
        except Empty:
            break
        message_queue.task_done()
        yield message


def start_socket():
    host = os.environ.get("SOCKET_HOST", "127.0.0.1")
    port = int(os.environ.get("SOCKET_PORT", "9322"))
    with socket.socket() as server:
        server.bind((host, port))
        server.listen()
        while True:
            connection, _ = server.accept()
            connection.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            threading.Thread(target=handle, args=(connection,), daemon=True).start()


def handle(connection):
    global _active
    with _lock:
        _active += 1
        if _active == 1:
            enqueue_message({"type": "SystemEvent", "event": "connected"})
    try:
        with connection:
            buf = b""
            while True:
                data = connection.recv(4096)
                if not data:
                    break
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if len(line) > MAX_FRAME_BYTES:
                        raise ValueError("Socket frame too large")
                    try:
                        message = json.loads(line.decode("utf-8"))
                    except (ValueError, UnicodeError):
                        continue
                    if isinstance(message, dict):
                        enqueue_message(message)
                if len(buf) > MAX_FRAME_BYTES:
                    raise ValueError("Socket frame too large")
    except (OSError, ValueError) as error:
        logging.warning("Socket receiver closed: %s", error)
    finally:
        with _lock:
            _active -= 1
            if _active == 0:
                enqueue_message({"type": "SystemEvent", "event": "disconnected"})
