import { type Context, Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { csrf } from "hono/csrf";
import { crearBuscador } from "../conocimiento/buscador";
import { csvAEntradas, decodificarCsv, leerPrecio } from "../conocimiento/csv";
import { agregarEnLote, agregarEntrada, editarEntrada, quitarEntrada, reindexarTienda, resolverPregunta } from "../conocimiento/servicio";
import {
  contarConocimiento,
  type DatosEntrada,
  listarConocimientoPagina,
  obtenerConocimiento,
  type TipoConocimiento,
} from "../datos/conocimiento";
import { contarPreguntasPendientes, descartarPregunta, listarPreguntasPendientes } from "../datos/preguntas";
import { obtenerTienda, type Tienda } from "../datos/tiendas";
import type { Env } from "../tipos";
import { PaginaEditar, PaginaNoEncontrada, PaginaPanel } from "./vistas";

type Ambiente = { Bindings: Env; Variables: { tienda: Tienda } };
type Ctx = Context<Ambiente>;

const TIPOS: TipoConocimiento[] = ["faq", "producto", "politica"];
const MAX_ERRORES_EN_AVISO = 5;
// La página se renderiza dentro del límite de CPU del plan gratuito solo si no es enorme.
const ENTRADAS_POR_PAGINA = 50;
const SIN_INDICE = " ⚠️ Se guardó, pero no se pudo actualizar la búsqueda: pulsa «Reindexar todo».";

export const panel = new Hono<Ambiente>();

// Credenciales por petición desde los secretos del Worker.
panel.use("*", async (c, next) => {
  const { PANEL_USUARIO: username, PANEL_CLAVE: password } = c.env;
  if (!username || !password) return c.text("Panel no configurado", 503);
  return basicAuth({ username, password, realm: "Panel de la tienda" })(c, next);
});
// Rechaza formularios enviados desde otros sitios (las credenciales Basic viajan solas).
panel.use("*", csrf());

// "/:tiendaId/*" también cubre "/:tiendaId".
panel.use("/:tiendaId/*", async (c, next) => {
  const tienda = await obtenerTienda(c.env.DB, c.req.param("tiendaId"));
  if (!tienda) return c.html(<PaginaNoEncontrada />, 404);
  c.set("tienda", tienda);
  await next();
});

const deps = (c: Ctx) => ({ db: c.env.DB, buscador: crearBuscador(c.env) });
const volver = (c: Ctx, aviso: string) =>
  c.redirect(`/panel/${encodeURIComponent(c.var.tienda.id)}?aviso=${encodeURIComponent(aviso)}`, 303);

async function paginaPanel(c: Ctx, extra: { aviso?: string; error?: string }, estado: 200 | 400 = 200) {
  const tienda = c.var.tienda;
  const pedida = Number.parseInt(c.req.query("pagina") ?? "1", 10);
  const pagina = Number.isFinite(pedida) && pedida > 0 ? pedida : 1;
  const [preguntas, totalPreguntas, conocimiento, totalConocimiento] = await Promise.all([
    listarPreguntasPendientes(c.env.DB, tienda.id),
    contarPreguntasPendientes(c.env.DB, tienda.id),
    listarConocimientoPagina(c.env.DB, tienda.id, ENTRADAS_POR_PAGINA, (pagina - 1) * ENTRADAS_POR_PAGINA),
    contarConocimiento(c.env.DB, tienda.id),
  ]);
  return c.html(
    <PaginaPanel
      tienda={tienda}
      preguntas={preguntas}
      totalPreguntas={totalPreguntas}
      conocimiento={conocimiento}
      totalConocimiento={totalConocimiento}
      pagina={pagina}
      paginas={Math.max(1, Math.ceil(totalConocimiento / ENTRADAS_POR_PAGINA))}
      {...extra}
    />,
    estado,
  );
}

/** Valida el formulario de una entrada. Devuelve los datos o el mensaje de error. */
function leerFormularioEntrada(f: Record<string, unknown>): DatosEntrada | string {
  const texto = (k: string) => (typeof f[k] === "string" ? (f[k] as string).trim() : "");
  const tipo = texto("tipo") as TipoConocimiento;
  if (!TIPOS.includes(tipo)) return "Tipo inválido.";
  const titulo = texto("titulo");
  const contenido = texto("contenido");
  if (!titulo || titulo.length > 200) return "El título es obligatorio (máximo 200 caracteres).";
  if (!contenido || contenido.length > 4000) return "El contenido es obligatorio (máximo 4000 caracteres).";
  if (tipo !== "producto" || !texto("precio")) return { tipo, titulo, contenido, datosProducto: null };
  const precio = leerPrecio(texto("precio"));
  if (precio === null) return "Precio inválido.";
  return {
    tipo,
    titulo,
    contenido,
    datosProducto: { precio, moneda: texto("moneda").toUpperCase() || "COP", categoria: texto("categoria") || "General" },
  };
}

panel.get("/:tiendaId", (c) => paginaPanel(c, { aviso: c.req.query("aviso") }));

panel.post("/:tiendaId/conocimiento", async (c) => {
  const datos = leerFormularioEntrada(await c.req.parseBody());
  if (typeof datos === "string") return paginaPanel(c, { error: datos }, 400);
  const { indexada } = await agregarEntrada(deps(c), c.var.tienda.id, datos);
  return volver(c, `Agregado: ${datos.titulo}.${indexada ? "" : SIN_INDICE}`);
});

panel.get("/:tiendaId/conocimiento/:id/editar", async (c) => {
  const entrada = await obtenerConocimiento(c.env.DB, c.var.tienda.id, c.req.param("id"));
  if (!entrada) return c.html(<PaginaNoEncontrada />, 404);
  return c.html(<PaginaEditar tienda={c.var.tienda} entrada={entrada} />);
});

panel.post("/:tiendaId/conocimiento/:id", async (c) => {
  const tiendaId = c.var.tienda.id;
  const actual = await obtenerConocimiento(c.env.DB, tiendaId, c.req.param("id"));
  if (!actual) return c.html(<PaginaNoEncontrada />, 404);
  const datos = leerFormularioEntrada(await c.req.parseBody());
  if (typeof datos === "string") return c.html(<PaginaEditar tienda={c.var.tienda} entrada={actual} error={datos} />, 400);
  const r = await editarEntrada(deps(c), tiendaId, actual.id, datos);
  return volver(c, `Guardado: ${datos.titulo}.${r?.indexada === false ? SIN_INDICE : ""}`);
});

panel.post("/:tiendaId/conocimiento/:id/borrar", async (c) => {
  const borrada = await quitarEntrada(deps(c), c.var.tienda.id, c.req.param("id"));
  if (!borrada) return c.html(<PaginaNoEncontrada />, 404);
  return volver(c, "Entrada borrada.");
});

panel.post("/:tiendaId/preguntas/:id/resolver", async (c) => {
  const f = await c.req.parseBody();
  const respuesta = typeof f.respuesta === "string" ? f.respuesta : "";
  if (!respuesta.trim() || respuesta.length > 4000) return paginaPanel(c, { error: "Escribe una respuesta (máximo 4000 caracteres)." }, 400);
  const r = await resolverPregunta(deps(c), c.var.tienda.id, c.req.param("id"), respuesta);
  if (!r) return c.html(<PaginaNoEncontrada />, 404);
  return volver(c, `¡Aprendido! El bot ya responde: ${r.entrada.titulo}${r.indexada ? "" : `.${SIN_INDICE}`}`);
});

panel.post("/:tiendaId/preguntas/:id/descartar", async (c) => {
  const ok = await descartarPregunta(c.env.DB, c.var.tienda.id, c.req.param("id"));
  if (!ok) return c.html(<PaginaNoEncontrada />, 404);
  return volver(c, "Pregunta descartada.");
});

panel.post("/:tiendaId/importar", async (c) => {
  const f = await c.req.parseBody();
  const archivo = f.archivo;
  const texto =
    archivo instanceof File && archivo.size > 0
      ? decodificarCsv(new Uint8Array(await archivo.arrayBuffer()))
      : typeof f.csv === "string"
        ? f.csv
        : "";
  if (!texto.trim()) return paginaPanel(c, { error: "Sube un archivo CSV o pega su contenido." }, 400);
  const { entradas, errores } = csvAEntradas(texto);
  const { entradas: creadas, indexada } = await agregarEnLote(deps(c), c.var.tienda.id, entradas);
  let aviso = `Importadas ${creadas.length} entradas.`;
  if (errores.length) {
    const detalle = errores.slice(0, MAX_ERRORES_EN_AVISO).map((e) => `fila ${e.fila} (${e.motivo})`).join(", ");
    const mas = errores.length > MAX_ERRORES_EN_AVISO ? ` y ${errores.length - MAX_ERRORES_EN_AVISO} más` : "";
    aviso += ` ${errores.length} filas con errores: ${detalle}${mas}.`;
  }
  if (!indexada) aviso += SIN_INDICE;
  return volver(c, aviso);
});

panel.post("/:tiendaId/reindexar", async (c) => {
  const n = await reindexarTienda(deps(c), c.var.tienda.id);
  return volver(c, `Indexando ${n} entradas; el bot las usará en unos segundos.`);
});
