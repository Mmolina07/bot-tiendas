import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { crearConocimiento, listarConocimiento } from "../../src/datos/conocimiento";
import { listarPreguntasPendientes, registrarPregunta } from "../../src/datos/preguntas";
import { crearTienda } from "../../src/datos/tiendas";

const AUTH = `Basic ${btoa("admin:clave-prueba")}`;

function get(ruta: string, auth: string | null = AUTH) {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return exports.default.fetch(`https://x${ruta}`, { headers, redirect: "manual" });
}
function post(ruta: string, campos: Record<string, string>, origin = "https://x") {
  return exports.default.fetch(`https://x${ruta}`, {
    method: "POST",
    redirect: "manual",
    headers: { authorization: AUTH, origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(campos).toString(),
  });
}
const nuevaTienda = () => crearTienda(env.DB, { nombre: "Tienda Panel" });

describe("panel", () => {
  it("sin credenciales → 401 con WWW-Authenticate", async () => {
    const t = await nuevaTienda();
    const r = await get(`/panel/${t.id}`, null);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate") ?? "").toContain("Basic");
  });

  it("credenciales erróneas → 401", async () => {
    const t = await nuevaTienda();
    expect((await get(`/panel/${t.id}`, `Basic ${btoa("admin:mal")}`)).status).toBe(401);
  });

  it("POST de otro origen → 403 y no crea nada", async () => {
    const t = await nuevaTienda();
    const r = await post(`/panel/${t.id}/conocimiento`, { tipo: "faq", titulo: "X", contenido: "x" }, "https://malo.example");
    expect(r.status).toBe(403);
    expect(await listarConocimiento(env.DB, t.id)).toEqual([]);
  });

  it("GET muestra preguntas pendientes y conocimiento", async () => {
    const t = await nuevaTienda();
    await registrarPregunta(env.DB, t.id, null, "¿Hacen talleres de barismo?");
    await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "Horario", contenido: "8 a 19", datosProducto: null });
    const r = await get(`/panel/${t.id}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("¿Hacen talleres de barismo?");
    expect(html).toContain("Horario");
    expect(html).toContain("Tienda Panel");
  });

  it("crear entrada → 303 y aparece en la lista", async () => {
    const t = await nuevaTienda();
    const r = await post(`/panel/${t.id}/conocimiento`, { tipo: "producto", titulo: "Café nuevo", contenido: "Rico", precio: "20000", moneda: "COP", categoria: "Grano" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location") ?? "").toContain(`/panel/${t.id}?aviso=`);
    const [e] = await listarConocimiento(env.DB, t.id);
    expect(e).toMatchObject({ titulo: "Café nuevo", datosProducto: { precio: 20000, moneda: "COP", categoria: "Grano" } });
  });

  it("crear entrada inválida → 400", async () => {
    const t = await nuevaTienda();
    expect((await post(`/panel/${t.id}/conocimiento`, { tipo: "faq", titulo: "", contenido: "x" })).status).toBe(400);
    expect((await post(`/panel/${t.id}/conocimiento`, { tipo: "otro", titulo: "T", contenido: "x" })).status).toBe(400);
    expect(await listarConocimiento(env.DB, t.id)).toEqual([]);
  });

  it("resolver pregunta → 303, desaparece de pendientes y aparece como FAQ", async () => {
    const t = await nuevaTienda();
    const p = await registrarPregunta(env.DB, t.id, null, "¿Envían a España?");
    const r = await post(`/panel/${t.id}/preguntas/${p.id}/resolver`, { respuesta: "Solo dentro de Colombia." });
    expect(r.status).toBe(303);
    expect(await listarPreguntasPendientes(env.DB, t.id)).toEqual([]);
    expect((await listarConocimiento(env.DB, t.id)).map((e) => [e.tipo, e.titulo, e.contenido])).toEqual([
      ["faq", "¿Envían a España?", "Solo dentro de Colombia."],
    ]);
  });

  it("editar y borrar entrada", async () => {
    const t = await nuevaTienda();
    const e = await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "Viejo", contenido: "v", datosProducto: null });
    const form = await get(`/panel/${t.id}/conocimiento/${e.id}/editar`);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain("Viejo");
    expect((await post(`/panel/${t.id}/conocimiento/${e.id}`, { tipo: "politica", titulo: "Nuevo", contenido: "n" })).status).toBe(303);
    expect((await listarConocimiento(env.DB, t.id))[0]).toMatchObject({ tipo: "politica", titulo: "Nuevo" });
    expect((await post(`/panel/${t.id}/conocimiento/${e.id}/borrar`, {})).status).toBe(303);
    expect(await listarConocimiento(env.DB, t.id)).toEqual([]);
  });

  it("importar CSV por textarea → aviso con conteo y errores", async () => {
    const t = await nuevaTienda();
    const csv = ["tipo,titulo,contenido,precio,moneda,categoria", "faq,A,a,,,", "otro,B,b,,,", "producto,C,c,1000,,"].join("\n");
    const r = await post(`/panel/${t.id}/importar`, { csv });
    expect(r.status).toBe(303);
    const aviso = decodeURIComponent(new URL(r.headers.get("location")!, "https://x").searchParams.get("aviso") ?? "");
    expect(aviso).toContain("2");
    expect(aviso).toContain("fila 3");
    expect(await listarConocimiento(env.DB, t.id)).toHaveLength(2);
    const pagina = await (await get(new URL(r.headers.get("location")!, "https://x").pathname + new URL(r.headers.get("location")!, "https://x").search)).text();
    expect(pagina).toContain("fila 3");
  });

  it("reindexar → 303 con el conteo", async () => {
    const t = await nuevaTienda();
    await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "A", contenido: "a", datosProducto: null });
    const r = await post(`/panel/${t.id}/reindexar`, {});
    expect(r.status).toBe(303);
    expect(decodeURIComponent(r.headers.get("location") ?? "")).toContain("Indexando 1 entradas");
  });

  it("contenido con <script> se escapa", async () => {
    const t = await nuevaTienda();
    await crearConocimiento(env.DB, { tiendaId: t.id, tipo: "faq", titulo: "<script>alert(1)</script>", contenido: "x", datosProducto: null });
    await registrarPregunta(env.DB, t.id, null, "<img src=x onerror=alert(2)>");
    const html = await (await get(`/panel/${t.id}`)).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });

  it("tienda inexistente → 404", async () => {
    expect((await get("/panel/no-existe")).status).toBe(404);
  });

  it("editar entrada de otra tienda → 404", async () => {
    const a = await nuevaTienda();
    const b = await nuevaTienda();
    const e = await crearConocimiento(env.DB, { tiendaId: a.id, tipo: "faq", titulo: "De A", contenido: "a", datosProducto: null });
    expect((await get(`/panel/${b.id}/conocimiento/${e.id}/editar`)).status).toBe(404);
    expect((await post(`/panel/${b.id}/conocimiento/${e.id}`, { tipo: "faq", titulo: "X", contenido: "x" })).status).toBe(404);
  });

  it("descartar pregunta → 303 y desaparece sin crear conocimiento", async () => {
    const t = await nuevaTienda();
    const p = await registrarPregunta(env.DB, t.id, null, "basura");
    expect((await post(`/panel/${t.id}/preguntas/${p.id}/descartar`, {})).status).toBe(303);
    expect(await listarPreguntasPendientes(env.DB, t.id)).toEqual([]);
    expect(await listarConocimiento(env.DB, t.id)).toEqual([]);
  });

  it("importar CSV como archivo (multipart)", async () => {
    const t = await nuevaTienda();
    const form = new FormData();
    form.append("archivo", new File(["tipo;titulo;contenido\nfaq;Desde archivo;ok"], "c.csv", { type: "text/csv" }));
    const r = await exports.default.fetch(`https://x/panel/${t.id}/importar`, {
      method: "POST",
      redirect: "manual",
      headers: { authorization: AUTH, origin: "https://x" },
      body: form,
    });
    expect(r.status).toBe(303);
    expect((await listarConocimiento(env.DB, t.id)).map((e) => e.titulo)).toEqual(["Desde archivo"]);
  });
});
