import { listarConocimiento } from "../datos/conocimiento";
import { type Canal, guardarMensaje, obtenerOCrearConversacion, ultimosMensajes } from "../datos/conversaciones";
import { obtenerTienda } from "../datos/tiendas";
import type { MensajeIA, ProveedorIA } from "../ia/proveedor";
import { construirPromptSistema } from "./prompt";

export const LIMITE_HISTORIAL = 10;
export const RESPUESTA_SIN_IA = "Uy, ahora mismo no puedo responder. Intenta de nuevo en un momento, por favor 🙏";

export type MensajeEntrante = { tiendaId: string; canal: Canal; cliente: string; texto: string };
export type ResultadoAtencion = { respuesta: string; conversacionId: string; huboErrorIA: boolean };

export class TiendaNoEncontrada extends Error {
  constructor(tiendaId: string) {
    super(`Tienda no encontrada: ${tiendaId}`);
    this.name = "TiendaNoEncontrada";
  }
}

/** Núcleo del bot, independiente del canal: guarda, arma contexto, consulta la IA y guarda la respuesta. */
export async function atenderMensaje(
  deps: { db: D1Database; ia: ProveedorIA },
  m: MensajeEntrante,
): Promise<ResultadoAtencion> {
  const { db, ia } = deps;
  const tienda = await obtenerTienda(db, m.tiendaId);
  if (!tienda) throw new TiendaNoEncontrada(m.tiendaId);

  const conv = await obtenerOCrearConversacion(db, tienda.id, m.canal, m.cliente);
  await guardarMensaje(db, conv.id, "cliente", m.texto);

  const [historial, conocimiento] = await Promise.all([
    ultimosMensajes(db, conv.id, LIMITE_HISTORIAL),
    listarConocimiento(db, tienda.id),
  ]);
  const mensajes: MensajeIA[] = historial.map((h) => ({ rol: h.rol === "cliente" ? "cliente" : "bot", texto: h.texto }));
  // El modelo espera que la conversación empiece con el cliente.
  while (mensajes.length > 1 && mensajes[0].rol !== "cliente") mensajes.shift();

  try {
    const respuesta = await ia.generar({ sistema: construirPromptSistema(tienda, conocimiento), mensajes });
    await guardarMensaje(db, conv.id, "bot", respuesta);
    return { respuesta, conversacionId: conv.id, huboErrorIA: false };
  } catch (e) {
    console.error("Fallo de la IA", e);
    return { respuesta: RESPUESTA_SIN_IA, conversacionId: conv.id, huboErrorIA: true };
  }
}
