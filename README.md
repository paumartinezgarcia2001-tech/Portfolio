# Portfolio

Web de **travest15m0**, DJ y productora de eventos afincada en Madrid.

Astro 7 sobre Cloudflare Workers, sin React ni Tailwind. En construcción por fases:
hechas la 1 (estructura, navegación e Info), la 2 (bolos desde Supabase: next dates,
archive y barra de noticias), la 3 (vídeo de Media en HLS y transición de píxeles) y
la 4 (reproductor de mixes). Faltan el formulario, el panel y el despliegue definitivo.

Versión provisional: <https://paumartinezgarcia2001-tech.github.io/Portfolio/>
(GitHub Pages, ver [más abajo](#despliegue-provisional-github-pages)).

## Arrancar en local

Requisitos: Node 24 (ver `.nvmrc`).

```sh
npm install
cp .env.example .env        # rellena PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev                 # http://localhost:4321
```

Sin esas dos variables la web funciona igual, pero las listas de bolos salen vacías
con un aviso: la capa de datos nunca rompe la página.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (runtime de Cloudflare, `workerd`) |
| `npm run build` | Compila la web en `dist/` |
| `npm run preview` | Sirve la versión compilada con `workerd` |
| `npm run build:pages` | Compila la versión estática para GitHub Pages (necesita las variables de Supabase) |
| `npm run preview:pages` | Sirve esa versión en `http://localhost:4321/Portfolio/` |
| `npm run typecheck` | Genera los tipos de Cloudflare y ejecuta `astro check` |
| `npm run lint` | ESLint |
| `npm test` | Tests unitarios y de componentes (Vitest) |
| `npm run test:e2e` | Tests e2e (Playwright). La primera vez: `npx playwright install` |
| `npm run test:rls` | Comprueba contra Supabase que nadie puede escribir con la clave pública |
| `npm run media:hls -- "<vídeo>" --slug <nombre>` | Convierte un vídeo en HLS para Media (necesita ffmpeg) |
| `npm run media:upload` | Sube `.media/` a R2 (necesita las claves `R2_*` en `.env`) |
| `npm run media:serve` | Sirve `.media/` en `http://localhost:4322`, como si fuera R2 |
| `npm run media:mix -- "<audio>" --title "…"` | Prepara un mix para el reproductor y crea su fila en Supabase (necesita ffmpeg) |

Los e2e compilan la web y la sirven en el puerto 4321. Con `PW_ALL_BROWSERS=1` se
prueban también Firefox y WebKit; las capturas quedan en `test-results/screenshots/`.
Los de Media y del reproductor generan antes un vídeo y tres mixes de prueba con ffmpeg
(el vídeo en AV1, porque el Chromium de Playwright no trae H.264) y los sirven en el
puerto 4322; sin ffmpeg, se saltan. Los navegadores de los e2e dejan sonar sin tocar la
página (como Chrome en una web que ya conoce); el bloqueo de la primera visita se
simula en los tests que lo necesitan.

## Datos (Supabase)

- El esquema está en `supabase/migrations/` (`0001` tablas, `0002` RLS, `0003` mueve
  `is_admin()` fuera de la API e indexa las claves ajenas, `0004` deja que `mixes`
  guarde rutas relativas al bucket). Se aplican con el MCP de Supabase o con
  `npx supabase db push`.
- Los bolos se importaron de los `.xlsx` de `Raw_Files/WEB PAGE FILES/` con:

  ```sh
  node scripts/import-gigs.mjs --dry-run          # informe, sin tocar nada
  node scripts/import-gigs.mjs --sql bolos.sql    # genera el SQL (para el SQL Editor)
  node --env-file=.env scripts/import-gigs.mjs    # upsert con SUPABASE_SECRET_KEY
  ```

  Es idempotente: identifica cada bolo por fecha + sala + fiesta y solo actualiza lo
  que cambia.
- `supabase/tests/rls.sql` comprueba dentro de la base de datos que el público solo
  puede leer lo publicado.

## Vídeo de Media

El vídeo no está en el repo: se sirve en HLS desde el bucket de R2
`travest15m0-media`, en el dominio de `PUBLIC_MEDIA_BASE_URL`. Sin esa variable,
Media muestra un aviso en su lugar. El vídeo se ve nítido, sin pixelar; la textura LCD
de toda la web sí le pasa por encima.

Para cambiar el vídeo:

1. **Generar el HLS** (necesita ffmpeg; en Windows, `winget install Gyan.FFmpeg`):

   ```sh
   npm run media:hls -- "../Raw_Files/Audiovisual Content/INSULTO CLUB/CUKI.mp4" --slug cuki-insulto
   ```

   Saca una versión 4:5 (escritorio) y otra 9:16 (móvil) en `.media/video/<slug>-<hash>/`:
   H.264 en 1080/720/480 (sin ampliar nunca), segmentos de 4 s, MP4 de respaldo y pósters
   AVIF y JPG. Opciones útiles: `--start` y `--duration` (recorte), `--focus-x` y
   `--focus-y` (encuadre), `--no-audio` (vídeo solo visual) y `--poster-at`. Todo en
   `npm run media:hls -- --help`.
2. **Subirlo a R2**: `npm run media:upload -- video/<slug>-<hash>`. Pone el
   `Content-Type` y la caché inmutable, y no vuelve a subir lo que ya está.
3. **Apuntar la web al vídeo nuevo**: pegar en `src/config/media.ts` el bloque que
   imprime el paso 1 y rellenar `title` (lo leen los lectores de pantalla) y, si es
   un fragmento del set de LAGRIMA, `fullSet: LAGRIMA_FULL_SET`.

Para verlo en local sin R2: `npm run media:serve` y `PUBLIC_MEDIA_BASE_URL=http://localhost:4322`
en `.env`.

**R2, una sola vez**: crear el bucket, darle un dominio público (`media.<dominio>`; mientras
no haya dominio sirve la URL `r2.dev` del bucket), crear un token de API de R2 con permiso
de escritura en el bucket (sus datos van en `.env`, ver `.env.example`) y configurar CORS:

```sh
npx wrangler r2 bucket cors set travest15m0-media --file r2/cors.json
```

`r2/cors.json` permite `GET` y `HEAD` desde GitHub Pages y `localhost:4321`. Cuando
haya dominio, añade `https://<dominio>` a `origins` y vuelve a ejecutar el comando.

## Reproductor de mixes

La sexta fila del menú: solo tres botones en el centro, **anterior · reproducir/pausar ·
siguiente** (canción anterior o siguiente). La música **empieza sola al abrir la web**; si
el navegador no lo deja (lo normal en la primera visita: Chrome, Firefox y Safari piden
que la persona haya tocado la página), empieza con su primer clic, toque o tecla. En
móvil, dentro de una sección, los mismos botones van en una mini-barra fija abajo.

- Los mixes salen de la tabla `mixes` de Supabase (solo los publicados) y se barajan en
  cada visita. La música no se corta al cambiar de sección.
- Los archivos están en el bucket de R2, igual que el vídeo: la tabla guarda la ruta
  dentro del bucket (`mixes/<nombre>-<hash>.mp3`) y la web le pone delante
  `PUBLIC_MEDIA_BASE_URL`. **Sin esa variable, el reproductor dice «reproductor —
  próximamente»** (es lo que se ve ahora en GitHub Pages).
- Si la persona pausa la música, al recargar no vuelve a arrancar sola. Si en Media se
  activa el sonido del vídeo, la música se pausa y vuelve al salir de Media.

Para añadir un mix (necesita ffmpeg):

```sh
npm run media:mix -- "../Raw_Files/…/mix.wav" --title "Insulto Club · 2026"
```

Lo deja en MP3 a 320 kbps y a unos −14 LUFS en `.media/mixes/`, lo sube a R2 si hay
claves en `.env` y crea su fila en `mixes` (con `SUPABASE_SECRET_KEY` en `.env`; si no,
imprime el SQL para el SQL Editor). Opciones: `--subtitle`, `--artwork <imagen>`
(carátula cuadrada), `--draft` (sin publicar), `--copy` (no recodifica un MP3) y
`--sql <archivo>`. Todo en `npm run media:mix -- --help`.

Ahora hay tres **audios de prueba** publicados en la tabla. Sus MP3 ya preparados están
en `../Claude outputs/fase4/media/mixes/`. Cuando exista el bucket:

```sh
npm run media:upload -- --root "../Claude outputs/fase4/media"
```

Para oírlos en local sin R2: copia esa carpeta `mixes/` dentro de `.media/`, arranca
`npm run media:serve` y pon `PUBLIC_MEDIA_BASE_URL=http://localhost:4322` en `.env`. Para
quitarlos cuando lleguen los mixes de verdad: bórralos (o despublícalos) en Supabase.

## Despliegue provisional (GitHub Pages)

Hasta que la web esté en Cloudflare (fase 7), lo construido se publica como web
estática en <https://paumartinezgarcia2001-tech.github.io/Portfolio/>.

- **Cómo**: `.github/workflows/deploy-pages.yml` compila con `astro.config.pages.mjs`
  (salida estática, `base` `/Portfolio`, `noindex`) y publica `dist/` en Pages.
- **Cuándo**: con cada push a `main`, cada día a las 07:17 UTC (después del corte de
  las 08:00 de Madrid, para que los bolos pasen solos al archivo) y a mano desde
  *Actions → Deploy GitHub Pages → Run workflow*. Tras añadir un bolo o cambiar la
  barra de noticias en Supabase, lánzalo a mano para verlo al momento.
- **Datos**: se leen de Supabase **al compilar**. Si Supabase falla, el build se
  detiene y sigue publicada la versión anterior (nunca se publican listas vacías).
- **Ajustes del repo** (una sola vez): *Settings → Pages → Source: GitHub Actions* y,
  en *Settings → Secrets and variables → Actions → Variables*,
  `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Cuando exista el bucket de
  R2, añade también `PUBLIC_MEDIA_BASE_URL` para que se vean el vídeo de Media y el
  reproductor.
- **Límites**: sin servidor, así que el formulario (fase 5) y el panel (fase 6) no
  funcionarán aquí. GitHub pausa los workflows programados tras 60 días sin actividad
  en el repo: si pasa, se reactiva en la pestaña *Actions*.
- **Al pasar a Cloudflare**: borra `astro.config.pages.mjs` y el workflow, y desactiva
  Pages.

Las rutas internas usan `withBase()` (`src/lib/url.ts`) para funcionar tanto en la raíz
de un dominio como bajo `/Portfolio`.

## Estructura

```
src/
  assets/      textura del rotulador (SVG)
  config/      datos de la web, secciones, vídeo de Media y ajustes del filtro pixelado
  content/     textos en Markdown (info.md)
  components/  piezas del layout (menú, barra de noticias, cursor, vídeo…)
  layouts/     BaseLayout
  pages/       una página por sección
  scripts/     JS del navegador (navegación, móvil, cursor, vídeo, reproductor, píxeles)
  styles/      reset, tokens, estilos globales y el rotulador (highlighter.css)
  lib/         fechas, datos (Supabase o fixtures), barajado, SEO, rutas con base
  middleware.ts  carga la barra de noticias y fija la caché
scripts/       importación de bolos, pipeline de vídeo y de mixes, subida a R2 y servidor local (Node)
r2/            CORS del bucket
supabase/      migraciones y pruebas de RLS
tests/
  unit/        Vitest
  components/  componentes .astro renderizados con la API de contenedor (Vitest)
  e2e/         Playwright
  rls/         permisos de Supabase (necesita .env)
```

Las variables de entorno están documentadas en `.env.example`. Ningún secreto va en
el repositorio.
