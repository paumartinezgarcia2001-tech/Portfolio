# Portfolio

Web de **travest15m0**, DJ y productora de eventos afincada en Madrid.

Astro 7 sobre Cloudflare Workers, sin React ni Tailwind. En construcción por fases:
hechas la 1 (estructura, navegación e Info), la 2 (bolos desde Supabase: next dates,
archive y barra de noticias), la 3 (vídeo de Media en HLS y transición de píxeles),
la 4 (reproductor de mixes), la 5 (contacto y redes) y la
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

`r2/cors.json` permite `GET` y `HEAD` desde el Worker
(`portfolio.pau-martinez-garcia-2001.workers.dev`), GitHub Pages y `localhost:4321`, y `PUT`
(la subida de mixes desde el panel, fase 6) desde el Worker y `localhost:4321`. Sin el
origen del Worker, el reproductor no suena allí: el navegador bloquea los MP3 por CORS. Cuando haya dominio,
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

## Contacto

> **Ahora mismo no hay formulario** (D60, Luna ✓ 03-10-2026). `/contact` tiene el email de
> Pau como enlace `mailto:` donde antes estaba el formulario, y debajo el reproductor de
> SoundCloud y las publicaciones de Instagram, cada uno con su enlace. Así la web **no
> recoge ningún dato** ni manda nada a terceros al escribir.
>
> El formulario entero sigue en el repo —Action, zod, Turnstile, KV, Resend y el camino de
> Web3Forms—, apagado con un interruptor: `CONTACT_FORM_ENABLED` en `src/config/contact.ts`.
> Poniéndolo en `true` vuelve tal cual, y con él sus tests, que mientras tanto se saltan
> solos. Lo que queda de esta sección describe ese formulario.

El mensaje **no se guarda en ninguna base de datos**: se envía por email y «responder»
apunta a quien escribe.

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

### SoundCloud e Instagram en contact

Debajo del email hay un reproductor de SoundCloud y tres publicaciones destacadas de
Instagram. **Los dos se cargan al abrir la página** y **ocupan todo el ancho de la columna**
(que ya no tiene `max-width` propio). Debajo de cada widget va su enlace al perfil
—«soundcloud ↗» e «instagram ↗»—. El email va arriba del todo, donde estaba el formulario
(`SocialLinks.astro`).

- **SoundCloud**: reproductor visual oficial, sin registro ni clave. Ahora mismo incrusta el
  **perfil entero**, porque `SOUNDCLOUD.trackUrl` (`src/config/social.ts`) está vacío; con
  una URL ahí incrusta esa pista suelta. **No
  arranca solo** (`auto_play=false`): la web ya tiene su propia música (D43). Cuando suena,
  **la música se pausa**, igual que con el vídeo de Media, y vuelve al salir de contact; y si
  arranca la música, el reproductor se calla. Lo coordina la Widget API de SoundCloud.
  Con `SOUNDCLOUD.eager: false` vuelve a ser una fachada que no carga nada hasta que se pulsa.
- **Instagram**: embed oficial (`blockquote` + `embed.js`), que desde junio de 2026 ya no
  necesita token ni revisión de la app, pero **solo funciona con publicaciones públicas**.
  Cada `blockquote` sale del servidor con su enlace dentro: eso es lo que se ve sin
  JavaScript y mientras `embed.js` carga, y lo que el script sustituye por la publicación.
  Qué publicaciones se destacan está en `INSTAGRAM_POSTS` (`src/config/social.ts`): pega ahí
  las URLs (en Instagram: «···» → «Copiar enlace»). **Con la lista vacía el apartado no
  aparece.** Se limpian los `?igsh=…` y se descarta lo que no sea una publicación.
  Las tres van **en una sola fila**: si no caben —pantallas estrechas, o más de tres— la fila
  se desplaza en horizontal, no se apila.

**Una publicación borrada deja de poder incrustarse** (y lo mismo si su cuenta se pone
privada): Instagram responde «es posible que el enlace de esta foto o vídeo esté dañado».
`embed.js` lo deja a medias —mete un iframe vacío y no quita el `blockquote`—, así que a los
8 segundos `src/scripts/instagram-posts.ts` tira ese iframe y deja el enlace dentro de un
marco del tamaño de los demás (`.ig__fallback`), en vez de un hueco roto en la fila. Si pasa,
cambia esa URL en `INSTAGRAM_POSTS`. Para comprobar si una publicación se puede incrustar,
abre `https://www.instagram.com/p/<código>/embed/` en el navegador.

**No se puede incrustar el perfil entero de Instagram**: el oEmbed de Meta devuelve 400 («not
embeddable») para las URLs de perfil, y su API de feeds exige cuenta profesional y un token
que caduca cada 60 días (imposible de renovar desde una web estática). Lo más parecido es
esta selección, con un enlace al perfil debajo.

Como los dos se cargan de entrada, **SoundCloud y Meta pueden poner sus cookies en cuanto se
abre contact**. No hay avisos debajo de cada widget (los dos llevan dentro sus propios
enlaces legales) y, desde D60, tampoco hay página de privacidad donde contarlo: ver «Páginas
legales» más abajo. Si alguna vez se quiere volver a «no cargar nada sin pedirlo»,
`SOUNDCLOUD.eager: false` hace la mitad del trabajo.

Los dos orígenes están en `script-src` y `frame-src` de la CSP (`src/lib/security-headers.ts`),
declarados una sola vez y reutilizados desde la configuración.

### Páginas legales: quitadas

`/aviso-legal` y `/privacidad` **ya no existen** (Luna ✓ 03-10-2026): se borraron
`src/pages/aviso-legal.astro`, `src/pages/privacidad.astro` y `src/components/LegalPage.astro`,
y con ellos el pie de contact que las enlazaba.

Conviene saber qué se ha ido con ellas, porque la web sigue cargando **SoundCloud e
Instagram** nada más abrir contact, y esos dos pueden poner cookies de terceros; en la UE
eso normalmente pide avisarlo en alguna parte. Y en España la LSSI-CE pide un aviso legal a
quien hace actividad económica por internet, que es discutible en un portafolio pero no es
descabellado para alguien que coge bolos. Esto **no es asesoramiento legal**: si algún día
se quieren recuperar, están en el historial de git (`git show <commit>:src/pages/privacidad.astro`).

## Panel oculto

Una página con usuario y contraseña —**nada más**: sin CAPTCHA ni verificación en dos
pasos (D61)— desde la que Pau cambia, sin tocar código:

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
  los originales. Se guardan en `site_settings.theme` (migración `0007_theme.sql`).

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
`X-Robots-Tag` y `Cache-Control: no-store`. Solo funciona con servidor (Cloudflare): en
GitHub Pages no existe.

**Puesta en marcha** (una vez, en el dashboard de Supabase y en Cloudflare):

1. Aplicar las migraciones `supabase/migrations/0005_admin_panel.sql` (quién guarda cada
   cambio y límites de Info y vídeo) y `0006_drop_admin_mfa.sql` (quita lo de la
   verificación en dos pasos que añadía la 0005), en ese orden, en el *SQL Editor*. Para
   la página «colores», también `0007_theme.sql` (añade la columna `theme`; mientras no
   esté, la web usa los colores del código y el panel no puede guardarlos).
2. *Authentication → Sign In / Providers*: **desactivar** «Allow new users to sign up».
3. *Authentication → Attack Protection*: el **CAPTCHA, desactivado** (si se activa,
   Supabase rechaza todos los logins del panel, que no manda token: sale «Supabase pide un
   CAPTCHA…»). El límite de intentos de Supabase sigue funcionando.
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

**Seguridad.** Sin sistema de usuarios propio: Supabase Auth con cookies `httpOnly`,
`secure` y `sameSite=lax` (`@supabase/ssr`), el JWT validado con `getClaims()` y la
pertenencia a `admins` comprobada en cada petición. Errores genéricos («Usuario o
contraseña incorrectos.»), el límite de intentos de Supabase, protección CSRF
de Astro (`security.checkOrigin`) y todas las escrituras con la sesión de Pau y la clave
publicable: las políticas RLS son la última barrera, y la clave secreta de Supabase no
está en el Worker. No hay «olvidé mi contraseña» público: se cambia desde el dashboard.
Sin CAPTCHA ni segundo paso (D61, decisión de Luna): lo que protege la entrada es que la
ruta es secreta, una **contraseña larga y única** y ese límite de intentos.

**Tests.** `npm run test:e2e:admin` compila la web leyendo de un Supabase simulado
(`tests/e2e-admin/mock-supabase.mjs`, con las mismas reglas que las políticas RLS) y
prueba el login, los errores, la 404, las cabeceras, la barra, los bolos (y que aparecen
en la web), los duplicados, las varias fechas, el archivo, Info, el vídeo, la subida de
mixes (R2 interceptado en el navegador), el login con alias (también sin JavaScript) y el
uso a 375 px. Las migraciones y
`supabase/tests/rls.sql` se prueban en un Postgres de verdad sin red (PGlite) dentro de
`npm test` (`tests/unit/rls-sql.test.ts`).

El código: `src/pages/[admin]/`, `src/layouts/AdminLayout.astro`,
`src/components/admin/`, `src/actions/admin.ts`, `src/lib/admin/`,
`src/scripts/admin/` y `src/styles/admin.css`; textos y límites en `src/config/admin.ts`.

## Despliegue en Cloudflare (Workers Builds)

La web definitiva es un **Worker** llamado `portfolio` (el mismo `name` que en
`wrangler.jsonc`), conectado al repo con **Workers Builds**:
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
| **Build → Variables and secrets** (compilación) | al compilar: quedan escritas en el código y mandan sobre las de ejecución. Tras cambiar una, hay que volver a desplegar (*Deployments → … → Retry build*, o un push). Son las únicas que ven las páginas estáticas (las legales y «mensaje enviado») en sus cabeceras |

Las secretas (`ADMIN_PATH`, `ADMIN_USERNAME`, `ADMIN_EMAIL`, `RESEND_API_KEY`,
`CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`, `TURNSTILE_SECRET_KEY`, `R2_*`) van **solo** en
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
| `PUBLIC_MEDIA_BASE_URL` | dominio público del bucket R2 | Media enseña el aviso y el reproductor dice «reproductor — próximamente» |
| `PUBLIC_TURNSTILE_SITE_KEY` | clave pública del widget de Turnstile | nada mientras el formulario siga apagado (D60); el panel no la usa (D61) |

No hace falta ninguna otra: `DATA_SOURCE`, `DATA_STRICT`, `SITE_NOINDEX` y
`STATIC_BUILD` ya tienen el valor correcto para Cloudflare, y `PUBLIC_WEB3FORMS_KEY` solo
la usa GitHub Pages. **Nunca** pongas `SUPABASE_SECRET_KEY` en Cloudflare: es solo para los
scripts locales.

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
4. `/<ADMIN_PATH>` enseña el login del panel (usuario y contraseña, sin CAPTCHA); cualquier
   otra ruta, el 404. Con `ADMIN_USERNAME` y `ADMIN_EMAIL` puestos, se entra con el alias.

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
