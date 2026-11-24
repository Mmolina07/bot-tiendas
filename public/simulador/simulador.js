// Simulador de chat: habla con /api/simulador. Todo el texto se pinta con textContent (la IA es texto no confiable).
(() => {
  const API = "/api/simulador";
  const lista = document.getElementById("mensajes");
  const form = document.getElementById("formulario");
  const entrada = document.getElementById("entrada");
  const boton = document.getElementById("enviar");
  const nombre = document.getElementById("nombre-tienda");
  const estado = document.getElementById("estado");

  function agregar(rol, texto) {
    const li = document.createElement("li");
    li.className = `burbuja ${rol === "cliente" ? "cliente" : rol === "aviso" ? "aviso" : "bot"}`;
    li.textContent = texto;
    lista.appendChild(li);
    lista.scrollTop = lista.scrollHeight;
    return li;
  }

  function mostrarEscribiendo() {
    const li = document.createElement("li");
    li.className = "burbuja bot escribiendo";
    li.setAttribute("aria-label", "escribiendo");
    for (let i = 0; i < 3; i++) li.appendChild(document.createElement("span"));
    lista.appendChild(li);
    lista.scrollTop = lista.scrollHeight;
    estado.textContent = "escribiendo…";
    return () => {
      li.remove();
      estado.textContent = "en línea";
    };
  }

  async function iniciar() {
    try {
      const r = await fetch(`${API}/inicio`, { credentials: "include" });
      const datos = await r.json();
      if (!r.ok) {
        nombre.textContent = "Demo no disponible";
        agregar("aviso", datos.error || "La demo no está disponible ahora.");
        return;
      }
      nombre.textContent = datos.tienda.nombre;
      document.title = `Chat — ${datos.tienda.nombre}`;
      agregar("bot", datos.tienda.bienvenida);
      for (const m of datos.mensajes) agregar(m.rol, m.texto);
    } catch {
      nombre.textContent = "Sin conexión";
      agregar("aviso", "Sin conexión, intenta de nuevo");
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const texto = entrada.value.trim();
    if (!texto || boton.disabled) return;
    agregar("cliente", texto);
    entrada.value = "";
    boton.disabled = true;
    const ocultar = mostrarEscribiendo();
    try {
      const r = await fetch(`${API}/mensaje`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      const datos = await r.json().catch(() => ({}));
      ocultar();
      agregar("bot", r.ok ? datos.respuesta : datos.error || "Algo salió mal, intenta de nuevo");
    } catch {
      ocultar();
      agregar("aviso", "Sin conexión, intenta de nuevo");
    } finally {
      boton.disabled = false;
      entrada.focus();
    }
  });

  iniciar();
})();
