export type Canal = "whatsapp" | "simulador";
export type Conversacion = {
  id: string;
  tiendaId: string;
  canal: Canal;
  cliente: string;
  estado: "bot" | "requiere_humano";
  creadaEn: number;
  actualizadaEn: number;
};
export type Mensaje = {
  id: string;
  conversacionId: string;
  rol: "cliente" | "bot" | "humano";
  texto: string;
  creadoEn: number;
};

type FilaConversacion = {
  id: string;
  tienda_id: string;
  canal: Canal;
  cliente: string;
  estado: Conversacion["estado"];
  creada_en: number;
  actualizada_en: number;
};
type FilaMensaje = { id: string; conversacion_id: string; rol: Mensaje["rol"]; texto: string; creado_en: number };

const aConversacion = (f: FilaConversacion): Conversacion => ({
  id: f.id,
  tiendaId: f.tienda_id,
  canal: f.canal,
  cliente: f.cliente,
  estado: f.estado,
  creadaEn: f.creada_en,
  actualizadaEn: f.actualizada_en,
});
const aMensaje = (f: FilaMensaje): Mensaje => ({
  id: f.id,
  conversacionId: f.conversacion_id,
  rol: f.rol,
  texto: f.texto,
  creadoEn: f.creado_en,
});

/** Devuelve la conversación de ese cliente en esa tienda y canal; la crea si no existe (seguro ante peticiones simultáneas). */
export async function obtenerOCrearConversacion(
  db: D1Database,
  tiendaId: string,
  canal: Canal,
  cliente: string,
): Promise<Conversacion> {
  const ahora = Date.now();
  await db
    .prepare(
      `INSERT INTO conversaciones (id, tienda_id, canal, cliente, creada_en, actualizada_en)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tienda_id, canal, cliente) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), tiendaId, canal, cliente, ahora, ahora)
    .run();
  const fila = await db
    .prepare(
      `SELECT id, tienda_id, canal, cliente, estado, creada_en, actualizada_en
       FROM conversaciones WHERE tienda_id = ? AND canal = ? AND cliente = ?`,
    )
    .bind(tiendaId, canal, cliente)
    .first<FilaConversacion>();
  if (!fila) throw new Error("No se pudo obtener la conversación");
  return aConversacion(fila);
}

export async function guardarMensaje(
  db: D1Database,
  conversacionId: string,
  rol: Mensaje["rol"],
  texto: string,
  idExterno?: string,
): Promise<Mensaje> {
  const m: Mensaje = { id: crypto.randomUUID(), conversacionId, rol, texto, creadoEn: Date.now() };
  await db.batch([
    db
      .prepare("INSERT INTO mensajes (id, conversacion_id, rol, texto, id_externo, creado_en) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(m.id, conversacionId, rol, texto, idExterno ?? null, m.creadoEn),
    db.prepare("UPDATE conversaciones SET actualizada_en = ? WHERE id = ?").bind(m.creadoEn, conversacionId),
  ]);
  return m;
}

/** Los `limite` mensajes más recientes, en orden cronológico ascendente. */
export async function ultimosMensajes(db: D1Database, conversacionId: string, limite: number): Promise<Mensaje[]> {
  const { results } = await db
    .prepare(
      `SELECT id, conversacion_id, rol, texto, creado_en FROM mensajes
       WHERE conversacion_id = ? ORDER BY creado_en DESC, rowid DESC LIMIT ?`,
    )
    .bind(conversacionId, limite)
    .all<FilaMensaje>();
  return results.map(aMensaje).reverse();
}
