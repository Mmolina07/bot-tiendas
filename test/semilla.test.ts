import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { obtenerTienda } from "../src/datos/tiendas";
import { TIENDA_DEMO_ID } from "../src/demo";
import { cargarSemilla } from "./ayudantes";

describe("semilla tienda demo", () => {
  it("la semilla carga y es re-ejecutable", async () => {
    await cargarSemilla();
    await cargarSemilla();
    const cuenta = async (where: string) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM conocimiento WHERE tienda_id = ? AND ${where}`)
        .bind(TIENDA_DEMO_ID)
        .first<{ n: number }>())!.n;
    expect(await cuenta("tipo = 'producto'")).toBeGreaterThanOrEqual(20);
    expect(await cuenta("tipo IN ('faq','politica')")).toBeGreaterThanOrEqual(15);
    expect((await obtenerTienda(env.DB, TIENDA_DEMO_ID))?.nombre).toBe("Tostadero Aurora");
  });

  it("no incluye a propósito envíos internacionales, tarjetas de regalo ni talleres", async () => {
    await cargarSemilla();
    const { results } = await env.DB.prepare("SELECT titulo || ' ' || contenido AS t FROM conocimiento WHERE tienda_id = ?")
      .bind(TIENDA_DEMO_ID)
      .all<{ t: string }>();
    const todo = results.map((r) => r.t.toLowerCase()).join(" ");
    for (const tema of ["internacional", "tarjeta de regalo", "taller"]) expect(todo).not.toContain(tema);
  });
});
