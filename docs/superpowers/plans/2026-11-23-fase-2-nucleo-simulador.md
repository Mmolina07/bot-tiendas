# Fase 2 — Núcleo del bot + simulador web: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un visitante abre `/simulador`, chatea con el bot de una tienda de demo (un tostadero de café ficticio) y recibe respuestas de Gemini basadas solo en los datos de esa tienda, con el historial de la conversación guardado en D1.

**Architecture:** El canal "simulador" (rutas `/api/simulador/*` + página estática) traduce cada petición a `atenderMensaje()`, el núcleo independiente del canal. El núcleo:
- guarda el mensaje del cliente;
- carga el historial reciente y **todo** el conocimiento de la tienda, ya que en esta fase cabe en el prompt y la búsqueda semántica llega en la fase 3;
- arma el prompt de sistema, llama a un `ProveedorIA` y guarda la respuesta.

Gemini es la única implementación de `ProveedorIA` por ahora.

**Tech Stack:** Lo de la fase 1, más la API REST de Gemini (`generateContent`) y Workers Static Assets para la página del simulador.

**Spec:** `docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md` (secciones 2, 4, 7.2, 7.4 flujo 1, 7.5 y 8.2).

## Global Constraints

- Costo cero: Gemini en plan gratuito, sin facturación activada. Static Assets y D1 en plan gratuito.
- El bot usa **solo** la información cargada de la tienda: nunca inventa precios, productos ni políticas, y nunca confirma stock (anti-objetivo §4, decisión §7.6).
- La clave `GEMINI_API_KEY` es un secreto. Se configura con `wrangler secret put` en producción y en `.dev.vars` en local. Nunca va en `wrangler.jsonc` ni en git.
- El modelo se elige con la variable `GEMINI_MODELO`, sin tocar código.
- El simulador evoca WhatsApp (burbujas, colores verdes) sin usar su logo ni su nombre como marca.
- Errores de la API en formato JSON `{ "error": string }`, sin trazas (fase 1).
- Las pruebas no tienen almacenamiento aislado: usar ids únicos (`crypto.randomUUID()`) y no asumir tablas vacías.
- Las pruebas nunca llaman a Gemini de verdad: se espía `globalThis.fetch` con `vi.spyOn`, o se inyecta un `fetch` falso.

## Review Focus

1. Gemini falla (429 por cuota agotada, 500, red caída) → el visitante recibe un mensaje amable de "no puedo responder ahora", la API responde 200 y no 500, y el mensaje del cliente queda guardado (Task 4).
2. Mensaje vacío, solo espacios o de más de 1000 caracteres → 400 con `{error}` y sin llamada a Gemini (Task 5).
3. Cookie de cliente ausente o manipulada (texto arbitrario) → se crea un cliente nuevo; nunca se lee la conversación de otro cliente (Task 5).
4. Conversación larga → solo se envían a Gemini los últimos 10 mensajes, en orden cronológico (Task 3 y Task 4).
5. La tienda de demo no existe en la base (semilla sin cargar) → 503 `{error:"Tienda de demo no disponible"}` en lugar de 500 (Task 5).

---

### Task 0: Unificar `Env` y congelar las reglas por defecto

**Files:**
- Modify: `src/tipos.ts`, `src/datos/tiendas.ts:17-22`, `test/env.d.ts`
- Create: `src/env.d.ts`
- Test: `test/datos/tiendas.test.ts`

**Interfaces:**
- Produces:
  - `export type Env = Cloudflare.Env` en `src/tipos.ts`. Es la única fuente: los bindings vienen de `wrangler types` y los secretos y la variable `ENTORNO` se declaran en `src/env.d.ts`.
  - `src/env.d.ts` declara en `Cloudflare.Env`: `ENTORNO?: string` y `GEMINI_API_KEY: string`.
  - `test/env.d.ts` queda solo con `TEST_MIGRATIONS`.

- [ ] **Step 1: Escribir la prueba que falla**
  - `las reglas por defecto no se pueden modificar`: `expect(() => (CONFIGURACION_POR_DEFECTO.reglas as string[]).push("x")).toThrow(TypeError)` y además `CONFIGURACION_POR_DEFECTO.reglas` debe seguir igual a `[]`.
- [ ] **Step 2: Ejecutar** `npx vitest run tiendas`. Expected: FAIL, porque `push` funciona.
- [ ] **Step 3: Implementar el congelado.** Congelar `reglas` con `Object.freeze([])`. El tipo pasa a `Readonly<Omit<ConfiguracionTienda,"reglas"> & { reglas: readonly string[] }>`. `leerConfiguracion` ya devuelve una lista nueva, así que no cambia.
- [ ] **Step 4: Unificar `Env`.** Hacer el cambio de tipos descrito en Interfaces.
- [ ] **Step 5: Ejecutar** `npx vitest run` y `npx tsc --noEmit`. Expected: todo PASS y tsc sale con 0.
- [ ] **Step 6: Commit** — `refactor: Env único desde Cloudflare.Env y reglas por defecto congeladas`

---

### Task 1: Proveedor de IA y cliente de Gemini

**Files:**
- Create: `src/ia/proveedor.ts`, `src/ia/gemini.ts`
- Test: `test/ia/gemini.test.ts`

**Interfaces:**
- Produces (`src/ia/proveedor.ts`):

```ts
export type MensajeIA = { rol: "cliente" | "bot"; texto: string };
export type EntradaIA = { sistema: string; mensajes: MensajeIA[] };
export interface ProveedorIA { generar(entrada: EntradaIA): Promise<string> }
export class ErrorIA extends Error { constructor(message: string, readonly estado?: number) }
```

- Produces (`src/ia/gemini.ts`):
  `export function crearProveedorGemini(op: { apiKey: string; modelo: string; fetch?: typeof fetch }): ProveedorIA`

- [ ] **Step 1: Escribir las pruebas que fallan.** Usar un `fetch` falso que guarde la petición.
  - `envía la petición en formato Gemini`:
    - URL `https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent`;
    - método POST con cabecera `x-goog-api-key: <apiKey>`;
    - el cuerpo cumple `systemInstruction.parts[0].text === sistema`;
    - `contents` mapea `cliente→"user"` y `bot→"model"`, cada uno con `parts:[{text}]`, en el mismo orden.
  - `devuelve el texto de la respuesta`: con la respuesta `{candidates:[{content:{parts:[{text:"Hola "},{text:"mundo"}]}}]}`, el resultado es `"Hola mundo"`.
  - `respuesta HTTP no-OK → ErrorIA con estado`: un 429 hace `rejects` con una instancia de `ErrorIA` y `estado: 429`.
  - `respuesta sin texto → ErrorIA`: `{candidates:[]}` y también `{promptFeedback:{blockReason:"SAFETY"}}` hacen `rejects` con `ErrorIA`.
  - `fallo de red → ErrorIA`: si el `fetch` lanza `TypeError`, se `rejects` con `ErrorIA`.
- [ ] **Step 2: Ejecutar** `npx vitest run gemini`. Expected: FAIL, porque el módulo no existe.
- [ ] **Step 3: Implementar.** Usar `op.fetch ?? fetch` y `generationConfig: { temperature: 0.3, maxOutputTokens: 500 }`. Unir el texto de todas las `parts` del primer candidato.
- [ ] **Step 4: Ejecutar** `npx vitest run` y `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: interfaz ProveedorIA y cliente de Gemini`

---

### Task 2: Datos de conocimiento y tienda de demo

**Files:**
- Create: `src/datos/conocimiento.ts`, `semillas/tienda-demo.sql`
- Test: `test/datos/conocimiento.test.ts`, `test/semilla.test.ts`

**Interfaces:**
- Produces (`src/datos/conocimiento.ts`):

```ts
export type TipoConocimiento = "faq" | "producto" | "politica";
export type DatosProducto = { precio: number; moneda: string; categoria: string };
export type EntradaConocimiento = { id: string; tiendaId: string; tipo: TipoConocimiento;
  titulo: string; contenido: string; datosProducto: DatosProducto | null; actualizadoEn: number };
export async function crearConocimiento(db: D1Database, d: Omit<EntradaConocimiento, "id" | "actualizadoEn">): Promise<EntradaConocimiento>;
export async function listarConocimiento(db: D1Database, tiendaId: string): Promise<EntradaConocimiento[]>; // orden: tipo, titulo
```

  Si `datos_producto` tiene JSON inválido, se lee como `null` sin lanzar error.
- Produces: la constante `TIENDA_DEMO_ID = "demo-tostadero"`, exportada desde `src/demo.ts`.

- [ ] **Step 1: Escribir las pruebas que fallan de `conocimiento`**
  - `crear y listar por tienda`: crear 2 entradas en la tienda A y 1 en la tienda B. `listarConocimiento(A)` devuelve solo las 2 de A, ordenadas por tipo y título.
  - `datosProducto ida y vuelta`: `{precio: 12000, moneda:"COP", categoria:"Café en grano"}` se lee igual.
  - `datos_producto corrupto → null`: insertar la fila con SQL directo y `datos_producto = '{x'`. Se lee `datosProducto === null`.
- [ ] **Step 2: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS.
- [ ] **Step 3: Escribir la semilla `semillas/tienda-demo.sql`**
  - Tienda: id `demo-tostadero`, nombre "Tostadero Aurora", con `configuracion`: tono "cálido y cercano", horario "Lunes a sábado de 8:00 a 19:00", bienvenida "¡Hola! Soy el asistente de Tostadero Aurora ☕ ¿En qué te ayudo?" y 2–3 reglas de la tienda.
  - Al menos 20 productos (café en grano y molido, métodos, accesorios), con precios en COP en `datos_producto`.
  - Al menos 15 FAQ o políticas: envíos nacionales, medios de pago, devoluciones, horarios, suscripción mensual, molienda a pedido.
  - A propósito **no** incluir: envíos internacionales, tarjetas de regalo ni talleres. Así la fase 3 puede mostrar cómo aprende el bot.
  - El archivo empieza con `DELETE FROM tiendas WHERE id='demo-tostadero';`, gracias a la cascada, para que se pueda volver a ejecutar.
  - Todo inventado.
- [ ] **Step 4: Probar la semilla** en `test/semilla.test.ts`. Leer el archivo con `import semilla from "../semillas/tienda-demo.sql?raw"`, dividirlo en sentencias y ejecutarlas con `env.DB.batch`.
  - `la semilla carga y es re-ejecutable`: ejecutarla 2 veces sin error.
  - Después debe haber al menos 20 entradas `producto`, al menos 15 de `faq` + `politica`, y `obtenerTienda("demo-tostadero").nombre === "Tostadero Aurora"`.
- [ ] **Step 5: Ejecutar** `npx vitest run` y `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat: datos de conocimiento y semilla de la tienda demo`

---

### Task 3: Conversaciones y mensajes

**Files:**
- Create: `src/datos/conversaciones.ts`
- Test: `test/datos/conversaciones.test.ts`

**Interfaces:**
- Produces:

```ts
export type Canal = "whatsapp" | "simulador";
export type Conversacion = { id: string; tiendaId: string; canal: Canal; cliente: string;
  estado: "bot" | "requiere_humano"; creadaEn: number; actualizadaEn: number };
export type Mensaje = { id: string; conversacionId: string; rol: "cliente" | "bot" | "humano"; texto: string; creadoEn: number };
export async function obtenerOCrearConversacion(db: D1Database, tiendaId: string, canal: Canal, cliente: string): Promise<Conversacion>;
export async function guardarMensaje(db: D1Database, conversacionId: string, rol: Mensaje["rol"], texto: string, idExterno?: string): Promise<Mensaje>;
export async function ultimosMensajes(db: D1Database, conversacionId: string, limite: number): Promise<Mensaje[]>; // cronológico ascendente
```

  `obtenerOCrearConversacion` usa `INSERT ... ON CONFLICT(tienda_id, canal, cliente) DO NOTHING` y después un `SELECT`, de modo que dos peticiones simultáneas no crean duplicados. `guardarMensaje` actualiza `conversaciones.actualizada_en` en el mismo `batch`.

- [ ] **Step 1: Escribir las pruebas que fallan**
  - `misma tienda+canal+cliente → misma conversación`: llamar 2 veces y obtener el mismo `id`.
  - `distinto cliente → distinta conversación`.
  - `ultimosMensajes devuelve los N más recientes en orden cronológico`: guardar 12 mensajes "m1".."m12" con `creado_en` creciente. Si dos mensajes caen en el mismo milisegundo, el orden se desempata con la columna `rowid`. `ultimosMensajes(…, 10)` devuelve los textos `m3`..`m12` en ese orden.
  - `guardarMensaje actualiza actualizada_en`.
- [ ] **Step 2: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS. Ejecutar también `npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `feat: datos de conversaciones y mensajes`

---

### Task 4: Núcleo `atenderMensaje` y prompt de sistema

**Files:**
- Create: `src/nucleo/prompt.ts`, `src/nucleo/atender.ts`
- Test: `test/nucleo/prompt.test.ts`, `test/nucleo/atender.test.ts`

**Interfaces:**
- Consumes: `Tienda` y `obtenerTienda` (fase 1), `listarConocimiento` (Task 2), las funciones de conversaciones (Task 3) y `ProveedorIA`/`ErrorIA` (Task 1).
- Produces:

```ts
// prompt.ts
export function construirPromptSistema(tienda: Tienda, conocimiento: EntradaConocimiento[]): string;
// atender.ts
export const LIMITE_HISTORIAL = 10;
export const RESPUESTA_SIN_IA = "Uy, ahora mismo no puedo responder. Intenta de nuevo en un momento, por favor 🙏";
export type MensajeEntrante = { tiendaId: string; canal: Canal; cliente: string; texto: string };
export type ResultadoAtencion = { respuesta: string; conversacionId: string; huboErrorIA: boolean };
export async function atenderMensaje(deps: { db: D1Database; ia: ProveedorIA }, m: MensajeEntrante): Promise<ResultadoAtencion>;
```

- [ ] **Step 1: Escribir las pruebas que fallan de `prompt`**
  - `incluye nombre, tono, horario y reglas de la tienda`.
  - `incluye cada entrada de conocimiento`: título, contenido, y en los productos el precio formateado (`12.000 COP`).
  - `contiene las reglas de seguridad`. El prompt incluye literalmente estas frases, que son el texto fijado por el diseño:
    - "Responde solo con la información de la tienda que aparece abajo."
    - "Si no tienes la información, dilo con honestidad y sugiere contactar a la tienda; nunca inventes."
    - "Nunca confirmes disponibilidad ni stock."
    - "Responde en español, en mensajes breves como en un chat."
- [ ] **Step 2: Escribir las pruebas que fallan de `atender`.** Usar un `ProveedorIA` falso que guarde la entrada que recibe.
  - `responde y guarda ambos mensajes`: la IA devuelve "¡Claro!". El resultado tiene `respuesta === "¡Claro!"` y `huboErrorIA === false`, y `ultimosMensajes` devuelve `[cliente:texto, bot:"¡Claro!"]`.
  - `envía el historial con el mensaje nuevo al final, máximo LIMITE_HISTORIAL`: con 15 mensajes previos, `entrada.mensajes.length === 10` y el último es el del cliente actual.
  - `si la IA falla → RESPUESTA_SIN_IA, sin lanzar`: la IA lanza `ErrorIA("x", 429)`. El resultado tiene `respuesta === RESPUESTA_SIN_IA` y `huboErrorIA === true`. El mensaje del cliente queda guardado y la respuesta de error **no** se guarda como mensaje del bot, para no contaminar el historial.
  - `tienda inexistente → lanza TiendaNoEncontrada`: exportar `class TiendaNoEncontrada extends Error` desde `atender.ts`.
- [ ] **Step 3: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS. Ejecutar también `npx tsc --noEmit`.
- [ ] **Step 4: Commit** — `feat: núcleo atenderMensaje con prompt restringido a datos de la tienda`

---

### Task 5: Canal simulador (API) y cableado en la app

**Files:**
- Create: `src/canales/simulador.ts`, `src/ia/crear.ts`, `.dev.vars.example`
- Modify: `src/app.ts`, `wrangler.jsonc` (agregar `vars.GEMINI_MODELO` y `vars.DEMO_TIENDA_ID`), `src/env.d.ts`
- Test: `test/canales/simulador.test.ts`

**Interfaces:**
- Consumes: `atenderMensaje` y `TiendaNoEncontrada` (Task 4), `crearProveedorGemini` (Task 1), `obtenerTienda` y `ultimosMensajes`.
- Produces:
  - `src/ia/crear.ts`: `export function crearProveedorIA(env: Env): ProveedorIA`. En esta fase siempre devuelve Gemini con `env.GEMINI_API_KEY` y `env.GEMINI_MODELO`.
  - `src/canales/simulador.ts`: `export const simulador: Hono<{ Bindings: Env }>`, montado en `app.route("/api/simulador", simulador)`.
  - Cookie `sim_cliente`: con `HttpOnly; Secure; SameSite=None; Path=/api/simulador; Max-Age=86400`. Debe ser `SameSite=None` para que funcione dentro del iframe del portfolio. Su valor es un UUID v4. Si falta o no cumple `/^[0-9a-f-]{36}$/`, se genera uno nuevo.
  - `GET /api/simulador/inicio` responde 200 con `{ tienda: { nombre, bienvenida }, mensajes: {rol, texto}[] }`, donde `mensajes` son los últimos 50 de la conversación de ese cliente.
  - `POST /api/simulador/mensaje` recibe `{ texto }` y responde 200 con `{ respuesta, huboErrorIA }`.
  - Validación: `texto` es string, se recorta, debe tener entre 1 y 1000 caracteres; si no, 400 `{error:"Mensaje inválido"}`. Un cuerpo que no es JSON también da 400.
  - Si la tienda de demo no existe, ambas rutas dan 503 `{error:"Tienda de demo no disponible"}`.

- [ ] **Step 1: Escribir las pruebas que fallan.** Usar `exports.default.fetch` y cargar la semilla en `beforeAll`, con una función `cargarSemilla()` compartida desde `test/ayudantes.ts`, extraída de la Task 2. Simular Gemini con `vi.spyOn(globalThis, "fetch")`: si la URL incluye `generativelanguage`, devolver un JSON de Gemini con el texto "Respuesta de prueba"; en cualquier otro caso, usar el `fetch` real.
  - `POST /mensaje sin cookie → 200, crea cookie y responde`: `Set-Cookie` contiene `sim_cliente=` y `SameSite=None`, y el cuerpo es `{respuesta:"Respuesta de prueba", huboErrorIA:false}`.
  - `GET /inicio con la cookie devuelve bienvenida e historial`: `tienda.nombre === "Tostadero Aurora"` y `mensajes` tiene los 2 mensajes anteriores.
  - `cookie manipulada → cliente nuevo`: con `sim_cliente=../../otro`, la respuesta trae un `Set-Cookie` nuevo y `inicio` devuelve `mensajes: []`.
  - `texto inválido → 400 sin llamar a Gemini`: probar `""`, `"   "`, `"x".repeat(1001)`, `{texto: 5}` y un cuerpo no JSON. Todos dan 400 y el espía registra 0 llamadas a `generativelanguage`.
  - `Gemini 429 → 200 con huboErrorIA`: el cuerpo es `{respuesta: RESPUESTA_SIN_IA, huboErrorIA: true}`.
  - `sin tienda demo → 503`: usar una app con `DEMO_TIENDA_ID` apuntando a un id inexistente. Para eso, el router del simulador lee el id de `c.env.DEMO_TIENDA_ID`, y la prueba llama a `app.request(url, init, { ...env, DEMO_TIENDA_ID: "nope" })`.
- [ ] **Step 2: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS. Ejecutar también `npx tsc --noEmit`.
- [ ] **Step 3: Configuración.**
  - `wrangler.jsonc` agrega `"vars": { "GEMINI_MODELO": "gemini-2.5-flash", "DEMO_TIENDA_ID": "demo-tostadero" }`. El modelo se verifica en la Task 7.
  - `vitest.config.ts` agrega el binding de prueba `GEMINI_API_KEY: "clave-de-prueba"`.
  - `.dev.vars.example` contiene `GEMINI_API_KEY=pega-tu-clave-aqui`.
  - Ejecutar `npm run tipos` y `npx tsc --noEmit`.
- [ ] **Step 4: Commit** — `feat: canal simulador con cookie anónima y validación`

---

### Task 6: Página del simulador

**Files:**
- Create: `public/simulador/index.html`, `public/simulador/simulador.css`, `public/simulador/simulador.js`
- Modify: `wrangler.jsonc` (agregar `"assets": { "directory": "public" }`)
- Test: `test/simulador-pagina.test.ts`

**Interfaces:**
- Consumes: `GET /api/simulador/inicio` y `POST /api/simulador/mensaje` (Task 5), con `credentials: "include"`.

- [ ] **Step 1: Construir la página**
  - Una sola vista de chat con cabecera (nombre de la tienda y "en línea"), lista de burbujas (cliente a la derecha en verde claro, bot a la izquierda en blanco) y caja de texto con botón de enviar.
  - Indicador de "escribiendo…" mientras espera la respuesta.
  - El botón se desactiva durante el envío. Enter envía.
  - Las burbujas se renderizan con `textContent`, nunca con `innerHTML`, porque la respuesta del modelo es texto no confiable.
  - Debe funcionar a 360 px de ancho y dentro de un iframe de unos 400×650 px.
  - Si el API responde un error o `huboErrorIA`, muestra el texto recibido como burbuja del bot. Si falla la red, muestra "Sin conexión, intenta de nuevo".
- [ ] **Step 2: Escribir la prueba** `test/simulador-pagina.test.ts`: `GET /simulador/` responde 200 con `content-type` que contiene `text/html` y un cuerpo que contiene `simulador.js`. Ejecutar. Expected: PASS una vez configurado `assets`. Si el plugin de pruebas no sirve los assets, ver la nota.
  - Nota: si `exports.default.fetch` no pasa por los assets en las pruebas, sustituir esta prueba por una verificación manual con `npm run dev` y `curl -s localhost:8787/simulador/ | grep simulador.js`, y dejarlo anotado como decisión en el registro.
- [ ] **Step 3: Verificar a mano** con `npm run dev` y una clave real en `.dev.vars`. Abrir `http://localhost:8787/simulador/` y preguntar "¿cuál es el horario?". Expected: responde con el horario de la semilla. Preguntar "¿hacen envíos a España?". Expected: dice que no tiene esa información, sin inventar.
- [ ] **Step 4: Commit** — `feat: página del simulador estilo chat`

---

### Task 7: Despliegue de la fase 2

Esta tarea incluye pasos con la cuenta de Mateo: confirmar con él antes de cada uno.

- [ ] **Step 1: Clave de Gemini.** Mateo crea una clave gratis en Google AI Studio (https://aistudio.google.com/apikey) y ejecuta `! npx wrangler secret put GEMINI_API_KEY`. La clave no se pega en el chat.
- [ ] **Step 2: Verificar el modelo.**
  - `curl -s -H "x-goog-api-key: $KEY" https://generativelanguage.googleapis.com/v1beta/models | grep flash`. Mateo lo ejecuta con `!` para que la clave no quede en el chat.
  - Si `gemini-2.5-flash` no aparece, cambiar `GEMINI_MODELO` en `wrangler.jsonc` por el Flash vigente.
- [ ] **Step 3: Cargar la semilla** con `npx wrangler d1 execute bot-tiendas-db --remote --file semillas/tienda-demo.sql`.
- [ ] **Step 4: Desplegar** con `npm run deploy`, y después hacer `git push`.
- [ ] **Step 5: Verificar en producción**
  - `curl -s -X POST https://bot-tiendas.mateomolina.workers.dev/api/simulador/mensaje -H 'content-type: application/json' -d '{"texto":"¿Qué horario tienen?"}'` debe devolver `huboErrorIA:false` y una respuesta que menciona el horario de lunes a sábado.
  - Abrir `/simulador/` en el navegador y conversar.
- [ ] **Step 6: Actualizar el README** con el enlace al simulador y el estado "fase 2". Después commit y push.
