import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { simulador } from "./canales/simulador";
import type { Env } from "./tipos";

export const app = new Hono<{ Bindings: Env }>();

app.get("/salud", (c) => c.json({ ok: true, servicio: "bot-tiendas" }));

app.route("/api/simulador", simulador);

// Ruta solo para pruebas: permite verificar el manejo de errores no controlados.
app.get("/_prueba/error", (c, next) => {
  if (c.env.ENTORNO !== "test") return next();
  throw new Error("prueba");
});

app.get("/_prueba/no-autorizado", (c, next) => {
  if (c.env.ENTORNO !== "test") return next();
  throw new HTTPException(401, { message: "No autorizado" });
});

app.notFound((c) => c.json({ error: "No encontrado" }, 404));

app.onError((err, c) => {
  // Errores esperados (auth, validación, tamaño…): se respeta su estado.
  // Si el middleware trae su propia respuesta (p. ej. con WWW-Authenticate), se usa tal cual.
  if (err instanceof HTTPException) {
    return err.res ? err.getResponse() : c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Error interno" }, 500);
});
