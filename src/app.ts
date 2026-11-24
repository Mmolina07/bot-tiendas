import { Hono } from "hono";
import type { Env } from "./tipos";

export const app = new Hono<{ Bindings: Env }>();

app.get("/salud", (c) => c.json({ ok: true, servicio: "bot-tiendas" }));

// Ruta solo para pruebas: permite verificar el manejo de errores no controlados.
app.get("/_prueba/error", (c, next) => {
  if (c.env.ENTORNO !== "test") return next();
  throw new Error("prueba");
});

app.notFound((c) => c.json({ error: "No encontrado" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Error interno" }, 500);
});
