import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { crearBuscador, type Buscador } from "../../src/conocimiento/buscador";
import { crearBuscadorEncolado, IDS_POR_MENSAJE, type MensajeIndexar, procesarLote } from "../../src/conocimiento/cola";
import { crearConocimiento, type EntradaConocimiento } from "../../src/datos/conocimiento";
import { crearTienda } from "../../src/datos/tiendas";

function colaFalsa() {
  const enviados: MensajeIndexar[] = [];
  const cola = {
    send: async (body: MensajeIndexar) => void enviados.push(body),
    sendBatch: async (msgs: { body: MensajeIndexar }[]) => void enviados.push(...msgs.map((m) => m.body)),
  } as unknown as Queue<MensajeIndexar>;
  return { cola, enviados };
}
function buscadorFalso(opciones: { falla?: boolean } = {}) {
  const indexadas: EntradaConocimiento[][] = [];
  const borradas: string[][] = [];
  const buscador: Buscador = {
    buscar: async () => [],
    indexar: async (es) => {
      if (opciones.falla) throw new Error("AI caída");
      indexadas.push(es);
    },
    borrar: async (ids) => void borradas.push(ids),
  };
  return { buscador, indexadas, borradas };
}
const entrada = (i: number, tiendaId: string): EntradaConocimiento => ({
  id: `${tiendaId}-${i}`,
  tiendaId,
  tipo: "faq",
  titulo: `T${i}`,
  contenido: "c",
  datosProducto: null,
  actualizadoEn: 0,
});
function lote(bodies: MensajeIndexar[]) {
  const acks: number[] = [];
  const retries: number[] = [];
  const batch = {
    queue: "bot-tiendas-indexar",
    messages: bodies.map((body, i) => ({ id: `m${i}`, body, attempts: 1, timestamp: new Date(), ack: () => acks.push(i), retry: () => retries.push(i) })),
    ackAll: () => {},
    retryAll: () => {},
  } as unknown as MessageBatch<MensajeIndexar>;
  return { batch, acks, retries };
}

describe("conocimiento/cola", () => {
  it("indexar encola por tienda en mensajes de hasta IDS_POR_MENSAJE ids", async () => {
    const { cola, enviados } = colaFalsa();
    const base = buscadorFalso();
    const b = crearBuscadorEncolado(base.buscador, cola);
    await b.indexar([...Array.from({ length: 60 }, (_, i) => entrada(i, "A")), ...Array.from({ length: 3 }, (_, i) => entrada(i, "B"))]);
    expect(IDS_POR_MENSAJE).toBe(15);
    expect(enviados.map((m) => [m.tiendaId, m.ids.length])).toEqual([
      ["A", 15],
      ["A", 15],
      ["A", 15],
      ["A", 15],
      ["B", 3],
    ]);
    expect(base.indexadas).toEqual([]);
  });

  it("buscar y borrar se delegan al buscador real; indexar vacío no encola", async () => {
    const { cola, enviados } = colaFalsa();
    const base = buscadorFalso();
    const b = crearBuscadorEncolado(base.buscador, cola);
    await b.indexar([]);
    await b.borrar(["x"]);
    expect(enviados).toEqual([]);
    expect(base.borradas).toEqual([["x"]]);
  });

  it("procesarLote indexa las entradas de la tienda y confirma el mensaje", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const otra = await crearTienda(env.DB, { nombre: "O" });
    const a = await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "A", contenido: "a", datosProducto: null });
    const ajena = await crearConocimiento(env.DB, { tiendaId: otra.id, tipo: "faq", titulo: "X", contenido: "x", datosProducto: null });
    const base = buscadorFalso();
    const { batch, acks, retries } = lote([{ tiendaId: t.id, ids: [a.id, ajena.id, "borrada"] }]);
    await procesarLote(batch, { db: env.DB, buscador: base.buscador });
    expect(base.indexadas.map((es) => es.map((e) => e.titulo))).toEqual([["A"]]);
    expect(acks).toEqual([0]);
    expect(retries).toEqual([]);
  });

  it("si indexar falla, el mensaje se reintenta", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const a = await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "A", contenido: "a", datosProducto: null });
    const { batch, acks, retries } = lote([{ tiendaId: t.id, ids: [a.id] }]);
    await procesarLote(batch, { db: env.DB, buscador: buscadorFalso({ falla: true }).buscador });
    expect(acks).toEqual([]);
    expect(retries).toEqual([0]);
  });

  it("crearBuscador con cola encola en vez de indexar en la petición", async () => {
    const { cola, enviados } = colaFalsa();
    const ai = { run: async () => ({ data: [] }) } as unknown as Ai;
    const b = crearBuscador({ ...env, AI: ai, VECTORIZE: {} as VectorizeIndex, COLA_INDEXAR: cola });
    await b.indexar([entrada(1, "A")]);
    expect(enviados).toEqual([{ tiendaId: "A", ids: ["A-1"] }]);
  });
});
