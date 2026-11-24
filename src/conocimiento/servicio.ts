// Única puerta para escribir conocimiento: guarda en D1 y mantiene el índice de búsqueda al día.
import {
  actualizarConocimiento,
  borrarConocimiento,
  crearConocimiento,
  crearConocimientoEnLote,
  type DatosEntrada,
  type EntradaConocimiento,
  listarConocimiento,
} from "../datos/conocimiento";
import { marcarResuelta, obtenerPregunta } from "../datos/preguntas";
import type { Buscador } from "./buscador";

export type Deps = { db: D1Database; buscador: Buscador };

export async function agregarEntrada(deps: Deps, tiendaId: string, d: DatosEntrada): Promise<EntradaConocimiento> {
  const e = await crearConocimiento(deps.db, { ...d, tiendaId });
  await deps.buscador.indexar([e]);
  return e;
}

export async function editarEntrada(
  deps: Deps,
  tiendaId: string,
  id: string,
  d: DatosEntrada,
): Promise<EntradaConocimiento | null> {
  const e = await actualizarConocimiento(deps.db, tiendaId, id, d);
  if (e) await deps.buscador.indexar([e]);
  return e;
}

export async function quitarEntrada(deps: Deps, tiendaId: string, id: string): Promise<boolean> {
  const borrada = await borrarConocimiento(deps.db, tiendaId, id);
  if (borrada) await deps.buscador.borrar([id]);
  return borrada;
}

export async function agregarEnLote(deps: Deps, tiendaId: string, lista: DatosEntrada[]): Promise<EntradaConocimiento[]> {
  const creadas = await crearConocimientoEnLote(deps.db, tiendaId, lista);
  await deps.buscador.indexar(creadas);
  return creadas;
}

/** La tienda "enseña": la pregunta pasa a ser una FAQ y el bot ya la sabe. */
export async function resolverPregunta(
  deps: Deps,
  tiendaId: string,
  preguntaId: string,
  respuesta: string,
): Promise<EntradaConocimiento | null> {
  const contenido = respuesta.trim();
  const pregunta = await obtenerPregunta(deps.db, tiendaId, preguntaId);
  if (!contenido || !pregunta || pregunta.estado !== "pendiente") return null;
  const e = await agregarEntrada(deps, tiendaId, { tipo: "faq", titulo: pregunta.pregunta, contenido, datosProducto: null });
  await marcarResuelta(deps.db, tiendaId, preguntaId);
  return e;
}

export async function reindexarTienda(deps: Deps, tiendaId: string): Promise<number> {
  const todas = await listarConocimiento(deps.db, tiendaId);
  await deps.buscador.indexar(todas);
  return todas.length;
}
