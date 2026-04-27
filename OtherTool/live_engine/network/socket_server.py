import socket, threading, json
from queue import Queue

message_queue = Queue()

def start_socket():
    s = socket.socket()
    s.bind(("0.0.0.0", 9322))
    s.listen()

    while True:
        c, _ = s.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()

def handle(c):
    buf = b""

    while True:
        data = c.recv(4096)
        if not data:
            break

        buf += data

        print("得到數據",buf)

        
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            try:
                message_queue.put(json.loads(line.decode()))
            except:
                pass