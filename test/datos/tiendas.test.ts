import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  CONFIGURACION_POR_DEFECTO,
  crearTienda,
  leerConfiguracion,
  obtenerTienda,
  obtenerTiendaPorWhatsapp,
} from "../../src/datos/tiendas";

describe("datos/tiendas", () => {
  it("crearTienda y obtenerTienda devuelven lo mismo", async () => {
    const creada = await crearTienda(env.DB, { nombre: "Café Demo", configuracion: { tono: "formal" } });
    const leida = await obtenerTienda(env.DB, creada.id);
    expect(leida).toEqual(creada);
    expect(leida?.nombre).toBe("Café Demo");
    expect(leida?.configuracion.tono).toBe("formal");
    expect(leida?.configuracion.reglas).toEqual([]);
    expect(leida?.proveedorIa).toBe("gemini");
  });

  it("obtenerTienda inexistente → null", async () => {
    expect(await obtenerTienda(env.DB, "no-existe")).toBeNull();
  });

  it("obtenerTiendaPorWhatsapp encuentra por phone_number_id", async () => {
    const numero = `pn-${crypto.randomUUID()}`;
    const creada = await crearTienda(env.DB, { nombre: "WA", whatsappPhoneNumberId: numero });
    expect((await obtenerTiendaPorWhatsapp(env.DB, numero))?.id).toBe(creada.id);
    expect(await obtenerTiendaPorWhatsapp(env.DB, "999-no-existe")).toBeNull();
  });

  it("leerConfiguracion con JSON corrupto → por defecto", () => {
    expect(leerConfiguracion("{no json")).toEqual(CONFIGURACION_POR_DEFECTO);
  });

  it("leerConfiguracion ignora tipos incorrectos", () => {
    const c = leerConfiguracion('{"tono":5,"reglas":"x","horario":"9-18"}');
    expect(c.tono).toBe(CONFIGURACION_POR_DEFECTO.tono);
    expect(c.reglas).toEqual([]);
    expect(c.horario).toBe("9-18");
  });

  it("valores por defecto del diseño", () => {
    expect(CONFIGURACION_POR_DEFECTO).toEqual({
      tono: "amable y cercano",
      bienvenida: "¡Hola! ¿En qué te puedo ayudar?",
      horario: null,
      reglas: [],
    });
  });

  it("las reglas por defecto no se pueden modificar", () => {
    expect(() => (CONFIGURACION_POR_DEFECTO.reglas as string[]).push("x")).toThrow(TypeError);
    expect(CONFIGURACION_POR_DEFECTO.reglas).toEqual([]);
  });
});
