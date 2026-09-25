# Portfolio

Web de **travest15m0**, DJ y productora de eventos afincada en Madrid.

Astro 7 sobre Cloudflare Workers, sin React ni Tailwind. En construcción por fases:
hechas la 1 (estructura, navegación e Info), la 2 (bolos desde Supabase: next dates,
archive y barra de noticias), la 3 (vídeo de Media en HLS y transición de píxeles),
la 4 (reproductor de mixes), la 5 (formulario de contacto, redes y páginas legales) y la
6 (panel oculto para cambiar la barra de noticias, los bolos, los mixes, Info y el vídeo
sin tocar código). Falta el despliegue definitivo.

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
| `npm run test:e2e:admin` | Tests e2e del panel, con Supabase simulado (ver [Panel oculto](#panel-oculto)) |
| `npm run test:rls` | Comprueba contra Supabase que nadie puede escribir con la clave pública |
| `npm run media:hls -- "<vídeo>" --slug <nombre>` | Convierte un vídeo en HLS para Media (necesita ffmpeg) |
| `npm run media:upload` | Sube `.media/` a R2 (necesita las claves `R2_*` en `.env`) |
| `npm run media:serve` | Sirve `.media/` en `http://localhost:4322`, como si fuera R2 |
| `npm run media:mix -- "<audio>" --title "…"` | Prepara un mix para el reproductor y crea su fila en Supabase (necesita ffmpeg) |

Los e2e del formulario no envían emails ni llaman a Cloudflare: `tests/e2e/mock-services.mjs`
imita Turnstile (con el comportamiento de sus claves de prueba) y Resend en el puerto
4323. Con `E2E_TURNSTILE=real` se usa Turnstile de verdad, con sus claves de prueba.

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

`r2/cors.json` permite `GET` y `HEAD` desde GitHub Pages y `localhost:4321`, y `PUT`
(la subida de mixes desde el panel, fase 6) desde `localhost:4321`. Cuando haya dominio,
añade `https://<dominio>` a los `origins` de las dos reglas y vuelve a ejecutar el comando.

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

## Formulario de contacto

`/contact` tiene el formulario, el email de Pau como enlace `mailto:`, los enlaces a
SoundCloud e Instagram y el pie con las páginas legales. El mensaje **no se guarda en
ninguna base de datos**: se envía por email y «responder» apunta a quien escribe.

**Tres campos y nada más** (D58): email de contacto, teléfono (opcional) y mensaje. Al
enviarse bien, con JavaScript el aviso sale en la propia página y no se navega; sin
JavaScript se llega a `/mensaje-enviado`, así que recargar no reenvía.

Hay **dos caminos de envío**, según dónde esté alojada la web:

| | Cloudflare Workers | GitHub Pages (`STATIC_BUILD`) |
|---|---|---|
| Quién envía | Action `contact.send` → Resend | El navegador → API de Web3Forms |
| Validación | zod en el servidor | atributos del formulario (los textos de error son los mismos) |
| Turnstile | sí, verificado en el servidor | no (Web3Forms solo lo verifica en su plan de pago) |
| Límite de envíos | 5 por hora y por IP (KV) | el de Web3Forms (250 correos al mes) |
| Honeypot | sí (`botcheck`) | sí, lo comprueba Web3Forms |
| Sin JavaScript | no (Turnstile lo necesita) | sí |

El de Cloudflare es el definitivo; el de Web3Forms es lo que hace que el formulario
funcione en el despliegue de GitHub Pages (`src/lib/contact/web3forms.ts`). Para ese
camino solo hace falta una cuenta en <https://web3forms.com> **con el Gmail que tiene que
recibir los mensajes** y poner su clave de acceso en la variable `PUBLIC_WEB3FORMS_KEY`
(*Settings → Secrets and variables → Actions → Variables*). Es pública por diseño: acaba
escrita en el HTML. Sin ella, /contact muestra «formulario — próximamente».

Para el camino de Cloudflare hacen falta cuatro cosas (hasta entonces, en su lugar aparece
«formulario — próximamente» y quedan el correo y las redes):

1. **Resend** (<https://resend.com>): verificar el dominio (SPF y DKIM) y crear una clave
   de API. Plan gratuito: 100 emails al día.
2. **Turnstile** (panel de Cloudflare): un widget para el dominio y para `localhost`.
   Da una clave pública (`PUBLIC_TURNSTILE_SITE_KEY`) y una secreta
   (`TURNSTILE_SECRET_KEY`).
3. **Secrets en Cloudflare** (`npx wrangler secret put NOMBRE`): `RESEND_API_KEY`,
   `CONTACT_TO_EMAIL` (el email de Pau; nunca aparece en la web), `CONTACT_FROM_EMAIL`
   (por ejemplo `web@<dominio>`, verificado en Resend) y `TURNSTILE_SECRET_KEY`. En local
   van en `.env`.
4. **Un namespace de KV** para el límite de envíos: está declarado en `wrangler.jsonc`
   sin `id`, así que el primer `npx wrangler deploy` lo crea (o se crea a mano con
   `npx wrangler kv namespace create CONTACT_RATE_LIMIT` y se pega su `id`). En local lo
   simula wrangler, sin configurar nada.

Cómo se protege de los envíos automáticos **en Cloudflare**, en este orden:

- una casilla oculta (*honeypot*, `botcheck`): si llega marcada, el mensaje se descarta y
  se responde como si se hubiera enviado;
- **5 envíos por hora y por IP**, en KV; del sexto en adelante, «Has enviado demasiados
  mensajes. Prueba más tarde.». No se guarda la IP, sino un código derivado de ella que
  caduca a la hora;
- **Turnstile**, verificado en el servidor con la IP de quien envía. Si Cloudflare no
  responde, el mensaje no se envía (nunca se deja pasar sin comprobar);
- si Resend falla con un error suyo (5xx), se reintenta **una vez** con la misma clave de
  idempotencia, así que no puede llegar dos veces.

En GitHub Pages queda la casilla oculta (la comprueba Web3Forms en su servidor) y su
propio filtro anti-spam, que va incluido en el plan gratuito. Ahí **no** hay límite por IP
ni Turnstile: si algún día entra spam, en el panel de Web3Forms se puede activar hCaptcha,
pero entonces el formulario deja de funcionar sin JavaScript.

En Cloudflare el formulario funciona sin JavaScript (POST normal y redirección con el
resultado), pero **Turnstile lo necesita**: con el JS desactivado aparece un aviso que lo
explica. En GitHub Pages funciona sin JavaScript sin más.

Los textos y los límites están en `src/config/contact.ts`; la lógica del servidor, en
`src/lib/contact/` y `src/lib/email.ts`.

El teléfono se valida con una expresión (`PHONE_PATTERN`) que se escribe **una sola vez** y
se usa como `pattern` del campo y en el servidor. Ojo al tocarla: el navegador la compila
con la marca `v` y, si no compila, **se salta el `pattern` sin avisar**. Lo vigila un test.

### Páginas legales

`/aviso-legal` y `/privacidad` están **sin terminar a propósito**: son plantillas con los
apartados que pide la ley y con `TODO` a la vista donde faltan los datos de Pau (nombre,
NIF, domicilio, dirección de contacto, plazos de conservación…). La parte técnica sí es
exacta: describe lo que hace la web hoy. Hay que completarlas y revisarlas antes de
publicar la web en su dominio; esto no es asesoramiento legal.

## Panel oculto

Una página con usuario y contraseña desde la que Pau cambia, sin tocar código:

- el **texto de la barra de noticias** (con vista previa en vivo y la opción de añadir
  sola la próxima fecha);
- los **bolos**: añadir uno o **varias fechas** de la misma fiesta y sala (residencias),
  editar, borrar (con confirmación) y despublicar; aviso si ya hay un bolo en esa fecha y
  sala; el **archivo** en páginas de 50 para corregir erratas;
- los **mixes**: subir el audio (y la carátula) directamente a R2, publicar, ordenar,
  borrar;
- el **texto de Info** (Markdown sencillo: `## titulillo`, párrafos y
  `[enlaces](https://…)`), con vista previa y botón para volver al de `src/content/info.md`;
- el **vídeo de Media**: punto focal, enlace «ver set completo» y, al preparar un vídeo
  nuevo, el bloque que imprime `npm run media:hls`;
- la **verificación en dos pasos** (TOTP) de su cuenta.

Al guardar, la web pública se actualiza al momento (se purga la caché de Cloudflare por
etiquetas; como mucho, en 60 s).

**Dónde está.** En `https://<dominio>/<ADMIN_PATH>`. El nombre es el secreto
`ADMIN_PATH`, que **no se escribe en ningún archivo del repo** (es público): la ruta es
dinámica (`src/pages/[admin]/`) y el middleware compara el primer tramo de la URL con el
secreto; si no coincide, responde la misma 404 que cualquier otra ruta. No se enlaza
desde ningún sitio, no está en `robots.txt` ni en el sitemap, y lleva `noindex`,
`X-Robots-Tag` y `Cache-Control: no-store`. Solo funciona con servidor (Cloudflare): en
GitHub Pages no existe.

**Puesta en marcha** (una vez, en el dashboard de Supabase y en Cloudflare):

1. Aplicar la migración `supabase/migrations/0005_admin_panel.sql` (quién guarda cada
   cambio, límites de Info y vídeo, y TOTP obligatorio para escribir si la cuenta lo
   tiene).
2. *Authentication → Sign In / Providers*: **desactivar** «Allow new users to sign up».
3. *Authentication → Attack Protection*: **CAPTCHA** con Cloudflare Turnstile, con la
   clave secreta del mismo widget que el formulario de contacto.
4. *Authentication → Users → Add user*: la cuenta de Pau (email y contraseña robusta,
   «Auto Confirm User»). Luego, darle acceso con `supabase/snippets/add-admin.sql`
   (cambiando el email; no lo guardes con el email real).
5. Secrets del Worker (`npx wrangler secret put NOMBRE`; en local, `.env`): `ADMIN_PATH`
   y, si se quiere entrar con un alias corto en vez del email, `ADMIN_USERNAME` y
   `ADMIN_EMAIL`. Para subir mixes desde el panel, también `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET` (un token de R2 limitado al
   bucket, «Object Read & Write»).
6. CORS del bucket (`r2/cors.json`): añadir el dominio de la web a la regla de `PUT`
   para que el navegador pueda subir los mixes.
7. Recomendado: que Pau active la **verificación en dos pasos** en *seguridad*.

**Seguridad.** Sin sistema de usuarios propio: Supabase Auth con cookies `httpOnly`,
`secure` y `sameSite=lax` (`@supabase/ssr`), el JWT validado con `getClaims()` y la
pertenencia a `admins` comprobada en cada petición. Errores genéricos («Usuario o
contraseña incorrectos.»), CAPTCHA y el límite de intentos de Supabase, protección CSRF
de Astro (`security.checkOrigin`) y todas las escrituras con la sesión de Pau y la clave
publicable: las políticas RLS son la última barrera, y la clave secreta de Supabase no
está en el Worker. No hay «olvidé mi contraseña» público: se cambia desde el dashboard.

**Tests.** `npm run test:e2e:admin` compila la web leyendo de un Supabase simulado
(`tests/e2e-admin/mock-supabase.mjs`, con las mismas reglas que las políticas RLS) y
prueba el login, los errores, la 404, las cabeceras, la barra, los bolos (y que aparecen
en la web), los duplicados, las varias fechas, el archivo, Info, el vídeo, la subida de
mixes (R2 interceptado en el navegador), el TOTP y el uso a 375 px. Las migraciones y
`supabase/tests/rls.sql` se prueban en un Postgres de verdad sin red (PGlite) dentro de
`npm test` (`tests/unit/rls-sql.test.ts`).

El código: `src/pages/[admin]/`, `src/layouts/AdminLayout.astro`,
`src/components/admin/`, `src/actions/admin.ts`, `src/lib/admin/`,
`src/scripts/admin/` y `src/styles/admin.css`; textos y límites en `src/config/admin.ts`.

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
  `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `PUBLIC_WEB3FORMS_KEY`
  (formulario de contacto). Cuando exista el bucket de R2, añade también
  `PUBLIC_MEDIA_BASE_URL` para que se vean el vídeo de Media y el reproductor.
- **Límites**: sin servidor, el **panel (fase 6) no existe** (sus páginas no se compilan)
  y el formulario de contacto envía por Web3Forms en lugar de Resend, sin Turnstile ni
  límite por IP (ver [Formulario de contacto](#formulario-de-contacto)). GitHub pausa los
  workflows programados tras 60 días sin actividad en el repo: si pasa, se reactiva en la
  pestaña *Actions*.
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
  layouts/     BaseLayout y AdminLayout (panel)
  pages/       una página por sección; [admin]/ es el panel oculto
  scripts/     JS del navegador (navegación, móvil, cursor, vídeo, reproductor, píxeles, formulario)
  styles/      reset, tokens, estilos globales y el rotulador (highlighter.css)
  lib/         fechas, datos (Supabase o fixtures), barajado, SEO, rutas con base,
               contacto (esquema, Turnstile, límite y envío), cabeceras de seguridad
               y el panel (admin/: sesión, esquemas, firma de R2, vídeo)
  actions/     Astro Actions del servidor (contact.send y admin.*)
  middleware.ts  datos de la columna izquierda, caché, cabeceras de seguridad y
               acceso al panel
scripts/       importación de bolos, pipeline de vídeo y de mixes, subida a R2 y servidor local (Node)
r2/            CORS del bucket
supabase/      migraciones, pruebas de RLS y SQL de ayuda (snippets/)
tests/
  unit/        Vitest
  components/  componentes .astro renderizados con la API de contenedor (Vitest)
  e2e/         Playwright
  e2e-admin/   Playwright del panel, con Supabase simulado
  rls/         permisos de Supabase (necesita .env)
```

Las variables de entorno están documentadas en `.env.example`. Ningún secreto va en
el repositorio.
