# bot-tiendas

Bot de atención al cliente para tiendas por WhatsApp, con simulador web para probarlo sin dar tu número. Multi-tienda: un cliente nuevo es una tienda nueva en la base de datos, no un proyecto nuevo.

**Estado:** fase 3 — el bot busca por significado en el conocimiento de la tienda, registra lo que no sabe y la tienda le "enseña" desde un panel.
**Pruébalo:** https://bot-tiendas.mateomolina.workers.dev/simulador/ (tienda ficticia "Tostadero Aurora")

- Diseño: [`docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md`](docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md)
- Plan de la fase 3: [`docs/superpowers/plans/2026-11-24-fase-3-conocimiento-panel.md`](docs/superpowers/plans/2026-11-24-fase-3-conocimiento-panel.md)
- Plan de la fase 2: [`docs/superpowers/plans/2026-11-23-fase-2-nucleo-simulador.md`](docs/superpowers/plans/2026-11-23-fase-2-nucleo-simulador.md)
- Plan de la fase 1: [`docs/superpowers/plans/2026-11-23-fase-1-fundacion.md`](docs/superpowers/plans/2026-11-23-fase-1-fundacion.md)

## Tecnologías

Cloudflare Workers · TypeScript · Hono (+ JSX) · D1 (SQLite) · Vectorize + Workers AI (`bge-m3`) · Queues · Gemini (plan gratuito) · Workers Static Assets · Vitest (en el runtime de Workers). Próximas fases: WhatsApp Cloud API, Turnstile.

## Cómo "aprende"

1. Un cliente pregunta algo que no está en los datos → el bot lo dice con honestidad (sin inventar ni deducir) y la pregunta queda registrada.
2. En el **panel** (`/panel/<tienda>`, protegido con usuario y contraseña) la tienda ve las preguntas sin respuesta y las responde con **"Enseñar al bot"**, o las descarta.
3. La respuesta se guarda como pregunta frecuente y se indexa para la búsqueda por significado: desde ese momento el bot la usa con cualquier cliente.

El panel también permite agregar/editar/borrar conocimiento e importar catálogos en CSV (también los de Excel en español, con `;`). La indexación corre en segundo plano con Cloudflare Queues para respetar el límite de CPU del plan gratuito.

## Desarrollo

```bash
npm install
cp .dev.vars.example .dev.vars   # clave de Gemini y usuario/clave del panel
npm run db:migrar:local   # crea el esquema en la base local
npx wrangler d1 execute bot-tiendas-db --local --file semillas/tienda-demo.sql   # tienda demo
npm run dev               # servidor local en http://localhost:8787
npm test                  # pruebas
npm run deploy            # despliegue a Cloudflare
```

Después de cambiar `wrangler.jsonc`, regenera los tipos con `npm run tipos`.
