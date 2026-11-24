# bot-tiendas

Bot de atención al cliente para tiendas por WhatsApp, con simulador web para probarlo sin dar tu número. Multi-tienda: un cliente nuevo es una tienda nueva en la base de datos, no un proyecto nuevo.

**Estado:** fase 2 — el bot responde con Gemini usando solo los datos de la tienda; simulador web funcionando.
**Pruébalo:** https://bot-tiendas.mateomolina.workers.dev/simulador/ (tienda ficticia "Tostadero Aurora")

- Diseño: [`docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md`](docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md)
- Plan de la fase 2: [`docs/superpowers/plans/2026-11-23-fase-2-nucleo-simulador.md`](docs/superpowers/plans/2026-11-23-fase-2-nucleo-simulador.md)
- Plan de la fase 1: [`docs/superpowers/plans/2026-11-23-fase-1-fundacion.md`](docs/superpowers/plans/2026-11-23-fase-1-fundacion.md)

## Tecnologías

Cloudflare Workers · TypeScript · Hono · D1 (SQLite) · Gemini (plan gratuito) · Workers Static Assets · Vitest (en el runtime de Workers). Próximas fases: Vectorize + Workers AI, WhatsApp Cloud API, Turnstile.

## Desarrollo

```bash
npm install
cp .dev.vars.example .dev.vars   # y pega tu clave de Gemini
npm run db:migrar:local   # crea el esquema en la base local
npx wrangler d1 execute bot-tiendas-db --local --file semillas/tienda-demo.sql   # tienda demo
npm run dev               # servidor local en http://localhost:8787
npm test                  # pruebas
npm run deploy            # despliegue a Cloudflare
```

Después de cambiar `wrangler.jsonc`, regenera los tipos con `npm run tipos`.
