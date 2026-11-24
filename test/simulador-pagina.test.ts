import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// En producción los assets se sirven antes que el Worker; en las pruebas se consultan por el binding ASSETS.
describe("página del simulador", () => {
  it("GET /simulador/ sirve el HTML del chat", async () => {
    const r = await env.ASSETS.fetch("https://x/simulador/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type") ?? "").toContain("text/html");
    expect(await r.text()).toContain("simulador.js");
  });
});
