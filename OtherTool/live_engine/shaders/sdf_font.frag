#version 120

uniform sampler2D tex;
uniform float alpha;

varying vec2 v_uv;

void main() {
    float dist = texture2D(tex, v_uv).a;

    float w = fwidth(dist);
    float a = smoothstep(0.5 - w, 0.5 + w, dist);

    gl_FragColor = vec4(1.0, 1.0, 1.0, a * alpha);
}