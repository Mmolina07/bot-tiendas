-- Esquema inicial (diseño §7.3 y §7.6). D1 aplica las claves foráneas siempre.

CREATE TABLE tiendas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  configuracion TEXT NOT NULL DEFAULT '{}',
  proveedor_ia TEXT NOT NULL DEFAULT 'gemini',
  whatsapp_phone_number_id TEXT UNIQUE,
  whatsapp_token_cifrado TEXT,
  whatsapp_app_secret_cifrado TEXT,
  creada_en INTEGER NOT NULL
);

CREATE TABLE conocimiento (
  id TEXT PRIMARY KEY,
  tienda_id TEXT NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('faq','producto','politica')),
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  datos_producto TEXT,
  actualizado_en INTEGER NOT NULL
);
CREATE INDEX idx_conocimiento_tienda ON conocimiento(tienda_id);

CREATE TABLE conversaciones (
  id TEXT PRIMARY KEY,
  tienda_id TEXT NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp','simulador')),
  cliente TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'bot' CHECK (estado IN ('bot','requiere_humano')),
  humano_desde INTEGER,
  creada_en INTEGER NOT NULL,
  actualizada_en INTEGER NOT NULL,
  UNIQUE (tienda_id, canal, cliente)
);

CREATE TABLE mensajes (
  id TEXT PRIMARY KEY,
  conversacion_id TEXT NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  rol TEXT NOT NULL CHECK (rol IN ('cliente','bot','humano')),
  texto TEXT NOT NULL,
  id_externo TEXT UNIQUE,
  creado_en INTEGER NOT NULL
);
CREATE INDEX idx_mensajes_conversacion ON mensajes(conversacion_id, creado_en);

CREATE TABLE preguntas_sin_respuesta (
  id TEXT PRIMARY KEY,
  tienda_id TEXT NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
  conversacion_id TEXT REFERENCES conversaciones(id) ON DELETE SET NULL,
  pregunta TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','resuelta')),
  creada_en INTEGER NOT NULL
);
CREATE INDEX idx_preguntas_tienda_estado ON preguntas_sin_respuesta(tienda_id, estado);
