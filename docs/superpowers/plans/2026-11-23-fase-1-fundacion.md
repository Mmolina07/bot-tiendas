# Fase 1 — Fundación: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar un Worker `bot-tiendas` desplegado en `*.workers.dev`, con Hono + TypeScript, la base D1 con el esquema completo del diseño, acceso a datos de tiendas probado y pruebas corriendo en el runtime de Workers.

**Architecture:** Un solo Worker con una app Hono (`src/app.ts`) que más adelante alojará canales, núcleo y panel. La base D1 se define con migraciones SQL versionadas en `migrations/`. El acceso a datos vive en `src/datos/`, un archivo por tabla, y recibe la `D1Database` como parámetro para poder probarlo.

**Tech Stack:** Cloudflare Workers, TypeScript, Hono 4, D1, Wrangler 4, Vitest + `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md` (secciones 5, 7.1, 7.3, 7.6 y 8.1).

## Global Constraints

- Costo cero: solo el plan gratuito de Cloudflare. No activar Workers Paid.
- Nombre del Worker: `bot-tiendas`. Base D1: `bot-tiendas-db`, binding `DB`.
- Todo el código en TypeScript estricto (`"strict": true`).
- Identificadores en español para el dominio (tiendas, conversaciones, mensajes…), como en el diseño.
- IDs: `TEXT` generados con `crypto.randomUUID()`. Fechas: `INTEGER` con milisegundos epoch (`Date.now()`).
- Las respuestas de error de la API son JSON `{ "error": string }` y nunca incluyen la traza de la excepción.
- Las dependencias se instalan en su última versión estable compatible entre sí. Antes de instalar, revisar en la `peerDependencies` de `@cloudflare/vitest-pool-workers` qué versión de `vitest` acepta.

## Review Focus

1. Pedir una tienda que no existe → devuelve `null`, no lanza error (Task 3).
2. `configuracion` guardada como JSON corrupto → se usan los valores por defecto en lugar de romper la respuesta del bot (Task 3).
3. El mismo `id_externo` de un mensaje insertado dos veces → la segunda inserción se rechaza. Es la base de la deduplicación de webhooks de Meta (Task 2).
4. Borrar una tienda → se borran en cascada su conocimiento, conversaciones, mensajes y preguntas. La limpieza de las sandbox de la fase 6 depende de esto (Task 2).
5. Una ruta inexistente o una excepción no controlada → JSON 404/500 sin traza (Task 1).

---

### Task 0: Preparar el entorno y el repositorio

El Node que aparece primero en el PATH (`/opt/homebrew/opt/node@24/bin/node`) está roto: se compiló contra `libsimdjson.36` y Homebrew actualizó simdjson a la 38. El `node` 26 de Homebrew (`/opt/homebrew/bin/node`) funciona.

- [ ] **Step 1: Arreglar Node** (cambia el sistema de Mateo: pedirle confirmación antes de ejecutarlo)

Run: `brew reinstall node@24`
Si sigue fallando: `brew unlink node@24` y usar el `node` 26 de Homebrew.
Expected: `node -v` imprime una versión sin error de `dyld`, y `npm -v` funciona.

- [ ] **Step 2: Iniciar git y versionar el diseño**

Crear `.gitignore` con `node_modules/`, `.wrangler/`, `.dev.vars`, `dist/`, `coverage/` y `.DS_Store`.

```bash
git init -b main
git add .gitignore docs/
git commit -m "docs: diseño del bot de tiendas y plan de la fase 1"
```

Expected: `git log --oneline` muestra 1 commit.

---

### Task 1: Esqueleto del Worker con Hono, ruta de salud y errores JSON

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `src/index.ts`, `src/app.ts`, `src/tipos.ts`, `test/env.d.ts`
- Test: `test/app.test.ts`

**Interfaces:**
- Produces:
  - `type Env = { DB: D1Database }` en `src/tipos.ts`. Se ampliará en fases siguientes.
  - `const app: Hono<{ Bindings: Env }>` exportada desde `src/app.ts`.
  - `src/index.ts` exporta `default app`.
- Scripts de `package.json`: `dev` (`wrangler dev`), `test` (`vitest run`), `deploy` (`wrangler deploy`), `tipos` (`wrangler types`), `db:migrar:local` y `db:migrar:remoto` (`wrangler d1 migrations apply bot-tiendas-db --local|--remote`).

- [ ] **Step 1: Crear el proyecto e instalar dependencias**

`npm init -y`, luego `npm i hono` y `npm i -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types`.

`wrangler.jsonc`:
- `name: "bot-tiendas"`, `main: "src/index.ts"`.
- `compatibility_date` = la fecha de hoy, `compatibility_flags: ["nodejs_compat"]`.
- `d1_databases: [{ binding: "DB", database_name: "bot-tiendas-db", database_id: "local-pendiente", migrations_dir: "migrations" }]`. El `database_id` real se pone en la Task 4.

`vitest.config.ts` usa el pool de Workers con `wrangler.configPath: "./wrangler.jsonc"`. Se amplía en la Task 2.

- [ ] **Step 2: Escribir las pruebas que fallan** en `test/app.test.ts`, usando `SELF.fetch` de `cloudflare:test`.

```ts
it("GET /salud responde ok", async () => {
  const r = await SELF.fetch("https://x/salud");
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, servicio: "bot-tiendas" });
});
it("ruta inexistente → 404 JSON", async () => {
  const r = await SELF.fetch("https://x/no-existe");
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "No encontrado" });
});
it("error no controlado → 500 JSON sin traza", async () => {
  const r = await SELF.fetch("https://x/_prueba/error");
  expect(r.status).toBe(500);
  const cuerpo = await r.json();
  expect(cuerpo).toEqual({ error: "Error interno" });
});
```

- [ ] **Step 3: Ejecutar** `npm test`. Expected: FAIL, porque las rutas no existen.

- [ ] **Step 4: Implementar `src/app.ts`**

- `app.get("/salud")` devuelve el JSON de la prueba.
- `app.notFound` devuelve 404 `{error:"No encontrado"}`.
- `app.onError` hace `console.error(err)` y devuelve 500 `{error:"Error interno"}`.
- La ruta `GET /_prueba/error` lanza `new Error("prueba")`. Solo se registra cuando `c.env.ENTORNO === "test"`; agregar `ENTORNO?: string` a `Env`. En la sección de pruebas de `vitest.config.ts` se define `miniflare.bindings.ENTORNO = "test"`.

- [ ] **Step 5: Ejecutar** `npm test`. Expected: 3 PASS. Ejecutar también `npx tsc --noEmit`. Expected: sin errores.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: esqueleto del Worker con Hono, /salud y errores JSON"`

---

### Task 2: Esquema D1 (migración 0001)

**Files:**
- Create: `migrations/0001_esquema_inicial.sql`, `test/setup.ts`
- Modify: `vitest.config.ts` (leer migraciones, `setupFiles`)
- Test: `test/esquema.test.ts`

**Interfaces:**
- Produces: las tablas y columnas de abajo, que usan todas las fases siguientes.

- [ ] **Step 1: Escribir la migración.** Es el modelo de datos del diseño (7.3) más las decisiones de la sección 7.6.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE tiendas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  configuracion TEXT NOT NULL DEFAULT '{}',
  proveedor_ia TEXT NOT NULL DEFAULT 'gemini',
  whatsapp_phone_number_id TEXT UNIQUE,
  whatsapp_token_cifrado TEXT,
  whatsapp_app_secret_cifrado TEXT,
  creada_en INTEGER NOT NULL
);

CREATE TABLE conocimiento (
  id TEXT PRIMARY KEY,
  tienda_id TEXT NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('faq','producto','politica')),
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  datos_producto TEXT,
  actualizado_en INTEGER NOT NULL
);
CREATE INDEX idx_conocimiento_tienda ON conocimiento(tienda_id);

CREATE TABLE conversaciones (
  id TEXT PRIMARY KEY,
  tienda_id TEXT NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp','simulador')),
  cliente TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'bot' CHECK (estado IN ('bot','requiere_humano')),
  humano_desde INTEGER,
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL,
  UNIQUE (tienda_id, canal, cliente)
);

CREATE TABLE mensajes (
  id TEXT PRIMARY KEY,
  conversacion_id TEXT NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  rol TEXT NOT NULL CHECK (rol IN ('cliente','bot','humano')),
  texto TEXT NOT NULL,
  id_externo TEXT UNIQUE,
  creado_en INTEGER NOT NULL
);
CREATE INDEX idx_mensajes_conversacion ON mensajes(conversacion_id, creado_en);

CREATE TABLE preguntas_sin_respuesta (
  id TEXT PRIMARY KEY,
  tienda_id TEXT NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  conversacion_id TEXT REFERENCES conversaciones(id) ON DELETE SET NULL,
  pregunta TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','resuelta')),
  creada_en INTEGER NOT NULL
);
CREATE INDEX idx_preguntas_tienda_estado ON preguntas_sin_respuesta(tienda_id, estado);
```

- [ ] **Step 2: Conectar las migraciones a las pruebas**

- En `vitest.config.ts`, leer las migraciones con `readD1Migrations("./migrations")` y pasarlas como binding `TEST_MIGRATIONS`.
- `test/setup.ts` llama a `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`.
- Declarar `TEST_MIGRATIONS` en `test/env.d.ts`.

- [ ] **Step 3: Escribir las pruebas que fallan** en `test/esquema.test.ts`. Insertar con `env.DB.prepare(...).bind(...).run()`.
  - `crea las 5 tablas`: consultar `sqlite_master` y esperar `tiendas`, `conocimiento`, `conversaciones`, `mensajes` y `preguntas_sin_respuesta`.
  - `rechaza id_externo duplicado`: insertar tienda → conversación → mensaje con `id_externo = "wamid.1"`. El segundo insert con el mismo `id_externo` hace `rejects.toThrow(/UNIQUE/)`.
  - `borrar tienda borra en cascada`: insertar una tienda con una fila en cada tabla hija, `DELETE FROM tiendas WHERE id=?`, y comprobar que `COUNT(*)` da 0 en `conocimiento`, `conversaciones`, `mensajes` y `preguntas_sin_respuesta`.
  - `rechaza tipo de conocimiento inválido`: `tipo = 'otro'` hace `rejects.toThrow(/CHECK/)`.

- [ ] **Step 4: Ejecutar** `npm test`. Expected: FAIL mientras no exista la migración o el setup. Con ambos listos: todo PASS.

- [ ] **Step 5: Probar la migración en local.** Ejecutar `npm run db:migrar:local`. Expected: "Migrations applied" con `0001_esquema_inicial.sql`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: esquema D1 inicial (tiendas, conocimiento, conversaciones, mensajes, preguntas)"`

---

### Task 3: Acceso a datos de tiendas

**Files:**
- Create: `src/datos/tiendas.ts`
- Test: `test/datos/tiendas.test.ts`

**Interfaces:**
- Consumes: la tabla `tiendas` (Task 2).
- Produces (`src/datos/tiendas.ts`):

```ts
export type ConfiguracionTienda = {
  tono: string;          // por defecto "amable y cercano"
  bienvenida: string;    // por defecto "¡Hola! ¿En qué te puedo ayudar?"
  horario: string | null; // por defecto null
  reglas: string[];      // por defecto []
};
export type Tienda = {
  id: string; nombre: string; configuracion: ConfiguracionTienda;
  proveedorIa: string; whatsappPhoneNumberId: string | null; creadaEn: number;
};
export const CONFIGURACION_POR_DEFECTO: ConfiguracionTienda;
export function leerConfiguracion(json: string): ConfiguracionTienda;
export async function crearTienda(db: D1Database, datos: {
  nombre: string; configuracion?: Partial<ConfiguracionTienda>;
  whatsappPhoneNumberId?: string;
}): Promise<Tienda>;
export async function obtenerTienda(db: D1Database, id: string): Promise<Tienda | null>;
export async function obtenerTiendaPorWhatsapp(db: D1Database, phoneNumberId: string): Promise<Tienda | null>;
```

Las columnas `whatsapp_*_cifrado` no se exponen en `Tienda`. Se leerán con una función aparte en la fase 4.

- [ ] **Step 1: Escribir las pruebas que fallan**
  - `crearTienda y obtenerTienda devuelven lo mismo`: crear `{ nombre: "Café Demo", configuracion: { tono: "formal" } }`. `obtenerTienda` devuelve `nombre: "Café Demo"`, `configuracion.tono: "formal"`, `configuracion.reglas: []` y `proveedorIa: "gemini"`.
  - `obtenerTienda inexistente → null`.
  - `obtenerTiendaPorWhatsapp encuentra por phone_number_id`: crear con `whatsappPhoneNumberId: "123"`. Buscar `"123"` devuelve la tienda y buscar `"999"` devuelve `null`.
  - `leerConfiguracion con JSON corrupto → por defecto`: `leerConfiguracion("{no json")` es igual a `CONFIGURACION_POR_DEFECTO`.
  - `leerConfiguracion ignora tipos incorrectos`: `leerConfiguracion('{"tono":5,"reglas":"x","horario":"9-18"}')` da `tono` por defecto, `reglas: []` y `horario: "9-18"`.

- [ ] **Step 2: Ejecutar** `npm test -- tiendas`. Expected: FAIL, porque el módulo no existe.

- [ ] **Step 3: Implementar `src/datos/tiendas.ts`.** `leerConfiguracion` envuelve `JSON.parse` en try/catch y valida cada campo por tipo. Los campos inválidos toman su valor por defecto. Las consultas son SQL directo con `prepare().bind()`, y una función privada convierte la fila (snake_case) en `Tienda` (camelCase).

- [ ] **Step 4: Ejecutar** `npm test` y `npx tsc --noEmit`. Expected: todo PASS y sin errores de tipos.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: acceso a datos de tiendas con configuración tolerante a errores"`

---

### Task 4: Despliegue en Cloudflare

Esta tarea incluye pasos interactivos y que publican en internet: confirmar con Mateo antes de cada uno.

- [ ] **Step 1: Iniciar sesión.** Mateo ejecuta `! npx wrangler login`, que abre el navegador. Expected: `npx wrangler whoami` muestra su cuenta.

- [ ] **Step 2: Crear la base remota.** Ejecutar `npx wrangler d1 create bot-tiendas-db`. Copiar el `database_id` que imprime en `wrangler.jsonc`, en lugar de `local-pendiente`.

- [ ] **Step 3: Migrar la base remota.** Ejecutar `npm run db:migrar:remoto`. Expected: se aplica `0001_esquema_inicial.sql`.

- [ ] **Step 4: Desplegar.** Ejecutar `npm run deploy`. Expected: imprime una URL `https://bot-tiendas.<subdominio>.workers.dev`.

- [ ] **Step 5: Verificar en producción.**
  - `curl -s https://bot-tiendas.<subdominio>.workers.dev/salud` debe devolver `{"ok":true,"servicio":"bot-tiendas"}`.
  - `curl -s -o /dev/null -w "%{http_code}" .../_prueba/error` debe devolver `404`, porque la ruta de prueba no existe fuera de los tests.

- [ ] **Step 6: Escribir el README.** `README.md` corto con:
  - qué es el proyecto, con enlace al diseño;
  - cómo correr `npm run dev`, `npm test` y `npm run deploy`;
  - la URL desplegada.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "chore: despliegue inicial en Workers y README"`

- [ ] **Step 8 (opcional, confirmar con Mateo): subir a GitHub.** Crear el repositorio con `gh repo create bot-tiendas --private --source . --push`. Si es público o privado lo decide Mateo.
