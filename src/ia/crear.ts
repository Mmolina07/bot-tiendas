import type { Env } from "../tipos";
import { crearProveedorGemini } from "./gemini";
import type { ProveedorIA } from "./proveedor";

/** Elige el proveedor de IA según la configuración. Por ahora siempre Gemini (respaldo con Workers AI en la fase 5). */
export function crearProveedorIA(env: Env): ProveedorIA {
  return crearProveedorGemini({ apiKey: env.GEMINI_API_KEY, modelo: env.GEMINI_MODELO });
}
