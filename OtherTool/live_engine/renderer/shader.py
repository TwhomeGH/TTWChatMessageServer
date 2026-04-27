from OpenGL.GL import *

class ShaderProgram:
    def __init__(self, vert_src, frag_src):
        self.program = glCreateProgram()

        self.vs = self.compile(GL_VERTEX_SHADER, vert_src)
        self.fs = self.compile(GL_FRAGMENT_SHADER, frag_src)

        glAttachShader(self.program, self.vs)
        glAttachShader(self.program, self.fs)

        glLinkProgram(self.program)

        if not glGetProgramiv(self.program, GL_LINK_STATUS):
            raise Exception(glGetProgramInfoLog(self.program))

    def compile(self, type, source):
        shader = glCreateShader(type)
        glShaderSource(shader, source)
        glCompileShader(shader)

        if not glGetShaderiv(shader, GL_COMPILE_STATUS):
            raise Exception(glGetShaderInfoLog(shader))

        return shader

    def use(self):
        glUseProgram(self.program)