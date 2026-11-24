import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  crearBuscador,
  crearBuscadorTodo,
  crearBuscadorVectorize,
  MODELO_EMBEDDINGS,
  RESULTADOS_BUSQUEDA,
  textoParaIndexar,
} from "../../src/conocimiento/buscador";
import { crearConocimiento, type EntradaConocimiento } from "../../src/datos/conocimiento";
import { crearTienda } from "../../src/datos/tiendas";

const vector = () => Array.from({ length: 1024 }, () => 0.1);

function aiFalsa(opciones: { falla?: boolean } = {}) {
  const llamadas: { modelo: string; textos: string[] }[] = [];
  const ai = {
    run: async (modelo: string, entrada: { text: string[] }) => {
      if (opciones.falla) throw new Error("AI caída");
      llamadas.push({ modelo, textos: entrada.text });
      return { data: entrada.text.map(vector) };
    },
  } as unknown as Ai;
  return { ai, llamadas };
}

function indiceFalso(idsQuery: string[] = []) {
  const upserts: VectorizeVector[][] = [];
  const borrados: string[][] = [];
  const consultas: { topK?: number; filter?: unknown }[] = [];
  const indice = {
    upsert: async (v: VectorizeVector[]) => {
      upserts.push(v);
      return { mutationId: "m" };
    },
    deleteByIds: async (ids: string[]) => {
      borrados.push(ids);
      return { mutationId: "m" };
    },
    query: async (_v: number[], op: { topK?: number; filter?: unknown }) => {
      consultas.push(op);
      return { count: idsQuery.length, matches: idsQuery.map((id, i) => ({ id, score: 1 - i / 10 })) };
    },
  } as unknown as VectorizeIndex;
  return { indice, upserts, borrados, consultas };
}

const entrada = (i: number, tiendaId = "t"): EntradaConocimiento => ({
  id: `e${i}`,
  tiendaId,
  tipo: "faq",
  titulo: `T${i}`,
  contenido: `C${i}`,
  datosProducto: null,
  actualizadoEn: 0,
});

async function tiendaConDos() {
  const t = await crearTienda(env.DB, { nombre: "T" });
  const a = await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "A", contenido: "a", datosProducto: null });
  const b = await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "B", contenido: "b", datosProducto: null });
  return { t, a, b };
}

describe("conocimiento/buscador", () => {
  it("textoParaIndexar incluye categoría y precio en productos", () => {
    const p = { ...entrada(1), tipo: "producto" as const, titulo: "Café", contenido: "Rico", datosProducto: { precio: 12000, moneda: "COP", categoria: "Grano" } };
    expect(textoParaIndexar(p)).toBe("Café. Rico Categoría: Grano. Precio: 12.000 COP.");
    expect(textoParaIndexar(entrada(2))).toBe("T2. C2");
  });

  it("indexar hace un solo AI.run y un solo upsert por lote de 100", async () => {
    const { ai, llamadas } = aiFalsa();
    const { indice, upserts } = indiceFalso();
    await crearBuscadorVectorize({ db: env.DB, ai, indice }).indexar(Array.from({ length: 150 }, (_, i) => entrada(i)));
    expect(llamadas.map((l) => l.textos.length)).toEqual([100, 50]);
    expect(llamadas.every((l) => l.modelo === MODELO_EMBEDDINGS)).toBe(true);
    expect(upserts.map((u) => u.length)).toEqual([100, 50]);
    expect(upserts[0][0]).toMatchObject({ id: "e0", metadata: { tiendaId: "t" } });
    expect(upserts[0][0].values).toHaveLength(1024);
  });

  it("buscar filtra por tienda y respeta el orden de relevancia", async () => {
    const { t, a, b } = await tiendaConDos();
    const { ai } = aiFalsa();
    const { indice, consultas } = indiceFalso([b.id, a.id, "borrado"]);
    const r = await crearBuscadorVectorize({ db: env.DB, ai, indice }).buscar(t.id, "hola");
    expect(consultas[0]).toMatchObject({ topK: RESULTADOS_BUSQUEDA, filter: { tiendaId: t.id } });
    expect(RESULTADOS_BUSQUEDA).toBe(8);
    expect(r.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("buscar ignora ids de otra tienda", async () => {
    const { t, a } = await tiendaConDos();
    const otra = await crearTienda(env.DB, { nombre: "O" });
    const ajena = await crearConocimiento(env.DB, { tiendaId: otra.id, tipo: "faq", titulo: "X", contenido: "x", datosProducto: null });
    const { ai } = aiFalsa();
    const { indice } = indiceFalso([ajena.id, a.id]);
    const r = await crearBuscadorVectorize({ db: env.DB, ai, indice }).buscar(t.id, "hola");
    expect(r.map((e) => e.id)).toEqual([a.id]);
  });

  it("si AI falla → respaldo con todo el conocimiento", async () => {
    const { t } = await tiendaConDos();
    const { ai } = aiFalsa({ falla: true });
    const { indice } = indiceFalso();
    const r = await crearBuscadorVectorize({ db: env.DB, ai, indice }).buscar(t.id, "hola");
    expect(r.map((e) => e.titulo)).toEqual(["A", "B"]);
  });

  it("sin resultados → respaldo con todo el conocimiento", async () => {
    const { t } = await tiendaConDos();
    const { ai } = aiFalsa();
    const { indice } = indiceFalso([]);
    const r = await crearBuscadorVectorize({ db: env.DB, ai, indice }).buscar(t.id, "hola");
    expect(r).toHaveLength(2);
  });

  it("borrar llama deleteByIds y con lista vacía no llama a nada", async () => {
    const { ai } = aiFalsa();
    const { indice, borrados } = indiceFalso();
    const b = crearBuscadorVectorize({ db: env.DB, ai, indice });
    await b.borrar([]);
    await b.borrar(["x", "y"]);
    expect(borrados).toEqual([["x", "y"]]);
  });

  it("crearBuscador sin bindings → buscador Todo", async () => {
    const { t } = await tiendaConDos();
    const b = crearBuscador({ ...env, AI: undefined, VECTORIZE: undefined });
    await b.indexar([entrada(1)]);
    expect((await b.buscar(t.id, "x")).map((e) => e.titulo)).toEqual(["A", "B"]);
    expect((await crearBuscadorTodo(env.DB).buscar(t.id, "x")).length).toBe(2);
  });
});
