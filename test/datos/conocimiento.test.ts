import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { crearConocimiento, listarConocimiento } from "../../src/datos/conocimiento";
import { crearTienda } from "../../src/datos/tiendas";

describe("datos/conocimiento", () => {
  it("crear y listar por tienda", async () => {
    const a = await crearTienda(env.DB, { nombre: "A" });
    const b = await crearTienda(env.DB, { nombre: "B" });
    await crearConocimiento(env.DB, { tiendaId: a.id, tipo: "producto", titulo: "Zeta", contenido: "z", datosProducto: null });
    await crearConocimiento(env.DB, { tiendaId: a.id, tipo: "faq", titulo: "Horario", contenido: "8-19", datosProducto: null });
    await crearConocimiento(env.DB, { tiendaId: b.id, tipo: "faq", titulo: "Otra", contenido: "x", datosProducto: null });
    const lista = await listarConocimiento(env.DB, a.id);
    expect(lista.map((e) => [e.tipo, e.titulo])).toEqual([
      ["faq", "Horario"],
      ["producto", "Zeta"],
    ]);
    expect(lista.every((e) => e.tiendaId === a.id)).toBe(true);
  });

  it("datosProducto ida y vuelta", async () => {
    const t = await crearTienda(env.DB, { nombre: "P" });
    const datos = { precio: 12000, moneda: "COP", categoria: "Café en grano" };
    await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "producto", titulo: "Café", contenido: "c", datosProducto: datos });
    const [e] = await listarConocimiento(env.DB, t.id);
    expect(e.datosProducto).toEqual(datos);
  });

  it("datos_producto corrupto → null", async () => {
    const t = await crearTienda(env.DB, { nombre: "C" });
    await env.DB.prepare(
      "INSERT INTO conocimiento (id, tienda_id, tipo, titulo, contenido, datos_producto, actualizado_en) VALUES (?, ?, 'producto', 'x', 'y', '{x', 0)",
    )
      .bind(crypto.randomUUID(), t.id)
      .run();
    const [e] = await listarConocimiento(env.DB, t.id);
    expect(e.datosProducto).toBeNull();
  });
});
