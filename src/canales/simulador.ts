import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ultimosMensajes, obtenerOCrearConversacion } from "../datos/conversaciones";
import { obtenerTienda } from "../datos/tiendas";
import { crearProveedorIA } from "../ia/crear";
import { atenderMensaje, TiendaNoEncontrada } from "../nucleo/atender";
import type { Env } from "../tipos";

type Ctx = Context<{ Bindings: Env }>;

const COOKIE = "sim_cliente";
const FORMATO_CLIENTE = /^[0-9a-f-]{36}$/;
const MAX_TEXTO = 1000;
const MAX_HISTORIAL_VISIBLE = 50;

const noDisponible = (c: Ctx) => c.json({ error: "Tienda de demo no disponible" }, 503);

/** Id anónimo del visitante: el de su cookie si es válido; si no, uno nuevo (y se le entrega en la cookie). */
function clienteDe(c: Ctx): string {
  const actual = getCookie(c, COOKIE);
  if (actual && FORMATO_CLIENTE.test(actual)) return actual;
  const nuevo = crypto.randomUUID();
  setCookie(c, COOKIE, nuevo, {
    httpOnly: true,
    secure: true,
    sameSite: "None", // necesario para que funcione dentro del iframe del portfolio
    path: "/api/simulador",
    maxAge: 86400,
  });
  return nuevo;
}

export const simulador = new Hono<{ Bindings: Env }>();

simulador.get("/inicio", async (c) => {
  const tienda = await obtenerTienda(c.env.DB, c.env.DEMO_TIENDA_ID);
  if (!tienda) return noDisponible(c);
  const conv = await obtenerOCrearConversacion(c.env.DB, tienda.id, "simulador", clienteDe(c));
  const mensajes = await ultimosMensajes(c.env.DB, conv.id, MAX_HISTORIAL_VISIBLE);
  return c.json({
    tienda: { nombre: tienda.nombre, bienvenida: tienda.configuracion.bienvenida },
    mensajes: mensajes.map((m) => ({ rol: m.rol, texto: m.texto })),
  });
});

simulador.post("/mensaje", async (c) => {
  const cuerpo = await c.req.json<{ texto?: unknown }>().catch(() => null);
  const texto = typeof cuerpo?.texto === "string" ? cuerpo.texto.trim() : "";
  if (!texto || texto.length > MAX_TEXTO) return c.json({ error: "Mensaje inválido" }, 400);

  try {
    const r = await atenderMensaje(
      { db: c.env.DB, ia: crearProveedorIA(c.env) },
      { tiendaId: c.env.DEMO_TIENDA_ID, canal: "simulador", cliente: clienteDe(c), texto },
    );
    return c.json({ respuesta: r.respuesta, huboErrorIA: r.huboErrorIA });
  } catch (e) {
    if (e instanceof TiendaNoEncontrada) return noDisponible(c);
    throw e;
  }
});
