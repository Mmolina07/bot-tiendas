import type { Buscador } from "../conocimiento/buscador";
import { type Canal, guardarMensaje, obtenerOCrearConversacion, ultimosMensajes } from "../datos/conversaciones";
import { registrarPregunta } from "../datos/preguntas";
import { obtenerTienda } from "../datos/tiendas";
import type { MensajeIA, ProveedorIA } from "../ia/proveedor";
import { construirPromptSistema } from "./prompt";

export const LIMITE_HISTORIAL = 10;
export const RESPUESTA_SIN_IA = "Uy, ahora mismo no puedo responder. Intenta de nuevo en un momento, por favor 🙏";
const RESPUESTA_SIN_INFO_VACIA = "No tengo esa información, te sugiero contactar a la tienda.";
const PATRON_SIN_INFO = /\[sin_info\]/gi;

export type MensajeEntrante = { tiendaId: string; canal: Canal; cliente: string; texto: string };
export type ResultadoAtencion = {
  respuesta: string;
  conversacionId: string;
  huboErrorIA: boolean;
  sinInformacion: boolean;
};

export class TiendaNoEncontrada extends Error {
  constructor(tiendaId: string) {
    super(`Tienda no encontrada: ${tiendaId}`);
    this.name = "TiendaNoEncontrada";
  }
}

/** Quita la marca [SIN_INFO] (en cualquier posición y mayúsculas) e indica si estaba. */
function separarMarca(texto: string): { limpio: string; sinInformacion: boolean } {
  const sinInformacion = texto.toLowerCase().includes("[sin_info]");
  if (!sinInformacion) return { limpio: texto, sinInformacion };
  const limpio = texto.replace(PATRON_SIN_INFO, "").replace(/\s{2,}/g, " ").trim();
  return { limpio: limpio || RESPUESTA_SIN_INFO_VACIA, sinInformacion };
}

/** Núcleo del bot, independiente del canal: guarda, arma contexto, consulta la IA y guarda la respuesta. */
export async function atenderMensaje(
  deps: { db: D1Database; ia: ProveedorIA; buscador: Buscador },
  m: MensajeEntrante,
): Promise<ResultadoAtencion> {
  const { db, ia, buscador } = deps;
  const tienda = await obtenerTienda(db, m.tiendaId);
  if (!tienda) throw new TiendaNoEncontrada(m.tiendaId);

  const conv = await obtenerOCrearConversacion(db, tienda.id, m.canal, m.cliente);
  await guardarMensaje(db, conv.id, "cliente", m.texto);

  const [historial, conocimiento] = await Promise.all([
    ultimosMensajes(db, conv.id, LIMITE_HISTORIAL),
    buscador.buscar(tienda.id, m.texto),
  ]);
  const mensajes: MensajeIA[] = historial.map((h) => ({ rol: h.rol === "cliente" ? "cliente" : "bot", texto: h.texto }));
  // El modelo espera que la conversación empiece con el cliente.
  while (mensajes.length > 1 && mensajes[0].rol !== "cliente") mensajes.shift();

  let generada: string;
  try {
    generada = await ia.generar({ sistema: construirPromptSistema(tienda, conocimiento), mensajes });
  } catch (e) {
    console.error("Fallo de la IA", e);
    return { respuesta: RESPUESTA_SIN_IA, conversacionId: conv.id, huboErrorIA: true, sinInformacion: false };
  }

  const { limpio, sinInformacion } = separarMarca(generada);
  await guardarMensaje(db, conv.id, "bot", limpio);
  if (sinInformacion) await registrarPregunta(db, tienda.id, conv.id, m.texto);
  return { respuesta: limpio, conversacionId: conv.id, huboErrorIA: false, sinInformacion };
}
