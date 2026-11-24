import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const pedir = (ruta: string) => exports.default.fetch(`https://x${ruta}`);

describe("app", () => {
  it("GET /salud responde ok", async () => {
    const r = await pedir("/salud");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, servicio: "bot-tiendas" });
  });

  it("ruta inexistente → 404 JSON", async () => {
    const r = await pedir("/no-existe");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "No encontrado" });
  });

  it("error no controlado → 500 JSON sin traza", async () => {
    const r = await pedir("/_prueba/error");
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Error interno" });
  });
});
