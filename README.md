# Portfolio

Web de **travest15m0**, DJ y productora de eventos afincada en Madrid.

Astro 7 sobre Cloudflare Workers, sin React ni Tailwind. En construcción por fases:
la fase 1 deja la estructura, la navegación y la sección Info; los datos, el vídeo,
el reproductor y el formulario llegan en las siguientes.

## Arrancar en local

Requisitos: Node 24 (ver `.nvmrc`).

```sh
npm install
cp .env.example .env        # de momento no hace falta rellenar nada
npm run dev                 # http://localhost:4321
```

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (runtime de Cloudflare, `workerd`) |
| `npm run build` | Compila la web en `dist/` |
| `npm run preview` | Sirve la versión compilada con `workerd` |
| `npm run typecheck` | Genera los tipos de Cloudflare y ejecuta `astro check` |
| `npm run lint` | ESLint |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests e2e (Playwright). La primera vez: `npx playwright install` |

Los e2e compilan la web y la sirven en el puerto 4321. Con `PW_ALL_BROWSERS=1` se
prueban también Firefox y WebKit; las capturas quedan en `test-results/screenshots/`.

## Estructura

```
src/
  config/      datos de la web, secciones y ajustes del filtro pixelado
  content/     textos en Markdown (info.md)
  components/  piezas del layout (menú, barra de noticias, cursor…)
  layouts/     BaseLayout
  pages/       una página por sección
  scripts/     JS del navegador (navegación, móvil, cursor)
  styles/      reset, tokens y estilos globales
tests/
  unit/        Vitest
  e2e/         Playwright
```

Las variables de entorno están documentadas en `.env.example`. Ningún secreto va en
el repositorio.
