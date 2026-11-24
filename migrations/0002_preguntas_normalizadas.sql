-- Texto normalizado (minúsculas, espacios colapsados) para no registrar dos veces la misma pregunta pendiente.
ALTER TABLE preguntas_sin_respuesta ADD COLUMN pregunta_normalizada TEXT;
CREATE INDEX idx_preguntas_normalizada ON preguntas_sin_respuesta(tienda_id, estado, pregunta_normalizada);
