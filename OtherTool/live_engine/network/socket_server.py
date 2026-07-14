import socket, threading, json
from queue import Queue

message_queue = Queue()

_active = 0
_lock = threading.Lock()

def start_socket():
    s = socket.socket()
    s.bind(("0.0.0.0", 9322))
    s.listen()

    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()

def handle(c):
    global _active
    with _lock:
        _active += 1
        if _active == 1:
            message_queue.put({"type": "SystemEvent", "event": "connected"})

    buf = b""
    while True:
        data = c.recv(4096)
        if not data:
            break
        buf += data
        print("得到數據", buf)
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            try:
                message_queue.put(json.loads(line.decode()))
            except Exception:
                pass

    with _lock:
        _active -= 1
        if _active == 0:
            message_queue.put({"type": "SystemEvent", "event": "disconnected"})
