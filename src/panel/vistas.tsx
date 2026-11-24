import type { Child } from "hono/jsx";
import type { EntradaConocimiento, TipoConocimiento } from "../datos/conocimiento";
import type { Pregunta } from "../datos/preguntas";
import type { Tienda } from "../datos/tiendas";
import { formatearMiles } from "../nucleo/prompt";

// CSS estático (no contiene datos), por eso se inserta sin escapar.
const CSS = `
:root { --fondo:#f6f4f0; --superficie:#fff; --texto:#1d2a26; --suave:#5f6f6a; --borde:#ddd6cc; --acento:#0b6e5f; --peligro:#b3261e; --aviso:#e7f4ee; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fondo:#0f1513; --superficie:#18211e; --texto:#e7eeec; --suave:#9fb2ac; --borde:#2b3834; --acento:#2bb58f; --peligro:#f2867d; --aviso:#163029; } }
:root[data-theme="dark"] { --fondo:#0f1513; --superficie:#18211e; --texto:#e7eeec; --suave:#9fb2ac; --borde:#2b3834; --acento:#2bb58f; --peligro:#f2867d; --aviso:#163029; }
* { box-sizing: border-box; }
body { margin:0; background:var(--fondo); color:var(--texto); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
main { max-width:960px; margin:0 auto; padding:16px; }
header.barra { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
h1 { font-size:22px; margin:0; } h2 { font-size:17px; margin:0 0 12px; }
.suave { color:var(--suave); font-size:13px; }
section { background:var(--superficie); border:1px solid var(--borde); border-radius:12px; padding:16px; margin-bottom:16px; }
.aviso { background:var(--aviso); border-radius:10px; padding:10px 14px; margin-bottom:16px; }
.error { color:var(--peligro); font-weight:600; }
label { display:block; font-size:13px; font-weight:600; margin:10px 0 4px; }
input, select, textarea { width:100%; padding:8px 10px; border:1px solid var(--borde); border-radius:8px; background:var(--fondo); color:var(--texto); font:inherit; }
textarea { min-height:90px; resize:vertical; }
.fila { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:0 12px; }
button { margin-top:12px; padding:8px 14px; border:none; border-radius:8px; background:var(--acento); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
button.secundario { background:transparent; color:var(--acento); border:1px solid var(--acento); margin-top:0; }
button.peligro { background:transparent; color:var(--peligro); border:1px solid var(--peligro); margin-top:0; padding:4px 10px; }
.pregunta { border-top:1px solid var(--borde); padding:12px 0; }
.pregunta:first-of-type { border-top:none; padding-top:0; }
.tabla { width:100%; border-collapse:collapse; }
.tabla td, .tabla th { text-align:left; vertical-align:top; padding:8px 6px; border-top:1px solid var(--borde); }
.tabla th { font-size:13px; color:var(--suave); }
.acciones { display:flex; gap:8px; align-items:center; white-space:nowrap; }
.acciones form { margin:0; }
.chip { display:inline-block; font-size:12px; padding:1px 8px; border-radius:999px; border:1px solid var(--borde); color:var(--suave); }
a { color:var(--acento); }
@media (max-width:640px) { .tabla thead { display:none; } .tabla tr { display:block; border-top:1px solid var(--borde); padding:8px 0; } .tabla td { display:block; border:none; padding:2px 0; } }
`;

const TIPOS: { valor: TipoConocimiento; nombre: string }[] = [
  { valor: "faq", nombre: "Pregunta frecuente" },
  { valor: "politica", nombre: "Política" },
  { valor: "producto", nombre: "Producto" },
];
const nombreTipo = (t: TipoConocimiento) => TIPOS.find((x) => x.valor === t)?.nombre ?? t;

export function Layout(props: { titulo: string; children: Child }) {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.titulo}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

function CamposEntrada(props: { e?: Partial<EntradaConocimiento> }) {
  const e = props.e ?? {};
  const p = e.datosProducto;
  return (
    <>
      <label for="tipo">Tipo</label>
      <select id="tipo" name="tipo">
        {TIPOS.map((t) => (
          <option value={t.valor} selected={e.tipo === t.valor}>
            {t.nombre}
          </option>
        ))}
      </select>
      <label for="titulo">Título</label>
      <input id="titulo" name="titulo" required maxlength={200} value={e.titulo ?? ""} />
      <label for="contenido">Contenido</label>
      <textarea id="contenido" name="contenido" required maxlength={4000}>
        {e.contenido ?? ""}
      </textarea>
      <p class="suave">Solo para productos (opcional):</p>
      <div class="fila">
        <div>
          <label for="precio">Precio</label>
          <input id="precio" name="precio" inputmode="decimal" value={p ? String(p.precio) : ""} />
        </div>
        <div>
          <label for="moneda">Moneda</label>
          <input id="moneda" name="moneda" maxlength={3} value={p?.moneda ?? "COP"} />
        </div>
        <div>
          <label for="categoria">Categoría</label>
          <input id="categoria" name="categoria" maxlength={80} value={p?.categoria ?? ""} />
        </div>
      </div>
    </>
  );
}

export function PaginaPanel(props: {
  tienda: Tienda;
  preguntas: Pregunta[];
  conocimiento: EntradaConocimiento[];
  aviso?: string;
  error?: string;
}) {
  const { tienda, preguntas, conocimiento } = props;
  const base = `/panel/${encodeURIComponent(tienda.id)}`;
  return (
    <Layout titulo={`Panel — ${tienda.nombre}`}>
      <header class="barra">
        <div>
          <h1>{tienda.nombre}</h1>
          <span class="suave">Panel de la tienda · {conocimiento.length} entradas de conocimiento</span>
        </div>
        <form method="post" action={`${base}/reindexar`}>
          <button class="secundario" type="submit">
            Reindexar todo
          </button>
        </form>
      </header>

      {props.aviso && <p class="aviso">{props.aviso}</p>}
      {props.error && <p class="aviso error">{props.error}</p>}

      <section>
        <h2>Preguntas sin respuesta ({preguntas.length})</h2>
        {preguntas.length === 0 && <p class="suave">No hay preguntas pendientes. El bot está respondiendo todo 🎉</p>}
        {preguntas.map((p) => (
          <div class="pregunta">
            <strong>{p.pregunta}</strong>
            <div class="suave">{new Date(p.creadaEn).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</div>
            <form method="post" action={`${base}/preguntas/${encodeURIComponent(p.id)}/resolver`}>
              <label for={`r-${p.id}`}>Respuesta (se guarda como pregunta frecuente)</label>
              <textarea id={`r-${p.id}`} name="respuesta" required maxlength={4000} />
              <button type="submit">Enseñar al bot</button>
            </form>
          </div>
        ))}
      </section>

      <section>
        <h2>Agregar conocimiento</h2>
        <form method="post" action={`${base}/conocimiento`}>
          <CamposEntrada />
          <button type="submit">Agregar</button>
        </form>
      </section>

      <section>
        <h2>Importar CSV</h2>
        <p class="suave">
          Columnas: <code>tipo,titulo,contenido,precio,moneda,categoria</code>. El tipo es faq, politica o producto. Máximo
          300 filas.
        </p>
        <form method="post" action={`${base}/importar`} enctype="multipart/form-data">
          <label for="archivo">Archivo .csv</label>
          <input id="archivo" name="archivo" type="file" accept=".csv,text/csv" />
          <label for="csv">…o pega el contenido</label>
          <textarea id="csv" name="csv" />
          <button type="submit">Importar</button>
        </form>
      </section>

      <section>
        <h2>Conocimiento</h2>
        <table class="tabla">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Título y contenido</th>
              <th>Precio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {conocimiento.map((e) => (
              <tr>
                <td>
                  <span class="chip">{nombreTipo(e.tipo)}</span>
                </td>
                <td>
                  <strong>{e.titulo}</strong>
                  <div class="suave">{e.contenido}</div>
                </td>
                <td>{e.datosProducto ? `${formatearMiles(e.datosProducto.precio)} ${e.datosProducto.moneda}` : ""}</td>
                <td>
                  <div class="acciones">
                    <a href={`${base}/conocimiento/${encodeURIComponent(e.id)}/editar`}>Editar</a>
                    <form
                      method="post"
                      action={`${base}/conocimiento/${encodeURIComponent(e.id)}/borrar`}
                      onsubmit="return confirm('¿Borrar esta entrada?')"
                    >
                      <button class="peligro" type="submit">
                        Borrar
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}

export function PaginaEditar(props: { tienda: Tienda; entrada: EntradaConocimiento; error?: string }) {
  const base = `/panel/${encodeURIComponent(props.tienda.id)}`;
  return (
    <Layout titulo={`Editar — ${props.tienda.nombre}`}>
      <p>
        <a href={base}>← Volver al panel</a>
      </p>
      {props.error && <p class="aviso error">{props.error}</p>}
      <section>
        <h2>Editar conocimiento</h2>
        <form method="post" action={`${base}/conocimiento/${encodeURIComponent(props.entrada.id)}`}>
          <CamposEntrada e={props.entrada} />
          <button type="submit">Guardar</button>
        </form>
      </section>
    </Layout>
  );
}

export function PaginaNoEncontrada() {
  return (
    <Layout titulo="No encontrado">
      <h1>No encontrado</h1>
      <p class="suave">La tienda o la entrada no existe.</p>
    </Layout>
  );
}
