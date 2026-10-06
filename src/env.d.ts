declare namespace App {
  interface Locals {
    /** Texto de la barra de noticias para esta petición (src/middleware.ts). */
    tickerText?: string;
    /** Colores elegidos en el panel, o `null` (los del código) (src/middleware.ts). */
    theme?: import('./config/theme').Theme | null;
    /** Mixes publicados del reproductor (src/middleware.ts). */
    mixes?: import('./lib/data/core').Mix[];
    /** Panel oculto: solo en sus rutas, tras comprobar `ADMIN_PATH`. */
    admin?: import('./lib/admin/context').AdminLocals;
  }
}
