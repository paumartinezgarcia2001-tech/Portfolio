# Portfolio

Web de **travest15m0**, DJ y productora de eventos afincada en Madrid.

Astro 7 sobre Cloudflare Workers, sin React ni Tailwind. Cinco secciones (info, next
dates, media, archive y contact), un reproductor de mixes que sigue sonando al navegar
y un panel oculto desde el que Pau cambia la barra de noticias, los bolos, los mixes,
Info, el vídeo de Media y los colores sin tocar código.

En línea: <https://portfolio.pau-martinez-garcia-2001.workers.dev> (mientras no haya
dominio propio).

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

Los e2e compilan la web con datos de prueba (`DATA_SOURCE=fixtures`) y la sirven en el
puerto 4321. Con `PW_ALL_BROWSERS=1` se prueban también Firefox y WebKit; las capturas
quedan en `test-results/screenshots/`. Los de Media y del reproductor generan antes un
vídeo y tres mixes de prueba con ffmpeg (el vídeo en AV1, porque el Chromium de
Playwright no trae H.264) y los sirven en el puerto 4322; sin ffmpeg, se saltan. Los
widgets de SoundCloud e Instagram se interceptan (`tests/e2e/social-helpers.ts`): los
tests no salen a esos dominios. Los navegadores de los e2e dejan sonar sin tocar la
página (como Chrome en una web que ya conoce); el bloqueo de la primera visita se
simula en los tests que lo necesitan.

## Datos (Supabase)

- El esquema está en `supabase/migrations/`: `0001` tablas, `0002` RLS, `0003` mueve
  `is_admin()` fuera de la API e indexa las claves ajenas, `0004` deja que `mixes`
  guarde rutas relativas al bucket, `0005` prepara el panel (quién guarda cada cambio y
  límites de Info y vídeo), `0006` quita la verificación en dos pasos que añadía la
  `0005` y `0007` añade los colores (`site_settings.theme`). Se aplican en orden con el
  MCP de Supabase, el *SQL Editor* o `npx supabase db push`.
- Los bolos se importaron de los `.xlsx` de `Raw_Files/WEB PAGE FILES/` con:

  ```sh
  node scripts/import-gigs.mjs --dry-run          # informe, sin tocar nada
  node scripts/import-gigs.mjs --sql bolos.sql    # genera el SQL (para el SQL Editor)
  node --env-file=.env scripts/import-gigs.mjs    # upsert con SUPABASE_SECRET_KEY
  ```

  Es idempotente: identifica cada bolo por fecha + sala + fiesta y solo actualiza lo
  que cambia. Lo normal ahora es añadirlos desde el panel.
- `supabase/tests/rls.sql` comprueba dentro de la base de datos que el público solo
  puede leer lo publicado.
- **Keep-alive.** El plan gratuito de Supabase pausa el proyecto tras una semana sin
  actividad. Para que no pase, el Worker tiene un **Cron Trigger** (`triggers` en
  `wrangler.jsonc`, cada día a las 06:17 UTC) que pide `/api/health` —una consulta mínima a
  `site_settings`— dentro del propio Worker (`src/worker.ts` y `src/lib/keep-alive.ts`). No
  hay que configurar nada: el despliegue lo crea. Se ve en *Workers & Pages → portfolio →
  Settings → Trigger events*, y cada ejecución deja «[keep-alive] Supabase OK» en los logs
  (*Observability*); si Supabase no responde, la ejecución sale como fallida.

## Vídeo de Media

El vídeo no está en el repo: se sirve en HLS desde el bucket de R2
`travest15m0-media`, en el dominio de `PUBLIC_MEDIA_BASE_URL`. Sin esa variable,
Media muestra «vídeo — próximamente» en su lugar. El vídeo se ve nítido, sin pixelar;
la textura LCD de toda la web sí le pasa por encima.

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
3. **Apuntar la web al vídeo nuevo**: desde el panel (página «vídeo», pegando el bloque
   que imprime el paso 1) o, en el código, pegándolo en `src/config/media.ts` y
   rellenando `title` (lo leen los lectores de pantalla) y, si es un fragmento del set
   de LAGRIMA, `fullSet: LAGRIMA_FULL_SET`.

Para verlo en local sin R2: `npm run media:serve` y `PUBLIC_MEDIA_BASE_URL=http://localhost:4322`
en `.env`.

**R2, una sola vez**: crear el bucket, darle un dominio público (`media.<dominio>`; mientras
no haya dominio sirve la URL `r2.dev` del bucket), crear un token de API de R2 con permiso
de escritura en el bucket (sus datos van en `.env`, ver `.env.example`) y configurar CORS:

```sh
npx wrangler r2 bucket cors set travest15m0-media --file r2/cors.json
```

`r2/cors.json` permite `GET` y `HEAD` desde el Worker
(`portfolio.pau-martinez-garcia-2001.workers.dev`) y `localhost:4321`, y `PUT` (la
subida de mixes desde el panel) desde los mismos orígenes. Sin el origen del Worker, el
reproductor no suena allí: el navegador bloquea los MP3 por CORS. Cuando haya dominio,
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
  próximamente»**.
- Si la persona pausa la música, al recargar no vuelve a arrancar sola. Si en Media se
  activa el sonido del vídeo, o en contact suena SoundCloud, la música se pausa y vuelve
  al salir.

Los mixes se suben desde el panel (página «mixes»). Para prepararlos en local con el
volumen normalizado (necesita ffmpeg):

```sh
npm run media:mix -- "../Raw_Files/…/mix.wav" --title "Insulto Club · 2026"
```

Lo deja en MP3 a 320 kbps y a unos −14 LUFS en `.media/mixes/`, lo sube a R2 si hay
claves en `.env` y crea su fila en `mixes` (con `SUPABASE_SECRET_KEY` en `.env`; si no,
imprime el SQL para el SQL Editor). Opciones: `--subtitle`, `--artwork <imagen>`
(carátula cuadrada), `--draft` (sin publicar), `--copy` (no recodifica un MP3) y
`--sql <archivo>`. Todo en `npm run media:mix -- --help`.

## Contacto

`/contact` **no tiene formulario** (D60): la web no recoge ningún dato. Arriba va el email
de Pau como enlace `mailto:` (`SITE.contactEmail` en `src/config/site.ts`) y debajo el
reproductor de SoundCloud y tres publicaciones destacadas de Instagram, cada uno con su
enlace al perfil —«soundcloud ↗» e «instagram ↗»—. Los dos widgets **se cargan al abrir la
página** y **ocupan todo el ancho de la columna**.

- **SoundCloud**: reproductor visual oficial, sin registro ni clave. Ahora mismo incrusta el
  **perfil entero**, porque `SOUNDCLOUD.trackUrl` (`src/config/social.ts`) está vacío; con
  una URL ahí incrusta esa pista suelta. **No arranca solo** (`auto_play=false`): la web ya
  tiene su propia música (D43). Cuando suena, **la música se pausa**, igual que con el
  vídeo de Media, y vuelve al salir de contact; y si arranca la música, el reproductor se
  calla. Lo coordina la Widget API de SoundCloud. Con `SOUNDCLOUD.eager: false` vuelve a
  ser una fachada que no carga nada hasta que se pulsa.
- **Instagram**: embed oficial (`blockquote` + `embed.js`), sin token, pero **solo funciona
  con publicaciones públicas**. Cada `blockquote` sale del servidor con su enlace dentro:
  eso es lo que se ve sin JavaScript y mientras `embed.js` carga. Qué publicaciones se
  destacan está en `INSTAGRAM_POSTS` (`src/config/social.ts`): pega ahí las URLs (en
  Instagram: «···» → «Copiar enlace»). **Con la lista vacía el apartado no aparece.** Las
  tres van **en una sola fila**: si no caben, la fila se desplaza en horizontal.

**Una publicación borrada deja de poder incrustarse** (y lo mismo si su cuenta se pone
privada). `embed.js` lo deja a medias —un iframe vacío y el `blockquote` sin quitar—, así
que a los 8 segundos `src/scripts/instagram-posts.ts` tira ese iframe y deja el enlace
dentro de un marco del tamaño de los demás. Si pasa, cambia esa URL en `INSTAGRAM_POSTS`.
Para comprobar si una publicación se puede incrustar, abre
`https://www.instagram.com/p/<código>/embed/` en el navegador. **El perfil entero de
Instagram no se puede incrustar**: Meta devuelve 400 para las URLs de perfil y su API de
feeds pide cuenta profesional y un token que caduca cada 60 días.

Los dos orígenes están en `script-src` y `frame-src` de la CSP
(`src/lib/security-headers.ts`), declarados una sola vez.

**A tener en cuenta**: como los dos widgets se cargan de entrada, SoundCloud y Meta pueden
poner sus cookies en cuanto se abre contact, y la web no tiene página de privacidad ni
aviso legal (se quitaron con D60). En la UE eso normalmente pide avisarlo en alguna parte,
y la LSSI-CE pide un aviso legal a quien hace actividad económica por internet. Esto **no
es asesoramiento legal**; si algún día se quieren recuperar, están en el historial de git.

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
- los **colores** (página «colores»): los cinco de las secciones, los dos fondos (el
  texto usa los fondos al revés) y el del reproductor, con color propio o el de cada
  sección. Vista previa al momento, aviso si algo se leería mal y botón para volver a
  los originales. Se guardan en `site_settings.theme`.

**Cómo se entra.** En «usuario» vale el **email** de la cuenta de Supabase o un **alias**
corto (por ejemplo `pau`): el secret `ADMIN_USERNAME` es el alias y `ADMIN_EMAIL` el email
al que apunta; el servidor los cambia antes de llamar a Supabase y el alias no distingue
mayúsculas. Sin esos dos secrets, solo vale el email.

Al guardar, la web pública se actualiza al momento (se purga la caché de Cloudflare por
etiquetas; como mucho, en 60 s).

**Dónde está.** En `https://<dominio>/<ADMIN_PATH>`. El nombre es el secreto
`ADMIN_PATH`, que **no se escribe en ningún archivo del repo** (es público): la ruta es
dinámica (`src/pages/[admin]/`) y el middleware compara el primer tramo de la URL con el
secreto; si no coincide, responde la misma 404 que cualquier otra ruta. No se enlaza
desde ningún sitio, no está en `robots.txt` ni en el sitemap, y lleva `noindex`,
`X-Robots-Tag` y `Cache-Control: no-store`.

**Puesta en marcha** (una vez, en el dashboard de Supabase y en Cloudflare):

1. Aplicar las migraciones hasta la `0007` (ver [Datos](#datos-supabase)). Sin la `0007`
   la web usa los colores del código y el panel no puede guardarlos.
2. *Authentication → Sign In / Providers*: **desactivar** «Allow new users to sign up».
3. *Authentication → Attack Protection*: el **CAPTCHA, desactivado**. El panel no manda
   token de CAPTCHA, así que con él activado Supabase rechazaría todos los logins. El
   límite de intentos de Supabase sigue funcionando.
4. *Authentication → Users → Add user*: la cuenta de Pau (email y contraseña robusta,
   «Auto Confirm User»). Luego, darle acceso con `supabase/snippets/add-admin.sql`
   (cambiando el email; no lo guardes con el email real).
5. Secrets del Worker (`npx wrangler secret put NOMBRE`; en local, `.env`): `ADMIN_PATH`
   y, si se quiere entrar con un alias corto en vez del email, `ADMIN_USERNAME` y
   `ADMIN_EMAIL`. Para subir mixes desde el panel, también `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET` (un token de R2 limitado al
   bucket, «Object Read & Write»).
6. CORS del bucket (`r2/cors.json`): el dominio de la web tiene que estar en la regla de
   `PUT` para que el navegador pueda subir los mixes.

**Seguridad.** Sin sistema de usuarios propio: Supabase Auth con cookies `httpOnly`,
`secure` y `sameSite=lax` (`@supabase/ssr`), el JWT validado con `getClaims()` y la
pertenencia a `admins` comprobada en cada petición. Errores genéricos («Usuario o
contraseña incorrectos.»), protección CSRF de Astro (`security.checkOrigin`) y todas las
escrituras con la sesión de Pau y la clave publicable: las políticas RLS son la última
barrera, y la clave secreta de Supabase no está en el Worker. No hay «olvidé mi
contraseña» público: se cambia desde el dashboard.

Contra la fuerza bruta (`src/lib/admin/login-guard.ts`):

- **5 intentos por minuto y por IP**, con el binding de Rate Limiting de Workers
  (`ratelimits` en `wrangler.jsonc`; no hay que crear nada en Cloudflare). Hace falta
  porque Supabase ve la IP del Worker, no la de quien intenta entrar. Del sexto en
  adelante: «Demasiados intentos…», también con la contraseña buena.
- **Todo fallo tarda lo mismo** (≈ 0,8 s): no se puede adivinar el alias por lo que
  tarda la respuesta.
- Y el límite de intentos del propio Supabase.

**Inyección SQL**: no hay ninguna consulta escrita a mano. El usuario y la contraseña
van como datos a Supabase Auth, y todo lo demás usa el cliente de Supabase (PostgREST),
que manda los valores como parámetros. El HTML que sale de la base de datos (el texto
de Info) se escapa entero (`src/lib/markdown.ts`), y la CSP no deja ejecutar scripts en
línea. Lo prueban `tests/e2e-admin/auth.spec.ts` y `tests/unit/admin.test.ts`.

Lo que protege la entrada es que la ruta es secreta, una **contraseña larga y única**
(16 caracteres o más, que no se use en ningún otro sitio) y esos límites (D61: sin
CAPTCHA ni verificación en dos pasos). En el dashboard de Supabase conviene subir la
longitud mínima de la contraseña («Minimum password length», en *Authentication → Sign In /
Providers → Email*) a 16.

**Tests.** `npm run test:e2e:admin` compila la web leyendo de un Supabase simulado
(`tests/e2e-admin/mock-supabase.mjs`, con las mismas reglas que las políticas RLS) y
prueba el login, los errores, el límite de intentos por IP, los intentos de inyección SQL, la 404, las cabeceras, la barra, los bolos (y que aparecen
en la web), los duplicados, las varias fechas, el archivo, Info, el vídeo, los colores, la
subida de mixes (R2 interceptado en el navegador), el login con alias (también sin
JavaScript) y el uso a 375 px. Las migraciones y `supabase/tests/rls.sql` se prueban en
un Postgres de verdad sin red (PGlite) dentro de `npm test` (`tests/unit/rls-sql.test.ts`).
Cada test entra desde una IP distinta (`CF-Connecting-IP`, el `test` de
`tests/e2e-admin/helpers.ts`) para no tropezar con el límite de intentos.

El código: `src/pages/[admin]/`, `src/layouts/AdminLayout.astro`,
`src/components/admin/`, `src/actions/admin.ts`, `src/lib/admin/`,
`src/scripts/admin/` y `src/styles/admin.css`; textos y límites en `src/config/admin.ts`.

## Despliegue en Cloudflare (Workers Builds)

La web es un **Worker** llamado `portfolio` (el mismo `name` que en `wrangler.jsonc`),
conectado al repo con **Workers Builds**:
<https://portfolio.pau-martinez-garcia-2001.workers.dev> mientras no haya dominio.

- **Compilación** (*Settings → Build*): comando de build `npm run build`, comando de
  despliegue `npx wrangler deploy`, carpeta raíz vacía (`/`). Rama de producción: `main`;
  el resto de ramas, como versión de prueba (*preview*).
- **Node**: `.nvmrc` fija la versión; Workers Builds la lee sola.

### Variables: dónde ponerlas

Las `PUBLIC_*` sirven en **cualquiera de los dos sitios** del Worker (*Workers & Pages →
portfolio → Settings*):

| Dónde | Cuándo cuenta |
|---|---|
| **Variables and Secrets** (ejecución) — **recomendado** | al momento: guardar crea una versión nueva del Worker, sin recompilar. Si una `PUBLIC_*` no llegó al build, el servidor la lee de aquí (`src/lib/public-env.ts`) |
| **Build → Variables and secrets** (compilación) | al compilar: quedan escritas en el código y mandan sobre las de ejecución. Tras cambiar una, hay que volver a desplegar (*Deployments → … → Retry build*, o un push). Son las únicas que ven las cabeceras de los archivos estáticos (`_headers`) |

Las secretas (`ADMIN_PATH`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, `R2_*`) van **solo** en
*Variables and Secrets*, tipo **Secret**.

`wrangler.jsonc` lleva `"keep_vars": true`: sin eso, cada `wrangler deploy` de Workers
Builds borraba las variables de tipo *Text* puestas en el panel (los secrets nunca se
borran).

Las `PUBLIC_*`, por orden de importancia:

| Variable | Valor | Sin ella |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | `https://<proyecto>.supabase.co` | next dates y archive dicen «No se han podido cargar…», `/api/health` da 503 y el panel no funciona |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | lo mismo |
| `PUBLIC_SITE_URL` | `https://portfolio.pau-martinez-garcia-2001.workers.dev` (luego, el dominio), sin barra final | las URL canónicas y de Open Graph salen de la petición |
| `PUBLIC_MEDIA_BASE_URL` | dominio público del bucket R2 | Media enseña «vídeo — próximamente» y el reproductor dice «reproductor — próximamente» |

No hace falta ninguna otra: `DATA_SOURCE` ya vale `supabase` por defecto (`fixtures` solo
lo usan los tests). **Nunca** pongas `SUPABASE_SECRET_KEY` en Cloudflare: es solo para
los scripts locales.

Los secrets también se pueden poner desde el terminal (van al Worker `portfolio` porque
es el `name` de `wrangler.jsonc`):

```sh
npx wrangler secret put ADMIN_PATH
npx wrangler secret put ADMIN_USERNAME   # alias para entrar (opcional)
npx wrangler secret put ADMIN_EMAIL      # el email de Supabase al que apunta el alias
```

El **panel oculto** solo existe si el Worker ve `ADMIN_PATH` **en ejecución** (*Variables
and Secrets*, tipo Secret). Puesta solo en *Build*, o con otras mayúsculas que la URL,
`/<ADMIN_PATH>` da 404 como cualquier otra ruta (a propósito: no se distingue de una página
que no existe).

### Comprobar que ha ido bien

1. `https://<web>/api/health` → `{"ok":true,…}` con 200 (Supabase conectado).
2. `/next-dates` y `/archive` muestran fechas.
3. En las cabeceras de cualquier página, la `Content-Security-Policy` incluye el dominio de
   Supabase en `connect-src` y el de R2 en `img-src`/`media-src` (si no, el Worker no ve
   las `PUBLIC_*`).
4. `/<ADMIN_PATH>` enseña el login del panel; cualquier otra ruta, el 404. Con
   `ADMIN_USERNAME` y `ADMIN_EMAIL` puestos, se entra con el alias.
5. En *Settings → Trigger events* sale el Cron `17 6 * * *` (keep-alive de Supabase) y, en
   *Settings → Bindings*, el rate limiter `LOGIN_RATE_LIMIT`.

## Estructura

```
src/
  assets/      textura del rotulador (SVG)
  config/      datos de la web, secciones, colores, redes, vídeo de Media, reproductor,
               filtro pixelado, efecto CRT, caché y textos del panel
  content/     textos en Markdown (info.md)
  components/  piezas del layout (menú, barra de noticias, cursor, vídeo, widgets de redes…)
  layouts/     BaseLayout y AdminLayout (panel)
  pages/       una página por sección; [admin]/ es el panel oculto; api/health
  worker.ts    punto de entrada del Worker: la web y el keep-alive diario de Supabase
  scripts/     JS del navegador (navegación, móvil, cursor, vídeo, reproductor, píxeles,
               CRT, widgets de redes y panel)
  styles/      reset, tokens, estilos globales, el rotulador (highlighter.css) y el panel
  lib/         fechas, datos (Supabase o fixtures), barajado, SEO, colores, cabeceras de
               seguridad, keep-alive y el panel (admin/: sesión, límite de intentos,
               esquemas, firma de R2, vídeo)
  actions/     Astro Actions del panel (admin.*)
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
