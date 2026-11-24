import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { RESPUESTA_SIN_IA } from "../../src/nucleo/atender";
import { cargarSemilla } from "../ayudantes";

const fetchReal = globalThis.fetch;
let estadoGemini = 200;
let espia: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

const llamadasGemini = () => espia.mock.calls.filter(([u]: Parameters<typeof fetch>) => String(u instanceof Request ? u.url : u).includes("generativelanguage")).length;

function pedir(ruta: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return exports.default.fetch(`https://x/api/simulador${ruta}`, { ...init, headers });
}
const enviar = (cuerpo: unknown, cookie?: string) =>
  pedir("/mensaje", { method: "POST", headers: { "content-type": "application/json" }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }, cookie);
const cookieDe = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

beforeAll(cargarSemilla);
beforeEach(() => {
  estadoGemini = 200;
  espia = vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
    const url = String(u instanceof Request ? u.url : u);
    if (!url.includes("generativelanguage")) return fetchReal(u, init);
    if (estadoGemini !== 200) return new Response("error", { status: estadoGemini });
    return Response.json({ candidates: [{ content: { parts: [{ text: "Respuesta de prueba" }] } }] });
  });
});
afterEach(() => espia.mockRestore());

describe("canal simulador", () => {
  it("POST /mensaje sin cookie → 200, crea cookie y responde", async () => {
    const r = await enviar({ texto: "¿Qué horario tienen?" });
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie") ?? "";
    expect(sc).toContain("sim_cliente=");
    expect(sc).toContain("SameSite=None");
    expect(sc).toContain("HttpOnly");
    expect(await r.json()).toEqual({ respuesta: "Respuesta de prueba", huboErrorIA: false });
  });

  it("GET /inicio con la cookie devuelve bienvenida e historial", async () => {
    const r1 = await enviar({ texto: "hola" });
    const cookie = cookieDe(r1);
    const r = await pedir("/inicio", {}, cookie);
    expect(r.status).toBe(200);
    const cuerpo = await r.json<{ tienda: { nombre: string; bienvenida: string }; mensajes: { rol: string; texto: string }[] }>();
    expect(cuerpo.tienda.nombre).toBe("Tostadero Aurora");
    expect(cuerpo.tienda.bienvenida).toContain("Tostadero Aurora");
    expect(cuerpo.mensajes).toEqual([
      { rol: "cliente", texto: "hola" },
      { rol: "bot", texto: "Respuesta de prueba" },
    ]);
  });

  it("cookie manipulada → cliente nuevo", async () => {
    const r = await pedir("/inicio", {}, "sim_cliente=../../otro");
    expect(r.headers.get("set-cookie") ?? "").toMatch(/sim_cliente=[0-9a-f-]{36}/);
    expect((await r.json<{ mensajes: unknown[] }>()).mensajes).toEqual([]);
  });

  it("texto inválido → 400 sin llamar a Gemini", async () => {
    for (const cuerpo of [{ texto: "" }, { texto: "   " }, { texto: "x".repeat(1001) }, { texto: 5 }, "no es json"]) {
      const r = await enviar(cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect(await r.json()).toEqual({ error: "Mensaje inválido" });
    }
    expect(llamadasGemini()).toBe(0);
  });

  it("Gemini 429 → 200 con huboErrorIA", async () => {
    estadoGemini = 429;
    const r = await enviar({ texto: "hola" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ respuesta: RESPUESTA_SIN_IA, huboErrorIA: true });
  });

  it("sin tienda demo → 503", async () => {
    const envSinDemo = { ...env, DEMO_TIENDA_ID: "nope" };
    for (const [ruta, init] of [
      ["/api/simulador/inicio", {}],
      ["/api/simulador/mensaje", { method: "POST", headers: { "content-type": "application/json" }, body: '{"texto":"hola"}' }],
    ] as const) {
      const r = await app.request(`https://x${ruta}`, init, envSinDemo);
      expect(r.status, ruta).toBe(503);
      expect(await r.json()).toEqual({ error: "Tienda de demo no disponible" });
    }
  });
});
