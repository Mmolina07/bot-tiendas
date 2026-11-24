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
