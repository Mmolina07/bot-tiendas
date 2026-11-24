import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { guardarMensaje, obtenerOCrearConversacion, ultimosMensajes } from "../../src/datos/conversaciones";
import { crearTienda } from "../../src/datos/tiendas";

const cliente = () => crypto.randomUUID();

describe("datos/conversaciones", () => {
  it("misma tienda+canal+cliente → misma conversación", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const c = cliente();
    const a = await obtenerOCrearConversacion(env.DB, t.id, "simulador", c);
    const b = await obtenerOCrearConversacion(env.DB, t.id, "simulador", c);
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ tiendaId: t.id, canal: "simulador", cliente: c, estado: "bot" });
  });

  it("distinto cliente → distinta conversación", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const a = await obtenerOCrearConversacion(env.DB, t.id, "simulador", cliente());
    const b = await obtenerOCrearConversacion(env.DB, t.id, "simulador", cliente());
    expect(b.id).not.toBe(a.id);
  });

  it("ultimosMensajes devuelve los N más recientes en orden cronológico", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const conv = await obtenerOCrearConversacion(env.DB, t.id, "simulador", cliente());
    for (let i = 1; i <= 12; i++) await guardarMensaje(env.DB, conv.id, i % 2 ? "cliente" : "bot", `m${i}`);
    const ultimos = await ultimosMensajes(env.DB, conv.id, 10);
    expect(ultimos.map((m) => m.texto)).toEqual(["m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"]);
  });

  it("guardarMensaje actualiza actualizada_en", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const conv = await obtenerOCrearConversacion(env.DB, t.id, "simulador", cliente());
    await env.DB.prepare("UPDATE conversaciones SET actualizada_en = 0 WHERE id = ?").bind(conv.id).run();
    await guardarMensaje(env.DB, conv.id, "cliente", "hola");
    const fila = await env.DB.prepare("SELECT actualizada_en AS a FROM conversaciones WHERE id = ?").bind(conv.id).first<{ a: number }>();
    expect(fila!.a).toBeGreaterThan(0);
  });
});
