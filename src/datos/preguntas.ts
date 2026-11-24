export const MAX_PREGUNTAS_LISTADAS = 50;

export type Pregunta = {
  id: string;
  tiendaId: string;
  conversacionId: string | null;
  pregunta: string;
  estado: "pendiente" | "resuelta";
  creadaEn: number;
};

type Fila = {
  id: string;
  tienda_id: string;
  conversacion_id: string | null;
  pregunta: string;
  estado: Pregunta["estado"];
  creada_en: number;
};

const COLUMNAS = "id, tienda_id, conversacion_id, pregunta, estado, creada_en";
const aPregunta = (f: Fila): Pregunta => ({
  id: f.id,
  tiendaId: f.tienda_id,
  conversacionId: f.conversacion_id,
  pregunta: f.pregunta,
  estado: f.estado,
  creadaEn: f.creada_en,
});

const normalizar = (t: string) => t.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");

/** Registra la pregunta; si ya hay una pendiente igual en la tienda, devuelve esa en vez de duplicarla. */
export async function registrarPregunta(
  db: D1Database,
  tiendaId: string,
  conversacionId: string | null,
  pregunta: string,
): Promise<Pregunta> {
  const clave = normalizar(pregunta);
  const existente = await db
    .prepare(
      `SELECT ${COLUMNAS} FROM preguntas_sin_respuesta
       WHERE tienda_id = ? AND estado = 'pendiente' AND pregunta_normalizada = ? LIMIT 1`,
    )
    .bind(tiendaId, clave)
    .first<Fila>();
  if (existente) return aPregunta(existente);
  const fila = await db
    .prepare(
      `INSERT INTO preguntas_sin_respuesta (id, tienda_id, conversacion_id, pregunta, pregunta_normalizada, creada_en)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLUMNAS}`,
    )
    .bind(crypto.randomUUID(), tiendaId, conversacionId, pregunta, clave, Date.now())
    .first<Fila>();
  if (!fila) throw new Error("No se pudo registrar la pregunta");
  return aPregunta(fila);
}

/** Pendientes de la tienda, más recientes primero (máximo MAX_PREGUNTAS_LISTADAS). */
export async function listarPreguntasPendientes(db: D1Database, tiendaId: string): Promise<Pregunta[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNAS} FROM preguntas_sin_respuesta
       WHERE tienda_id = ? AND estado = 'pendiente' ORDER BY creada_en DESC, rowid DESC LIMIT ?`,
    )
    .bind(tiendaId, MAX_PREGUNTAS_LISTADAS)
    .all<Fila>();
  return results.map(aPregunta);
}

export async function obtenerPregunta(db: D1Database, tiendaId: string, id: string): Promise<Pregunta | null> {
  const fila = await db
    .prepare(`SELECT ${COLUMNAS} FROM preguntas_sin_respuesta WHERE id = ? AND tienda_id = ?`)
    .bind(id, tiendaId)
    .first<Fila>();
  return fila ? aPregunta(fila) : null;
}

export async function marcarResuelta(db: D1Database, tiendaId: string, id: string): Promise<void> {
  await db
    .prepare("UPDATE preguntas_sin_respuesta SET estado = 'resuelta' WHERE id = ? AND tienda_id = ?")
    .bind(id, tiendaId)
    .run();
}

export async function contarPreguntasPendientes(db: D1Database, tiendaId: string): Promise<number> {
  const f = await db
    .prepare("SELECT COUNT(*) AS n FROM preguntas_sin_respuesta WHERE tienda_id = ? AND estado = 'pendiente'")
    .bind(tiendaId)
    .first<{ n: number }>();
  return f?.n ?? 0;
}

/** Descarta una pregunta basura sin convertirla en conocimiento. */
export async function descartarPregunta(db: D1Database, tiendaId: string, id: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM preguntas_sin_respuesta WHERE id = ? AND tienda_id = ?").bind(id, tiendaId).run();
  return r.meta.changes > 0;
}

/** Marca resuelta solo si seguía pendiente; devuelve si la marcó (evita resolverla dos veces). */
export async function marcarResueltaSiPendiente(db: D1Database, tiendaId: string, id: string): Promise<boolean> {
  const r = await db
    .prepare("UPDATE preguntas_sin_respuesta SET estado = 'resuelta' WHERE id = ? AND tienda_id = ? AND estado = 'pendiente'")
    .bind(id, tiendaId)
    .run();
  return r.meta.changes > 0;
}
