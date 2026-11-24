import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { listarPreguntasPendientes, marcarResuelta, obtenerPregunta, registrarPregunta } from "../../src/datos/preguntas";
import { crearTienda } from "../../src/datos/tiendas";

describe("datos/preguntas", () => {
  it("registrar y listar pendientes por tienda", async () => {
    const a = await crearTienda(env.DB, { nombre: "A" });
    const b = await crearTienda(env.DB, { nombre: "B" });
    await registrarPregunta(env.DB, a.id, null, "primera");
    await registrarPregunta(env.DB, a.id, null, "segunda");
    await registrarPregunta(env.DB, b.id, null, "de B");
    const lista = await listarPreguntasPendientes(env.DB, a.id);
    expect(lista.map((p) => p.pregunta)).toEqual(["segunda", "primera"]);
    expect(lista.every((p) => p.estado === "pendiente" && p.tiendaId === a.id)).toBe(true);
  });

  it("marcarResuelta la saca de pendientes", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const p = await registrarPregunta(env.DB, t.id, null, "x");
    await marcarResuelta(env.DB, t.id, p.id);
    expect(await listarPreguntasPendientes(env.DB, t.id)).toEqual([]);
    expect((await obtenerPregunta(env.DB, t.id, p.id))?.estado).toBe("resuelta");
  });

  it("obtenerPregunta de otra tienda → null", async () => {
    const a = await crearTienda(env.DB, { nombre: "A" });
    const b = await crearTienda(env.DB, { nombre: "B" });
    const p = await registrarPregunta(env.DB, a.id, null, "x");
    expect(await obtenerPregunta(env.DB, b.id, p.id)).toBeNull();
  });
});
