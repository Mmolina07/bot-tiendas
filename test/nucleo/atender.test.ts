import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { guardarMensaje, obtenerOCrearConversacion, ultimosMensajes } from "../../src/datos/conversaciones";
import { crearTienda } from "../../src/datos/tiendas";
import { ErrorIA, type EntradaIA, type ProveedorIA } from "../../src/ia/proveedor";
import { listarPreguntasPendientes } from "../../src/datos/preguntas";
import { atenderMensaje, LIMITE_HISTORIAL, RESPUESTA_SIN_IA, TiendaNoEncontrada } from "../../src/nucleo/atender";

function iaFalsa(responder: () => Promise<string>) {
  const recibidas: EntradaIA[] = [];
  const ia: ProveedorIA = {
    generar: (e) => {
      recibidas.push(e);
      return responder();
    },
  };
  return { ia, recibidas };
}

describe("nucleo/atender", () => {
  it("responde y guarda ambos mensajes", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { ia } = iaFalsa(async () => "¡Claro!");
    const r = await atenderMensaje({ db: env.DB, ia }, { tiendaId: t.id, canal: "simulador", cliente: crypto.randomUUID(), texto: "¿Tienen café?" });
    expect(r).toMatchObject({ respuesta: "¡Claro!", huboErrorIA: false });
    const msgs = await ultimosMensajes(env.DB, r.conversacionId, 10);
    expect(msgs.map((m) => [m.rol, m.texto])).toEqual([
      ["cliente", "¿Tienen café?"],
      ["bot", "¡Claro!"],
    ]);
  });

  it("envía el historial con el mensaje nuevo al final, máximo LIMITE_HISTORIAL", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const cliente = crypto.randomUUID();
    const conv = await obtenerOCrearConversacion(env.DB, t.id, "simulador", cliente);
    for (let i = 1; i <= 15; i++) await guardarMensaje(env.DB, conv.id, i % 2 ? "cliente" : "bot", `previo ${i}`);
    const { ia, recibidas } = iaFalsa(async () => "ok");
    await atenderMensaje({ db: env.DB, ia }, { tiendaId: t.id, canal: "simulador", cliente, texto: "nuevo" });
    const enviados = recibidas[0].mensajes;
    expect(LIMITE_HISTORIAL).toBe(10);
    expect(enviados).toHaveLength(10);
    expect(enviados.at(-1)).toEqual({ rol: "cliente", texto: "nuevo" });
    expect(enviados.map((m) => m.texto)).toEqual([...Array.from({ length: 9 }, (_, i) => `previo ${i + 7}`), "nuevo"]);
    expect(recibidas[0].sistema).toContain("T");
  });

  it("si la IA falla → RESPUESTA_SIN_IA, sin lanzar", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { ia } = iaFalsa(async () => {
      throw new ErrorIA("x", 429);
    });
    const r = await atenderMensaje({ db: env.DB, ia }, { tiendaId: t.id, canal: "simulador", cliente: crypto.randomUUID(), texto: "hola" });
    expect(r).toMatchObject({ respuesta: RESPUESTA_SIN_IA, huboErrorIA: true });
    const msgs = await ultimosMensajes(env.DB, r.conversacionId, 10);
    expect(msgs.map((m) => [m.rol, m.texto])).toEqual([["cliente", "hola"]]);
  });

  it("tienda inexistente → lanza TiendaNoEncontrada", async () => {
    const { ia } = iaFalsa(async () => "ok");
    await expect(
      atenderMensaje({ db: env.DB, ia }, { tiendaId: "no-existe", canal: "simulador", cliente: "c", texto: "hola" }),
    ).rejects.toBeInstanceOf(TiendaNoEncontrada);
  });

  it("[SIN_INFO] → se quita la marca y se registra la pregunta", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { ia } = iaFalsa(async () => "[SIN_INFO] No tengo esa información.");
    const r = await atenderMensaje({ db: env.DB, ia }, { tiendaId: t.id, canal: "simulador", cliente: crypto.randomUUID(), texto: "¿Envían a España?" });
    expect(r).toMatchObject({ respuesta: "No tengo esa información.", sinInformacion: true, huboErrorIA: false });
    expect((await listarPreguntasPendientes(env.DB, t.id)).map((p) => p.pregunta)).toEqual(["¿Envían a España?"]);
    const msgs = await ultimosMensajes(env.DB, r.conversacionId, 10);
    expect(msgs.at(-1)?.texto).toBe("No tengo esa información.");
  });

  it("marca en minúsculas o en medio del texto también cuenta", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { ia } = iaFalsa(async () => "Lo siento, [sin_info] no sé. [SIN_INFO]");
    const r = await atenderMensaje({ db: env.DB, ia }, { tiendaId: t.id, canal: "simulador", cliente: crypto.randomUUID(), texto: "¿talleres?" });
    expect(r.respuesta.toLowerCase()).not.toContain("[sin_info]");
    expect(r.sinInformacion).toBe(true);
    expect(await listarPreguntasPendientes(env.DB, t.id)).toHaveLength(1);
  });

  it("sin marca → no registra pregunta", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    const { ia } = iaFalsa(async () => "Abrimos a las 8.");
    const r = await atenderMensaje({ db: env.DB, ia }, { tiendaId: t.id, canal: "simulador", cliente: crypto.randomUUID(), texto: "¿horario?" });
    expect(r.sinInformacion).toBe(false);
    expect(await listarPreguntasPendientes(env.DB, t.id)).toEqual([]);
  });

  it("fallo al guardar tras una respuesta correcta → se lanza, no se reporta como fallo de IA", async () => {
    const t = await crearTienda(env.DB, { nombre: "T" });
    let lotes = 0;
    const db = new Proxy(env.DB, {
      get(obj, prop) {
        if (prop === "batch")
          return (s: D1PreparedStatement[]) => {
            lotes++;
            if (lotes === 2) return Promise.reject(new Error("D1 caído"));
            return obj.batch(s);
          };
        const v = Reflect.get(obj, prop);
        return typeof v === "function" ? v.bind(obj) : v;
      },
    });
    const { ia } = iaFalsa(async () => "ok");
    await expect(
      atenderMensaje({ db, ia }, { tiendaId: t.id, canal: "simulador", cliente: crypto.randomUUID(), texto: "hola" }),
    ).rejects.toThrow("D1 caído");
  });
});
