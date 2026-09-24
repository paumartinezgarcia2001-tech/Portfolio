/**
 * Script del panel oculto (C19, fase 6). Se carga en todas sus páginas
 * (AdminLayout); cada parte se activa solo si encuentra su formulario.
 * El panel no usa el ClientRouter: cada página se carga entera.
 */
import { setupEditors } from './editors';
import { setupAdminForms } from './forms';
import { setupGigForms } from './gigs';
import { setupAuth } from './login';
import { setupMixes } from './mixes';
import { setupSecurity } from './security';
import { setupCounters, setupTickerPreview } from './ticker';

setupAuth();
setupAdminForms();
setupCounters();
setupTickerPreview();
setupGigForms();
setupEditors();
setupMixes();
setupSecurity();

// Listo: los tests e2e esperan a esto antes de tocar nada.
document.documentElement.dataset.adminReady = '';
