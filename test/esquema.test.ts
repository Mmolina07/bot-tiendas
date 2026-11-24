import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const db = () => env.DB;
const ahora = 1_700_000_000_000;

async function crearTiendaConHijos(tiendaId: string) {
  await db().batch([
    db().prepare("INSERT INTO tiendas (id, nombre, creada_en) VALUES (?, ?, ?)").bind(tiendaId, "T", ahora),
    db()
      .prepare("INSERT INTO conocimiento (id, tienda_id, tipo, titulo, contenido, actualizado_en) VALUES (?, ?, 'faq', 'a', 'b', ?)")
      .bind(`k-${tiendaId}`, tiendaId, ahora),
    db()
      .prepare("INSERT INTO conversaciones (id, tienda_id, canal, cliente, creada_en, actualizada_en) VALUES (?, ?, 'simulador', 'c1', ?, ?)")
      .bind(`c-${tiendaId}`, tiendaId, ahora, ahora),
    db()
      .prepare("INSERT INTO mensajes (id, conversacion_id, rol, texto, id_externo, creado_en) VALUES (?, ?, 'cliente', 'hola', ?, ?)")
      .bind(`m-${tiendaId}`, `c-${tiendaId}`, `wamid.${tiendaId}`, ahora),
    db()
      .prepare("INSERT INTO preguntas_sin_respuesta (id, tienda_id, conversacion_id, pregunta, creada_en) VALUES (?, ?, ?, '¿?', ?)")
      .bind(`p-${tiendaId}`, tiendaId, `c-${tiendaId}`, ahora),
  ]);
}

describe("esquema", () => {
  it("crea las 5 tablas", async () => {
    const { results } = await db()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all<{ name: string }>();
    const nombres = results.map((r) => r.name);
    for (const t of ["tiendas", "conocimiento", "conversaciones", "mensajes", "preguntas_sin_respuesta"]) {
      expect(nombres).toContain(t);
    }
  });

  it("rechaza id_externo duplicado", async () => {
    await crearTiendaConHijos("t1");
    await expect(
      db()
        .prepare("INSERT INTO mensajes (id, conversacion_id, rol, texto, id_externo, creado_en) VALUES ('m2', 'c-t1', 'cliente', 'x', 'wamid.t1', ?)")
        .bind(ahora)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("borrar tienda borra en cascada", async () => {
    await crearTiendaConHijos("t2");
    await db().prepare("DELETE FROM tiendas WHERE id = ?").bind("t2").run();
    const consultas: Record<string, string> = {
      conocimiento: "SELECT COUNT(*) AS n FROM conocimiento WHERE id = 'k-t2'",
      conversaciones: "SELECT COUNT(*) AS n FROM conversaciones WHERE id = 'c-t2'",
      mensajes: "SELECT COUNT(*) AS n FROM mensajes WHERE id = 'm-t2'",
      preguntas_sin_respuesta: "SELECT COUNT(*) AS n FROM preguntas_sin_respuesta WHERE id = 'p-t2'",
    };
    for (const [tabla, sql] of Object.entries(consultas)) {
      const fila = await db().prepare(sql).first<{ n: number }>();
      expect(fila?.n, tabla).toBe(0);
    }
  });

  it("rechaza tipo de conocimiento inválido", async () => {
    await db().prepare("INSERT INTO tiendas (id, nombre, creada_en) VALUES ('t3', 'T', ?)").bind(ahora).run();
    await expect(
      db()
        .prepare("INSERT INTO conocimiento (id, tienda_id, tipo, titulo, contenido, actualizado_en) VALUES ('k', 't3', 'otro', 'a', 'b', ?)")
        .bind(ahora)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });
});
