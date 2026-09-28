import json
import os
import socket
import threading
import time
import traceback
from queue import Queue, Empty, Full

from core.debug_log import log, log_warn, log_error

MAX_FRAME_BYTES = 256 * 1024
# A quiet live chat still needs the link proven alive: the server pings every
# KEEPALIVE_INTERVAL and drops a peer that sent nothing for IDLE_TIMEOUT.
KEEPALIVE_INTERVAL = 20
IDLE_TIMEOUT = 60
KEEPALIVE_LINE = b'{"type": "keepalive"}\n'
# One intended client (TikTok.js) plus occasional tools; cap so a runaway
# reconnect storm cannot spawn unbounded receiver threads.
MAX_CONNECTIONS = 8
# If the port is briefly held (another instance still shutting down), retry
# instead of dying silently and leaving the overlay unable to receive.
BIND_RETRY_SECONDS = 5

message_queue = Queue(maxsize=200)
_queue_lock = threading.Lock()
_dropped = 0
_last_warning = 0.0
_active = 0
_lock = threading.Lock()
_slots = threading.Semaphore(MAX_CONNECTIONS)


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
                log_warn(f"Socket queue full: size={message_queue.qsize()} dropped={_dropped}")


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


def _open_server(host, port):
    server = socket.socket()
    # SO_REUSEADDR lets the overlay rebind quickly after a restart instead of
    # waiting out TIME_WAIT (the usual cause of a silent start failure).
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen()
    return server


def start_socket():
    host = os.environ.get("SOCKET_HOST", "127.0.0.1")
    port = int(os.environ.get("SOCKET_PORT", "9322"))
    while True:
        try:
            with _open_server(host, port) as server:
                log(f"Socket server listening on {host}:{port} (max {MAX_CONNECTIONS} connections)")
                while True:
                    connection, peer = server.accept()
                    if not _slots.acquire(blocking=False):
                        log_warn(
                            f"Socket rejected {peer}: max {MAX_CONNECTIONS} connections reached"
                        )
                        try:
                            connection.close()
                        except OSError:
                            pass
                        continue
                    connection.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                    threading.Thread(
                        target=handle, args=(connection, peer), daemon=True
                    ).start()
        except Exception as error:
            log_error(f"Socket server unavailable on {host}:{port}: {error!r}")
            log_error(traceback.format_exc())
            enqueue_message({
                "type": "SystemEvent",
                "event": "socket_error",
                "message": f"{host}:{port} {error}",
            })
            time.sleep(BIND_RETRY_SECONDS)


def handle(connection, peer=("?", 0)):
    global _active
    try:
        with _lock:
            _active += 1
            active = _active
            if active == 1:
                enqueue_message({"type": "SystemEvent", "event": "connected"})
        log(f"Socket client connected: {peer} (active={active})")
        _run_connection(connection)
    except (OSError, ValueError) as error:
        log_warn(f"Socket receiver closed ({peer}): {error}")
    except Exception as error:
        log_error(f"Socket receiver crashed ({peer}): {error!r}")
        log_error(traceback.format_exc())
    finally:
        try:
            connection.close()
        except OSError:
            pass
        _slots.release()
        with _lock:
            _active -= 1
            remaining = _active
            if remaining == 0:
                enqueue_message({"type": "SystemEvent", "event": "disconnected"})
        log(f"Socket client disconnected: {peer} (active={remaining})")


def _run_connection(connection):
    # Timeout drives app-level keepalive: on silence we ping, and only drop the
    # peer once it has ignored us for IDLE_TIMEOUT.
    connection.settimeout(KEEPALIVE_INTERVAL)
    buf = b""
    last_active = time.monotonic()
    while True:
        try:
            data = connection.recv(4096)
        except socket.timeout:
            if time.monotonic() - last_active > IDLE_TIMEOUT:
                raise OSError(f"idle timeout after {IDLE_TIMEOUT}s")
            try:
                connection.sendall(KEEPALIVE_LINE)
            except OSError as error:
                raise OSError(f"keepalive send failed: {error}")
            continue
        if not data:
            break
        last_active = time.monotonic()
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            if len(line) > MAX_FRAME_BYTES:
                raise ValueError("Socket frame too large")
            try:
                message = json.loads(line.decode("utf-8"))
            except (ValueError, UnicodeError) as error:
                log_warn(f"Socket frame dropped: {error}")
                continue
            if isinstance(message, dict):
                enqueue_message(message)
        if len(buf) > MAX_FRAME_BYTES:
            raise ValueError("Socket frame too large")
