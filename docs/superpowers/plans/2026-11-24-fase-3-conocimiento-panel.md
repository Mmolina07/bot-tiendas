# Fase 3 — Conocimiento ("aprender") y panel de la tienda: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El bot busca solo los fragmentos relevantes del conocimiento de la tienda. Cuando no sabe algo, lo dice sin deducir y registra la pregunta. Desde un panel protegido, la tienda edita su conocimiento, importa un CSV y responde las preguntas pendientes, y el bot lo aprende al instante.

**Architecture:**
- **Buscador.** Una interfaz `Buscador` aísla la búsqueda. Tiene dos implementaciones:
  - Vectorize con embeddings de Workers AI (`@cf/baai/bge-m3`), para producción.
  - "Todo el conocimiento", para cuando no hay Vectorize: en las pruebas y como respaldo.
- **Escrituras.** Todas las escrituras de conocimiento pasan por `src/conocimiento/servicio.ts`, que guarda en D1 y reindexa. Así D1 y Vectorize no se desincronizan.
- **Panel.** Se renderiza en el servidor con Hono JSX en `/panel/:tiendaId`, protegido con Basic Auth y CSRF.
- **Preguntas sin respuesta.** El núcleo detecta la marca `[SIN_INFO]` que pone el modelo, la quita de la respuesta y registra la pregunta.

**Tech Stack:** Lo de la fase 2, más Vectorize, Workers AI (binding `AI`), `hono/basic-auth`, `hono/csrf` y Hono JSX.

**Spec:** `docs/superpowers/specs/2026-11-23-bot-tiendas-whatsapp-design.md` (secciones 2, 4, 7.2, 7.4 flujos 2 y 3, 7.6 carga de catálogo, y 8.3).

## Global Constraints

- Costo cero: Vectorize y Workers AI en plan gratuito.
- Plan gratuito de Workers: máximo 50 subrequests por petición. Embeddings y `upsert` siempre en lote: un solo `AI.run` con un array de textos y un solo `upsert` por lote de hasta 100 entradas.
- Índice Vectorize `bot-tiendas-conocimiento`: 1024 dimensiones, métrica `cosine`, índice de metadatos `tiendaId` de tipo string. El id de cada vector es el id de la entrada de `conocimiento`, y su metadata es `{ tiendaId }`.
- El bot nunca inventa ni **deduce** datos que no estén escritos en la información de la tienda (anti-objetivo §4).
- El panel exige Basic Auth con los secretos `PANEL_USUARIO` y `PANEL_CLAVE`. Los formularios POST pasan por `csrf()` con el mismo origen.
- Todo lo que se pinta en el panel pasa por JSX, que escapa el contenido, porque el conocimiento y las preguntas son texto no confiable. Nunca se usa `raw()` con datos.
- Las pruebas no usan Vectorize ni Workers AI reales. Las pruebas de integración corren con `wrangler` en el entorno `test`, sin bindings `AI` ni `VECTORIZE`, y por eso usan el buscador "todo el conocimiento". La implementación con Vectorize se prueba con objetos falsos.
- Las pruebas usan ids únicos y no asumen tablas vacías (fases 1 y 2).

## Review Focus

1. Un CSV con comillas, comas dentro de un campo, filas vacías, fila de cabecera con mayúsculas o espacios, o `tipo`/`precio` inválidos → importa las filas válidas y reporta las inválidas con su número de fila, sin abortar todo (Task 4).
2. Vectorize o Workers AI fallan al buscar → el bot responde usando todo el conocimiento en lugar de fallar (Task 2).
3. Una petición al panel sin credenciales, con credenciales erróneas o con un POST de otro origen → 401 o 403 sin tocar datos (Task 5).
4. Contenido con `<script>` en el conocimiento o en una pregunta → se muestra escapado en el panel (Task 5).
5. El modelo responde con `[SIN_INFO]` en cualquier posición o en minúsculas → la marca nunca llega al cliente y la pregunta se registra una sola vez (Task 1).

---

### Task 1: Preguntas sin respuesta, prompt más estricto y ajustes del núcleo

**Files:**
- Create: `src/datos/preguntas.ts`
- Modify: `src/nucleo/prompt.ts`, `src/nucleo/atender.ts`
- Test: `test/datos/preguntas.test.ts`, `test/nucleo/prompt.test.ts`, `test/nucleo/atender.test.ts`

**Interfaces:**
- Produces (`src/datos/preguntas.ts`):

```ts
export type Pregunta = { id: string; tiendaId: string; conversacionId: string | null; pregunta: string;
  estado: "pendiente" | "resuelta"; creadaEn: number };
export async function registrarPregunta(db: D1Database, tiendaId: string, conversacionId: string | null, pregunta: string): Promise<Pregunta>;
export async function listarPreguntasPendientes(db: D1Database, tiendaId: string): Promise<Pregunta[]>; // más recientes primero
export async function obtenerPregunta(db: D1Database, tiendaId: string, id: string): Promise<Pregunta | null>;
export async function marcarResuelta(db: D1Database, tiendaId: string, id: string): Promise<void>;
```

- Produces (`src/nucleo/prompt.ts`): `export const MARCA_SIN_INFO = "[SIN_INFO]"`.
- Changes (`src/nucleo/atender.ts`): `ResultadoAtencion` gana el campo `sinInformacion: boolean`. `atenderMensaje(deps, m)` tiene ahora `deps: { db: D1Database; ia: ProveedorIA; buscador: Buscador }`, con `Buscador` de la Task 2. En esta task, la búsqueda sigue siendo `listarConocimiento`; la Task 2 introduce `buscador`.

- [ ] **Step 1: Escribir las pruebas que fallan de `preguntas`**
  - `registrar y listar pendientes por tienda`: crear 2 preguntas en la tienda A y 1 en la B. La lista de A tiene 2 preguntas, de la más reciente a la más antigua.
  - `marcarResuelta la saca de pendientes`.
  - `obtenerPregunta de otra tienda → null`: no se puede acceder a la pregunta de otra tienda cambiando el id en la URL.
- [ ] **Step 2: Escribir las pruebas que fallan del prompt.** Agregar estas frases a `contiene las reglas de seguridad`:
  - "Si la información no aparece escrita abajo, no la deduzcas ni la supongas (por ejemplo, si no se menciona un país, no afirmes que no envían allí)."
  - "Cuando no tengas la información, empieza tu respuesta con [SIN_INFO] y después dilo con honestidad y sugiere contactar a la tienda."
  - "Saluda solo en tu primera respuesta de la conversación."

  Quitar de la lista la frase antigua "Si no tienes la información, dilo con honestidad y sugiere contactar a la tienda; nunca inventes.", porque la sustituye la segunda frase nueva.
- [ ] **Step 3: Escribir las pruebas que fallan del núcleo**
  - `[SIN_INFO] → se quita la marca y se registra la pregunta`: la IA responde `"[SIN_INFO] No tengo esa información."`. El resultado tiene `respuesta === "No tengo esa información."` y `sinInformacion: true`. `listarPreguntasPendientes` contiene el texto del cliente, y el mensaje guardado del bot no contiene `[SIN_INFO]`.
  - `marca en minúsculas o en medio del texto también cuenta`: con `"Lo siento, [sin_info] no sé."`, la respuesta no contiene la marca sin importar mayúsculas, y la pregunta se registra una sola vez.
  - `sin marca → no registra pregunta`.
  - `fallo al guardar tras una respuesta correcta → se lanza, no se reporta como fallo de IA`: arreglo pendiente de la revisión de la fase 2. Solo `ia.generar` va dentro del `try`. Para probarlo, usar un `db` envuelto cuyo `batch` lanza error en la segunda llamada a `guardarMensaje`, y comprobar que `atenderMensaje` hace `rejects`.
  - `envía el historial en orden`: arreglo pendiente de la fase 2. Además de lo que ya se comprueba, `entrada.mensajes.map(m => m.texto)` es igual a `["previo 7", …, "previo 15", "nuevo"]`.
- [ ] **Step 4: Ejecutar.** Expected: FAIL.
- [ ] **Step 5: Implementar**
  - La marca se detecta con `/\[sin_info\]/gi`. Se quitan todas sus apariciones y se hace `trim()`.
  - Si tras quitarla la respuesta queda vacía, se usa "No tengo esa información, te sugiero contactar a la tienda."
  - `registrarPregunta` se llama con el texto del cliente.
- [ ] **Step 6: Ejecutar** `npx vitest run` y `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 7: Commit** — `feat: preguntas sin respuesta y prompt que no deduce`

---

### Task 2: Buscador (Vectorize + Workers AI, con respaldo)

**Files:**
- Create: `src/conocimiento/buscador.ts`
- Modify: `src/nucleo/atender.ts`, `src/canales/simulador.ts`, `wrangler.jsonc`, `vitest.config.ts`, `src/env.d.ts`
- Test: `test/conocimiento/buscador.test.ts`, `test/nucleo/atender.test.ts`

**Interfaces:**
- Produces (`src/conocimiento/buscador.ts`):

```ts
export const MODELO_EMBEDDINGS = "@cf/baai/bge-m3";
export const RESULTADOS_BUSQUEDA = 8;
export interface Buscador {
  buscar(tiendaId: string, texto: string): Promise<EntradaConocimiento[]>;
  indexar(entradas: EntradaConocimiento[]): Promise<void>;  // en lotes de 100
  borrar(ids: string[]): Promise<void>;
}
export function textoParaIndexar(e: EntradaConocimiento): string; // "titulo. contenido" (+ " Categoría: x. Precio: 12.000 COP." en productos)
export function crearBuscadorTodo(db: D1Database): Buscador;      // buscar = listarConocimiento; indexar/borrar = no-op
export function crearBuscadorVectorize(op: { db: D1Database; ai: Ai; indice: VectorizeIndex }): Buscador;
export function crearBuscador(env: Env): Buscador;                // Vectorize si existen env.AI y env.VECTORIZE; si no, Todo
```

- Comportamiento de `crearBuscadorVectorize.buscar`:
  - Genera el embedding de `texto` y consulta `indice.query(vector, { topK: RESULTADOS_BUSQUEDA, filter: { tiendaId } })`.
  - Carga esas entradas desde D1, solo las de esa tienda, en el orden de relevancia. Los ids que ya no existen en D1 se ignoran.
  - **Si AI o Vectorize lanzan un error, o si no hay resultados**, devuelve `listarConocimiento` de la tienda (respaldo), con un `console.warn`.
- Wiring:
  - `wrangler.jsonc` agrega `"ai": { "binding": "AI" }` y `"vectorize": [{ "binding": "VECTORIZE", "index_name": "bot-tiendas-conocimiento" }]`, además de `"env": { "test": { … } }`. El entorno `test` repite `d1_databases`, `vars` y `assets`, pero sin `ai` ni `vectorize`.
  - `vitest.config.ts` usa `wrangler: { configPath: "./wrangler.jsonc", environment: "test" }`.
  - `src/env.d.ts` declara `AI?` y `VECTORIZE?` como opcionales en `Cloudflare.Env`, porque en el entorno `test` no existen.
  - `atenderMensaje` usa `deps.buscador.buscar(tienda.id, m.texto)` en lugar de `listarConocimiento`.

- [ ] **Step 1: Escribir las pruebas que fallan.** `ai` falso: `run(modelo, { text })` devuelve `{ data: text.map(() => vector1024) }` y guarda las llamadas. `indice` falso: guarda los `upsert`, `deleteByIds` y `query`, y `query` devuelve `matches` configurables.
  - `textoParaIndexar incluye categoría y precio en productos`.
  - `indexar hace un solo AI.run y un solo upsert por lote de 100`: con 150 entradas, `ai.run` se llama 2 veces y `upsert` 2 veces, con lotes de 100 y 50. Cada vector tiene `id = entrada.id`, `metadata.tiendaId` y `values.length === 1024`. `ai.run` se llama con `MODELO_EMBEDDINGS`.
  - `buscar filtra por tienda y respeta el orden de relevancia`: `query` devuelve `[idB, idA, "borrado"]`. Debe llamarse con `filter: { tiendaId }` y `topK: 8`, y el resultado son las entradas `[B, A]`.
  - `buscar ignora ids de otra tienda`: si `query` devuelve el id de una entrada de otra tienda, no se incluye.
  - `si AI falla → respaldo con todo el conocimiento`.
  - `sin resultados → respaldo con todo el conocimiento`.
  - `borrar llama deleteByIds`, y con una lista vacía no llama a nada.
  - `crearBuscador sin bindings → buscador Todo`: con `{ ...env, AI: undefined, VECTORIZE: undefined }`, `indexar` no lanza error y `buscar` devuelve el conocimiento de la tienda.
  - En `atender.test.ts`, pasar `buscador: crearBuscadorTodo(env.DB)` a las pruebas existentes, más una prueba nueva: `usa el buscador para el prompt`. Con un buscador falso que devuelve 1 entrada con título "Solo esta", el `sistema` contiene "Solo esta" y no contiene otras entradas de la tienda.
- [ ] **Step 2: Ejecutar.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Hacer después `npm run tipos`. Si `wrangler types` marca `AI` o `VECTORIZE` como obligatorios, la declaración opcional de `src/env.d.ts` no podrá relajarlos. En ese caso, `crearBuscador` comprueba en tiempo de ejecución (`if (!env.AI || !env.VECTORIZE)`), y se deja anotado como decisión en el registro.
- [ ] **Step 4: Ejecutar** `npx vitest run` y `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: búsqueda semántica con Vectorize y respaldo`

---

### Task 3: Servicio de conocimiento (D1 + índice sincronizados)

**Files:**
- Modify: `src/datos/conocimiento.ts`
- Create: `src/conocimiento/servicio.ts`
- Test: `test/datos/conocimiento.test.ts`, `test/conocimiento/servicio.test.ts`

**Interfaces:**
- Produces (`src/datos/conocimiento.ts`):

```ts
export type DatosEntrada = Omit<EntradaConocimiento, "id" | "actualizadoEn" | "tiendaId">;
export async function obtenerConocimiento(db: D1Database, tiendaId: string, id: string): Promise<EntradaConocimiento | null>;
export async function actualizarConocimiento(db: D1Database, tiendaId: string, id: string, d: DatosEntrada): Promise<EntradaConocimiento | null>;
export async function borrarConocimiento(db: D1Database, tiendaId: string, id: string): Promise<boolean>;
export async function crearConocimientoEnLote(db: D1Database, tiendaId: string, lista: DatosEntrada[]): Promise<EntradaConocimiento[]>;
```

  Todas filtran por `tiendaId`: actuar sobre un id de otra tienda devuelve `null` o `false`.
- Produces (`src/conocimiento/servicio.ts`). Son las **únicas** funciones que el panel usa para escribir:

```ts
export type Deps = { db: D1Database; buscador: Buscador };
export async function agregarEntrada(deps: Deps, tiendaId: string, d: DatosEntrada): Promise<EntradaConocimiento>;
export async function editarEntrada(deps: Deps, tiendaId: string, id: string, d: DatosEntrada): Promise<EntradaConocimiento | null>;
export async function quitarEntrada(deps: Deps, tiendaId: string, id: string): Promise<boolean>;
export async function agregarEnLote(deps: Deps, tiendaId: string, lista: DatosEntrada[]): Promise<EntradaConocimiento[]>;
export async function resolverPregunta(deps: Deps, tiendaId: string, preguntaId: string, respuesta: string): Promise<EntradaConocimiento | null>;
  // crea una FAQ con titulo = texto de la pregunta y contenido = respuesta, la indexa y marca la pregunta resuelta
export async function reindexarTienda(deps: Deps, tiendaId: string): Promise<number>; // cantidad indexada
```

- [ ] **Step 1: Escribir las pruebas que fallan.** Usar un buscador falso que guarde `indexar` y `borrar`.
  - `actualizar y borrar respetan la tienda`: con el id de una entrada de la tienda A pero el `tiendaId` de B, el resultado es `null`/`false` y la entrada de A no cambia.
  - `crearConocimientoEnLote inserta todas en un batch`: 30 entradas dan 30 filas.
  - `agregarEntrada guarda e indexa`.
  - `editarEntrada reindexa`.
  - `quitarEntrada borra del índice`.
  - `resolverPregunta crea la FAQ, la indexa y marca resuelta`: después, `listarPreguntasPendientes` no la contiene y `listarConocimiento` tiene una FAQ con ese título y esa respuesta.
  - `resolverPregunta con respuesta vacía o de otra tienda → null sin cambios`.
  - `reindexarTienda indexa todo el conocimiento de la tienda`.
- [ ] **Step 2: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS. Ejecutar también `npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `feat: servicio de conocimiento sincronizado con el índice`

---

### Task 4: Importación de CSV

**Files:**
- Create: `src/conocimiento/csv.ts`
- Test: `test/conocimiento/csv.test.ts`

**Interfaces:**
- Produces:

```ts
export const MAX_FILAS_CSV = 500;
export type ErrorFila = { fila: number; motivo: string }; // fila = número de línea en el archivo (cabecera = 1)
export function leerCsv(texto: string): string[][];                  // RFC 4180: comillas, "" escapadas, comas y saltos dentro de comillas, \r\n
export function csvAEntradas(texto: string): { entradas: DatosEntrada[]; errores: ErrorFila[] };
```

- Formato de `csvAEntradas`:
  - Cabecera obligatoria con las columnas `tipo,titulo,contenido,precio,moneda,categoria`, en cualquier orden. Los nombres se normalizan con `trim().toLowerCase()`.
  - `precio`, `moneda` y `categoria` solo se usan cuando `tipo = producto`. Si `precio` está, debe ser numérico: se aceptan `12000`, `12.000` y `12000.5`, y los puntos de miles se quitan cuando hay más de 3 dígitos tras el punto o más de un punto. `moneda` por defecto es `COP`, y `categoria` por defecto es `General`.
  - Las filas totalmente vacías se ignoran sin error.
  - Errores por fila: `tipo inválido`, `falta titulo`, `falta contenido` y `precio inválido`.
  - Si faltan columnas obligatorias en la cabecera (`tipo`, `titulo`, `contenido`), se devuelve un único error en la fila 1.
  - Por encima de `MAX_FILAS_CSV` filas de datos, se devuelve un único error "máximo 500 filas" y ninguna entrada.
  - Se quita el BOM inicial si existe.

- [ ] **Step 1: Escribir las pruebas que fallan**
  - `leerCsv maneja comillas, comas, comillas escapadas y saltos dentro de comillas`: `'a,"b, c","d ""x""","e\nf"\r\n1,2,3,4'` da `[["a","b, c",'d "x"',"e\nf"],["1","2","3","4"]]`.
  - `csvAEntradas importa productos y FAQ`: con la cabecera ` Tipo , TITULO,contenido,precio,moneda,categoria`, una fila de producto con precio `12.000` y una de FAQ, se obtienen 2 entradas. El producto tiene `{precio:12000, moneda:"COP", categoria:"General"}` cuando faltan moneda y categoría, y la FAQ tiene `datosProducto: null`.
  - `filas inválidas se reportan con su número y las válidas se importan`: con 4 filas (válida, tipo "otro", sin título, precio "abc"), se obtiene 1 entrada y los errores de las filas 3, 4 y 5 con sus motivos.
  - `cabecera sin columnas obligatorias → error en fila 1`.
  - `más de 500 filas → error y sin entradas`.
  - `ignora filas vacías y BOM`.
- [ ] **Step 2: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS.
- [ ] **Step 3: Commit** — `feat: importación de conocimiento desde CSV`

---

### Task 5: Panel de la tienda

**Files:**
- Create: `src/panel/rutas.tsx`, `src/panel/vistas.tsx`
- Modify: `src/app.ts`, `src/env.d.ts` (agregar `PANEL_USUARIO: string; PANEL_CLAVE: string`), `vitest.config.ts` (bindings de prueba `PANEL_USUARIO: "admin"` y `PANEL_CLAVE: "clave-prueba"`), `.dev.vars.example`, `tsconfig.json` (incluir `.tsx` si hace falta)
- Test: `test/panel/panel.test.ts`

**Interfaces:**
- Consumes: el servicio (Task 3), `csvAEntradas` (Task 4), `listarPreguntasPendientes` (Task 1), `listarConocimiento`, `obtenerTienda` y `crearBuscador` (Task 2).
- Produces: `export const panel: Hono<{ Bindings: Env }>` montado en `app.route("/panel", panel)`. Rutas:
  - `GET /panel/:tiendaId`: una página con tres secciones.
    1. "Preguntas sin respuesta", con un formulario de respuesta por pregunta.
    2. "Agregar conocimiento", con un formulario de tipo, título, contenido y, si es producto, precio, moneda y categoría, más un formulario "Importar CSV" con un archivo o un textarea.
    3. "Conocimiento", una tabla con cada entrada y sus botones Editar y Borrar.

    Arriba, un botón "Reindexar todo".
  - `GET /panel/:tiendaId/conocimiento/:id/editar`: el formulario de edición.
  - `POST /panel/:tiendaId/conocimiento` (crear), `POST /panel/:tiendaId/conocimiento/:id` (editar), `POST /panel/:tiendaId/conocimiento/:id/borrar`, `POST /panel/:tiendaId/preguntas/:id/resolver`, `POST /panel/:tiendaId/importar` y `POST /panel/:tiendaId/reindexar`.
  - Los POST correctos redirigen con 303 a `/panel/:tiendaId?aviso=<texto>`, y la página muestra el aviso, por ejemplo "Importadas 20 entradas. 2 filas con errores: fila 3 (tipo inválido)…".
  - Si la tienda no existe, 404 con una página simple. Si un formulario es inválido, 400 con la página y el mensaje de error.
- Seguridad:
  - `basicAuth({ username: c.env.PANEL_USUARIO, password: c.env.PANEL_CLAVE })` sobre `/panel/*`. Las credenciales se leen por petición desde `c.env`.
  - `csrf()` de `hono/csrf` sobre `/panel/*`. Rechaza con 403 los POST de formulario cuyo `Origin` no coincide.
  - Gracias al `onError` de la fase 1, el 401 de basicAuth conserva la cabecera `WWW-Authenticate`.

- [ ] **Step 1: Escribir las pruebas que fallan.** Usar `exports.default.fetch` con la cabecera `authorization: Basic base64("admin:clave-prueba")` y `origin: https://x` en los POST. Crear una tienda propia por prueba.
  - `sin credenciales → 401 con WWW-Authenticate`.
  - `credenciales erróneas → 401`.
  - `POST de otro origen → 403 y no crea nada`: con `origin: https://malo.example`, `listarConocimiento` no cambia.
  - `GET muestra preguntas pendientes y conocimiento`: con una pregunta y una entrada sembradas, el HTML contiene ambos textos.
  - `crear entrada → 303 y aparece en la lista`.
  - `resolver pregunta → 303, desaparece de pendientes y aparece como FAQ`.
  - `editar y borrar entrada`.
  - `importar CSV por textarea → aviso con conteo y errores`: un CSV con 2 filas válidas y 1 inválida produce un aviso que contiene "2" y "fila 3".
  - `contenido con <script> se escapa`: una entrada con título `<script>alert(1)</script>` hace que el HTML contenga `&lt;script&gt;` y no `<script>alert`.
  - `tienda inexistente → 404`.
  - `editar entrada de otra tienda → 404`.
- [ ] **Step 2: Ejecutar.** Expected: FAIL. Después implementar y ejecutar de nuevo. Expected: PASS. Ejecutar también `npx tsc --noEmit`.
- [ ] **Step 3: Diseño de las vistas**
  - Usable a 360 px de ancho y en modo claro y oscuro, con estilos en línea con `<style>` dentro de un layout JSX.
  - Etiquetas en todos los campos.
  - Los botones de borrar van en un `<form method="post">` con `onsubmit="return confirm(...)"`.
- [ ] **Step 4: Commit** — `feat: panel de la tienda con auth, CSRF, CSV y preguntas`

---

### Task 6: Despliegue de la fase 3

Esta tarea incluye pasos con la cuenta de Mateo: confirmar con él antes de crear recursos y para los secretos.

- [ ] **Step 1: Crear el índice y su índice de metadatos.** Hay que hacerlo antes de insertar vectores.
  - `npx wrangler vectorize create bot-tiendas-conocimiento --dimensions=1024 --metric=cosine`
  - `npx wrangler vectorize create-metadata-index bot-tiendas-conocimiento --propertyName=tiendaId --type=string`
- [ ] **Step 2: Secretos del panel.** Mateo ejecuta `! npx wrangler secret put PANEL_USUARIO` y `! npx wrangler secret put PANEL_CLAVE`, eligiendo él los valores.
- [ ] **Step 3: Desplegar** con `npm run deploy` y hacer `git push`.
- [ ] **Step 4: Indexar la tienda de demo.** Mateo abre `https://bot-tiendas.mateomolina.workers.dev/panel/demo-tostadero` y pulsa "Reindexar todo". Expected: el aviso dice "Indexadas 38 entradas".
- [ ] **Step 5: Verificar en producción**
  - Preguntar en el simulador "¿hacen envíos a España?". Expected: dice que no tiene la información y la pregunta aparece en el panel.
  - Responderla en el panel, por ejemplo "Por ahora solo enviamos dentro de Colombia".
  - Volver a preguntar en una conversación nueva. Expected: responde con lo aprendido.
  - Preguntar "¿cuánto cuesta el envío a Cali?". Expected: responde correctamente, porque la búsqueda trae la FAQ de costos.
- [ ] **Step 6: README.** Agregar la sección "Panel de la tienda" y actualizar el estado a "fase 3". Después commit y push.
