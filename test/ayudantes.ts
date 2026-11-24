import { env } from "cloudflare:workers";
import semilla from "../semillas/tienda-demo.sql?raw";

/** Divide el SQL de la semilla en sentencias (una por línea terminada en ';', ignorando comentarios). */
export function sentenciasSemilla(): string[] {
  return semilla
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
}

export async function cargarSemilla(): Promise<void> {
  await env.DB.batch(sentenciasSemilla().map((s) => env.DB.prepare(s)));
}
