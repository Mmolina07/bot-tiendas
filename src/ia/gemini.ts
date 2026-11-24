import { ErrorIA, type EntradaIA, type ProveedorIA } from "./proveedor";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type RespuestaGemini = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
};

export function crearProveedorGemini(op: { apiKey: string; modelo: string; fetch?: typeof fetch }): ProveedorIA {
  const pedir = op.fetch ?? fetch;
  return {
    async generar(entrada: EntradaIA): Promise<string> {
      let r: Response;
      try {
        r = await pedir(`${BASE}/${op.modelo}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": op.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: entrada.sistema }] },
            contents: entrada.mensajes.map((m) => ({
              role: m.rol === "cliente" ? "user" : "model",
              parts: [{ text: m.texto }],
            })),
            // Sin razonamiento interno: en los modelos 2.5 esos tokens cuentan contra maxOutputTokens.
            generationConfig: { temperature: 0.3, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
          }),
        });
      } catch (e) {
        throw new ErrorIA(`Fallo de red con Gemini: ${(e as Error).message}`);
      }
      if (!r.ok) throw new ErrorIA(`Gemini respondió ${r.status}`, r.status);

      const datos = (await r.json().catch(() => ({}))) as RespuestaGemini;
      const candidato = datos.candidates?.[0];
      // Una respuesta cortada a la mitad es peor que ninguna: se trata como fallo.
      if (candidato?.finishReason === "MAX_TOKENS") throw new ErrorIA("Gemini cortó la respuesta por límite de tokens");
      const texto = (candidato?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (!texto) throw new ErrorIA("Gemini no devolvió texto");
      return texto;
    },
  };
}
