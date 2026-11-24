import { describe, expect, it } from "vitest";
import { crearProveedorGemini } from "../../src/ia/gemini";
import { ErrorIA } from "../../src/ia/proveedor";

function fetchFalso(respuesta: () => Response | Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  }) as typeof fetch;
  return { f, llamadas };
}

const okCon = (cuerpo: unknown) => () => new Response(JSON.stringify(cuerpo), { status: 200 });
const entrada = {
  sistema: "Eres un bot",
  mensajes: [
    { rol: "cliente" as const, texto: "hola" },
    { rol: "bot" as const, texto: "¡Hola!" },
    { rol: "cliente" as const, texto: "¿horario?" },
  ],
};

describe("ia/gemini", () => {
  it("envía la petición en formato Gemini", async () => {
    const { f, llamadas } = fetchFalso(okCon({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    await crearProveedorGemini({ apiKey: "K", modelo: "m-1", fetch: f }).generar(entrada);
    expect(llamadas).toHaveLength(1);
    const { url, init } = llamadas[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("K");
    const cuerpo = JSON.parse(String(init.body));
    expect(cuerpo.systemInstruction.parts[0].text).toBe("Eres un bot");
    expect(cuerpo.contents).toEqual([
      { role: "user", parts: [{ text: "hola" }] },
      { role: "model", parts: [{ text: "¡Hola!" }] },
      { role: "user", parts: [{ text: "¿horario?" }] },
    ]);
  });

  it("devuelve el texto de la respuesta", async () => {
    const { f } = fetchFalso(okCon({ candidates: [{ content: { parts: [{ text: "Hola " }, { text: "mundo" }] } }] }));
    expect(await crearProveedorGemini({ apiKey: "K", modelo: "m", fetch: f }).generar(entrada)).toBe("Hola mundo");
  });

  it("respuesta HTTP no-OK → ErrorIA con estado", async () => {
    const { f } = fetchFalso(() => new Response("cuota", { status: 429 }));
    const p = crearProveedorGemini({ apiKey: "K", modelo: "m", fetch: f }).generar(entrada);
    await expect(p).rejects.toBeInstanceOf(ErrorIA);
    await expect(p).rejects.toMatchObject({ estado: 429 });
  });

  it("respuesta sin texto → ErrorIA", async () => {
    for (const cuerpo of [{ candidates: [] }, { promptFeedback: { blockReason: "SAFETY" } }]) {
      const { f } = fetchFalso(okCon(cuerpo));
      await expect(crearProveedorGemini({ apiKey: "K", modelo: "m", fetch: f }).generar(entrada)).rejects.toBeInstanceOf(ErrorIA);
    }
  });

  it("fallo de red → ErrorIA", async () => {
    const { f } = fetchFalso(() => {
      throw new TypeError("network");
    });
    await expect(crearProveedorGemini({ apiKey: "K", modelo: "m", fetch: f }).generar(entrada)).rejects.toBeInstanceOf(ErrorIA);
  });
});
