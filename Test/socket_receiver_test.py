"""Run with python -B -m unittest discover -s Test -p socket_receiver_test.py."""
import importlib.util
import pathlib
import socket
import sys
import threading
import time
import unittest
from unittest.mock import patch

# socket_server 屬於 live_engine 套件，會匯入 core.debug_log；以檔案獨立載入時
# 必須先把套件根目錄放進 sys.path，否則會 ModuleNotFoundError: core。
live_engine = pathlib.Path(__file__).resolve().parents[1] / 'OtherTool/live_engine'
sys.path.insert(0, str(live_engine))

source = live_engine / 'network/socket_server.py'
spec = importlib.util.spec_from_file_location('socket_receiver', source)
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class SocketReceiverTests(unittest.TestCase):
    def setUp(self):
        list(receiver.drain_messages(1000, 1))

    def test_tcp_fragments_utf8_and_malformed_frames(self):
        client, server = socket.socketpair()
        worker = threading.Thread(target=receiver.handle, args=(server,))
        worker.start()
        try:
            data = '{"type":"StreamMessage","message":"中文🙂"}\ninvalid\nnull\n{"n":2}\n'.encode()
            for byte in data:
                client.sendall(bytes([byte]))
        finally:
            client.close()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        messages = list(receiver.drain_messages(100, 1))
        self.assertEqual(messages, [
            {'type': 'SystemEvent', 'event': 'connected'},
            {'type': 'StreamMessage', 'message': '中文🙂'}, {'n': 2},
            {'type': 'SystemEvent', 'event': 'disconnected'}])
        self.assertEqual(receiver._active, 0)
        self.assertEqual(server.fileno(), -1)

    def test_queue_overload_is_bounded_and_keeps_recent_messages(self):
        for n in range(1000):
            receiver.enqueue_message({'n': n})
        self.assertEqual(receiver.message_queue.qsize(), 200)
        messages = list(receiver.drain_messages(1000, 1))
        self.assertEqual([m['n'] for m in messages], list(range(800, 1000)))

    def test_ui_budget_includes_message_processing(self):
        for n in range(100):
            receiver.enqueue_message({'n': n})
        self.assertEqual(len(list(receiver.drain_messages(20, 1))), 20)
        with patch.object(receiver.time, 'monotonic', side_effect=[0, 0, 0.005]):
            self.assertEqual(len(list(receiver.drain_messages())), 1)
        self.assertEqual(receiver.message_queue.qsize(), 79)

    def test_oversized_frame_closes_connection(self):
        client, server = socket.socketpair()
        worker = threading.Thread(target=receiver.handle, args=(server,))
        with patch.object(receiver, 'MAX_FRAME_BYTES', 10):
            worker.start()
            client.sendall(b'x' * 11)
            worker.join(2)
            client.close()
        self.assertFalse(worker.is_alive())
        self.assertEqual(receiver._active, 0)
        self.assertEqual(server.fileno(), -1)

    def test_receive_error_always_closes_and_updates_active_count(self):
        class BrokenConnection:
            closed = False
            def settimeout(self, timeout): pass
            def close(self): self.closed = True
            def recv(self, size): raise ConnectionResetError('test reset')
        connection = BrokenConnection()
        receiver.handle(connection)
        self.assertTrue(connection.closed)
        self.assertEqual(receiver._active, 0)
        self.assertEqual(list(receiver.drain_messages(100, 1))[-1]['event'], 'disconnected')

    def test_keepalive_probe_then_idle_disconnect(self):
        events = []

        class SilentConnection:
            closed = False
            def settimeout(self, timeout): events.append(('timeout', timeout))
            def sendall(self, data): events.append(('send', data))
            def close(self): self.closed = True
            def recv(self, size): raise socket.timeout()

        connection = SilentConnection()
        # monotonic(): last_active=0；第一次逾時仍在 IDLE_TIMEOUT 內送出 keepalive，
        # 第二次逾時超過 IDLE_TIMEOUT 後主動關閉連線。
        with patch.object(receiver.time, 'monotonic', side_effect=[0, 0, 100]):
            receiver.handle(connection)
        self.assertEqual(events[0], ('timeout', receiver.KEEPALIVE_INTERVAL))
        self.assertIn(('send', receiver.KEEPALIVE_LINE), events)
        self.assertTrue(connection.closed)
        self.assertEqual(receiver._active, 0)
        self.assertEqual(list(receiver.drain_messages(100, 1))[-1]['event'], 'disconnected')


if __name__ == '__main__':
    unittest.main()
