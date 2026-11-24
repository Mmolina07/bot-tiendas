import { contarConocimiento, type EntradaConocimiento, listarConocimiento, obtenerConocimientoPorIds } from "../datos/conocimiento";
import { formatearMiles } from "../nucleo/prompt";
import type { Env } from "../tipos";

export const MODELO_EMBEDDINGS = "@cf/baai/bge-m3";
export const RESULTADOS_BUSQUEDA = 8;
/** Con pocas entradas cabe todo en el prompt y se responde mejor que con solo las más parecidas. */
export const UMBRAL_TODO_EL_CONOCIMIENTO = 40;
const TAMANO_LOTE = 100;

/** Encuentra el conocimiento relevante para una pregunta y mantiene el índice al día. */
export interface Buscador {
  buscar(tiendaId: string, texto: string): Promise<EntradaConocimiento[]>;
  indexar(entradas: EntradaConocimiento[]): Promise<void>;
  borrar(ids: string[]): Promise<void>;
}

export function textoParaIndexar(e: EntradaConocimiento): string {
  const base = `${e.titulo}. ${e.contenido}`;
  if (e.tipo !== "producto" || !e.datosProducto) return base;
  const { categoria, precio, moneda } = e.datosProducto;
  return `${base} Categoría: ${categoria}. Precio: ${formatearMiles(precio)} ${moneda}.`;
}

/** Sin búsqueda: todo el conocimiento de la tienda (válido para tiendas pequeñas y como respaldo). */
export function crearBuscadorTodo(db: D1Database): Buscador {
  return {
    buscar: (tiendaId) => listarConocimiento(db, tiendaId),
    indexar: async () => {},
    borrar: async () => {},
  };
}

const enLotes = <T>(lista: T[]) =>
  Array.from({ length: Math.ceil(lista.length / TAMANO_LOTE) }, (_, i) => lista.slice(i * TAMANO_LOTE, (i + 1) * TAMANO_LOTE));

export function crearBuscadorVectorize(op: { db: D1Database; ai: Ai; indice: VectorizeIndex }): Buscador {
  const { db, ai, indice } = op;
  const embeber = async (textos: string[]): Promise<number[][]> => {
    const r = (await ai.run(MODELO_EMBEDDINGS as Parameters<Ai["run"]>[0], { text: textos } as never)) as { data: number[][] };
    return r.data;
  };
  const respaldo = crearBuscadorTodo(db);

  return {
    async buscar(tiendaId, texto) {
      try {
        if ((await contarConocimiento(db, tiendaId)) <= UMBRAL_TODO_EL_CONOCIMIENTO) return respaldo.buscar(tiendaId, texto);
        const [vector] = await embeber([texto]);
        const { matches } = await indice.query(vector, { topK: RESULTADOS_BUSQUEDA, filter: { tiendaId } });
        const encontradas = await obtenerConocimientoPorIds(db, tiendaId, matches.map((m) => m.id));
        if (encontradas.length > 0) return encontradas;
        console.warn("Búsqueda sin resultados; se usa todo el conocimiento", { tiendaId });
      } catch (e) {
        console.warn("Fallo la búsqueda semántica; se usa todo el conocimiento", e);
      }
      return respaldo.buscar(tiendaId, texto);
    },

    async indexar(entradas) {
      for (const lote of enLotes(entradas)) {
        const vectores = await embeber(lote.map(textoParaIndexar));
        await indice.upsert(lote.map((e, i) => ({ id: e.id, values: vectores[i], metadata: { tiendaId: e.tiendaId } })));
      }
    },

    async borrar(ids) {
      for (const lote of enLotes(ids)) await indice.deleteByIds(lote);
    },
  };
}

/** Vectorize si el Worker tiene los bindings; si no (pruebas, cuenta sin índice), todo el conocimiento. */
export function crearBuscador(env: Env): Buscador {
  if (!env.AI || !env.VECTORIZE) return crearBuscadorTodo(env.DB);
  return crearBuscadorVectorize({ db: env.DB, ai: env.AI, indice: env.VECTORIZE });
}
