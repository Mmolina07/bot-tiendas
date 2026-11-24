export type MensajeIA = { rol: "cliente" | "bot"; texto: string };
export type EntradaIA = { sistema: string; mensajes: MensajeIA[] };

/** Cualquier modelo de lenguaje que el bot pueda usar (Gemini, Workers AI, uno de pago…). */
export interface ProveedorIA {
  generar(entrada: EntradaIA): Promise<string>;
}

export class ErrorIA extends Error {
  constructor(
    message: string,
    readonly estado?: number,
  ) {
    super(message);
    this.name = "ErrorIA";
  }
}
