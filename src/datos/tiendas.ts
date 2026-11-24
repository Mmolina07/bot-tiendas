export type ConfiguracionTienda = {
  tono: string;
  bienvenida: string;
  horario: string | null;
  reglas: string[];
};

export type Tienda = {
  id: string;
  nombre: string;
  configuracion: ConfiguracionTienda;
  proveedorIa: string;
  whatsappPhoneNumberId: string | null;
  creadaEn: number;
};

export const CONFIGURACION_POR_DEFECTO: Readonly<Omit<ConfiguracionTienda, "reglas"> & { reglas: readonly string[] }> =
  Object.freeze({
    tono: "amable y cercano",
    bienvenida: "¡Hola! ¿En qué te puedo ayudar?",
    horario: null,
    reglas: Object.freeze([]),
  });

type FilaTienda = {
  id: string;
  nombre: string;
  configuracion: string;
  proveedor_ia: string;
  whatsapp_phone_number_id: string | null;
  creada_en: number;
};

const COLUMNAS = "id, nombre, configuracion, proveedor_ia, whatsapp_phone_number_id, creada_en";

/** Interpreta la configuración guardada; cualquier campo ausente o inválido toma su valor por defecto. */
export function leerConfiguracion(json: string): ConfiguracionTienda {
  let crudo: unknown;
  try {
    crudo = JSON.parse(json);
  } catch {
    crudo = {};
  }
  const o = crudo !== null && typeof crudo === "object" ? (crudo as Record<string, unknown>) : {};
  const d = CONFIGURACION_POR_DEFECTO;
  return {
    tono: typeof o.tono === "string" ? o.tono : d.tono,
    bienvenida: typeof o.bienvenida === "string" ? o.bienvenida : d.bienvenida,
    horario: typeof o.horario === "string" ? o.horario : d.horario,
    reglas: Array.isArray(o.reglas) ? o.reglas.filter((r): r is string => typeof r === "string") : [],
  };
}

function aTienda(f: FilaTienda): Tienda {
  return {
    id: f.id,
    nombre: f.nombre,
    configuracion: leerConfiguracion(f.configuracion),
    proveedorIa: f.proveedor_ia,
    whatsappPhoneNumberId: f.whatsapp_phone_number_id,
    creadaEn: f.creada_en,
  };
}

export async function crearTienda(
  db: D1Database,
  datos: { nombre: string; configuracion?: Partial<ConfiguracionTienda>; whatsappPhoneNumberId?: string },
): Promise<Tienda> {
  const id = crypto.randomUUID();
  const configuracion = leerConfiguracion(JSON.stringify(datos.configuracion ?? {}));
  const fila = await db
    .prepare(
      `INSERT INTO tiendas (id, nombre, configuracion, whatsapp_phone_number_id, creada_en)
       VALUES (?, ?, ?, ?, ?) RETURNING ${COLUMNAS}`,
    )
    .bind(id, datos.nombre, JSON.stringify(configuracion), datos.whatsappPhoneNumberId ?? null, Date.now())
    .first<FilaTienda>();
  if (!fila) throw new Error("No se pudo crear la tienda");
  return aTienda(fila);
}

export async function obtenerTienda(db: D1Database, id: string): Promise<Tienda | null> {
  const fila = await db.prepare(`SELECT ${COLUMNAS} FROM tiendas WHERE id = ?`).bind(id).first<FilaTienda>();
  return fila ? aTienda(fila) : null;
}

export async function obtenerTiendaPorWhatsapp(db: D1Database, phoneNumberId: string): Promise<Tienda | null> {
  const fila = await db
    .prepare(`SELECT ${COLUMNAS} FROM tiendas WHERE whatsapp_phone_number_id = ?`)
    .bind(phoneNumberId)
    .first<FilaTienda>();
  return fila ? aTienda(fila) : null;
}
