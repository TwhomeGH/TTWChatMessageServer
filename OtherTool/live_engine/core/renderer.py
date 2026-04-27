class RenderQueue:
    def __init__(self):
        self.chat = []
        self.textures = []
        self.particles = []

    def submit_chat(self, node):
        self.chat.append(node)