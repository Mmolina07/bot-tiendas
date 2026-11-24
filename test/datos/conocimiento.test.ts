import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  actualizarConocimiento,
  borrarConocimiento,
  crearConocimiento,
  crearConocimientoEnLote,
  listarConocimiento,
  obtenerConocimiento,
} from "../../src/datos/conocimiento";
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

  it("actualizar y borrar respetan la tienda", async () => {
    const a = await crearTienda(env.DB, { nombre: "A" });
    const b = await crearTienda(env.DB, { nombre: "B" });
    const e = await crearConocimiento(env.DB, { tiendaId: a.id, tipo: "faq", titulo: "Original", contenido: "o", datosProducto: null });
    const cambio = { tipo: "faq" as const, titulo: "Cambiado", contenido: "c", datosProducto: null };
    expect(await actualizarConocimiento(env.DB, b.id, e.id, cambio)).toBeNull();
    expect(await borrarConocimiento(env.DB, b.id, e.id)).toBe(false);
    expect((await obtenerConocimiento(env.DB, a.id, e.id))?.titulo).toBe("Original");
    expect((await actualizarConocimiento(env.DB, a.id, e.id, cambio))?.titulo).toBe("Cambiado");
    expect(await borrarConocimiento(env.DB, a.id, e.id)).toBe(true);
    expect(await obtenerConocimiento(env.DB, a.id, e.id)).toBeNull();
  });

  it("crearConocimientoEnLote inserta todas en un batch", async () => {
    const t = await crearTienda(env.DB, { nombre: "L" });
    const lista = Array.from({ length: 30 }, (_, i) => ({ tipo: "faq" as const, titulo: `F${i}`, contenido: "x", datosProducto: null }));
    const creadas = await crearConocimientoEnLote(env.DB, t.id, lista);
    expect(creadas).toHaveLength(30);
    expect(creadas.every((e) => e.tiendaId === t.id)).toBe(true);
    expect(await listarConocimiento(env.DB, t.id)).toHaveLength(30);
  });
});
