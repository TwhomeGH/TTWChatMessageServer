import socket, json

data = {
    "type": "StreamMessage",
    "user": "核音",
    "message": "送你禮物🔥",
    "img": "https://img.icons8.com/?size=100&id=L8HgZUgz2jWS",
    "giftImg": "https://img.icons8.com/?size=100&id=124077",
    "isMain": True
}

s = socket.socket()
s.connect(("127.0.0.1", 9322))
s.send((json.dumps(data) + "\n").encode())
s.close()