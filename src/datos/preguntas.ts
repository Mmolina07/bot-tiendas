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

export async function registrarPregunta(
  db: D1Database,
  tiendaId: string,
  conversacionId: string | null,
  pregunta: string,
): Promise<Pregunta> {
  const fila = await db
    .prepare(
      `INSERT INTO preguntas_sin_respuesta (id, tienda_id, conversacion_id, pregunta, creada_en)
       VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNAS}`,
    )
    .bind(crypto.randomUUID(), tiendaId, conversacionId, pregunta, Date.now())
    .first<Fila>();
  if (!fila) throw new Error("No se pudo registrar la pregunta");
  return aPregunta(fila);
}

/** Pendientes de la tienda, más recientes primero. */
export async function listarPreguntasPendientes(db: D1Database, tiendaId: string): Promise<Pregunta[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNAS} FROM preguntas_sin_respuesta
       WHERE tienda_id = ? AND estado = 'pendiente' ORDER BY creada_en DESC, rowid DESC`,
    )
    .bind(tiendaId)
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
