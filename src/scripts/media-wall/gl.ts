/**
 * Capa WebGL del muro (D65): un canvas, un programa y un rectángulo por pieza.
 *
 * - WebGL 2 si lo hay y, si no, WebGL 1: los shaders son GLSL ES 1.0 y solo se
 *   usa lo que tienen los dos (texturas NPOT con CLAMP_TO_EDGE y sin mipmaps).
 * - Sin antialias ni canal alfa en el canvas: el muro es opaco y las piezas
 *   son rectángulos alineados; así el navegador compone más barato.
 * - `software`: el navegador avisa de que pintaría sin GPU (p. ej. SwiftShader).
 *   El muro lo sabe y arranca a menos resolución.
 */
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import type { TextureSource } from './sources';

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const UNIFORMS = [
  'u_rect',
  'u_view',
  'u_tex',
  'u_cover',
  'u_size',
  'u_dpr',
  'u_mode',
  'u_edge',
  'u_style',
  'u_dir',
  'u_time',
  'u_seed',
  'u_alpha',
  'u_dark',
  'u_accent',
  'u_light',
] as const;

type UniformName = (typeof UNIFORMS)[number];

export interface QuadParams {
  /** Rectángulo en px CSS. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** UV: escala (x, y) y desplazamiento (x, y). */
  cover: readonly [number, number, number, number];
  mode: number;
  edge: number;
  style: number;
  dir: number;
  seed: number;
  alpha: number;
}

export interface Palette {
  dark: readonly [number, number, number];
  accent: readonly [number, number, number];
  light: readonly [number, number, number];
}

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('No se ha podido crear el shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader: ${log ?? 'error desconocido'}`);
  }
  return shader;
}

export class WallGL {
  readonly gl: GL;
  readonly canvas: HTMLCanvasElement;
  readonly version: 1 | 2;
  readonly software: boolean;
  #program: WebGLProgram | null = null;
  #buffer: WebGLBuffer | null = null;
  #uniforms = new Map<UniformName, WebGLUniformLocation | null>();
  #view = { w: 1, h: 1, dpr: 1 };

  private constructor(canvas: HTMLCanvasElement, gl: GL, version: 1 | 2, software: boolean) {
    this.canvas = canvas;
    this.gl = gl;
    this.version = version;
    this.software = software;
    this.setup();
  }

  /** WebGL 2 → WebGL 1, primero exigiendo GPU y después sin exigirla. `null` si no hay ninguno. */
  static create(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}): WallGL | null {
    const base: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'default',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    };
    for (const software of [false, true]) {
      const attrs = { ...base, failIfMajorPerformanceCaveat: !software };
      const gl2 = canvas.getContext('webgl2', attrs);
      const gl = gl2 ?? (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);
      if (!gl) continue;
      try {
        return new WallGL(canvas, gl, gl2 ? 2 : 1, software);
      } catch (error) {
        console.warn('[media-wall] WebGL no ha podido arrancar.', error);
        return null;
      }
    }
    return null;
  }

  /** Programa, geometría y estado. Se vuelve a llamar tras recuperar el contexto. */
  setup(): void {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('No se ha podido crear el programa');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Programa: ${gl.getProgramInfoLog(program) ?? 'error desconocido'}`);
    }
    this.#program = program;
    gl.useProgram(program);
    this.#uniforms.clear();
    for (const name of UNIFORMS) this.#uniforms.set(name, gl.getUniformLocation(program, name));

    this.#buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.uniform1i(this.#u('u_tex'), 0);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  /** Tamaño del panel en px CSS y escala de render (densidad × calidad). */
  resize(cssW: number, cssH: number, scale: number): void {
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.#view = { w: cssW, h: cssH, dpr: scale };
  }

  createTexture(): WebGLTexture | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  /** Sube una imagen, un vídeo (su fotograma actual) o un canvas. `false` si falla (p. ej. CORS). */
  upload(texture: WebGLTexture, source: TextureSource): boolean {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      return true;
    } catch (error) {
      console.warn('[media-wall] No se ha podido subir una textura.', error);
      return false;
    }
  }

  deleteTexture(texture: WebGLTexture | null): void {
    if (texture && !this.lost) this.gl.deleteTexture(texture);
  }

  /** Empieza un fotograma: borra con el fondo y fija la paleta y el tiempo. */
  begin(palette: Palette, time: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b] = palette.dark;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.#u('u_view'), this.#view.w, this.#view.h);
    gl.uniform1f(this.#u('u_dpr'), this.#view.dpr);
    gl.uniform1f(this.#u('u_time'), time);
    gl.uniform3f(this.#u('u_dark'), ...palette.dark);
    gl.uniform3f(this.#u('u_accent'), ...palette.accent);
    gl.uniform3f(this.#u('u_light'), ...palette.light);
  }

  draw(texture: WebGLTexture, quad: QuadParams): void {
    const gl = this.gl;
    const dpr = this.#view.dpr;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(this.#u('u_rect'), quad.x, quad.y, quad.w, quad.h);
    gl.uniform4f(this.#u('u_cover'), ...quad.cover);
    gl.uniform2f(this.#u('u_size'), quad.w * dpr, quad.h * dpr);
    gl.uniform1f(this.#u('u_mode'), quad.mode);
    gl.uniform1f(this.#u('u_edge'), quad.edge);
    gl.uniform1f(this.#u('u_style'), quad.style);
    gl.uniform1f(this.#u('u_dir'), quad.dir);
    gl.uniform1f(this.#u('u_seed'), quad.seed);
    gl.uniform1f(this.#u('u_alpha'), quad.alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Libera la GPU (al salir de Media). */
  destroy(): void {
    const gl = this.gl;
    if (!this.lost) {
      gl.deleteBuffer(this.#buffer);
      gl.deleteProgram(this.#program);
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  #u(name: UniformName): WebGLUniformLocation | null {
    return this.#uniforms.get(name) ?? null;
  }
}
