import { describe, expect, it } from "vitest";
import type { EntradaConocimiento } from "../../src/datos/conocimiento";
import type { Tienda } from "../../src/datos/tiendas";
import { construirPromptSistema } from "../../src/nucleo/prompt";

const tienda: Tienda = {
  id: "t",
  nombre: "Tostadero Aurora",
  configuracion: { tono: "cálido", bienvenida: "Hola", horario: "Lunes a sábado 8-19", reglas: ["Regla uno", "Regla dos"] },
  proveedorIa: "gemini",
  whatsappPhoneNumberId: null,
  creadaEn: 0,
};
const base = { tiendaId: "t", actualizadoEn: 0 };
const conocimiento: EntradaConocimiento[] = [
  { ...base, id: "1", tipo: "faq", titulo: "Envíos", contenido: "Enviamos a todo el país", datosProducto: null },
  { ...base, id: "2", tipo: "producto", titulo: "Café Huila", contenido: "Tueste medio", datosProducto: { precio: 12000, moneda: "COP", categoria: "Café" } },
];

describe("nucleo/prompt", () => {
  const p = construirPromptSistema(tienda, conocimiento);

  it("incluye nombre, tono, horario y reglas de la tienda", () => {
    for (const s of ["Tostadero Aurora", "cálido", "Lunes a sábado 8-19", "Regla uno", "Regla dos"]) expect(p).toContain(s);
  });

  it("incluye cada entrada de conocimiento", () => {
    for (const s of ["Envíos", "Enviamos a todo el país", "Café Huila", "Tueste medio", "12.000 COP"]) expect(p).toContain(s);
  });

  it("contiene las reglas de seguridad", () => {
    for (const s of [
      "Responde solo con la información de la tienda que aparece abajo.",
      "Si no tienes la información, dilo con honestidad y sugiere contactar a la tienda; nunca inventes.",
      "Nunca confirmes disponibilidad ni stock.",
      "Responde en español, en mensajes breves como en un chat.",
    ])
      expect(p).toContain(s);
  });
});
