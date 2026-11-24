import { app } from "./app";
import { crearBuscadorDirecto } from "./conocimiento/buscador";
import { type MensajeIndexar, procesarLote } from "./conocimiento/cola";
import type { Env } from "./tipos";

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<MensajeIndexar>, env: Env) => procesarLote(batch, { db: env.DB, buscador: crearBuscadorDirecto(env) }),
} satisfies ExportedHandler<Env, MensajeIndexar>;
