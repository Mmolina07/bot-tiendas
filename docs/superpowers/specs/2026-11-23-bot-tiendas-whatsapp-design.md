# Bot de atención para tiendas por WhatsApp — Diseño

Fecha: 2026-11-23
Estado: borrador para aprobación

## 1. Intención y por qué

Mateo quiere un bot que atienda a los clientes de una tienda por WhatsApp, con dos fines:

1. **Portfolio**: mostrarlo en https://portafolio.mateomolina.workers.dev, donde cualquier visitante pueda probarlo.
2. **Base freelance**: en freelance piden mucho "chats que atiendan clientes y vayan aprendiendo". Este proyecto debe ser reutilizable: un cliente nuevo = configurar una tienda nueva, no un proyecto nuevo.

Restricción fuerte: **todo gratis** por ahora. Servicios de pago para un cliente concreto se evaluarán después.

## 2. Objetivos

- El bot responde preguntas de clientes de una tienda (horarios, envíos, medios de pago, políticas, productos) usando **solo** la información cargada de esa tienda.
- Busca en el catálogo y recomienda productos.
- Funciona por **dos canales con el mismo núcleo**:
  - **Simulador web** con estética tipo WhatsApp, embebible en el portfolio; cualquiera lo prueba sin dar su número.
  - **WhatsApp real** vía WhatsApp Cloud API (oficial de Meta), para demos en vivo y para clientes.
- **"Aprende"** mediante:
  - Base de conocimiento editable por la tienda (FAQ + catálogo) desde un panel.
  - Registro de preguntas que el bot no supo responder ("preguntas sin respuesta"), para que la tienda las complete; al completarlas pasan a la base de conocimiento.
  - Historial de conversación por cliente (contexto dentro de la conversación).
- **Derivar a humano**: si el cliente lo pide o el bot no sabe, la conversación se marca "requiere humano" y el bot lo avisa al cliente.
- **Multi-tienda desde el día uno**: los datos llevan el id de tienda; una sola instalación sirve a varias tiendas.
- Español como idioma principal.

## 3. No-objetivos (por ahora)

- **Tomar pedidos o cobrar.** Solo informa. Depende de integraciones externas de cada cliente (su sistema, hoja de cálculo, pasarela de pago). El diseño debe dejar espacio para añadirlo como una "herramienta" nueva del bot, sin rehacer el núcleo.
- Entrenar/afinar un modelo propio.
- Bandeja de atención humana completa (asignación a agentes, varios operadores, notificaciones). Solo un cuadro mínimo de respuesta (ver 7.6).
- Mostrar stock en tiempo real: no se guarda stock; el bot nunca confirma disponibilidad, invita a confirmarla con la tienda.
- Mensajes salientes iniciados por la tienda (plantillas/campañas de WhatsApp, que son de pago).
- Múltiples idiomas, voz, imágenes.

## 4. Anti-objetivos (sería un fracaso aunque "funcione")

- Que el bot **invente** precios, stock, políticas o productos que no están en los datos de la tienda.
- Usar librerías no oficiales de WhatsApp (Baileys, whatsapp-web.js): riesgo de bloqueo del número; ningún cliente serio lo aceptaría.
- Que un visitante del portfolio pueda agotar la cuota gratuita de IA y dejar el bot caído para todos.
- Que adaptar el bot a un cliente nuevo requiera tocar código.
- Que la demo quede rota o dormida cuando un reclutador la abre.

## 5. Restricciones

- **Costo cero**: solo planes gratuitos.
  - Cloudflare Workers free: 100k peticiones/día, 10 ms de CPU por petición (las esperas de red, p. ej. llamar a la IA, no cuentan como CPU).
  - D1 free, Vectorize free, Workers AI free (cuota diaria de "neuronas").
  - API de Gemini en plan gratuito (con límites de peticiones por minuto/día; en plan gratuito Google puede usar los datos para mejorar sus productos — aceptable para la demo, a revisar con clientes reales).
  - WhatsApp Cloud API: las respuestas dentro de la ventana de 24 h tras un mensaje del cliente son gratuitas. El número de prueba de Meta solo envía a hasta 5 números verificados.
- **Webhook de Meta**: hay que responder 200 rápido; el procesamiento (IA) se hace en segundo plano (`ctx.waitUntil`). Validar la firma `X-Hub-Signature-256` con el App Secret y la verificación inicial `hub.challenge`. Meta puede reenviar el mismo mensaje: el procesamiento debe ser idempotente (deduplicar por id de mensaje).
- El runtime de Workers no es Node completo: elegir librerías compatibles.
- El portfolio vive en otra carpeta/repositorio; este proyecto es independiente. La integración con el portfolio es un cambio pequeño al final (embeber/enlazar el simulador).

## 6. Enfoques considerados

| Enfoque | A favor | En contra |
|---|---|---|
| **1. Código propio en Cloudflare (elegido)** | Gratis y sin dormirse; misma plataforma que el portfolio; multi-tienda real; alto valor de portfolio | Más trabajo inicial; runtime de Workers limitado |
| 2. Node.js + Render + Supabase | Muy común en ofertas freelance; flexible | Render gratis se duerme (~50 s de arranque); Supabase gratis pausa tras una semana sin uso |
| 3. n8n / Flowise | Muy rápido; editable por no técnicos; mucha demanda | Poco código propio para mostrar; gratis solo autoalojado; escala mal a muchos clientes (un flujo por cliente) |

**Elegido: 1**, por Mateo, porque es gratis de verdad, siempre está despierto (crítico para el webhook y para la demo), escala a muchas tiendas con una sola instalación y demuestra nivel técnico. Se reconoce que n8n es valioso para clientes que quieren algo rápido o editable por ellos; es una habilidad complementaria, no este proyecto.

En la demo, los visitantes prueban el **simulador web**; el WhatsApp real se usa para demos en vivo (decidido por Mateo).

## 7. Diseño

### 7.1 Tecnologías y por qué

| Pieza | Tecnología | Por qué |
|---|---|---|
| Servidor | Cloudflare Workers + **TypeScript** + **Hono** | Hono es ligero, hecho para Workers, con rutas y middleware tipo Express |
| Base de datos | **D1** (SQLite) | Gratis, integrada, SQL estándar; suficiente para tiendas, conversaciones y FAQ |
| Búsqueda por significado | **Vectorize** + embeddings de **Workers AI** (modelo multilingüe, p. ej. `bge-m3`) | Encuentra la info relevante aunque el cliente lo pregunte con otras palabras; gratis |
| Modelo de lenguaje | **Gemini** (modelo Flash del plan gratuito) por defecto; **Workers AI** (Llama) como respaldo | Gemini gratis es de buena calidad en español; respaldo evita caída si se agota la cuota |
| WhatsApp | **WhatsApp Cloud API** (Meta, oficial) | Oficial, gratis para responder, es lo que pedirá un cliente |
| Simulador y panel | HTML servido por el mismo Worker (Hono JSX o HTML + JS ligero) | Sin despliegue extra; el simulador se embebe en el portfolio con un `iframe` |
| Protección del simulador | Límite de mensajes por visitante/IP y por día + **Turnstile** (CAPTCHA invisible gratuito de Cloudflare) | Evita que un abuso agote la cuota de IA |
| Acceso al panel | **Cloudflare Access** (gratis hasta 50 usuarios) o contraseña simple por tienda | Protege la edición de datos sin construir un sistema de login |
| Pruebas | **Vitest** con el pool de Workers de Cloudflare | Pruebas que corren en el mismo runtime que producción |
| Herramientas | **Wrangler** (CLI de Cloudflare), git + GitHub | Despliegue y versionado |

### 7.2 Arquitectura

```
 WhatsApp (Meta) ──webhook──┐
                            ▼
 Simulador web ──HTTP──► [Canales] ──► [Núcleo del bot] ──► [Proveedor IA]
 (iframe en portfolio)      │              │                 Gemini / Workers AI
                            │              ├──► [Conocimiento] Vectorize + D1
 Panel de la tienda ──HTTP──┘              └──► [Conversaciones] D1
```

- **Canales** (adaptadores): traducen cada canal a un mensaje común `{tienda, cliente, texto}` y la respuesta de vuelta. Añadir Instagram/Telegram en el futuro = un adaptador nuevo.
- **Núcleo**: recibe el mensaje, carga historial reciente, busca en el conocimiento de la tienda, arma el prompt con la configuración de la tienda (nombre, tono, reglas), llama a la IA y decide:
  - responder;
  - responder "no tengo esa info" + registrar pregunta sin respuesta;
  - derivar a humano.
- **Proveedor IA**: interfaz única (`generar(prompt)`, `embeber(texto)`) con implementaciones intercambiables. Cambiar de proveedor para un cliente (p. ej. a uno de pago) = configuración, no código.
- **Herramientas** (punto de extensión): el núcleo se diseña para que más adelante el modelo pueda llamar funciones (p. ej. `consultarStock`, `crearPedido`). En esta versión solo existe `buscarConocimiento`.

### 7.3 Datos (D1)

- `tiendas`: id, nombre, configuración (tono, horario, mensaje de bienvenida, reglas), id de número de WhatsApp (si tiene), proveedor IA.
- `conocimiento`: id, tienda, tipo (`faq` | `producto` | `politica`), título, contenido, datos de producto (precio, categoría…), fecha. Cada entrada se indexa en Vectorize con su id y tienda.
- `conversaciones`: id, tienda, canal, cliente (teléfono o id anónimo del simulador), estado (`bot` | `requiere_humano`), fechas.
- `mensajes`: id, conversación, rol (cliente/bot), texto, id externo (para deduplicar webhooks), fecha.
- `preguntas_sin_respuesta`: id, tienda, pregunta, conversación, estado (`pendiente` | `resuelta`).

### 7.4 Flujos clave

1. **Cliente pregunta** → canal normaliza → núcleo busca top-N fragmentos de la tienda → IA responde con instrucción estricta de usar solo esos datos → se guarda todo → se responde por el mismo canal.
2. **Bot no sabe** → responde con honestidad + ofrece derivar a humano → registra en `preguntas_sin_respuesta`.
3. **Tienda enseña** → en el panel ve preguntas sin respuesta, escribe la respuesta → se crea entrada de conocimiento y se indexa → el bot ya lo sabe.
4. **Pide humano** → conversación pasa a `requiere_humano`; el bot deja de responder automáticamente en esa conversación y avisa al cliente que una persona lo contactará. Visible en el panel.

### 7.5 Tienda de demo

Tienda ficticia (rubro a elegir por el constructor, p. ej. tienda de café o ropa) con ~20–30 productos y ~15 FAQ inventados, cargados por un script de semilla. Incluir algunas preguntas que el bot deliberadamente no sabe, para mostrar el flujo de "aprender".

### 7.6 Decisiones tomadas tras la revisión (criterio del diseñador, corregibles)

- **Derivar a humano**:
  - En WhatsApp, la conversación aparece en el panel con un cuadro mínimo para que la tienda responda desde ahí. Es gratis dentro de la ventana de 24 h y evita depender de la "coexistencia" de Meta (un número en Cloud API no puede usarse a la vez en la app de WhatsApp Business).
  - Vuelve al bot con un botón "devolver al bot", o sola tras 24 h sin actividad humana.
  - Sin notificaciones externas por ahora; el panel muestra un contador.
  - En el simulador público, la derivación se **simula**: el bot explica que en una tienda real pasaría a una persona y sigue funcionando. Ningún visitante puede silenciar la demo.
- **Cuentas de Meta**: en esta versión, una sola app de Meta (de Mateo) y un número de prueba. El modelo de datos guarda por tienda el id de número y deja campos opcionales para token y App Secret propios (como secretos cifrados). Así, más adelante, cada cliente puede usar su propia cuenta de Meta sin cambiar el núcleo. Los webhooks se enrutan a la tienda por `phone_number_id`.
- **Carga de catálogo**: además de la edición una a una, el panel permite **importar CSV** de productos y FAQ. La reindexación en Vectorize se hace por lotes.
- **Stock**: no se guarda; ver no-objetivos.

### 7.7 Demo aislada por visitante (decidido por Mateo)

Los visitantes del portfolio pueden usar **el chat y el panel**, cada uno sobre **su propia copia temporal** de la tienda de demo, para ver el ciclo completo: el bot no sabe algo → el visitante se lo enseña en el panel → el bot ya responde.

- Al abrir la demo (tras pasar Turnstile), se crea una tienda "sandbox" clonada de la tienda semilla, ligada a un id anónimo en cookie. Simulador y panel de demo operan sobre esa tienda.
- Las tiendas sandbox expiran a las pocas horas (valor a criterio del constructor). Un **Cron Trigger** de Workers (gratis) borra sus filas en D1 y sus vectores en Vectorize.
- Para no clonar todos los vectores por visitante, la búsqueda consulta los vectores de la tienda semilla **más** los que el visitante añadió en su sandbox. Solo se indexa lo nuevo.
- Límites por sandbox: máximo de entradas de conocimiento nuevas, de mensajes por día y de sandboxes activos en total, para no salirse de las cuotas gratuitas. Si se llega al tope global, la demo lo dice con claridad en lugar de fallar.
- La tienda semilla nunca se modifica desde la demo pública. El panel real de cada tienda va protegido (Access o contraseña).

## 8. Fases

1. **Fundación**: proyecto Workers + Hono + TypeScript, D1 con esquema, pruebas, despliegue a `*.workers.dev`, repositorio git.
2. **Núcleo + simulador**: núcleo del bot con proveedor IA (Gemini), historial, simulador web funcional con la tienda de demo (sin búsqueda semántica aún: todo el conocimiento de la tienda cabe en el prompt).
3. **Conocimiento ("aprender")**: Vectorize + embeddings, búsqueda de fragmentos relevantes, preguntas sin respuesta, panel de la tienda para editar conocimiento, importar CSV y resolver preguntas.
4. **WhatsApp real**: app en Meta for Developers, webhook con verificación y firma, deduplicación, procesamiento en segundo plano, número de prueba.
5. **Robustez**: derivar a humano (con respuesta mínima desde el panel), límites y Turnstile en el simulador, respaldo de proveedor IA, manejo de errores, registro de uso.
6. **Portfolio**: demo aislada por visitante (7.7), sección en el portfolio con el simulador embebido, explicación de la arquitectura, video corto del WhatsApp real, README del repositorio.
7. **Plantilla freelance** (opcional): script/guía para dar de alta una tienda nueva (datos, número de WhatsApp, panel) en minutos.

## 9. Lo que queda a criterio del constructor

- Rubro y contenido concreto de la tienda de demo.
- ORM o SQL directo para D1; estructura exacta de carpetas.
- Diseño visual del simulador (debe evocar WhatsApp sin copiar su marca/logo) y del panel.
- Parámetros de la búsqueda (N fragmentos, tamaño), cuánto historial incluir, valores de los límites de uso.
- Modelo exacto de Gemini y de Workers AI disponibles en plan gratuito al momento de construir.
- Elección entre Cloudflare Access o contraseña simple para el panel.
