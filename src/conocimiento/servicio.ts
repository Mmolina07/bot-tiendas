// Única puerta para escribir conocimiento: guarda en D1 y mantiene el índice de búsqueda al día.
// Si el índice falla, lo guardado en D1 se conserva y se informa `indexada: false`
// (el panel sugiere "Reindexar todo") en vez de devolver un error que invite a reintentar y duplicar.
import {
  actualizarConocimiento,
  borrarConocimiento,
  crearConocimiento,
  crearConocimientoEnLote,
  type DatosEntrada,
  type EntradaConocimiento,
  listarConocimiento,
} from "../datos/conocimiento";
import { marcarResueltaSiPendiente, obtenerPregunta } from "../datos/preguntas";
import type { Buscador } from "./buscador";

export type Deps = { db: D1Database; buscador: Buscador };
const MAX_TITULO = 200;

async function indexarSeguro(buscador: Buscador, entradas: EntradaConocimiento[]): Promise<boolean> {
  try {
    await buscador.indexar(entradas);
    return true;
  } catch (e) {
    console.error("No se pudo indexar; el conocimiento quedó guardado sin índice", e);
    return false;
  }
}

export async function agregarEntrada(
  deps: Deps,
  tiendaId: string,
  d: DatosEntrada,
): Promise<{ entrada: EntradaConocimiento; indexada: boolean }> {
  const entrada = await crearConocimiento(deps.db, { ...d, tiendaId });
  return { entrada, indexada: await indexarSeguro(deps.buscador, [entrada]) };
}

export async function editarEntrada(
  deps: Deps,
  tiendaId: string,
  id: string,
  d: DatosEntrada,
): Promise<{ entrada: EntradaConocimiento; indexada: boolean } | null> {
  const entrada = await actualizarConocimiento(deps.db, tiendaId, id, d);
  if (!entrada) return null;
  return { entrada, indexada: await indexarSeguro(deps.buscador, [entrada]) };
}

export async function quitarEntrada(deps: Deps, tiendaId: string, id: string): Promise<boolean> {
  const borrada = await borrarConocimiento(deps.db, tiendaId, id);
  if (borrada) {
    // Un vector huérfano es inofensivo: la búsqueda solo devuelve ids que siguen en D1.
    await deps.buscador.borrar([id]).catch((e) => console.error("No se pudo borrar del índice", e));
  }
  return borrada;
}

export async function agregarEnLote(
  deps: Deps,
  tiendaId: string,
  lista: DatosEntrada[],
): Promise<{ entradas: EntradaConocimiento[]; indexada: boolean }> {
  const entradas = await crearConocimientoEnLote(deps.db, tiendaId, lista);
  return { entradas, indexada: entradas.length === 0 || (await indexarSeguro(deps.buscador, entradas)) };
}

/** La tienda "enseña": la pregunta pasa a ser una FAQ y el bot ya la sabe. */
export async function resolverPregunta(
  deps: Deps,
  tiendaId: string,
  preguntaId: string,
  respuesta: string,
): Promise<{ entrada: EntradaConocimiento; indexada: boolean } | null> {
  const contenido = respuesta.trim();
  if (!contenido) return null;
  const pregunta = await obtenerPregunta(deps.db, tiendaId, preguntaId);
  if (!pregunta) return null;
  // Se "reclama" primero: un doble envío o un reintento no crea dos FAQ.
  if (!(await marcarResueltaSiPendiente(deps.db, tiendaId, preguntaId))) return null;
  const titulo = pregunta.pregunta.length > MAX_TITULO ? `${pregunta.pregunta.slice(0, MAX_TITULO - 1)}…` : pregunta.pregunta;
  return agregarEntrada(deps, tiendaId, { tipo: "faq", titulo, contenido, datosProducto: null });
}

export async function reindexarTienda(deps: Deps, tiendaId: string): Promise<number> {
  const todas = await listarConocimiento(deps.db, tiendaId);
  await deps.buscador.indexar(todas);
  return todas.length;
}
