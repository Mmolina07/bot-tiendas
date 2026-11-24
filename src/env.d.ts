// Secretos y variables que `wrangler types` no conoce (no están en wrangler.jsonc).
declare namespace Cloudflare {
  interface Env {
    ENTORNO?: string;
    GEMINI_API_KEY: string;
    PANEL_USUARIO?: string;
    PANEL_CLAVE?: string;
  }
}
