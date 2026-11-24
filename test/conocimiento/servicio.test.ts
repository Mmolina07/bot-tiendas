import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Buscador } from "../../src/conocimiento/buscador";
import {
  agregarEntrada,
  editarEntrada,
  quitarEntrada,
  reindexarTienda,
  resolverPregunta,
} from "../../src/conocimiento/servicio";
import { listarConocimiento } from "../../src/datos/conocimiento";
import { listarPreguntasPendientes, registrarPregunta } from "../../src/datos/preguntas";
import { crearTienda } from "../../src/datos/tiendas";

function buscadorFalso() {
  const indexadas: string[][] = [];
  const borradas: string[][] = [];
  const buscador: Buscador = {
    buscar: async () => [],
    indexar: async (es) => void indexadas.push(es.map((e) => e.titulo)),
    borrar: async (ids) => void borradas.push(ids),
  };
  return { deps: { db: env.DB, buscador }, indexadas, borradas };
}
const faq = (titulo: string, contenido = "c") => ({ tipo: "faq" as const, titulo, contenido, datosProducto: null });

describe("conocimiento/servicio", () => {
  it("agregarEntrada guarda e indexa", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { deps, indexadas } = buscadorFalso();
    await agregarEntrada(deps, t.id, faq("Nueva"));
    expect((await listarConocimiento(env.DB, t.id)).map((e) => e.titulo)).toEqual(["Nueva"]);
    expect(indexadas).toEqual([["Nueva"]]);
  });

  it("editarEntrada reindexa", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { deps, indexadas } = buscadorFalso();
    const e = await agregarEntrada(deps, t.id, faq("Vieja"));
    await editarEntrada(deps, t.id, e.id, faq("Editada"));
    expect(indexadas.at(-1)).toEqual(["Editada"]);
  });

  it("quitarEntrada borra del índice", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { deps, borradas } = buscadorFalso();
    const e = await agregarEntrada(deps, t.id, faq("X"));
    expect(await quitarEntrada(deps, t.id, e.id)).toBe(true);
    expect(borradas).toEqual([[e.id]]);
    expect(await listarConocimiento(env.DB, t.id)).toEqual([]);
  });

  it("resolverPregunta crea la FAQ, la indexa y marca resuelta", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { deps, indexadas } = buscadorFalso();
    const p = await registrarPregunta(env.DB, t.id, null, "¿Envían a España?");
    const e = await resolverPregunta(deps, t.id, p.id, "  Solo enviamos dentro de Colombia.  ");
    expect(e).toMatchObject({ tipo: "faq", titulo: "¿Envían a España?", contenido: "Solo enviamos dentro de Colombia." });
    expect(await listarPreguntasPendientes(env.DB, t.id)).toEqual([]);
    expect(indexadas).toEqual([["¿Envían a España?"]]);
  });

  it("resolverPregunta con respuesta vacía o de otra tienda → null sin cambios", async () => {
    const a = await crearTienda(env.DB, { nombre: "A" });
    const b = await crearTienda(env.DB, { nombre: "B" });
    const { deps } = buscadorFalso();
    const p = await registrarPregunta(env.DB, a.id, null, "¿x?");
    expect(await resolverPregunta(deps, a.id, p.id, "   ")).toBeNull();
    expect(await resolverPregunta(deps, b.id, p.id, "respuesta")).toBeNull();
    expect(await listarPreguntasPendientes(env.DB, a.id)).toHaveLength(1);
    expect(await listarConocimiento(env.DB, b.id)).toEqual([]);
  });

  it("reindexarTienda indexa todo el conocimiento de la tienda", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { deps, indexadas } = buscadorFalso();
    await agregarEntrada(deps, t.id, faq("A"));
    await agregarEntrada(deps, t.id, faq("B"));
    indexadas.length = 0;
    expect(await reindexarTienda(deps, t.id)).toBe(2);
    expect(indexadas).toEqual([["A", "B"]]);
  });
});
