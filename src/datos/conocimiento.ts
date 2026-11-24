export type TipoConocimiento = "faq" | "producto" | "politica";
export type DatosProducto = { precio: number; moneda: string; categoria: string };
export type EntradaConocimiento = {
  id: string;
  tiendaId: string;
  tipo: TipoConocimiento;
  titulo: string;
  contenido: string;
  datosProducto: DatosProducto | null;
  actualizadoEn: number;
};

export type DatosEntrada = Omit<EntradaConocimiento, "id" | "actualizadoEn" | "tiendaId">;

type Fila = {
  id: string;
  tienda_id: string;
  tipo: TipoConocimiento;
  titulo: string;
  contenido: string;
  datos_producto: string | null;
  actualizado_en: number;
};

const COLUMNAS = "id, tienda_id, tipo, titulo, contenido, datos_producto, actualizado_en";

function leerDatosProducto(json: string | null): DatosProducto | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Partial<DatosProducto> | null;
    if (o && typeof o.precio === "number" && typeof o.moneda === "string" && typeof o.categoria === "string") {
      return { precio: o.precio, moneda: o.moneda, categoria: o.categoria };
    }
  } catch {
    // JSON inválido: se trata como sin datos de producto.
  }
  return null;
}

function aEntrada(f: Fila): EntradaConocimiento {
  return {
    id: f.id,
    tiendaId: f.tienda_id,
    tipo: f.tipo,
    titulo: f.titulo,
    contenido: f.contenido,
    datosProducto: leerDatosProducto(f.datos_producto),
    actualizadoEn: f.actualizado_en,
  };
}

export async function crearConocimiento(
  db: D1Database,
  d: Omit<EntradaConocimiento, "id" | "actualizadoEn">,
): Promise<EntradaConocimiento> {
  const fila = await db
    .prepare(
      `INSERT INTO conocimiento (${COLUMNAS}) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNAS}`,
    )
    .bind(
      crypto.randomUUID(),
      d.tiendaId,
      d.tipo,
      d.titulo,
      d.contenido,
      d.datosProducto ? JSON.stringify(d.datosProducto) : null,
      Date.now(),
    )
    .first<Fila>();
  if (!fila) throw new Error("No se pudo crear el conocimiento");
  return aEntrada(fila);
}

export async function listarConocimiento(db: D1Database, tiendaId: string): Promise<EntradaConocimiento[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNAS} FROM conocimiento WHERE tienda_id = ? ORDER BY tipo, titulo`)
    .bind(tiendaId)
    .all<Fila>();
  return results.map(aEntrada);
}

/** Entradas de la tienda con esos ids, en el mismo orden de `ids`; ignora las que no existen o son de otra tienda. */
export async function obtenerConocimientoPorIds(db: D1Database, tiendaId: string, ids: string[]): Promise<EntradaConocimiento[]> {
  if (ids.length === 0) return [];
  const marcas = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT ${COLUMNAS} FROM conocimiento WHERE tienda_id = ? AND id IN (${marcas})`)
    .bind(tiendaId, ...ids)
    .all<Fila>();
  const porId = new Map(results.map((f) => [f.id, aEntrada(f)]));
  return ids.flatMap((id) => porId.get(id) ?? []);
}

const serializarProducto = (d: DatosProducto | null) => (d ? JSON.stringify(d) : null);

export async function obtenerConocimiento(db: D1Database, tiendaId: string, id: string): Promise<EntradaConocimiento | null> {
  const fila = await db
    .prepare(`SELECT ${COLUMNAS} FROM conocimiento WHERE id = ? AND tienda_id = ?`)
    .bind(id, tiendaId)
    .first<Fila>();
  return fila ? aEntrada(fila) : null;
}

export async function actualizarConocimiento(
  db: D1Database,
  tiendaId: string,
  id: string,
  d: DatosEntrada,
): Promise<EntradaConocimiento | null> {
  const fila = await db
    .prepare(
      `UPDATE conocimiento SET tipo = ?, titulo = ?, contenido = ?, datos_producto = ?, actualizado_en = ?
       WHERE id = ? AND tienda_id = ? RETURNING ${COLUMNAS}`,
    )
    .bind(d.tipo, d.titulo, d.contenido, serializarProducto(d.datosProducto), Date.now(), id, tiendaId)
    .first<Fila>();
  return fila ? aEntrada(fila) : null;
}

export async function borrarConocimiento(db: D1Database, tiendaId: string, id: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM conocimiento WHERE id = ? AND tienda_id = ?").bind(id, tiendaId).run();
  return r.meta.changes > 0;
}

export async function crearConocimientoEnLote(
  db: D1Database,
  tiendaId: string,
  lista: DatosEntrada[],
): Promise<EntradaConocimiento[]> {
  if (lista.length === 0) return [];
  const ahora = Date.now();
  const entradas: EntradaConocimiento[] = lista.map((d) => ({ ...d, id: crypto.randomUUID(), tiendaId, actualizadoEn: ahora }));
  // Varias filas por sentencia (D1: máx. 100 parámetros por sentencia y ~50 consultas por petición en el plan gratuito).
  const FILAS_POR_SENTENCIA = 14; // 14 × 7 columnas = 98 parámetros
  const sentencias: D1PreparedStatement[] = [];
  for (let i = 0; i < entradas.length; i += FILAS_POR_SENTENCIA) {
    const grupo = entradas.slice(i, i + FILAS_POR_SENTENCIA);
    sentencias.push(
      db
        .prepare(`INSERT INTO conocimiento (${COLUMNAS}) VALUES ${grupo.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`)
        .bind(...grupo.flatMap((e) => [e.id, tiendaId, e.tipo, e.titulo, e.contenido, serializarProducto(e.datosProducto), ahora])),
    );
  }
  await db.batch(sentencias);
  return entradas;
}

export async function contarConocimiento(db: D1Database, tiendaId: string): Promise<number> {
  const f = await db.prepare("SELECT COUNT(*) AS n FROM conocimiento WHERE tienda_id = ?").bind(tiendaId).first<{ n: number }>();
  return f?.n ?? 0;
}
