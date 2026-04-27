from OpenGL.GL import *

class GLRenderer:

    def __init__(self):
        pass

    def begin(self):
        
        glClear(GL_COLOR_BUFFER_BIT)
        glMatrixMode(GL_MODELVIEW)
        glLoadIdentity()

        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
        

    def draw_box(self, x, y, w, h, alpha):

        # ⚠️ 改成可見顏色（避免 0 黑看不到）
        glColor4f(0.2, 0.2, 0.2, max(0.3, alpha))

        glBegin(GL_QUADS)
        

        glTexCoord2f(0, 1); glVertex2f(x, y)
        glTexCoord2f(1, 1); glVertex2f(x + w, y)
        glTexCoord2f(1, 0); glVertex2f(x + w, y + h)
        glTexCoord2f(0, 0); glVertex2f(x, y + h)



        glEnd()