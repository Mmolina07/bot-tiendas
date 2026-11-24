import type { DatosEntrada, TipoConocimiento } from "../datos/conocimiento";

// 300 filas = ~22 sentencias de inserción: deja margen dentro del límite de consultas de D1 en el plan gratuito.
export const MAX_FILAS_CSV = 300;
export type ErrorFila = { fila: number; motivo: string }; // fila = número de registro en el archivo (cabecera = 1)

const TIPOS: TipoConocimiento[] = ["faq", "producto", "politica"];
const OBLIGATORIAS = ["tipo", "titulo", "contenido"] as const;

/** Parser CSV (RFC 4180): comillas, "" escapadas, comas y saltos de línea dentro de comillas, \r\n. */
export function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (enComillas) {
      if (ch === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') enComillas = false;
      else campo += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === ",") {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += ch;
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/** "12000", "12.000", "1.250.000", "12,000" y "12000.5" → número; cualquier otra cosa → null. */
function leerPrecio(crudo: string): number | null {
  const t = crudo.trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  if (/^\d+(\.\d{1,2})?$/.test(t)) return Number(t);
  return null;
}

export function csvAEntradas(texto: string): { entradas: DatosEntrada[]; errores: ErrorFila[] } {
  const registros = leerCsv(texto.replace(/^﻿/, ""));
  if (registros.length === 0) return { entradas: [], errores: [{ fila: 1, motivo: "archivo vacío" }] };

  const cabecera = registros[0].map((c) => c.trim().toLowerCase());
  const faltan = OBLIGATORIAS.filter((c) => !cabecera.includes(c));
  if (faltan.length) return { entradas: [], errores: [{ fila: 1, motivo: `faltan columnas: ${faltan.join(", ")}` }] };

  const datos = registros.slice(1).map((r, i) => ({ fila: i + 2, r }));
  const noVacias = datos.filter(({ r }) => r.some((c) => c.trim() !== ""));
  if (noVacias.length > MAX_FILAS_CSV) return { entradas: [], errores: [{ fila: 1, motivo: `máximo ${MAX_FILAS_CSV} filas` }] };

  const col = (r: string[], nombre: string) => {
    const i = cabecera.indexOf(nombre);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };

  const entradas: DatosEntrada[] = [];
  const errores: ErrorFila[] = [];
  for (const { fila, r } of noVacias) {
    const tipo = col(r, "tipo").toLowerCase() as TipoConocimiento;
    const titulo = col(r, "titulo");
    const contenido = col(r, "contenido");
    if (!TIPOS.includes(tipo)) errores.push({ fila, motivo: "tipo inválido" });
    else if (!titulo) errores.push({ fila, motivo: "falta titulo" });
    else if (!contenido) errores.push({ fila, motivo: "falta contenido" });
    else if (tipo !== "producto") entradas.push({ tipo, titulo, contenido, datosProducto: null });
    else {
      const crudo = col(r, "precio");
      const precio = crudo ? leerPrecio(crudo) : null;
      if (crudo && precio === null) errores.push({ fila, motivo: "precio inválido" });
      else
        entradas.push({
          tipo,
          titulo,
          contenido,
          datosProducto:
            precio === null
              ? null
              : { precio, moneda: col(r, "moneda").toUpperCase() || "COP", categoria: col(r, "categoria") || "General" },
        });
    }
  }
  return { entradas, errores };
}
