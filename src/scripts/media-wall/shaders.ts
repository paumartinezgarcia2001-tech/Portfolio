/**
 * Shaders del muro de Media (D65). GLSL ES 1.0: funcionan igual con WebGL 1 y
 * WebGL 2, así que cubren también los iPhone y Android más antiguos.
 *
 * Un solo programa para todo (un `u_mode` por pieza): cada pieza es un
 * rectángulo con su textura, y el filtro se calcula en la GPU con dos niveles:
 *
 * - `u_edge` (0–1): transición. 1 cuando la pieza entra o sale del encuadre,
 *   0 en el centro. Mueve lo que «se anima»: tamaño del píxel, ráfagas de
 *   glitch, la línea de escaneo, el umbral del dither…
 * - `u_style` (0–1): cuánto se mezcla el filtro con la imagen original. En el
 *   centro vale el `rest` del filtro (src/config/media-wall.ts); pasar el
 *   ratón lo baja a 0 (nítida).
 *
 * Colores: `u_dark` (fondo del menú), `u_accent` (neón de la sección) y
 * `u_light` (texto del menú), leídos de los tokens CSS: si Pau cambia los
 * colores desde el panel, el muro los sigue.
 */

/** Modos de dibujo. Los filtros siguen el orden de `WALL_FILTERS` (+1). */
export const MODE = {
  plain: 0,
  pixel: 1,
  duotone: 2,
  dither: 3,
  rgb: 4,
  halftone: 5,
  scan: 6,
  /** Rótulo de bolo: caja del acento con texto oscuro (textura de máscara). */
  tag: 7,
  /** Rótulo bajo la pieza: texto claro (textura de máscara). */
  caption: 8,
} as const;

export const VERTEX_SHADER = /* glsl */ `
attribute vec2 a_pos;
uniform vec4 u_rect;   // x, y, ancho, alto (px CSS)
uniform vec2 u_view;   // tamaño del panel (px CSS)
varying vec2 v_uv;

void main() {
  vec2 px = u_rect.xy + a_pos * u_rect.zw;
  vec2 clip = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_pos;
}
`;

export const FRAGMENT_SHADER = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform sampler2D u_tex;
uniform vec4 u_cover;    // escala y desplazamiento de la UV (object-fit: cover + punto focal)
uniform vec2 u_size;     // tamaño de la pieza en px de dispositivo
uniform float u_dpr;
uniform float u_mode;
uniform float u_edge;
uniform float u_style;
uniform float u_dir;     // -1 entrando, +1 saliendo
uniform float u_time;
uniform float u_seed;
uniform float u_alpha;
uniform vec3 u_dark;
uniform vec3 u_accent;
uniform vec3 u_light;

varying vec2 v_uv;

// Trama Bayer sin operaciones de bits (GLSL ES 1.0).
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 tex(vec2 uv) { return texture2D(u_tex, u_cover.xy * clamp(uv, 0.0, 1.0) + u_cover.zw).rgb; }

bool is(float mode) { return abs(u_mode - mode) < 0.5; }

void main() {
  vec2 frag = v_uv * u_size;          // px de dispositivo dentro de la pieza
  vec3 original = tex(v_uv);
  vec3 col = original;
  float alpha = 1.0;

  if (is(${MODE.pixel}.0)) {
    // Mosaico: bloques de hasta un 12 % del ancho en los bordes; nítido en el centro.
    float block = max(1.0, floor(u_edge * u_edge * u_size.x * 0.12));
    vec2 uv = (floor(frag / block) + 0.5) * block / u_size;
    vec3 c = tex(uv);
    c = mix(c, floor(c * 6.0 + 0.5) / 6.0, u_edge);
    col = mix(original, c, max(u_style, step(1.5, block)));

  } else if (is(${MODE.duotone}.0)) {
    float l = luma(original);
    l = clamp((l - 0.5) * (1.0 + u_edge * 2.5) + 0.5, 0.0, 1.0);
    float levels = mix(48.0, 3.0, u_edge);
    l = floor(l * levels + 0.5) / levels;
    vec3 duo = mix(u_dark, u_accent, l);
    // Barrido de luz que recorre la pieza.
    float sweep = fract(v_uv.y * 0.6 + v_uv.x * 0.25 - u_time * 0.12 + u_seed);
    duo = mix(duo, u_light, smoothstep(0.035, 0.0, abs(sweep - 0.5)) * 0.35);
    col = mix(original, duo, u_style);

  } else if (is(${MODE.dither}.0)) {
    // 1 bit en celdas de 2 px CSS: entra desde la oscuridad y sale quemada en luz.
    float cell = max(2.0, floor(2.0 * u_dpr + 0.5));
    vec2 q = floor(frag / cell);
    float l = luma(tex((q + 0.5) * cell / u_size));
    l += u_dir * u_edge * 0.85;
    float on = step(bayer8(q), l);
    col = mix(original, mix(u_dark, u_accent, on), u_style);

  } else if (is(${MODE.rgb}.0)) {
    float slot = floor(u_time * 7.0 + u_seed * 13.0);
    float burst = step(0.84 - u_edge * 0.7, hash(vec2(slot, u_seed * 91.0)));
    float row = floor(v_uv.y * 22.0 + hash(vec2(slot, 1.0)) * 4.0);
    float cut = step(0.62, hash(vec2(row * 1.7, slot)));
    float shift = (hash(vec2(row, slot)) - 0.5) * 0.16 * burst * cut;
    vec2 uv = v_uv + vec2(shift, 0.0);
    float split = (0.004 + 0.04 * u_edge) * (0.6 + burst);
    vec3 c = vec3(tex(uv + vec2(split, 0.0)).r, tex(uv).g, tex(uv - vec2(split, 0.0)).b);
    float scan = step(0.5, fract(frag.y / (2.0 * u_dpr)));
    c *= 1.0 - 0.16 * scan;
    col = mix(original, c, u_style);

  } else if (is(${MODE.halftone}.0)) {
    // Trama de puntos a 45°: puntos oscuros sobre el acento, más gruesos en los bordes.
    float cell = mix(5.0, 15.0, u_edge) * u_dpr;
    vec2 p = vec2(frag.x + frag.y, frag.y - frag.x) * 0.70710678;
    vec2 centre = (floor(p / cell) + 0.5) * cell;
    vec2 back = vec2(centre.x - centre.y, centre.x + centre.y) * 0.70710678;
    float l = luma(tex(back / u_size));
    float r = sqrt(clamp(1.0 - l, 0.0, 1.0)) * cell * 0.64;
    float d = length(p - centre);
    float ink = 1.0 - smoothstep(r - 0.8, r + 0.8, d);
    col = mix(original, mix(u_accent, u_dark, ink), u_style);

  } else if (is(${MODE.scan}.0)) {
    // Línea de escaneo: revela al entrar (de arriba abajo) y borra al salir.
    float y = v_uv.y;
    float boundary = u_dir < 0.0 ? 1.0 - u_edge : u_edge;
    float shown = u_dir < 0.0 ? step(y, boundary) : step(boundary, y);
    float cellPx = 2.0 * u_dpr;
    float noise = hash(floor(frag / cellPx) + floor(u_time * 12.0)) - 0.5;
    float sil = step(0.52, luma(original) + noise * 0.3);
    float lines = 0.7 + 0.3 * step(0.5, fract(frag.y / (3.0 * u_dpr)));
    vec3 hidden = mix(u_dark, u_accent * 0.6, sil) * lines;
    vec3 c = mix(hidden, original, shown);
    float dist = abs(y - boundary) * u_size.y;
    float active = step(0.002, u_edge) * step(u_edge, 0.998);
    float line = (1.0 - smoothstep(0.0, 2.0 * u_dpr, dist)) * active;
    float glow = exp(-dist / (16.0 * u_dpr)) * 0.45 * active * (1.0 - shown);
    c = mix(c, u_accent, max(line, glow));
    col = mix(original, c, min(1.0, u_style * 4.0));

  } else if (is(${MODE.tag}.0) || is(${MODE.caption}.0)) {
    // Máscaras: rojo = caja, verde = texto. Se disuelven con la trama Bayer.
    vec4 m = texture2D(u_tex, u_cover.xy * v_uv + u_cover.zw);
    float box = is(${MODE.tag}.0) ? max(m.r, m.g) : 0.0;
    float text = m.g;
    vec2 q = floor(frag / max(2.0, floor(2.0 * u_dpr + 0.5)));
    float visible = step(bayer8(q), 1.0 - u_edge);
    if (is(${MODE.tag}.0)) {
      col = mix(u_accent, u_dark, text / max(box, 0.0001));
      alpha = box * visible;
    } else {
      col = u_light;
      alpha = text * visible * 0.85;
    }
  }

  alpha *= u_alpha;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;
