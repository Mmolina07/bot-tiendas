# bot-tiendas

Bot de atención al cliente para tiendas por WhatsApp, con simulador web para probarlo sin dar tu número. Multi-tienda: un cliente nuevo es una tienda nueva en la base de datos, no un proyecto nuevo.

**Estado:** fase 1 (fundación) — servidor, base de datos y despliegue.
**Demo:** https://bot-tiendas.mateomolina.workers.dev/salud

- Diseño: [`docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md`](docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md)
- Plan de la fase 1: [`docs/superpowers/plans/2026-11-23-fase-1-fundacion.md`](docs/superpowers/plans/2026-11-23-fase-1-fundacion.md)

## Tecnologías

Cloudflare Workers · TypeScript · Hono · D1 (SQLite) · Vitest (en el runtime de Workers). Próximas fases: Vectorize + Workers AI, Gemini, WhatsApp Cloud API, Turnstile.

## Desarrollo

```bash
npm install
npm run db:migrar:local   # crea el esquema en la base local
npm run dev               # servidor local en http://localhost:8787
npm test                  # pruebas
npm run deploy            # despliegue a Cloudflare
```

Después de cambiar `wrangler.jsonc`, regenera los tipos con `npm run tipos`.
