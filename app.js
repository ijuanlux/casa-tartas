// La Casa de las Tartas — app.js
// SPA mínima: login (Supabase auth) + CRUD de cierres + admin.

const cfg = window.CASA_TARTAS_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("TU-PROYECTO") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("TU-ANON");
if (!configured) {
  console.warn("config.js no configurado — la app está en modo preview, el login no funcionará todavía.");
  const banner = document.createElement("div");
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#fdf1e3;color:#b95b00;font:14px -apple-system,sans-serif;text-align:center;z-index:9999;border-bottom:1px solid #e7d3b8;";
  banner.textContent = "⚠ Modo preview: edita config.js con tu URL y anon key de Supabase para activar el login.";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(banner));
}
const sb = window.supabase.createClient(
  cfg.SUPABASE_URL || "https://placeholder.supabase.co",
  cfg.SUPABASE_ANON_KEY || "placeholder"
);

// ===== Estado =====
let me = null;            // { id, email, profile: { role, full_name } }
let locales = [];
let currentCierres = [];

// ===== Helpers =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmtMoney = (n) => (Number(n || 0)).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const todayISO = () => new Date().toISOString().slice(0, 10);

// ===== Cola offline =====
const QUEUE_KEY = "casa_tartas_pending_cierres";

function queueLoad() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}
function queueSave(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
function queueAdd(payload) {
  const q = queueLoad();
  payload._localId = `local-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  payload._created = new Date().toISOString();
  q.push(payload);
  queueSave(q);
  updateConnBadge();
  return payload._localId;
}
function queueRemove(localId) {
  const q = queueLoad().filter(p => p._localId !== localId);
  queueSave(q);
  updateConnBadge();
}
function queueCount() { return queueLoad().length; }

function isNetworkError(err) {
  if (!err) return false;
  const m = (err.message || "").toLowerCase();
  return m.includes("failed to fetch") || m.includes("network") || m.includes("load failed") || !navigator.onLine;
}

async function flushQueue() {
  if (!me) return;
  const q = queueLoad();
  if (!q.length) return;
  for (const p of q) {
    try {
      const { data: cierre, error } = await sb.from("cierres").insert({
        fecha: p.fecha, local_id: p.local_id, tot_facturas: p.tot_facturas,
        tot_suministros: p.tot_suministros || 0,
        tarjetas: p.tarjetas, efectivo: p.efectivo, pagos_banco: p.pagos_banco || 0,
        notas: p.notas, user_id: me.id
      }).select().single();
      if (error) throw error;
      if (p._facturas && p._facturas.length) {
        const rows = p._facturas.map(f => ({ ...f, cierre_id: cierre.id }));
        const { error: fe } = await sb.from("facturas").insert(rows);
        if (fe) console.warn("flush facturas error", fe);
      }
      if (p._suministros && p._suministros.length) {
        const rows = p._suministros.map(s => ({ ...s, cierre_id: cierre.id }));
        const { error: se } = await sb.from("suministros").insert(rows);
        if (se) console.warn("flush suministros error", se);
      }
      queueRemove(p._localId);
    } catch (e) {
      if (isNetworkError(e)) break; // sigue offline; intentar más tarde
      console.warn("flush failed for", p._localId, e);
      // error no-red (validación, RLS, etc): conservar y dejar para revisión manual
      break;
    }
  }
  // Refresca histórico si estamos en esa pestaña
  if (!$("#tab-historico").hidden) loadHistorico();
}

function updateConnBadge() {
  const badge = $("#conn-badge");
  if (!badge) return;
  const n = queueCount();
  if (!navigator.onLine) {
    badge.textContent = n ? `Sin red · ${n} pendientes` : "Sin red";
    badge.className = "conn-badge off";
    badge.hidden = false;
  } else if (n) {
    badge.textContent = `${n} sin sincronizar`;
    badge.className = "conn-badge pending";
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

window.addEventListener("online",  () => { updateConnBadge(); flushQueue(); });
window.addEventListener("offline", updateConnBadge);

function show(view) {
  $("#view-login").hidden = view !== "login";
  $("#view-app").hidden = view !== "app";
}

function setTab(tab) {
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $("#tab-nuevo").hidden = tab !== "nuevo";
  $("#tab-historico").hidden = tab !== "historico";
  $("#tab-admin").hidden = tab !== "admin";
  if (tab === "historico") loadHistorico();
  if (tab === "admin")    loadAdmin();
}

// ===== Auth =====
async function bootstrapAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) await onLogin(data.session.user);
  else show("login");

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      me = null;
      show("login");
    }
  });
}

async function onLogin(user) {
  // Cargar perfil
  const { data: prof, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (error) {
    console.warn("profile error", error);
  }
  me = { id: user.id, email: user.email, profile: prof || { role: "usuario", full_name: user.email } };
  $("#user-name").textContent = me.profile.full_name || me.email;
  $$(".admin-only").forEach(el => el.hidden = me.profile.role !== "admin");

  await loadLocales();
  show("app");
  setTab("nuevo");
  initCierreForm();
  updateConnBadge();
  flushQueue();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const errBox = $("#login-error");
  errBox.hidden = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errBox.textContent = error.message;
    errBox.hidden = false;
    return;
  }
  window.dispatchEvent(new CustomEvent("casa:login-success"));
  await onLogin(data.user);
});

$("#logout").addEventListener("click", async () => {
  await sb.auth.signOut();
});

// ===== Tabs =====
$$(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

// ===== Locales =====
async function loadLocales() {
  const { data, error } = await sb.from("locales").select("*").eq("activo", true).order("nombre");
  if (error) { console.error(error); return; }
  locales = data;
  const opts = locales.map(l => `<option value="${l.id}">${l.nombre}</option>`).join("");
  $("#f-local").innerHTML = opts;
  $("#filter-local").innerHTML = `<option value="">Todos</option>` + opts;
}

// ===== Form cierre =====
function initCierreForm() {
  $("#f-fecha").value = todayISO();
  $("#facturas-list").innerHTML = "";
  addFacturaRow();
  $("#suministros-list").innerHTML = "";
  addSuministroRow();
  $("#f-pagos-banco").value = "0";
  recomputeTotales();
  $("#cierre-msg").hidden = true;
  $("#cuadre-msg").hidden = true;
}

function addFacturaRow(desc = "", imp = "") {
  const row = document.createElement("div");
  row.className = "factura-row";
  row.innerHTML = `
    <input type="text" class="f-desc" placeholder="Descripción (opcional)" value="${desc}" />
    <input type="number" class="f-imp" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${imp}" />
    <button type="button" class="remove" title="Quitar">×</button>
  `;
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    recomputeTotales();
  });
  row.querySelector(".f-imp").addEventListener("input", recomputeTotales);
  $("#facturas-list").appendChild(row);
}

$("#add-factura").addEventListener("click", () => addFacturaRow());

function addSuministroRow(desc = "", imp = "") {
  const row = document.createElement("div");
  row.className = "factura-row";
  row.innerHTML = `
    <input type="text" class="s-desc" placeholder="Ej: Internet, Teléfono..." value="${desc}" />
    <input type="number" class="s-imp" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${imp}" />
    <button type="button" class="remove" title="Quitar">×</button>
  `;
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    recomputeTotales();
  });
  row.querySelector(".s-imp").addEventListener("input", recomputeTotales);
  $("#suministros-list").appendChild(row);
}
$("#add-suministro").addEventListener("click", () => addSuministroRow());

function recomputeTotales() {
  let tot = 0;
  $$("#facturas-list .f-imp").forEach(i => { tot += Number(i.value || 0); });
  $("#f-tot-facturas").value = tot.toFixed(2);
  let totSum = 0;
  $$("#suministros-list .s-imp").forEach(i => { totSum += Number(i.value || 0); });
  $("#f-tot-suministros").value = totSum.toFixed(2);
  const tarj = Number($("#f-tarjetas").value || 0);
  const efec = Number($("#f-efectivo").value || 0);
  const caja = tot + tarj + efec;
  $("#f-tot-caja").value = caja.toFixed(2);

  // Desglose del total (suma de las tres partes, sin restas)
  const msg = $("#cuadre-msg");
  if (caja === 0) {
    msg.hidden = true;
  } else {
    msg.textContent = `Facturas ${fmtMoney(tot)} + Tarjetas ${fmtMoney(tarj)} + Efectivo ${fmtMoney(efec)} = ${fmtMoney(caja)}`;
    msg.className = "cuadre ok";
    msg.hidden = false;
  }
}

$("#f-tarjetas").addEventListener("input", recomputeTotales);
$("#f-efectivo").addEventListener("input", recomputeTotales);
$("#reset-form").addEventListener("click", () => setTimeout(initCierreForm, 0));

$("#cierre-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#cierre-msg");
  msg.hidden = true;

  const fecha = $("#f-fecha").value;
  const local_id = Number($("#f-local").value);
  const tarjetas = Number($("#f-tarjetas").value || 0);
  const efectivo = Number($("#f-efectivo").value || 0);
  const pagos_banco = Number($("#f-pagos-banco").value || 0);
  const tot_facturas = Number($("#f-tot-facturas").value || 0);
  const tot_suministros = Number($("#f-tot-suministros").value || 0);
  const notas = $("#f-notas").value.trim() || null;

  const facturas = [];
  $$("#facturas-list .factura-row").forEach((row, idx) => {
    const desc = row.querySelector(".f-desc").value.trim();
    const imp = Number(row.querySelector(".f-imp").value || 0);
    if (imp > 0) facturas.push({ descripcion: desc || null, importe: imp, orden: idx });
  });

  const suministros = [];
  $$("#suministros-list .factura-row").forEach((row, idx) => {
    const desc = row.querySelector(".s-desc").value.trim();
    const imp = Number(row.querySelector(".s-imp").value || 0);
    if (imp > 0) suministros.push({ descripcion: desc || null, importe: imp, orden: idx });
  });

  // Si no hay red, ir directo a la cola
  if (!navigator.onLine) {
    queueAdd({ fecha, local_id, tot_facturas, tot_suministros, tarjetas, efectivo, pagos_banco, notas, _facturas: facturas, _suministros: suministros });
    initCierreForm();
    msg.textContent = "✓ Guardado localmente — se sincronizará al volver la conexión";
    msg.className = "msg ok";
    msg.hidden = false;
    return;
  }

  try {
    const { data: cierre, error } = await sb.from("cierres").insert({
      fecha, local_id, tot_facturas, tot_suministros, tarjetas, efectivo, pagos_banco, notas, user_id: me.id
    }).select().single();
    if (error) throw error;

    if (facturas.length) {
      const rows = facturas.map(f => ({ ...f, cierre_id: cierre.id }));
      const { error: fe } = await sb.from("facturas").insert(rows);
      if (fe) {
        msg.textContent = "Cierre guardado, pero falló alguna factura: " + fe.message;
        msg.className = "msg err";
        msg.hidden = false;
        return;
      }
    }

    if (suministros.length) {
      const rows = suministros.map(s => ({ ...s, cierre_id: cierre.id }));
      const { error: se } = await sb.from("suministros").insert(rows);
      if (se) {
        msg.textContent = "Cierre guardado, pero falló algún suministro: " + se.message;
        msg.className = "msg err";
        msg.hidden = false;
        return;
      }
    }

    initCierreForm();
    msg.textContent = "✓ Cierre guardado correctamente";
    msg.className = "msg ok";
    msg.hidden = false;
  } catch (e) {
    if (isNetworkError(e)) {
      queueAdd({ fecha, local_id, tot_facturas, tot_suministros, tarjetas, efectivo, pagos_banco, notas, _facturas: facturas, _suministros: suministros });
      initCierreForm();
      msg.textContent = "✓ Guardado localmente — se sincronizará al volver la conexión";
      msg.className = "msg ok";
      msg.hidden = false;
    } else {
      msg.textContent = "Error: " + (e.message || e);
      msg.className = "msg err";
      msg.hidden = false;
    }
  }
});

// ===== Histórico =====
async function loadHistorico() {
  const from = $("#filter-from").value || null;
  const to   = $("#filter-to").value || null;
  const local = $("#filter-local").value || null;

  let q = sb.from("cierres")
    .select("id, fecha, local_id, tot_facturas, tarjetas, efectivo, tot_caja, pagos_banco, tot_suministros, notas, user_id, locales(nombre), profiles(full_name)")
    .order("fecha", { ascending: false })
    .limit(500);

  if (from) q = q.gte("fecha", from);
  if (to)   q = q.lte("fecha", to);
  if (local) q = q.eq("local_id", Number(local));

  let loadErr = null;
  try {
    const { data, error } = await q;
    if (error) throw error;
    currentCierres = data || [];
  } catch (e) {
    console.warn("loadHistorico failed", e);
    loadErr = e;
    currentCierres = [];
  }
  renderHistorico();
  if (loadErr) {
    $("#summary").innerHTML = `<span class="hist-error">⚠ No se pudo cargar el histórico: ${loadErr.message || loadErr}</span>`;
  }
}

function renderHistorico() {
  const tbody = $("#historico-table tbody");
  const pending = queueLoad();
  const pendingRows = pending.map(p => {
    const localNombre = locales.find(l => l.id === Number(p.local_id))?.nombre ?? "";
    const totCaja = Number(p.tot_facturas || 0) + Number(p.tarjetas || 0) + Number(p.efectivo || 0);
    return `
      <tr class="pending" data-local-id="${p._localId}">
        <td>${p.fecha}</td>
        <td>${localNombre}</td>
        <td class="num">${fmtMoney(p.tot_facturas)}</td>
        <td class="num">${fmtMoney(p.tarjetas)}</td>
        <td class="num">${fmtMoney(p.efectivo)}</td>
        <td class="num"><strong>${fmtMoney(totCaja)}</strong></td>
        <td class="num">${fmtMoney(p.pagos_banco || 0)}</td>
        <td class="num">${fmtMoney(p.tot_suministros || 0)}</td>
        <td>${me?.profile?.full_name ?? ""} (pendiente)</td>
        <td>—</td>
      </tr>`;
  }).join("");

  const rows = currentCierres.map(c => `
    <tr class="clickable" data-id="${c.id}">
      <td>${c.fecha}</td>
      <td>${c.locales?.nombre ?? ""}</td>
      <td class="num">${fmtMoney(c.tot_facturas)}</td>
      <td class="num">${fmtMoney(c.tarjetas)}</td>
      <td class="num">${fmtMoney(c.efectivo)}</td>
      <td class="num"><strong>${fmtMoney(c.tot_caja)}</strong></td>
      <td class="num">${fmtMoney(c.pagos_banco || 0)}</td>
      <td class="num">${fmtMoney(c.tot_suministros || 0)}</td>
      <td>${c.profiles?.full_name ?? ""}</td>
      <td>→</td>
    </tr>
  `).join("");

  tbody.innerHTML = pendingRows + rows;
  tbody.querySelectorAll("tr.clickable").forEach(tr => {
    tr.addEventListener("click", () => openDetalle(Number(tr.dataset.id)));
  });

  // Resumen (incluye pendientes para que cuadre con lo que ella ve)
  const allCierres = [
    ...currentCierres,
    ...pending.map(p => ({
      tot_facturas: Number(p.tot_facturas || 0),
      tarjetas: Number(p.tarjetas || 0),
      efectivo: Number(p.efectivo || 0),
      tot_caja: Number(p.tot_facturas || 0) + Number(p.tarjetas || 0) + Number(p.efectivo || 0),
      pagos_banco: Number(p.pagos_banco || 0),
      tot_suministros: Number(p.tot_suministros || 0)
    }))
  ];
  const totF = allCierres.reduce((s, c) => s + Number(c.tot_facturas), 0);
  const totT = allCierres.reduce((s, c) => s + Number(c.tarjetas), 0);
  const totE = allCierres.reduce((s, c) => s + Number(c.efectivo), 0);
  const totC = allCierres.reduce((s, c) => s + Number(c.tot_caja), 0);
  const totP = allCierres.reduce((s, c) => s + Number(c.pagos_banco || 0), 0);
  const totS = allCierres.reduce((s, c) => s + Number(c.tot_suministros || 0), 0);
  const pendingLabel = pending.length ? ` (${pending.length} pendientes)` : "";
  $("#summary").innerHTML = `
    <span>${allCierres.length} cierres${pendingLabel}</span>
    <span>Facturas: <strong>${fmtMoney(totF)}</strong></span>
    <span>Tarjetas: <strong>${fmtMoney(totT)}</strong></span>
    <span>Efectivo: <strong>${fmtMoney(totE)}</strong></span>
    <span>Tot. Caja: <strong>${fmtMoney(totC)}</strong></span>
    <span>Pagos banco: <strong>${fmtMoney(totP)}</strong></span>
    <span>Suministros: <strong>${fmtMoney(totS)}</strong></span>
  `;
}

$("#apply-filter").addEventListener("click", loadHistorico);

$("#export-csv").addEventListener("click", () => {
  if (!currentCierres.length) return;
  const header = ["fecha","local","tot_facturas","tarjetas","efectivo","tot_caja","pagos_banco","tot_suministros","notas","quien"];
  const rows = currentCierres.map(c => [
    c.fecha,
    c.locales?.nombre ?? "",
    c.tot_facturas,
    c.tarjetas,
    c.efectivo,
    c.tot_caja,
    c.pagos_banco ?? 0,
    c.tot_suministros ?? 0,
    (c.notas || "").replace(/\n/g, " "),
    c.profiles?.full_name ?? ""
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => {
      const s = String(v ?? "");
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `casa-tartas-cierres-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

async function openDetalle(id) {
  const c = currentCierres.find(x => x.id === id);
  if (!c) return;
  const [{ data: facts }, { data: sums }] = await Promise.all([
    sb.from("facturas").select("descripcion, importe, orden").eq("cierre_id", id).order("orden"),
    sb.from("suministros").select("descripcion, importe, orden").eq("cierre_id", id).order("orden")
  ]);

  $("#detalle-title").textContent = `Cierre ${c.fecha} — ${c.locales?.nombre ?? ""}`;
  const factHtml = (facts || []).length ? `
    <h4>Facturas</h4>
    <table>
      <thead><tr><th>Descripción</th><th class="num">Importe</th></tr></thead>
      <tbody>
        ${facts.map(f => `<tr><td>${f.descripcion ?? ""}</td><td class="num">${fmtMoney(f.importe)}</td></tr>`).join("")}
      </tbody>
    </table>
  ` : "<p class='hint'>Sin facturas detalladas.</p>";

  const sumHtml = (sums || []).length ? `
    <h4>Suministros y gastos</h4>
    <table>
      <thead><tr><th>Descripción</th><th class="num">Importe</th></tr></thead>
      <tbody>
        ${sums.map(s => `<tr><td>${s.descripcion ?? ""}</td><td class="num">${fmtMoney(s.importe)}</td></tr>`).join("")}
      </tbody>
    </table>
  ` : "";

  $("#detalle-body").innerHTML = `
    ${factHtml}
    ${sumHtml}
    <p><strong>Tot. Facturas:</strong> ${fmtMoney(c.tot_facturas)}</p>
    <p><strong>Tarjetas:</strong> ${fmtMoney(c.tarjetas)} &nbsp; <strong>Efectivo:</strong> ${fmtMoney(c.efectivo)}</p>
    <p><strong>TOT. CAJA:</strong> ${fmtMoney(c.tot_caja)}</p>
    <p><strong>Pagos por banco a proveedores:</strong> ${fmtMoney(c.pagos_banco || 0)}</p>
    <p><strong>Tot. Suministros:</strong> ${fmtMoney(c.tot_suministros || 0)}</p>
    ${c.notas ? `<p><em>Notas:</em> ${c.notas}</p>` : ""}
    <p class="hint">Registrado por ${c.profiles?.full_name ?? ""}</p>
  `;

  const delBtn = $("#detalle-delete");
  delBtn.hidden = me.profile.role !== "admin";
  delBtn.onclick = async () => {
    if (!confirm("¿Eliminar este cierre? No se puede deshacer.")) return;
    const { error } = await sb.from("cierres").delete().eq("id", id);
    if (error) { alert("Error: " + error.message); return; }
    $("#detalle-modal").close();
    loadHistorico();
  };

  $("#detalle-modal").showModal();
}

// ===== Admin =====
async function loadAdmin() {
  if (me.profile.role !== "admin") return;

  const { data: locs } = await sb.from("locales").select("*").order("nombre");
  $("#locales-list").innerHTML = (locs || []).map(l => `
    <li>
      <span>${l.nombre} ${l.activo ? "" : "(inactivo)"}</span>
      <button class="btn-ghost" data-id="${l.id}" data-activo="${l.activo}">
        ${l.activo ? "Desactivar" : "Activar"}
      </button>
    </li>
  `).join("");
  $("#locales-list").querySelectorAll("button").forEach(b => {
    b.addEventListener("click", async () => {
      const id = Number(b.dataset.id);
      const activo = b.dataset.activo !== "true";
      const { error } = await sb.from("locales").update({ activo }).eq("id", id);
      if (error) { alert(error.message); return; }
      loadAdmin();
      loadLocales();
    });
  });

  const { data: profs } = await sb.from("profiles").select("*").order("full_name");
  $("#users-table tbody").innerHTML = (profs || []).map(p => `
    <tr>
      <td>${p.full_name ?? ""}</td>
      <td>
        <select data-id="${p.id}" class="role-select">
          <option value="usuario" ${p.role === "usuario" ? "selected" : ""}>usuario</option>
          <option value="admin"   ${p.role === "admin"   ? "selected" : ""}>admin</option>
        </select>
      </td>
      <td></td>
    </tr>
  `).join("");
  $("#users-table").querySelectorAll(".role-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      const { error } = await sb.from("profiles").update({ role: sel.value }).eq("id", sel.dataset.id);
      if (error) alert(error.message);
    });
  });
}

$("#local-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("#new-local").value.trim();
  if (!nombre) return;
  const { error } = await sb.from("locales").insert({ nombre });
  if (error) { alert(error.message); return; }
  $("#new-local").value = "";
  loadAdmin();
  loadLocales();
});

// ===== Pull-to-refresh =====
async function globalRefresh() {
  if (!me) return;
  await loadLocales();
  await flushQueue();
  const activeTab = document.querySelector(".tab.active")?.dataset.tab;
  if (activeTab === "historico") await loadHistorico();
  else if (activeTab === "admin") await loadAdmin();
}

(function setupPullToRefresh() {
  const THRESHOLD = 70;
  const MAX_PULL  = 130;
  const FRICTION  = 2.2;
  let startY = 0, pullDist = 0, pulling = false, refreshing = false;
  let indicator = null;

  function buildIndicator() {
    const el = document.createElement("div");
    el.id = "ptr-indicator";
    el.innerHTML = `<span class="ptr-emoji">🎂</span><span class="ptr-label">Tira para actualizar</span>`;
    document.body.appendChild(el);
    return el;
  }

  function isAppViewVisible() {
    const app = document.getElementById("view-app");
    return app && !app.hidden;
  }

  function isAtTop() {
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  }

  function setLabel(text) {
    if (indicator) indicator.querySelector(".ptr-label").textContent = text;
  }

  function setEmojiRotation(deg) {
    if (indicator) indicator.querySelector(".ptr-emoji").style.transform = `rotate(${deg}deg)`;
  }

  function reset(animated = true) {
    if (!indicator) return;
    if (!animated) indicator.classList.add("active");
    indicator.style.transform = "translateX(-50%) translateY(-120%)";
    indicator.classList.remove("ready");
    setLabel("Tira para actualizar");
    setEmojiRotation(0);
    if (!animated) requestAnimationFrame(() => indicator.classList.remove("active"));
    pullDist = 0;
  }

  document.addEventListener("touchstart", (e) => {
    if (refreshing || !isAppViewVisible() || !isAtTop()) return;
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pulling = true;
    if (!indicator) indicator = buildIndicator();
    indicator.classList.add("active");
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) {
      pullDist = 0;
      indicator.style.transform = "translateX(-50%) translateY(-120%)";
      indicator.classList.remove("ready");
      setLabel("Tira para actualizar");
      return;
    }
    pullDist = Math.min(MAX_PULL, dy / FRICTION);
    const offset = Math.min(pullDist - 70, 30); // baja desde -70 hasta +30
    indicator.style.transform = `translateX(-50%) translateY(${offset}px)`;
    setEmojiRotation(pullDist * 3);
    const ready = pullDist >= THRESHOLD;
    indicator.classList.toggle("ready", ready);
    setLabel(ready ? "Suelta para actualizar" : "Tira para actualizar");
    if (pullDist > 6) e.preventDefault();
  }, { passive: false });

  document.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    indicator.classList.remove("active");
    const triggered = pullDist >= THRESHOLD;
    if (!triggered) { reset(true); return; }
    refreshing = true;
    indicator.classList.add("loading");
    indicator.style.transform = "translateX(-50%) translateY(15px)";
    setLabel("Actualizando…");
    try { await globalRefresh(); }
    catch (err) { console.warn("refresh failed", err); }
    finally {
      indicator.classList.remove("loading");
      reset(true);
      refreshing = false;
    }
  }, { passive: true });
})();

// ===== Service Worker (PWA) =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW register failed", err));
  });
}

// ===== Boot =====
bootstrapAuth();
