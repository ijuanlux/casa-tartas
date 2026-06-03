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
  $("#tab-estadisticas").hidden = tab !== "estadisticas";
  $("#tab-admin").hidden = tab !== "admin";
  if (tab === "historico")    loadHistorico();
  if (tab === "estadisticas") loadEstadisticas();
  if (tab === "admin")        loadAdmin();
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

// ===== Estadísticas =====
const charts = {};
function destroyCharts() { Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} }); }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const statsCaja = (r) => Number(r.tot_facturas || 0) + Number(r.tarjetas || 0) + Number(r.efectivo || 0);
const statsSum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
let statsAll = [];
let rangeActive = false;   // el filtro por calendario solo aplica al pulsar "Buscar"

function mesLabel(ym) {
  const [y, m] = ym.split("-");
  const l = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return l.charAt(0).toUpperCase() + l.slice(1);
}

function populateMonths(rows) {
  const sel = $("#stats-month");
  const cur = sel.value;
  const months = [...new Set(rows.map((r) => r.fecha.slice(0, 7)))].sort().reverse();
  sel.innerHTML = `<option value="">Todos los meses</option>` +
    months.map((m) => `<option value="${m}">${mesLabel(m)}</option>`).join("");
  if (months.includes(cur)) sel.value = cur;
}

async function loadEstadisticas() {
  if (typeof Chart === "undefined") { console.warn("Chart.js no cargó"); return; }
  try {
    const { data, error } = await sb.from("cierres")
      .select("fecha, tot_facturas, tarjetas, efectivo, tot_caja, pagos_banco, tot_suministros, local_id, locales(nombre)")
      .order("fecha", { ascending: true })
      .limit(5000);
    if (error) throw error;
    statsAll = data || [];
  } catch (e) { console.warn("estadisticas error", e); statsAll = statsAll || []; }
  populateMonths(statsAll);
  renderStats();
}

function renderStats() {
  const has = statsAll.length > 0;
  $("#stats-empty").hidden = has;
  $("#stats-content").hidden = !has;
  if (!has) { destroyCharts(); return; }

  // filtros: calendario > mes > periodo
  const from = $("#stats-from").value, to = $("#stats-to").value;
  const month = $("#stats-month").value;
  const days = Number($("#stats-range").value || 0);
  const hasRange = rangeActive && !!(from || to);
  $("#stats-range").disabled = hasRange || !!month;
  $("#stats-month").disabled = hasRange;
  const isoBack = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  let scoped, prev = null;
  if (hasRange) {
    const f = from || "0000-01-01", t = to || "9999-12-31";
    scoped = statsAll.filter((r) => r.fecha >= f && r.fecha <= t);
    if (from && to) {
      const span = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
      const pf = new Date(new Date(from) - span * 86400000).toISOString().slice(0, 10);
      const pt = new Date(new Date(from) - 86400000).toISOString().slice(0, 10);
      prev = statsAll.filter((r) => r.fecha >= pf && r.fecha <= pt);
    }
  } else if (month) {
    scoped = statsAll.filter((r) => r.fecha.slice(0, 7) === month);
    const [yy, mm] = month.split("-").map(Number);
    const pd = new Date(yy, mm - 2, 1), pkey = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    prev = statsAll.filter((r) => r.fecha.slice(0, 7) === pkey);
  } else if (days > 0) {
    const f = isoBack(days);
    scoped = statsAll.filter((r) => r.fecha >= f);
    const pf = isoBack(days * 2);
    prev = statsAll.filter((r) => r.fecha >= pf && r.fecha < f);
  } else {
    scoped = statsAll;
  }
  if (!scoped.length) scoped = statsAll;

  const totalCaja = statsSum(scoped, statsCaja);
  const totalFact = statsSum(scoped, (r) => Number(r.tot_facturas || 0));
  const totalTarj = statsSum(scoped, (r) => Number(r.tarjetas || 0));
  const totalEfec = statsSum(scoped, (r) => Number(r.efectivo || 0));
  const totalBanco = statsSum(scoped, (r) => Number(r.pagos_banco || 0));
  const totalSumin = statsSum(scoped, (r) => Number(r.tot_suministros || 0));

  $("#kpi-total").textContent = fmtMoney(totalCaja);
  $("#kpi-count").textContent = scoped.length;
  $("#kpi-avg").textContent = fmtMoney(totalCaja / scoped.length);
  let best = scoped[0];
  scoped.forEach((r) => { if (statsCaja(r) > statsCaja(best)) best = r; });
  $("#kpi-best").textContent = fmtMoney(statsCaja(best));
  $("#kpi-best-date").textContent = best.fecha + (best.locales?.nombre ? " · " + best.locales.nombre : "");
  $("#evo-title").textContent = (month || hasRange) ? "Evolución diaria" + (month ? " · " + mesLabel(month) : "") : "Evolución de la caja";

  // BONUS: comparativa vs periodo anterior (▲/▼ %)
  const deltaEl = $("#kpi-delta");
  if (deltaEl) {
    const prevTotal = prev ? statsSum(prev, statsCaja) : 0;
    if (prev && prev.length && prevTotal > 0) {
      const pct = Math.round((totalCaja - prevTotal) / prevTotal * 100);
      const up = pct >= 0;
      deltaEl.textContent = `${up ? "▲" : "▼"} ${Math.abs(pct)}% vs periodo anterior`;
      deltaEl.className = "kpi-delta " + (up ? "up" : "down");
      deltaEl.hidden = false;
    } else { deltaEl.hidden = true; }
  }

  const ink = cssVar("--ink") || "#3b2a1f";
  const inkSoft = cssVar("--ink-soft") || "#7a5b46";
  const line = cssVar("--line") || "#e7d3b8";
  const card = cssVar("--card") || "#fff";
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const gridc = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)";
  const PINK = "#c64b6c", GOLD = "#f4c430", CREAM = "#e9b06a", BLUE = "#4f9bd6", PURPLE = "#9b7ed1", GREEN = "#3aa76d", TEAL = "#33b1a6";

  // ---- estética global "pro" (sin sustituir objetos internos de Chart.js) ----
  Chart.defaults.color = inkSoft;
  Chart.defaults.font.family = "Fredoka, sans-serif";
  Chart.defaults.animation.duration = 900;
  Chart.defaults.animation.easing = "easeOutQuart";
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: dark ? "rgba(10,6,12,.92)" : "rgba(40,24,34,.92)",
    padding: 12, cornerRadius: 12, titleColor: "#fff", bodyColor: "#fff",
    boxPadding: 6, usePointStyle: true, borderColor: "rgba(255,255,255,.12)", borderWidth: 1,
  });
  const legBottom = () => ({ position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 12, boxWidth: 8, boxHeight: 8 } });

  // helpers de degradado + plugins
  const vgrad = (chart, c1, c2) => {
    const a = chart.chartArea; if (!a) return c1;
    const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
  };
  const hexA = (hex, al) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${al})`; };
  const centerText = {
    id: "centerText",
    afterDraw(ch) {
      const t = ch.config.options.plugins.centerText; if (!t || !ch.chartArea) return;
      const { ctx, chartArea: { left, right, top, bottom } } = ch;
      const x = (left + right) / 2, y = (top + bottom) / 2;
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "700 20px Fredoka, sans-serif"; ctx.fillStyle = ink; ctx.fillText(t.value, x, y - 7);
      ctx.font = "600 11px Fredoka, sans-serif"; ctx.fillStyle = inkSoft; ctx.fillText(t.label.toUpperCase(), x, y + 13);
      ctx.restore();
    },
  };
  const glow = {
    id: "glow",
    beforeDatasetsDraw(ch) { if (!ch.config.options.plugins.glow) return; const c = ch.ctx; c.save(); c.shadowColor = ch.config.options.plugins.glow; c.shadowBlur = 14; c.shadowOffsetY = 5; },
    afterDatasetsDraw(ch) { if (ch.config.options.plugins.glow) ch.ctx.restore(); },
  };
  const pctTip = (ctx) => {
    const arr = ctx.dataset.data, tot = arr.reduce((s, v) => s + Number(v || 0), 0);
    const v = Number(ctx.parsed || 0);
    return ` ${ctx.label}: ${fmtMoney(v)} (${tot ? Math.round(v / tot * 100) : 0}%)`;
  };
  const moneyTip = (ctx) => ` ${fmtMoney(ctx.parsed.y ?? ctx.parsed)}`;
  // ejes nuevos por gráfica (Chart.js v4 rompe si se comparte el mismo objeto entre charts)
  const mkScales = () => ({ y: { beginAtZero: true, grid: { color: gridc }, ticks: { callback: (v) => (v >= 1000 ? (v / 1000) + "k" : v) + "€" } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } });
  const mk = (sel, cfg) => { try { return new Chart($(sel), cfg); } catch (e) { console.error("Chart " + sel + " falló:", e); return null; } };

  destroyCharts();

  charts.comp = mk("#chart-composicion", {
    type: "doughnut",
    data: { labels: ["Facturas", "Tarjetas", "Efectivo"], datasets: [{ data: [totalFact, totalTarj, totalEfec], backgroundColor: [PINK, BLUE, CREAM], borderColor: card, borderWidth: 3, borderRadius: 6, hoverOffset: 10, spacing: 2 }] },
    options: { maintainAspectRatio: false, cutout: "70%", plugins: { legend: legBottom(), centerText: { value: fmtMoney(totalCaja), label: "caja" }, tooltip: { callbacks: { label: pctTip } } } },
    plugins: [centerText],
  });

  const byLocal = {};
  scoped.forEach((r) => { const n = r.locales?.nombre || ("Local " + r.local_id); byLocal[n] = (byLocal[n] || 0) + statsCaja(r); });
  const localNames = Object.keys(byLocal);
  charts.loc = mk("#chart-locales", {
    type: "doughnut",
    data: { labels: localNames, datasets: [{ data: localNames.map((n) => byLocal[n]), backgroundColor: [PINK, GOLD, BLUE, PURPLE, GREEN, TEAL, CREAM], borderColor: card, borderWidth: 3, borderRadius: 6, hoverOffset: 10, spacing: 2 }] },
    options: { maintainAspectRatio: false, cutout: "62%", plugins: { legend: legBottom(), centerText: { value: String(localNames.length), label: localNames.length === 1 ? "local" : "locales" }, tooltip: { callbacks: { label: pctTip } } } },
    plugins: [centerText],
  });

  // Caja por MES (siempre todos los meses; barra clicable para drill-in)
  const byMonth = {};
  statsAll.forEach((r) => { const m = r.fecha.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + statsCaja(r); });
  const months = Object.keys(byMonth).sort();
  charts.meses = mk("#chart-meses", {
    type: "bar",
    data: {
      labels: months.map((m) => mesLabel(m).replace(/ de \d+| \d+/, "")),
      datasets: [{
        data: months.map((m) => byMonth[m]), borderRadius: 8, borderSkipped: false, maxBarThickness: 60,
        backgroundColor: (c) => (months[c.dataIndex] === month ? vgrad(c.chart, GOLD, "#e0890c") : vgrad(c.chart, hexA(PINK, 0.95), hexA(PINK, 0.35))),
        hoverBackgroundColor: (c) => vgrad(c.chart, GOLD, "#e0890c"),
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (t) => mesLabel(months[t[0].dataIndex]), label: moneyTip } } },
      scales: mkScales(),
      onClick: (evt, els) => {
        if (!els.length) return;
        const m = months[els[0].index];
        const sel = $("#stats-month");
        const selecting = sel.value !== m;
        sel.value = selecting ? m : "";
        renderStats();
        if (selecting) {
          const bestMonth = months.reduce((a, b) => (byMonth[b] > byMonth[a] ? b : a), months[0]);
          if (m === bestMonth && typeof window.casaConfetti === "function") window.casaConfetti();
        }
      },
    },
  });

  const byDate = {};
  scoped.forEach((r) => { byDate[r.fecha] = (byDate[r.fecha] || 0) + statsCaja(r); });
  const dates = Object.keys(byDate).sort();
  charts.evo = mk("#chart-evolucion", {
    type: "line",
    data: { labels: dates.map((d) => d.slice(5)), datasets: [{ label: "Caja", data: dates.map((d) => byDate[d]), borderColor: PINK, borderWidth: 3, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6, pointHoverBackgroundColor: PINK, pointHoverBorderColor: "#fff", pointHoverBorderWidth: 2, backgroundColor: (c) => vgrad(c.chart, hexA(PINK, 0.35), hexA(PINK, 0)) }] },
    options: { maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, plugins: { legend: { display: false }, glow: hexA(PINK, 0.5), tooltip: { callbacks: { label: moneyTip } } }, scales: mkScales() },
    plugins: [glow],
  });

  charts.pago = mk("#chart-pago", {
    type: "doughnut",
    data: { labels: ["Tarjetas", "Efectivo"], datasets: [{ data: [totalTarj, totalEfec], backgroundColor: [BLUE, GOLD], borderColor: card, borderWidth: 3, borderRadius: 6, hoverOffset: 10, spacing: 2 }] },
    options: { maintainAspectRatio: false, cutout: "70%", plugins: { legend: legBottom(), centerText: { value: fmtMoney(totalTarj + totalEfec), label: "cobrado" }, tooltip: { callbacks: { label: pctTip } } } },
    plugins: [centerText],
  });

  charts.gastos = mk("#chart-gastos", {
    type: "bar",
    data: { labels: ["Suministros", "Pagos banco"], datasets: [{ data: [totalSumin, totalBanco], borderRadius: 8, borderSkipped: false, maxBarThickness: 90, backgroundColor: (c) => [vgrad(c.chart, PURPLE, hexA(PURPLE, 0.4)), vgrad(c.chart, GREEN, hexA(GREEN, 0.4))][c.dataIndex] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: moneyTip } } }, scales: mkScales() },
  });

  // foto de datos para el informe PDF (se redibuja en limpio, no se captura el dashboard)
  window.__lastStats = {
    period: statsPeriodLabel(),
    kpi: { total: $("#kpi-total").textContent, count: $("#kpi-count").textContent, avg: $("#kpi-avg").textContent, best: $("#kpi-best").textContent, bestDate: $("#kpi-best-date").textContent, delta: ($("#kpi-delta") && !$("#kpi-delta").hidden) ? $("#kpi-delta").textContent : "" },
    totals: { fact: totalFact, tarj: totalTarj, efec: totalEfec, banco: totalBanco, sumin: totalSumin, caja: totalCaja },
    months, byMonth: { ...byMonth }, monthSel: month,
    dateLabels: dates.map((d) => d.slice(5)), dateVals: dates.map((d) => byDate[d]),
    localNames, localVals: localNames.map((n) => byLocal[n]),
  };

  // tras el layout, reajusta los gráficos a su celda (evita lienzos en blanco)
  requestAnimationFrame(() => Object.values(charts).forEach((c) => { try { c.resize(); } catch (e) {} }));
  setTimeout(() => Object.values(charts).forEach((c) => { try { c.resize(); } catch (e) {} }), 250);
}
function quickFilter() { rangeActive = false; renderStats(); }   // periodo/mes desactivan el modo fechas
$("#stats-range")?.addEventListener("change", quickFilter);
$("#stats-month")?.addEventListener("change", quickFilter);
$("#stats-search")?.addEventListener("click", () => { rangeActive = true; renderStats(); });
$("#stats-clear")?.addEventListener("click", () => {
  rangeActive = false;
  $("#stats-from").value = ""; $("#stats-to").value = "";
  $("#stats-range").value = "0"; $("#stats-month").value = "";
  renderStats();
});

// ===== Exportar informe a PDF (con logo y gráficos del periodo elegido) =====
function statsPeriodLabel() {
  const from = $("#stats-from").value, to = $("#stats-to").value, month = $("#stats-month").value, days = Number($("#stats-range").value || 0);
  if (from || to) return "Del " + (from || "inicio") + " al " + (to || "hoy");
  if (month) return mesLabel(month);
  if (days > 0) return "Últimos " + days + " días";
  return "Histórico completo";
}
function hexToRgb(h) { const n = parseInt((h || "#000").replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function fitBox(w, h, maxW, maxH) { const s = Math.min(maxW / w, maxH / h); return { w: w * s, h: h * s }; }
function imgToDataURL(url) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); res({ dataURL: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = rej; img.src = url;
  });
}

// dibuja una gráfica limpia en un canvas oculto y devuelve su PNG (no captura el dashboard)
function pdfChart(type, w, h, data, options, plugins) {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-99999px;top:0;width:" + w + "px;height:" + h + "px;";
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  holder.appendChild(cv); document.body.appendChild(holder);
  const ch = new Chart(cv, { type, data, options: Object.assign({ responsive: false, animation: false, maintainAspectRatio: false }, options), plugins: plugins || [] });
  ch.draw();
  const url = cv.toDataURL("image/png");
  ch.destroy(); holder.remove();
  return { dataURL: url, w, h };
}

async function exportStatsPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("No se pudo cargar el generador de PDF."); return; }
  const S = window.__lastStats;
  if (!S) { alert("Abre las estadísticas un momento y vuelve a intentarlo."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40, CW = W - 2 * M;
  const INK = [59, 42, 31], SOFT = [122, 91, 70], CARD = [255, 255, 255], BG = [250, 247, 242];
  const ACCENT = hexToRgb(cssVar("--accent")) || [198, 75, 108];
  const PINK = "#c64b6c", GOLD = "#f4c430", CREAM = "#e9b06a", BLUE = "#4f9bd6", PURPLE = "#9b7ed1", GREEN = "#3aa76d", TEAL = "#33b1a6";
  const tick = "#7a5b46", gline = "rgba(0,0,0,.07)";
  const num = (v) => (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : v) + "€";
  const scales = { y: { beginAtZero: true, grid: { color: gline }, ticks: { color: tick, callback: num, font: { size: 11 } } }, x: { grid: { display: false }, ticks: { color: tick, font: { size: 11 } } } };
  const legend = { legend: { position: "bottom", labels: { color: INK, usePointStyle: true, pointStyle: "circle", padding: 14, font: { size: 12 } } } };
  const center = (value, label) => ({
    id: "c", afterDraw(ch) {
      const a = ch.chartArea; if (!a) return; const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2; const c = ch.ctx;
      c.save(); c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "700 24px helvetica"; c.fillStyle = "#3b2a1f"; c.fillText(value, x, y - 9);
      c.font = "600 12px helvetica"; c.fillStyle = "#7a5b46"; c.fillText(String(label).toUpperCase(), x, y + 14); c.restore();
    },
  });
  const dough = (labels, data, colors, cv, cl) => pdfChart("doughnut", 480, 360,
    { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#fff", borderWidth: 3, borderRadius: 5, spacing: 2 }] },
    { cutout: "66%", plugins: legend, layout: { padding: 10 } }, [center(cv, cl)]);

  const imgMeses = pdfChart("bar", 1000, 320,
    { labels: S.months.map((m) => mesLabel(m).replace(/ de \d+| \d+/, "")), datasets: [{ data: S.months.map((m) => S.byMonth[m]), backgroundColor: S.months.map((m) => (m === S.monthSel ? GOLD : PINK)), borderRadius: 6, borderSkipped: false, maxBarThickness: 70 }] },
    { plugins: { legend: { display: false } }, scales, layout: { padding: 8 } });
  const imgEvo = pdfChart("line", 1000, 320,
    { labels: S.dateLabels, datasets: [{ data: S.dateVals, borderColor: PINK, borderWidth: 3, fill: true, backgroundColor: "rgba(198,75,108,.18)", tension: 0.4, pointRadius: 0 }] },
    { plugins: { legend: { display: false } }, scales, layout: { padding: 8 } });
  const imgComp = dough(["Facturas", "Tarjetas", "Efectivo"], [S.totals.fact, S.totals.tarj, S.totals.efec], [PINK, BLUE, CREAM], fmtMoney(S.totals.caja), "caja");
  const imgPago = dough(["Tarjetas", "Efectivo"], [S.totals.tarj, S.totals.efec], [BLUE, GOLD], fmtMoney(S.totals.tarj + S.totals.efec), "cobrado");
  const imgLoc = dough(S.localNames, S.localVals, [PINK, GOLD, BLUE, PURPLE, GREEN, TEAL, CREAM], String(S.localNames.length), S.localNames.length === 1 ? "local" : "locales");
  const imgGastos = pdfChart("bar", 720, 360,
    { labels: ["Suministros", "Pagos banco"], datasets: [{ data: [S.totals.sumin, S.totals.banco], backgroundColor: [PURPLE, GREEN], borderRadius: 6, borderSkipped: false, maxBarThickness: 130 }] },
    { plugins: { legend: { display: false } }, scales, layout: { padding: 8 } });

  const pageBg = () => { doc.setFillColor(...BG); doc.rect(0, 0, W, H, "F"); };
  pageBg();
  // encabezado BLANCO: el logo lleva fondo blanco, así se funde y no choca con el rosa
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, 104, "F");
  try {
    const logo = await imgToDataURL("./logo-casa-tartas.png");
    const f = fitBox(logo.w, logo.h, 172, 60);
    doc.addImage(logo.dataURL, "PNG", M, 22 + (60 - f.h) / 2, f.w, f.h);
  } catch (e) {}
  doc.setTextColor(...ACCENT);
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("Informe de caja", W - M, 44, { align: "right" });
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(S.period, W - M, 65, { align: "right" });
  doc.setTextColor(...SOFT); doc.setFontSize(9);
  const hoy = new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  doc.text("Generado el " + hoy, W - M, 81, { align: "right" });
  // regla bicolor (rosa + dorado) que combina con la marca
  doc.setFillColor(...ACCENT); doc.rect(0, 104, W * 0.62, 3.5, "F");
  doc.setFillColor(244, 196, 48); doc.rect(W * 0.62, 104, W * 0.38, 3.5, "F");

  let y = 128;
  const kpis = [["Total caja", S.kpi.total, S.kpi.delta], ["Cierres", S.kpi.count, ""], ["Media/cierre", S.kpi.avg, ""], ["Mejor día", S.kpi.best, S.kpi.bestDate]];
  const kw = (CW - 30) / 4;
  kpis.forEach((k, i) => {
    const x = M + i * (kw + 10);
    doc.setFillColor(...CARD); doc.roundedRect(x, y, kw, 60, 8, 8, "F");
    doc.setFillColor(...ACCENT); doc.roundedRect(x, y, 4, 60, 2, 2, "F");
    doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(String(k[0]).toUpperCase(), x + 12, y + 18);
    doc.setTextColor(...ACCENT); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(String(k[1]), x + 12, y + 40);
    if (k[2]) { doc.setTextColor(...SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(String(k[2]), x + 12, y + 53); }
  });
  y += 60 + 18;

  const card = (title, img, x, w, h) => {
    doc.setFillColor(...CARD); doc.roundedRect(x, y, w, h, 8, 8, "F");
    doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(title, x + 12, y + 20);
    const f = fitBox(img.w, img.h, w - 22, h - 36);
    doc.addImage(img.dataURL, "PNG", x + (w - f.w) / 2, y + 28 + (h - 36 - f.h) / 2, f.w, f.h);
  };
  const rowFull = (title, img, h) => { if (y + h > H - 36) { doc.addPage(); pageBg(); y = 40; } card(title, img, M, CW, h); y += h + 14; };
  const rowHalf = (t1, i1, t2, i2, h) => { if (y + h > H - 36) { doc.addPage(); pageBg(); y = 40; } const hw = (CW - 14) / 2; card(t1, i1, M, hw, h); card(t2, i2, M + hw + 14, hw, h); y += h + 14; };

  rowFull("Caja por mes", imgMeses, 175);
  rowFull(S.monthSel ? "Evolución diaria" : "Evolución de la caja", imgEvo, 165);
  rowHalf("Composición de la caja", imgComp, "Tarjeta vs Efectivo", imgPago, 210);
  rowHalf("Caja por local", imgLoc, "Gastos: suministros y banco", imgGastos, 210);

  doc.save("informe-casa-tartas.pdf");
}
$("#stats-pdf")?.addEventListener("click", exportStatsPDF);

// ===== Asistente "Tarta" (IA básica sin claves: entiende y consulta los datos) =====
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const MESES_RE = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

function isoFromParts(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function formatDayEs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}
function parseSpanishDate(t) {
  const today = new Date();
  const iso = (dt) => isoFromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  if (/anteayer|antes de ayer/.test(t)) { const d = new Date(today); d.setDate(d.getDate() - 2); return iso(d); }
  if (/\bayer\b/.test(t)) { const d = new Date(today); d.setDate(d.getDate() - 1); return iso(d); }
  if (/\bhoy\b/.test(t)) return iso(today);
  let m = t.match(new RegExp(`(\\d{1,2})\\s+de\\s+(${MESES_RE})(?:\\s+(?:de\\s+)?(\\d{4}))?`));
  if (m) return isoFromParts(m[3] ? +m[3] : today.getFullYear(), MESES[m[2]], +m[1]);
  m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) { let y = m[3] ? +m[3] : today.getFullYear(); if (y < 100) y += 2000; const mo = +m[2], d = +m[1]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return isoFromParts(y, mo, d); }
  return null;
}
function parseSpanishMonth(t) {
  const today = new Date();
  if (/este mes/.test(t)) return { y: today.getFullYear(), m: today.getMonth() + 1 };
  if (/mes pasado/.test(t)) { const d = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  const m = t.match(new RegExp(`\\b(${MESES_RE})\\b`));
  if (m && !new RegExp(`\\d{1,2}\\s+de\\s+${MESES_RE}`).test(t)) return { y: today.getFullYear(), m: MESES[m[1]] };
  return null;
}

async function casaQuery(question) {
  const t = (question || "").toLowerCase().trim();
  if (!t) return "Pregúntame algo 🙂";
  let rows = [];
  try {
    const { data, error } = await sb.from("cierres")
      .select("fecha, tot_facturas, tarjetas, efectivo, pagos_banco, tot_suministros, locales(nombre)")
      .order("fecha", { ascending: true }).limit(5000);
    if (error) throw error;
    rows = data || [];
  } catch (e) { return "Uy, ahora mismo no puedo consultar los datos 😕"; }
  if (!rows.length) return "Todavía no hay ningún cierre guardado. ¡Mete el primero! 🎂";

  const caja = (r) => Number(r.tot_facturas || 0) + Number(r.tarjetas || 0) + Number(r.efectivo || 0);
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

  // 1) ¿pregunta por un día concreto?
  const iso = parseSpanishDate(t);
  if (iso) {
    const day = rows.filter((r) => r.fecha === iso);
    if (!day.length) return `No encuentro ningún cierre del ${formatDayEs(iso)} 🤔`;
    return `El ${formatDayEs(iso)} se hizo ${fmtMoney(sum(day, caja))} de caja 🎂\n· Facturas: ${fmtMoney(sum(day, (r) => Number(r.tot_facturas || 0)))}\n· Tarjetas: ${fmtMoney(sum(day, (r) => Number(r.tarjetas || 0)))}\n· Efectivo: ${fmtMoney(sum(day, (r) => Number(r.efectivo || 0)))}`;
  }

  // 2) ámbito por mes (si lo menciona)
  const mo = parseSpanishMonth(t);
  let scope = rows, label = "en total";
  if (mo) {
    const key = `${mo.y}-${String(mo.m).padStart(2, "0")}`;
    scope = rows.filter((r) => r.fecha.slice(0, 7) === key);
    label = "en " + mesLabel(key).toLowerCase();
    if (!scope.length) return `No hay cierres ${label} 🤔`;
  }

  if (/mejor|r[eé]cord|m[aá]ximo/.test(t)) {
    let best = scope[0]; scope.forEach((r) => { if (caja(r) > caja(best)) best = r; });
    return `El mejor día ${mo ? label + " " : ""}fue el ${formatDayEs(best.fecha)} con ${fmtMoney(caja(best))} 💰`;
  }
  if (/peor|m[ií]nimo|menos caja/.test(t)) {
    let w = scope[0]; scope.forEach((r) => { if (caja(r) < caja(w)) w = r; });
    return `El día más flojo ${mo ? label + " " : ""}fue el ${formatDayEs(w.fecha)} con ${fmtMoney(caja(w))}.`;
  }
  if (/media|promedio/.test(t)) return `La media por cierre ${label} es ${fmtMoney(sum(scope, caja) / scope.length)} (${scope.length} cierres).`;
  if (/tarjeta/.test(t)) return `En tarjeta ${label} se ha cobrado ${fmtMoney(sum(scope, (r) => Number(r.tarjetas || 0)))} 💳`;
  if (/efectivo|met[aá]lico/.test(t)) return `En efectivo ${label} se ha cobrado ${fmtMoney(sum(scope, (r) => Number(r.efectivo || 0)))} 💵`;
  if (/cu[aá]ntos cierres|n[uú]mero de cierres/.test(t)) return `Hay ${scope.length} cierres ${label}.`;
  if (/suministro|gasto/.test(t)) return `Suministros y gastos ${label}: ${fmtMoney(sum(scope, (r) => Number(r.tot_suministros || 0)))}.`;
  if (/banco|proveedor/.test(t)) return `Pagos por banco ${label}: ${fmtMoney(sum(scope, (r) => Number(r.pagos_banco || 0)))}.`;
  if (/total|cu[aá]nto|caja|factur|ingres|gana|vend/.test(t)) return `${mo ? "Caja " + label : "Caja total"}: ${fmtMoney(sum(scope, caja))} 🎂 (${scope.length} cierres).`;

  return CASA_HELP;
}
const CASA_HELP = "Puedo decirte la caja de un día (\"¿cuánto se hizo el 15 de mayo?\" o \"¿y ayer?\"), el total o la media de un mes, el mejor día, o cuánto en tarjeta/efectivo. ¿Qué quieres saber? 🎂";
window.CASA_HELP = CASA_HELP;
window.casaQuery = casaQuery;

// Resumen compacto de los datos, para dar contexto a un LLM
async function casaDigest() {
  let rows = [];
  try {
    const { data, error } = await sb.from("cierres")
      .select("fecha, tot_facturas, tarjetas, efectivo, pagos_banco, tot_suministros")
      .order("fecha", { ascending: true }).limit(5000);
    if (error) throw error; rows = data || [];
  } catch (e) { return "No hay datos disponibles."; }
  if (!rows.length) return "Todavía no hay ningún cierre guardado.";
  const caja = (r) => Number(r.tot_facturas || 0) + Number(r.tarjetas || 0) + Number(r.efectivo || 0);
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const eur = (n) => Math.round(n) + "€";

  const total = sum(rows, caja);
  let best = rows[0], worst = rows[0];
  rows.forEach((r) => { if (caja(r) > caja(best)) best = r; if (caja(r) < caja(worst)) worst = r; });

  const byMonth = {};
  rows.forEach((r) => { const m = r.fecha.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + caja(r); });
  const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const dowSum = {}, dowCnt = {};
  rows.forEach((r) => { const [y, m, d] = r.fecha.split("-").map(Number); const wd = new Date(y, m - 1, d).getDay(); dowSum[wd] = (dowSum[wd] || 0) + caja(r); dowCnt[wd] = (dowCnt[wd] || 0) + 1; });

  const last = rows.slice(-12).map((r) => `${r.fecha}: ${eur(caja(r))}`).join("; ");
  const months = Object.keys(byMonth).sort().slice(-12).map((m) => `${m}: ${eur(byMonth[m])}`).join("; ");
  const dow = Object.keys(dowSum).map((wd) => `${DOW[wd]}: ${eur(dowSum[wd] / dowCnt[wd])}`).join("; ");

  return [
    `Negocio: La Casa de las Tartas (pastelería). Moneda: euros. "Caja" = facturas + tarjetas + efectivo.`,
    `Nº de cierres: ${rows.length}. Caja total acumulada: ${eur(total)}. Media por cierre: ${eur(total / rows.length)}.`,
    `Mejor día: ${best.fecha} (${eur(caja(best))}). Día más flojo: ${worst.fecha} (${eur(caja(worst))}).`,
    `Total por mes: ${months}.`,
    `Media por día de la semana: ${dow}.`,
    `Últimos cierres: ${last}.`,
  ].join("\n");
}
window.casaDigest = casaDigest;

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
