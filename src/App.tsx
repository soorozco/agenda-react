import React, { useEffect, useMemo, useRef, useState } from "react";

// ✅ Agenda Telefónica colaborativa (local o remota)
// - Sigue funcionando 100% en modo LOCAL (localStorage)
// - Nuevo modo REMOTO (API REST) usando VITE_API_URL
// - Toggle Local/Remoto en la UI + botón de prueba de conexión
// - Mapeo creado_en (API) ⇄ creadoEn (UI)
// - Mantiene validaciones, import/export y self‑tests

export type Contacto = {
  id: string;
  nombre: string;
  telefono: string;
  email?: string;
  notas?: string;
  creadoEn: string; // ISO
};

const LS_KEY = "agenda_telefonica_contactos_v1";
const API = (import.meta as any).env?.VITE_API_URL as string | undefined; // p.ej. http://localhost:3000 ó https://tu-api.onrender.com

function useLocalStorage<T>(key: string, valorInicial: T) {
  const [valor, setValor] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : valorInicial;
    } catch {
      return valorInicial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(valor));
    } catch {}
  }, [key, valor]);
  return [valor, setValor] as const;
}

function esFechaValidaISO(s: unknown): s is string {
  if (typeof s !== "string" || !s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function toLocaleOrDash(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function validarTelefono(tel: string) {
  const digits = (tel.match(/\d/g) || []).length;
  return digits >= 7;
}

function normalizarTelefono(tel: string) {
  return tel.replace(/[^\d+]/g, "").trim();
}

// 🔌 Utilidades para API remota
async function apiList(q: string) {
  const url = new URL(`${API}/contacts`);
  if (q) url.searchParams.set("q", q);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error("Error listContacts");
  const data = await r.json();
  // Mapeo creado_en → creadoEn
  const mapped: Contacto[] = data.map((x: any) => ({
    id: String(x.id),
    nombre: String(x.nombre),
    telefono: String(x.telefono),
    email: x.email ?? undefined,
    notas: x.notas ?? undefined,
    creadoEn: esFechaValidaISO(x.creado_en) ? String(x.creado_en) : new Date().toISOString(),
  }));
  return mapped;
}
async function apiCreate(body: Partial<Contacto>) {
  const r = await fetch(`${API}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: body.nombre,
      telefono: body.telefono,
      email: body.email ?? null,
      notas: body.notas ?? null,
    }),
  });
  if (!r.ok) throw new Error("Error createContact");
  return apiList("");
}
async function apiUpdate(id: string, body: Partial<Contacto>) {
  const r = await fetch(`${API}/contacts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: body.nombre,
      telefono: body.telefono,
      email: body.email ?? null,
      notas: body.notas ?? null,
    }),
  });
  if (!r.ok) throw new Error("Error updateContact");
  return apiList("");
}
async function apiDelete(id: string) {
  const r = await fetch(`${API}/contacts/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error("Error deleteContact");
  return apiList("");
}
async function apiHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/`);
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j?.ok);
  } catch {
    return false;
  }
}

export default function AgendaTelefonica() {
  // 👇 Toggle de modo: local o remoto. Si hay VITE_API_URL, por defecto REMOTO; si no, LOCAL.
  const defaultModo: "local" | "remoto" = API ? "remoto" : "local";
  const [modo, setModo] = useState<"local" | "remoto">(defaultModo);

  // Estados locales
  const [contactosLocal, setContactosLocal] = useLocalStorage<Contacto[]>(LS_KEY, []);
  const [contactosRemotos, setContactosRemotos] = useState<Contacto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<{ by: keyof Contacto; dir: "asc" | "desc" }>({ by: "nombre", dir: "asc" });
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<{ ok: boolean; detalles: string } | null>(null);
  const [cargandoRemoto, setCargandoRemoto] = useState(false);
  const [saludAPI, setSaludAPI] = useState<"ok" | "fail" | "">("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Formulario controlado
  const [form, setForm] = useState<{ nombre: string; telefono: string; email: string; notas: string }>({
    nombre: "",
    telefono: "",
    email: "",
    notas: "",
  });

  // 🔎 Búsqueda
  const coincide = (c: Contacto, q: string) => {
    const s = q.toLowerCase().trim();
    if (!s) return true;
    return (
      c.nombre.toLowerCase().includes(s) ||
      (c.telefono || "").toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s) ||
      (c.notas || "").toLowerCase().includes(s)
    );
  };

  // 🧹 Normalización en frío para modo local
  useEffect(() => {
    if (modo === "local") {
      setContactosLocal((prev) =>
        prev.map((c) => ({
          ...c,
          creadoEn: esFechaValidaISO(c.creadoEn) ? c.creadoEn : new Date().toISOString(),
          telefono: normalizarTelefono(c.telefono),
        }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  // 🔁 Cargar datos remotos
  useEffect(() => {
    if (modo !== "remoto" || !API) return;
    (async () => {
      try {
        setCargandoRemoto(true);
        const data = await apiList(busqueda);
        setContactosRemotos(data);
      } catch (e) {
        console.error(e);
      } finally {
        setCargandoRemoto(false);
      }
    })();
  }, [modo, busqueda]);

  const contactos = modo === "remoto" ? contactosRemotos : contactosLocal;

  const lista = useMemo(() => {
    const filtrados = contactos.filter((c) => coincide(c, busqueda));
    const sorted = [...filtrados].sort((a, b) => {
      const { by, dir } = orden;
      const av = (a[by] ?? "").toString().toLowerCase();
      const bv = (b[by] ?? "").toString().toLowerCase();
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [contactos, busqueda, orden]);

  const resetForm = () => setForm({ nombre: "", telefono: "", email: "", notas: "" });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nombre = form.nombre.trim();
    const telefono = form.telefono.trim();
    const email = form.email.trim();
    const notas = form.notas.trim();

    if (!nombre) {
      alert("Por favor, escribe el nombre");
      return;
    }
    if (!telefono || !validarTelefono(telefono)) {
      alert("Escribe un teléfono válido (al menos 7 dígitos)");
      return;
    }

    if (modo === "remoto") {
      // Crear/editar remoto
      if (editandoId) {
        await apiUpdate(editandoId, {
          nombre,
          telefono: normalizarTelefono(telefono),
          email: email || undefined,
          notas: notas || undefined,
        });
        const refreshed = await apiList("");
        setContactosRemotos(refreshed);
        setEditandoId(null);
        resetForm();
      } else {
        const refreshed = await apiCreate({
          nombre,
          telefono: normalizarTelefono(telefono),
          email: email || undefined,
          notas: notas || undefined,
        });
        setContactosRemotos(refreshed);
        resetForm();
      }
      return;
    }

    // Modo LOCAL
    if (editandoId) {
      setContactosLocal((prev) =>
        prev.map((c) =>
          c.id === editandoId
            ? {
                ...c,
                nombre,
                telefono: normalizarTelefono(telefono),
                email: email || undefined,
                notas: notas || undefined,
                creadoEn: esFechaValidaISO(c.creadoEn) ? c.creadoEn : new Date().toISOString(),
              }
            : c
        )
      );
      setEditandoId(null);
      resetForm();
    } else {
      const ahoraISO = new Date().toISOString();
      const nuevo: Contacto = {
        id: crypto.randomUUID(),
        nombre,
        telefono: normalizarTelefono(telefono),
        email: email || undefined,
        notas: notas || undefined,
        creadoEn: ahoraISO,
      };
      setContactosLocal((prev) => [nuevo, ...prev]);
      resetForm();
    }
  };

  const onEditar = (c: Contacto) => {
    setEditandoId(c.id);
    setForm({ nombre: c.nombre, telefono: c.telefono, email: c.email || "", notas: c.notas || "" });
  };

  const onCancelarEdicion = () => {
    setEditandoId(null);
    resetForm();
  };

  const onBorrar = async (id: string) => {
    if (!confirm("¿Eliminar este contacto?")) return;

    if (modo === "remoto") {
      await apiDelete(id);
      const refreshed = await apiList("");
      setContactosRemotos(refreshed);
      if (editandoId === id) onCancelarEdicion();
      return;
    }
    setContactosLocal((prev) => prev.filter((c) => c.id !== id));
    if (editandoId === id) onCancelarEdicion();
  };

  const borrarTodo = async () => {
    if (contactos.length === 0) return;
    if (!confirm("Esto eliminará TODOS los contactos de la agenda. ¿Continuar?")) return;

    if (modo === "remoto") {
      // No hay endpoint masivo; se borra uno por uno
      for (const c of contactos) {
        await apiDelete(c.id);
      }
      const refreshed = await apiList("");
      setContactosRemotos(refreshed);
      onCancelarEdicion();
      return;
    }
    setContactosLocal([]);
    onCancelarEdicion();
  };

  const exportarJSON = () => {
    const data = JSON.stringify({ contactos }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agenda_telefonica_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importarJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = reader.result as string;
        const parsed = JSON.parse(raw);

        const sanitizarContactos = (arr: any[]): Contacto[] =>
          arr
            .map((x) => {
              const nombre = String(x?.nombre ?? "").trim();
              const telefono = normalizarTelefono(String(x?.telefono ?? ""));
              const email = x?.email ? String(x.email).trim() : undefined;
              const notas = x?.notas ? String(x.notas).trim() : undefined;
              const creadoEn = esFechaValidaISO(x?.creadoEn) ? String(x.creadoEn) : new Date().toISOString();
              return {
                id: String(x?.id || crypto.randomUUID()),
                nombre,
                telefono,
                email,
                notas,
                creadoEn,
              } as Contacto;
            })
            .filter((c) => c.nombre && validarTelefono(c.telefono));

        if (Array.isArray(parsed)) {
          const saneados = sanitizarContactos(parsed);
          if (modo === "remoto") {
            // Insertar uno por uno en remoto
            for (const c of saneados) {
              await apiCreate(c);
            }
            const refreshed = await apiList("");
            setContactosRemotos(refreshed);
          } else {
            setContactosLocal(saneados);
          }
        } else if (parsed && Array.isArray(parsed.contactos)) {
          const saneados = sanitizarContactos(parsed.contactos);
          if (modo === "remoto") {
            for (const c of saneados) {
              await apiCreate(c);
            }
            const refreshed = await apiList("");
            setContactosRemotos(refreshed);
          } else {
            setContactosLocal(saneados);
          }
        } else {
          alert("Archivo inválido: se esperaba un arreglo de contactos o un objeto con { contactos: [...] }");
        }
      } catch (err) {
        alert("No se pudo leer el archivo JSON");
      }
    };
    reader.readAsText(file);
  };

  const cambiarOrden = (by: keyof Contacto) => {
    setOrden((o) => (o.by === by ? { by, dir: o.dir === "asc" ? "desc" : "asc" } : { by, dir: "asc" }));
  };

  // 🆕 Encabezado reutilizable (antes faltaba y causaba ReferenceError)
  const encabezado = (label: string, by: keyof Contacto) => (
    <th
      scope="col"
      className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 select-none"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:underline decoration-dotted"
        onClick={() => cambiarOrden(by)}
        title={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        {orden.by === by && <span className="text-gray-400">{orden.dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  // 🧪 Auto‑pruebas simples + casos extra
  useEffect(() => {
    try {
      const casos: Array<[string, boolean]> = [
        ["+52 33 1234 5678", true],
        ["123", false],
        ["(33) 12-34-56-78", true],
        ["+1 (212) 555-0000", true],
        ["+--abc", false],
      ];
      const testsTelefono = casos.every(([t, exp]) => validarTelefono(t) === exp);

      const a = [
        { nombre: "Ana", telefono: "33 1234 5678" },
        { nombre: "Luis", telefono: "+52 (55) 5555 5555", creadoEn: "", notas: null },
      ];
      const saneados = a
        .map((x) => ({
          id: String((x as any)?.id || crypto.randomUUID()),
          nombre: String((x as any)?.nombre ?? "").trim(),
          telefono: normalizarTelefono(String((x as any)?.telefono ?? "")),
          email: (x as any)?.email ? String((x as any).email).trim() : undefined,
          notas: (x as any)?.notas ? String((x as any).notas).trim() : undefined,
          creadoEn: esFechaValidaISO((x as any)?.creadoEn) ? String((x as any).creadoEn) : new Date().toISOString(),
        }))
        .filter((c) => c.nombre && validarTelefono(c.telefono));
      const testsSanitizar = Array.isArray(saneados) && saneados.length === 2 && saneados.every((c) => typeof c.creadoEn === "string" && esFechaValidaISO(c.creadoEn));

      setSelfTest({ ok: testsTelefono && testsSanitizar, detalles: testsTelefono && testsSanitizar ? "OK" : "FALLÓ" });
    } catch (e: any) {
      setSelfTest({ ok: false, detalles: e?.message || "Error en self‑tests" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarDatosPrueba = async () => {
    const ahora = new Date();
    const demo: Contacto[] = [
      { id: crypto.randomUUID(), nombre: "María Pérez", telefono: "+523312345678", email: "maria@example.com", notas: "Compras", creadoEn: new Date(ahora.getTime() - 86400000).toISOString() },
      { id: crypto.randomUUID(), nombre: "Carlos López", telefono: "+525512345678", email: undefined, notas: "Soporte", creadoEn: ahora.toISOString() },
    ];

    if (modo === "remoto") {
      for (const c of demo) await apiCreate(c);
      const refreshed = await apiList("");
      setContactosRemotos(refreshed);
    } else {
      // LOCAL
      setContactosLocal(demo);
    }
  };

  const probarConexion = async () => {
    if (!API) {
      setSaludAPI("fail");
      alert("No hay VITE_API_URL configurada");
      return;
    }
    const ok = await apiHealth();
    setSaludAPI(ok ? "ok" : "fail");
    if (!ok) alert("No se pudo conectar a la API. Revisa que esté corriendo y que VITE_API_URL apunte bien.");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">📒 Agenda Telefónica</h1>
            {selfTest && (
              <span className={`text-xs px-2 py-1 rounded-full ${selfTest.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`} title={`Self‑tests: ${selfTest.detalles}`}>
                Self‑tests: {selfTest.ok ? "✅" : "❌"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Modo:</span>
              <button
                className={`px-3 py-2 rounded-xl ${modo === "local" ? "bg-blue-600 text-white" : "bg-gray-200 hover:bg-gray-300"}`}
                onClick={() => setModo("local")}
              >
                Local
              </button>
              <button
                className={`px-3 py-2 rounded-xl ${modo === "remoto" ? "bg-blue-600 text-white" : "bg-gray-200 hover:bg-gray-300"}`}
                onClick={() => setModo("remoto")}
                disabled={!API}
                title={!API ? "Configura VITE_API_URL para activar el modo remoto" : ""}
              >
                Remoto (API)
              </button>
              <button className="px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300" onClick={probarConexion} disabled={!API}>
                Probar conexión
              </button>
              {API && <span className={`text-xs ${saludAPI === "ok" ? "text-green-600" : saludAPI === "fail" ? "text-red-600" : "text-gray-400"}`}>{saludAPI === "ok" ? "API OK" : saludAPI === "fail" ? "API FAIL" : ""}</span>}
            </div>
            <button className="px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-sm" onClick={exportarJSON}>Exportar JSON</button>
            <button className="px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-sm" onClick={() => fileInputRef.current?.click()}>Importar JSON</button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importarJSON(f); if (e.target) e.target.value = ""; }} />
            <button className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 text-sm" onClick={cargarDatosPrueba}>Cargar datos de prueba</button>
            <button className="px-3 py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 text-sm" onClick={borrarTodo}>Borrar todo</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 grid gap-6">
        {/* Buscador */}
        <section className="bg-white rounded-2xl shadow p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, teléfono, email o notas..." className="w-full md:flex-1 px-3 py-2 rounded-xl border focus:outline-none focus:ring" />
            <div className="text-sm text-gray-600 flex items-center gap-2">
              {modo === "remoto" && cargandoRemoto && <span>⏳ Cargando...</span>}
              <span>
                {lista.length} contacto{lista.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </section>

        {/* Formulario de alta / edición */}
        <section className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold mb-3">{editandoId ? "Editar contacto" : "Agregar nuevo contacto"}</h2>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-sm font-medium">Nombre *</label>
              <input className="px-3 py-2 rounded-xl border focus:outline-none focus:ring" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Ej. María Pérez" required />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Teléfono *</label>
              <input className="px-3 py-2 rounded-xl border focus:outline-none focus:ring" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="Ej. +52 33 1234 5678" required />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium">Email</label>
              <input type="email" className="px-3 py-2 rounded-xl border focus:outline-none focus:ring" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Ej. nombre@correo.com" />
            </div>
            <div className="grid gap-1 md:col-span-2">
              <label className="text-sm font-medium">Notas</label>
              <textarea className="px-3 py-2 rounded-xl border focus:outline-none focus:ring min-h-[72px]" value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Datos adicionales, extensión, cumple, relación, etc." />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700">{editandoId ? "Guardar cambios" : "Agregar"}</button>
              {editandoId && (
                <button type="button" className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300" onClick={onCancelarEdicion}>Cancelar</button>
              )}
            </div>
          </form>
        </section>

        {/* Tabla de contactos */}
        <section className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {encabezado("Nombre", "nombre")}
                  {encabezado("Teléfono", "telefono")}
                  {encabezado("Email", "email")}
                  <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Notas</th>
                  {encabezado("Creado", "creadoEn")}
                  <th scope="col" className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lista.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-medium">{c.nombre}</td>
                    <td className="px-4 py-2 text-sm">
                      <a href={`tel:${c.telefono}`} className="underline decoration-dotted" title="Llamar">{c.telefono}</a>
                    </td>
                    <td className="px-4 py-2 text-sm break-all">
                      {c.email ? <a href={`mailto:${c.email}`} className="underline decoration-dotted" title="Enviar correo">{c.email}</a> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700 max-w-[320px] truncate" title={c.notas || ""}>{c.notas || <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{toLocaleOrDash(c.creadoEn)}</td>
                    <td className="px-4 py-2 text-sm">
                      <div className="flex justify-end gap-2">
                        <button className="px-3 py-1 rounded-lg bg-gray-200 hover:bg-gray-300" onClick={() => onEditar(c)}>Editar</button>
                        <button className="px-3 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600" onClick={() => onBorrar(c.id)}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {lista.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No hay contactos. Agrega el primero con el formulario de arriba.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Ayuda rápida */}
        <section className="bg-white rounded-2xl shadow p-4 text-sm text-gray-600">
          <h3 className="font-semibold mb-2">Ayuda rápida</h3>
          <ul className="list-disc ml-5 space-y-1">
            <li>Usa el <b>modo Local</b> para jugar sin servidor. Usa <b>Remoto (API)</b> cuando tengas <code>VITE_API_URL</code> configurada.</li>
            <li>Ejemplo de archivo para importar (formato compatible):
              <pre className="mt-1 p-2 bg-gray-50 rounded-md overflow-auto text-xs">{
                `{"contactos": [ {"id":"...","nombre":"...","telefono":"..."} ]}`
              }</pre>
            </li>
          </ul>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-center text-xs text-gray-400">
        Hecho con ❤️ en React + Tailwind • Modo actual: <b>{modo.toUpperCase()}</b>
      </footer>
    </div>
  );
}



