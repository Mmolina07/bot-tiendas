// Indexación en segundo plano con Cloudflare Queues: generar embeddings consume mucha CPU y el plan
// gratuito limita ~10 ms por petición. Cada mensaje lleva pocos ids y se procesa en su propia invocación.
import { obtenerConocimientoPorIds } from "../datos/conocimiento";
import type { Buscador } from "./buscador";

export type MensajeIndexar = { tiendaId: string; ids: string[] };
export const IDS_POR_MENSAJE = 25; // ~8 ms de CPU por mensaje (medido: 38 entradas ≈ 12 ms)
const MENSAJES_POR_ENVIO = 100; // límite de sendBatch

/** Igual que el buscador real, pero `indexar` encola el trabajo en lugar de hacerlo en la petición. */
export function crearBuscadorEncolado(base: Buscador, cola: Queue<MensajeIndexar>): Buscador {
  return {
    buscar: (tiendaId, texto) => base.buscar(tiendaId, texto),
    borrar: (ids) => base.borrar(ids),
    async indexar(entradas) {
      const porTienda = new Map<string, string[]>();
      for (const e of entradas) porTienda.set(e.tiendaId, [...(porTienda.get(e.tiendaId) ?? []), e.id]);
      const mensajes: { body: MensajeIndexar }[] = [];
      for (const [tiendaId, ids] of porTienda)
        for (let i = 0; i < ids.length; i += IDS_POR_MENSAJE) mensajes.push({ body: { tiendaId, ids: ids.slice(i, i + IDS_POR_MENSAJE) } });
      for (let i = 0; i < mensajes.length; i += MENSAJES_POR_ENVIO) await cola.sendBatch(mensajes.slice(i, i + MENSAJES_POR_ENVIO));
    },
  };
}

/** Consumidor de la cola: carga las entradas (solo de esa tienda) y las indexa; si falla, reintenta. */
export async function procesarLote(batch: MessageBatch<MensajeIndexar>, deps: { db: D1Database; buscador: Buscador }) {
  for (const m of batch.messages) {
    try {
      const entradas = await obtenerConocimientoPorIds(deps.db, m.body.tiendaId, m.body.ids);
      await deps.buscador.indexar(entradas);
      m.ack();
    } catch (e) {
      console.error("Fallo al indexar desde la cola; se reintentará", e);
      m.retry();
    }
  }
}
