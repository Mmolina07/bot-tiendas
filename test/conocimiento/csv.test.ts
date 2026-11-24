import { describe, expect, it } from "vitest";
import { csvAEntradas, decodificarCsv, leerCsv, MAX_FILAS_CSV } from "../../src/conocimiento/csv";

const CAB = "tipo,titulo,contenido,precio,moneda,categoria";

describe("conocimiento/csv", () => {
  it("leerCsv maneja comillas, comas, comillas escapadas y saltos dentro de comillas", () => {
    expect(leerCsv('a,"b, c","d ""x""","e\nf"\r\n1,2,3,4')).toEqual([
      ["a", "b, c", 'd "x"', "e\nf"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("csvAEntradas importa productos y FAQ", () => {
    const { entradas, errores } = csvAEntradas(
      [" Tipo , TITULO,contenido,precio,moneda,categoria", "producto,Café,Rico,12.000,,", 'faq,Horario,"8 a 19, lunes a sábado",,,'].join("\n"),
    );
    expect(errores).toEqual([]);
    expect(entradas).toEqual([
      { tipo: "producto", titulo: "Café", contenido: "Rico", datosProducto: { precio: 12000, moneda: "COP", categoria: "General" } },
      { tipo: "faq", titulo: "Horario", contenido: "8 a 19, lunes a sábado", datosProducto: null },
    ]);
  });

  it("acepta precios 12000, 12.000 y 12000.5", () => {
    const { entradas } = csvAEntradas([CAB, "producto,A,a,12000,,", "producto,B,b,1.250.000,USD,X", "producto,C,c,12000.5,,"].join("\n"));
    expect(entradas.map((e) => e.datosProducto?.precio)).toEqual([12000, 1250000, 12000.5]);
    expect(entradas[1].datosProducto).toMatchObject({ moneda: "USD", categoria: "X" });
  });

  it("filas inválidas se reportan con su número y las válidas se importan", () => {
    const { entradas, errores } = csvAEntradas(
      [CAB, "faq,Válida,ok,,,", "otro,X,x,,,", "faq,,sin título,,,", "producto,P,p,abc,,"].join("\n"),
    );
    expect(entradas.map((e) => e.titulo)).toEqual(["Válida"]);
    expect(errores).toEqual([
      { fila: 3, motivo: "tipo inválido" },
      { fila: 4, motivo: "falta titulo" },
      { fila: 5, motivo: "precio inválido" },
    ]);
  });

  it("falta contenido se reporta", () => {
    expect(csvAEntradas([CAB, "faq,T,,,,"].join("\n")).errores).toEqual([{ fila: 2, motivo: "falta contenido" }]);
  });

  it("cabecera sin columnas obligatorias → error en fila 1", () => {
    const r = csvAEntradas("tipo,titulo\nfaq,x");
    expect(r.entradas).toEqual([]);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].fila).toBe(1);
  });

  it("más filas que el máximo → error y sin entradas", () => {
    const filas = Array.from({ length: MAX_FILAS_CSV + 1 }, (_, i) => `faq,T${i},c,,,`);
    const r = csvAEntradas([CAB, ...filas].join("\n"));
    expect(r.entradas).toEqual([]);
    expect(r.errores).toEqual([{ fila: 1, motivo: `máximo ${MAX_FILAS_CSV} filas` }]);
  });

  it("ignora filas vacías y BOM", () => {
    const r = csvAEntradas(`﻿${CAB}\n\nfaq,T,c,,,\n,,,,,\n`);
    expect(r.errores).toEqual([]);
    expect(r.entradas).toHaveLength(1);
  });

  it("una comilla en medio de un campo es literal y no se traga las filas siguientes", () => {
    const r = csvAEntradas([CAB, 'producto,Pantalla 15",Monitor,500000,,', "faq,A,a,,,", "faq,B,b,,,"].join("\n"));
    expect(r.errores).toEqual([]);
    expect(r.entradas.map((e) => e.titulo)).toEqual(['Pantalla 15"', "A", "B"]);
  });

  it("comillas sin cerrar → error en su fila y se importan las anteriores", () => {
    const r = csvAEntradas([CAB, "faq,A,a,,,", 'faq,"B sin cerrar,b,,,', "faq,C,c,,,"].join("\n"));
    expect(r.entradas.map((e) => e.titulo)).toEqual(["A"]);
    expect(r.errores).toEqual([{ fila: 3, motivo: "comillas sin cerrar" }]);
  });

  it("detecta el separador ; de Excel en español", () => {
    const r = csvAEntradas(["tipo;titulo;contenido;precio;moneda;categoria", "producto;Café;Rico, suave;12.000;;", "faq;Horario;8 a 19;;;"].join("\n"));
    expect(r.errores).toEqual([]);
    expect(r.entradas.map((e) => [e.titulo, e.contenido])).toEqual([["Café", "Rico, suave"], ["Horario", "8 a 19"]]);
  });

  it("decodificarCsv acepta UTF-8 y Windows-1252", () => {
    expect(decodificarCsv(new TextEncoder().encode("Café"))).toBe("Café");
    expect(decodificarCsv(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
});
