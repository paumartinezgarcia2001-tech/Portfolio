/**
 * hls.js publica los tipos de su build completo, pero no los de `hls.js/light`
 * (el que se usa en Media, C15): es la misma API sin subtítulos, audio
 * alternativo ni DRM.
 */
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
