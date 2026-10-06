/**
 * Sonoridad integrada según ITU-R BS.1770-4 / EBU R128 (D64), para normalizar
 * los mixes en el navegador como hace `npm run media:mix` con ffmpeg
 * (`loudnorm`, −14 LUFS).
 *
 * - Ponderación K: dos filtros biquad (estante alto + paso alto), con los
 *   coeficientes calculados para cualquier frecuencia de muestreo (como
 *   libebur128).
 * - Bloques de 400 ms con solape del 75 % (se guardan trozos de 100 ms y se
 *   juntan de cuatro en cuatro).
 * - Puertas: absoluta a −70 LUFS y relativa a −10 LU.
 * - Mono o estéreo (peso 1 por canal); a partir del tercer canal no se miden.
 *
 * Funciones puras, sin DOM: corren en el navegador (panel) y en los tests.
 */

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Coeficientes de la ponderación K para `sampleRate` (dos etapas). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Etapa 1: estante alto (modela la cabeza).
  let f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  // Etapa 2: paso alto (RLB).
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + k / q + k * k;
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, highpass];
}

const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

const energyToLufs = (energy: number) => -0.691 + 10 * Math.log10(energy);

export class LoudnessMeter {
  readonly sampleRate: number;
  readonly channels: number;
  #filters: [Biquad, Biquad];
  /** Estado de los filtros por canal: [x1, x2, y1, y2] de cada etapa. */
  #state: Float64Array[];
  #subblockFrames: number;
  #subblockFilled = 0;
  #subblockSum = 0;
  #subblocks: number[] = [];
  #peak = 0;
  #frames = 0;

  constructor(sampleRate: number, channels: number) {
    if (!(sampleRate > 0)) throw new Error(`Frecuencia de muestreo no válida: ${sampleRate}`);
    this.sampleRate = sampleRate;
    this.channels = Math.max(1, Math.min(2, channels));
    this.#filters = kWeighting(sampleRate);
    this.#state = Array.from({ length: this.channels }, () => new Float64Array(8));
    this.#subblockFrames = Math.max(1, Math.round(sampleRate / 10));
  }

  /** Pico de muestra (valor absoluto, 1 = 0 dBFS) de todo lo medido. */
  get peak(): number {
    return this.#peak;
  }

  /** Segundos medidos. */
  get duration(): number {
    return this.#frames / this.sampleRate;
  }

  /** Añade audio (un `Float32Array` por canal, todos del mismo largo). */
  push(channels: Float32Array[]): void {
    const used = channels.slice(0, this.channels);
    const length = used[0]?.length ?? 0;
    const [s, h] = this.#filters;
    let offset = 0;
    while (offset < length) {
      const take = Math.min(length - offset, this.#subblockFrames - this.#subblockFilled);
      for (let c = 0; c < used.length; c++) {
        const data = used[c]!;
        const st = this.#state[c]!;
        let sx1 = st[0]!;
        let sx2 = st[1]!;
        let sy1 = st[2]!;
        let sy2 = st[3]!;
        let hx1 = st[4]!;
        let hx2 = st[5]!;
        let hy1 = st[6]!;
        let hy2 = st[7]!;
        let sum = 0;
        let peak = this.#peak;
        for (let i = offset; i < offset + take; i++) {
          const x = data[i]!;
          const ax = x < 0 ? -x : x;
          if (ax > peak) peak = ax;
          const y1 = s.b0 * x + s.b1 * sx1 + s.b2 * sx2 - s.a1 * sy1 - s.a2 * sy2;
          sx2 = sx1;
          sx1 = x;
          sy2 = sy1;
          sy1 = y1;
          const y2 = h.b0 * y1 + h.b1 * hx1 + h.b2 * hx2 - h.a1 * hy1 - h.a2 * hy2;
          hx2 = hx1;
          hx1 = y1;
          hy2 = hy1;
          hy1 = y2;
          sum += y2 * y2;
        }
        st[0] = sx1;
        st[1] = sx2;
        st[2] = sy1;
        st[3] = sy2;
        st[4] = hx1;
        st[5] = hx2;
        st[6] = hy1;
        st[7] = hy2;
        this.#subblockSum += sum;
        this.#peak = peak;
      }
      this.#subblockFilled += take;
      offset += take;
      if (this.#subblockFilled === this.#subblockFrames) {
        this.#subblocks.push(this.#subblockSum / this.#subblockFrames);
        this.#subblockSum = 0;
        this.#subblockFilled = 0;
      }
    }
    this.#frames += length;
  }

  /** Sonoridad integrada (LUFS); `-Infinity` si es silencio o dura menos de 400 ms. */
  integrated(): number {
    const sub = this.#subblocks;
    const blocks: number[] = [];
    for (let i = 0; i + 3 < sub.length; i++) {
      blocks.push((sub[i]! + sub[i + 1]! + sub[i + 2]! + sub[i + 3]!) / 4);
    }
    const aboveAbsolute = blocks.filter((energy) => energy > 0 && energyToLufs(energy) > ABSOLUTE_GATE);
    if (aboveAbsolute.length === 0) return -Infinity;
    const meanAbsolute = aboveAbsolute.reduce((a, b) => a + b, 0) / aboveAbsolute.length;
    const relativeGate = energyToLufs(meanAbsolute) + RELATIVE_GATE;
    const gated = aboveAbsolute.filter((energy) => energyToLufs(energy) > relativeGate);
    if (gated.length === 0) return -Infinity;
    return energyToLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
}

export interface GainPlan {
  /** Sonoridad medida (LUFS). */
  measuredLufs: number;
  /** Ganancia que se aplica (dB). */
  gainDb: number;
  /** Factor lineal. */
  gain: number;
  /** `true` si el techo de picos ha impedido llegar al objetivo. */
  peakLimited: boolean;
  /** Sonoridad que queda (LUFS). */
  resultLufs: number;
}

/**
 * Ganancia para llevar el mix a `targetLufs` sin que los picos pasen de
 * `peakCeilingDb`. Es una ganancia fija, como `loudnorm` en modo lineal: no
 * comprime ni limita. Si subir hasta el objetivo haría pasar los picos, se
 * queda por debajo.
 */
export function planGain(measuredLufs: number, peak: number, targetLufs: number, peakCeilingDb: number): GainPlan {
  if (!Number.isFinite(measuredLufs)) {
    return { measuredLufs, gainDb: 0, gain: 1, peakLimited: false, resultLufs: measuredLufs };
  }
  let gainDb = targetLufs - measuredLufs;
  let peakLimited = false;
  if (peak > 0) {
    const peakDb = 20 * Math.log10(peak);
    if (peakDb + gainDb > peakCeilingDb) {
      gainDb = peakCeilingDb - peakDb;
      peakLimited = true;
    }
  }
  return { measuredLufs, gainDb, gain: 10 ** (gainDb / 20), peakLimited, resultLufs: measuredLufs + gainDb };
}
