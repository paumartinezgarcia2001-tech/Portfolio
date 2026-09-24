declare namespace App {
  interface Locals {
    /** Texto de la barra de noticias para esta petición (src/middleware.ts). */
    tickerText?: string;
    /** Mixes publicados del reproductor (src/middleware.ts, fase 4). */
    mixes?: import('./lib/data/core').Mix[];
    /** Panel oculto (fase 6): solo en sus rutas, tras comprobar `ADMIN_PATH`. */
    admin?: import('./lib/admin/context').AdminLocals;
  }
}
