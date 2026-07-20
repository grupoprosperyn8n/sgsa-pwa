// =============================================================================
// SGSA PWA — Multi-user, Professional UI
// =============================================================================
const API = "https://web-production-2584d.up.railway.app";
const REFRESH = 30000;

// ─── Storage (localStorage wrapper) ───────────────────────────────────────
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  clear() { try { localStorage.clear(); } catch {} },
};

// ─── Auth ─────────────────────────────────────────────────────────────────
let authToken = null;
let currentUser = null;

function saveSession(t, u) { store.set("sgsa_token", t); store.set("sgsa_user", u); }
function clearAll() { store.clear(); authToken = null; currentUser = null; }

async function restoreSession() {
  const t = store.get("sgsa_token"), u = store.get("sgsa_user");
  if (!t || !u) return false;
  authToken = t; currentUser = u;
  try {
    const r = await fetch(API + "/api/chat/auth/me", { headers: { Authorization: "Bearer " + t } });
    if (r.ok) { const d = await r.json(); if (d.ok) { currentUser = d.user; saveSession(t, currentUser); return true; } }
  } catch {}
  clearAll(); return false;
}

async function apiGet(path) {
  try {
    const r = await fetch(API + path, { headers: authToken ? { Authorization: "Bearer " + authToken } : {} });
    if (r.status === 401 && authToken) { clearAll(); showLogin(); return null; }
    return await r.json();
  } catch { return null; }
}

async function apiPost(path, body) {
  try {
    const r = await fetch(API + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: "Bearer " + authToken } : {}) },
      body: JSON.stringify(body),
    });
    if (r.status === 401 && authToken) { clearAll(); showLogin(); return null; }
    return await r.json();
  } catch { return null; }
}

function esc(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

// ─── Login ────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById("login-overlay").style.display = "flex";
  document.getElementById("app").style.display = "none";
}
function showApp() {
  document.getElementById("login-overlay").style.display = "none";
  document.getElementById("app").style.display = "flex";
  initChat(); initAlerts(); updateSettingsUser();
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const pw = document.getElementById("loginPassword").value.trim();
  if (!email || !pw) { document.getElementById("loginError").textContent = "Completá ambos campos"; return; }
  const r = await apiPost("/api/chat/auth/login", { email, password: pw });
  if (r && r.ok) { authToken = r.access_token; currentUser = r.user; saveSession(authToken, currentUser); showApp(); }
  else { document.getElementById("loginError").textContent = "Credenciales incorrectas"; }
});
document.getElementById("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("loginBtn").click(); });

// ─── Tabs ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  if (tab === "chat" && !authToken) { showLogin(); return; }
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");
  document.getElementById(tab + "-tab")?.classList.add("active");
  if (tab === "chat") refreshConversations();
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// ─── Settings Panel ───────────────────────────────────────────────────────
document.getElementById("settingsBtn").addEventListener("click", () => {
  document.getElementById("settings-overlay").style.display = "block";
  document.getElementById("settings-panel").style.display = "flex";
  updateSettingsUser();
});
document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);
document.getElementById("settings-overlay").addEventListener("click", closeSettings);
function closeSettings() {
  document.getElementById("settings-overlay").style.display = "none";
  document.getElementById("settings-panel").style.display = "none";
}

function updateSettingsUser() {
  document.getElementById("settingsName").textContent = currentUser?.nombre || "—";
  document.getElementById("settingsEmail").textContent = currentUser?.email || "—";
}

// Settings: change employee
document.getElementById("settingsChangeEmployee").addEventListener("click", () => {
  closeSettings(); openModal("employee-modal"); loadEmployeeModal();
});
// Settings: change office
document.getElementById("settingsChangeOffice").addEventListener("click", () => {
  if (!selectedAirtableId) { alert("Primero seleccioná un empleado"); return; }
  closeSettings(); openModal("office-modal"); loadOfficeModal();
});
// Settings: mute toggles
document.getElementById("toggleChatMute").addEventListener("change", function() {
  chatMuted = this.checked; store.set("sgsa_chat_muted", chatMuted);
});
document.getElementById("toggleAlertsMute").addEventListener("change", function() {
  alertsMuted = this.checked; store.set("sgsa_alerts_muted", alertsMuted);
});
// Settings: logout
document.getElementById("settingsLogout").addEventListener("click", () => {
  clearAll();
  if (window._chatTimer) clearInterval(window._chatTimer);
  stopPing();
  closeSettings();
  showLogin();
});

// ─── Logout from chat header ──────────────────────────────────────────────
// (handled via settings panel now)

// =============================================================================
// ALERTS
// =============================================================================
let alerts = [], alertTimer = null, selectedAirtableId = null;
let selectedOffice = "", selectedEmployeeName = "", alertsMuted = true;
let employees = [], offices = [];

async function loadEmployeeModal() {
  if (employees.length) { renderEmployeeList(employees); return; }
  try {
    const r = await fetch(API + "/api/chat/employees"); const d = await r.json();
    if (d.ok) employees = d.employees;
    renderEmployeeList(employees);
  } catch (e) { console.error(e); }
}

function renderEmployeeList(list) {
  const c = document.getElementById("modalList");
  if (!list.length) { c.innerHTML = '<div class="emp-empty">Sin resultados</div>'; return; }
  c.innerHTML = list.map(e => `<div class="emp-item" data-id="${e.id}" data-airtable="${e.airtable_id||""}">
    <div class="emp-avatar-mini">${e.avatar_url ? `<img src="${e.avatar_url}" class="emp-avatar-img">` : (e.nombre||"?")[0].toUpperCase()}</div>
    <div class="emp-info"><span class="emp-nombre">${esc(e.nombre)}</span>${e.oficina_nombre ? `<span class="emp-oficina">${esc(e.oficina_nombre)}</span>` : ""}</div>
  </div>`).join("");
  c.querySelectorAll(".emp-item").forEach(el => el.addEventListener("click", () => {
    const aid = el.dataset.airtable;
    if (aid) selectEmployee(aid, el.querySelector(".emp-nombre").textContent);
  }));
}

function selectEmployee(aid, name) {
  selectedAirtableId = aid; selectedEmployeeName = name;
  store.set("sgsa_selected_employee", aid); store.set("sgsa_employee_name", name);
  document.getElementById("employee-label").innerHTML = `<span class="material-symbols-outlined">person</span> ${esc(name)}`;
  closeModal("employee-modal"); openModal("office-modal"); loadOfficeModal();
}

// ─── Office ────────────────────────────────────────────────────────────────
async function loadOfficeModal() {
  if (offices.length) { renderOfficeList(offices); return; }
  try { const r = await fetch(API + "/api/oficinas"); const d = await r.json();
    if (d.ok) offices = d.oficinas; renderOfficeList(offices); } catch {}
}
function renderOfficeList(list) {
  const c = document.getElementById("officeList");
  if (!list.length) { c.innerHTML = '<div class="emp-empty">Sin sucursales</div>'; return; }
  c.innerHTML = list.map(o => `<div class="emp-item" data-name="${esc(o.nombre)}">
    <div class="emp-avatar-mini"><span class="material-symbols-outlined">apartment</span></div>
    <div class="emp-info"><span class="emp-nombre">${esc(o.nombre)}</span>${o.localidad ? `<span class="emp-oficina">${esc(o.localidad)}</span>` : ""}</div>
  </div>`).join("");
  c.querySelectorAll(".emp-item").forEach(el => el.addEventListener("click", () => {
    selectedOffice = el.dataset.name; store.set("sgsa_selected_office", selectedOffice);
    updateEmployeeLabel(); closeModal("office-modal"); loadAlerts();
  }));
}
document.getElementById("officeBackBtn").addEventListener("click", () => { closeModal("office-modal"); openModal("employee-modal"); loadEmployeeModal(); });
document.getElementById("officeSearch").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  renderOfficeList(offices.filter(o => o.nombre?.toLowerCase().includes(q) || o.localidad?.toLowerCase().includes(q)));
});

function updateEmployeeLabel() {
  let label = `<span class="material-symbols-outlined">person</span> ${esc(selectedEmployeeName)}`;
  if (selectedOffice) label += ` <span class="material-symbols-outlined" style="font-size:16px;color:var(--accent)">apartment</span> ${esc(selectedOffice)}`;
  document.getElementById("employee-label").innerHTML = label;
}

// ─── Alerts load ──────────────────────────────────────────────────────────
async function loadAlerts() {
  if (!selectedAirtableId) return;
  try {
    const r = await fetch(API + "/api/alerts?leidas=false", { headers: authToken ? { Authorization: "Bearer "+authToken } : {} });
    const d = await r.json();
    alerts = (d.alerts || []).filter(a => !a.leida);
    renderAlerts();
  } catch (e) { console.error(e); }
}

async function doAck(id) { try { await fetch(API + "/api/alerts/"+id+"/ack", { method:"POST", headers: authToken?{Authorization:"Bearer "+authToken}:{} }); } catch {} }
async function doStatus(id, estado) {
  try { await fetch(API + "/api/alerts/"+id+"/status", { method:"POST", headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})}, body:JSON.stringify({estado}) }); } catch {}
}

function renderAlerts() {
  const c = document.getElementById("alerts-list");
  const pending = alerts.filter(a => !a.leida);
  document.getElementById("alerts-badge").textContent = pending.length;
  if (!alerts.length) { c.innerHTML = '<div class="empty">Sin alertas pendientes</div>'; return; }
  c.innerHTML = alerts.map((a,i) => {
    const p = a.prioridad || "⚪"; let urg = 0;
    if (p.includes("🔴")) urg = 3; else if (p.includes("🟠")) urg = 2; else if (p.includes("🟡")) urg = 1;
    const exp = a._expanded ? "expanded" : "";
    let rows = "";
    if (a.detalle) {
      for (const line of a.detalle.split("\n")) {
        const ci = line.indexOf(":"); if (ci > 0) {
          const k = line.slice(0,ci).trim(), v = line.slice(ci+1).trim();
          rows += k&&v ? `<div class="row"><span class="label">${esc(k)}</span><span class="value">${esc(v)}</span></div>` : `<div>${esc(line)}</div>`;
        } else rows += `<div>${esc(line)}</div>`;
      }
    }
    if (a.link_registro) rows += `<div class="row"><span class="label">Link</span><span class="value"><a href="${esc(a.link_registro)}" target="_blank" style="color:var(--accent)">Abrir</a></span></div>`;
    return `<div class="alert-card urgencia-${urg} ${exp}" data-index="${i}" data-id="${a.id}">
      <div class="head"><div class="title">${esc(a.titulo||"Alerta")}</div><div class="urgencia">${p}</div></div>
      <div class="cuerpo">${esc(a.cuerpo||"")}</div>
      <div class="meta"><span>${(a.fecha||a.created_at||"").slice(0,10)}</span><span class="tag">${esc(a.tipo_alerta||"General")}</span>
      <span class="material-symbols-outlined expand-icon" style="font-size:14px">${exp?"expand_less":"expand_more"}</span></div>
      <div class="detalle">${rows}
        <div class="alert-actions${selectedOffice?"":" disabled-actions"}">
          ${selectedOffice ? `
          <button class="action-btn progreso-btn">En progreso</button>
          <button class="action-btn confirmar-btn">Turnos</button>
          <button class="action-btn concluido-btn">Concluido</button>
          <button class="action-btn anular-btn">Anular</button>
          <button class="ack-btn">Leído</button>
          ` : 'Seleccioná una sucursal para gestionar'}
        </div>
      </div></div>`;
  }).join("");

  c.querySelectorAll(".alert-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".action-btn,.ack-btn,.detalle a")) return;
      card.classList.toggle("expanded"); const idx = +card.dataset.index;
      alerts[idx]._expanded = card.classList.contains("expanded");
      const icon = card.querySelector(".expand-icon"); if (icon) icon.textContent = alerts[idx]._expanded ? "expand_less" : "expand_more";
    });
  });
  c.querySelectorAll(".ack-btn").forEach(b => b.addEventListener("click", async e => { e.stopPropagation(); await doAck(b.closest(".alert-card").dataset.id); loadAlerts(); }));
  c.querySelectorAll(".progreso-btn").forEach(b => b.addEventListener("click", async e => { e.stopPropagation(); await doStatus(b.closest(".alert-card").dataset.id,"EN_PROGRESO"); loadAlerts(); }));
  c.querySelectorAll(".confirmar-btn").forEach(b => b.addEventListener("click", async e => { e.stopPropagation(); await doStatus(b.closest(".alert-card").dataset.id,"TURNO_CONFIRMADO"); loadAlerts(); }));
  c.querySelectorAll(".concluido-btn").forEach(b => b.addEventListener("click", async e => { e.stopPropagation(); await doStatus(b.closest(".alert-card").dataset.id,"CONCLUIDA"); loadAlerts(); }));
  c.querySelectorAll(".anular-btn").forEach(b => b.addEventListener("click", async e => { e.stopPropagation(); await doStatus(b.closest(".alert-card").dataset.id,"ANULADA"); loadAlerts(); }));
}

function initAlerts() {
  selectedAirtableId = store.get("sgsa_selected_employee");
  selectedEmployeeName = store.get("sgsa_employee_name") || "";
  selectedOffice = store.get("sgsa_selected_office") || "";
  if (selectedAirtableId) { updateEmployeeLabel(); loadAlerts(); }
}

document.getElementById("changeEmployeeBtn").addEventListener("click", () => { openModal("employee-modal"); loadEmployeeModal(); });
document.getElementById("modalSearch").addEventListener("input", e => { const q = e.target.value.toLowerCase(); renderEmployeeList(employees.filter(emp => emp.nombre?.toLowerCase().includes(q))); });
document.getElementById("refreshBtn").addEventListener("click", loadAlerts);
document.getElementById("ackAllBtn").addEventListener("click", async () => {
  for (const card of document.querySelectorAll(".alert-card")) { const id = card.dataset.id; if (id) await doAck(id); }
  loadAlerts();
});

// =============================================================================
// CHAT
// =============================================================================
let conversations = [], selectedConversation = null, allEmployees = [];
let chatMuted = true, _pingTimer = null;

function initChat() { if (!authToken) return; refreshConversations(); startPing();
  if (window._chatTimer) clearInterval(window._chatTimer);
  window._chatTimer = setInterval(refreshConversations, REFRESH);
}
async function refreshConversations() {
  const d = await apiGet("/api/chat/conversations");
  if (d?.ok) { conversations = d.conversations; renderConversations(); }
}

function renderConversations() {
  const q = (document.getElementById("conversationSearch")?.value || "").toLowerCase();
  let f = q ? conversations.filter(c => c.display_name?.toLowerCase().includes(q)) : conversations;
  const c = document.getElementById("conversationList"), e = document.getElementById("inboxEmpty");
  if (!f.length) { c.innerHTML = ""; e.style.display = ""; return; }
  e.style.display = "none";
  c.innerHTML = f.map(cv => `<div class="group-card ${selectedConversation?.group_id===cv.group_id?"selected":""}" data-gid="${cv.group_id}">
    <div class="group-avatar">${cv.is_dm ? (cv.avatar_url ? `<img src="${cv.avatar_url}" class="group-avatar-img">` : '<span class="material-symbols-outlined">person</span>') : '<span class="material-symbols-outlined">groups</span>'}
      ${cv.is_dm ? `<span class="online-dot ${cv.online?"online":"offline"}"></span>` : ""}</div>
    <div class="group-info"><div class="group-name">${esc(cv.display_name||"Chat")}</div><div class="group-last-msg">${cv.last_message||"Sin mensajes"}</div></div>
    <div class="group-meta"><div class="group-time">${cv.last_message_time?timeAgo(cv.last_message_time):""}</div>${cv.unread>0?`<div class="group-unread">${cv.unread>99?"99+":cv.unread}</div>`:""}</div>
  </div>`).join("");
  c.querySelectorAll(".group-card").forEach(card => card.addEventListener("click", () => { const gid = card.dataset.gid; const cv = conversations.find(x => x.group_id == gid); if (cv) openConversation(cv); }));
}
document.getElementById("conversationSearch")?.addEventListener("input", renderConversations);

function timeAgo(iso) { if (!iso) return ""; const d = Date.now() - new Date(iso).getTime(); const m = Math.floor(d/60000); if (m<1) return "ahora"; if (m<60) return m+"m"; const h = Math.floor(m/60); if (h<24) return h+"h"; return Math.floor(h/24)+"d"; }

async function openConversation(cv) {
  selectedConversation = cv;
  document.getElementById("inbox-view").style.display = "none";
  document.getElementById("message-view").style.display = "";
  document.getElementById("chatBackBtn").style.display = "";
  document.getElementById("chatHeaderTitle").textContent = cv.display_name || "Chat";
  await loadMessages(cv.group_id); renderConversations();
}

document.getElementById("chatBackBtn").addEventListener("click", () => {
  selectedConversation = null;
  document.getElementById("inbox-view").style.display = "";
  document.getElementById("message-view").style.display = "none";
  document.getElementById("chatBackBtn").style.display = "none";
  document.getElementById("chatHeaderTitle").textContent = "Conversaciones";
  refreshConversations();
});

async function loadMessages(gid) {
  const d = await apiGet("/api/chat/mensajes/" + gid);
  const c = document.getElementById("messageList");
  if (!d?.ok) { c.innerHTML = '<div class="empty">Error al cargar mensajes</div>'; return; }
  const msgs = d.mensajes || [];
  if (!msgs.length) { document.getElementById("messageEmpty").style.display = ""; c.innerHTML = ""; return; }
  document.getElementById("messageEmpty").style.display = "none";
  const myId = currentUser?.airtable_id || currentUser?.id || "";
  c.innerHTML = msgs.reverse().map(m => {
    const isMine = m.remitente_id === myId;
    let body = `<div class="msg-text">${esc(m.texto||"")}</div>`;
    if (m.tipo_mensaje==="imagen" && m.archivo_url) body = `<div class="msg-attachment"><img src="${m.archivo_url}" loading="lazy"></div>`;
    else if ((m.tipo_mensaje==="video"||m.tipo_mensaje==="audio") && m.archivo_url)
      body = `<div class="msg-attachment">${m.tipo_mensaje==="audio"?`<audio controls src="${m.archivo_url}"></audio>`:`<video controls src="${m.archivo_url}" style="max-width:100%;max-height:300px"></video>`}</div>`;
    else if (m.archivo_url)
      body = `<div class="msg-attachment"><a class="file-link" href="${m.archivo_url}" target="_blank"><span class="material-symbols-outlined" style="font-size:16px">attach_file</span> ${esc(m.archivo_nombre||"Archivo")}</a></div>`;
    return `<div class="message ${isMine?"mine":"theirs"}">${!isMine?`<div class="sender-name">${esc(m.remitente_nombre||"")}</div>`:""}${body}<div class="msg-time">${timeAgo(m.created_at)}</div></div>`;
  }).join("");
  c.scrollTop = c.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("chatInput"); const text = input.value.trim();
  if (!text || !selectedConversation) return; input.value = "";
  const d = await apiPost("/api/chat/send", { grupo_id: selectedConversation.group_id, empleado_id: currentUser?.airtable_id, contenido: text });
  if (d?.ok) { loadMessages(selectedConversation.group_id); refreshConversations(); }
}
document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("chatInput").addEventListener("keydown", e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

// Attachments
document.getElementById("attachBtn").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file||!selectedConversation) return; e.target.value = "";
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch(API + "/api/chat/upload", { method:"POST", headers: authToken?{Authorization:"Bearer "+authToken}:{}, body: fd });
    const res = await r.json();
    if (res?.url) {
      await apiPost("/api/chat/messages", { grupo_id: selectedConversation.group_id, sender_id: currentUser?.airtable_id||currentUser?.id, mensaje: file.name, tipo: res.type||"documento", adjunto_url: res.url, adjunto_nombre: file.name });
      loadMessages(selectedConversation.group_id); refreshConversations();
    }
  } catch {}
});

// Ping
function startPing() { stopPing(); apiPost("/api/chat/ping",{}); _pingTimer = setInterval(()=>apiPost("/api/chat/ping",{}),30000); }
function stopPing() { if(_pingTimer){clearInterval(_pingTimer);_pingTimer=null;} }

// ─── People / Directory ──────────────────────────────────────────────────
document.getElementById("peopleBtn").addEventListener("click", () => { if(!authToken){showLogin();return;} openModal("peopleModal"); loadPeopleList(); });

async function loadPeopleList() {
  const d = await apiGet("/api/chat/employees");
  if (d?.ok) { allEmployees = (d.employees||[]).filter(e => e.id !== (currentUser?.airtable_id)); renderPeopleList(allEmployees); }
  else if (allEmployees.length) renderPeopleList(allEmployees);
}
function renderPeopleList(list) {
  const c = document.getElementById("peopleList");
  if (!list.length) { c.innerHTML = '<div class="emp-empty">Sin resultados</div>'; return; }
  c.innerHTML = list.map(e => `<div class="emp-item" data-empleado-id="${e.id}" data-empleado-nombre="${esc(e.nombre)}">
    <div class="emp-avatar-mini">${e.avatar_url?`<img src="${e.avatar_url}" class="emp-avatar-img">`:(e.nombre||"?")[0].toUpperCase()}<span class="online-dot ${e.online?"online":"offline"}"></span></div>
    <div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(e.nombre)}</div>${e.oficina_nombre?`<div style="font-size:11px;color:var(--fg2)">${esc(e.oficina_nombre)}</div>`:""}<div style="font-size:11px;color:var(--fg3)">${e.online?"En línea":"Desconectado"}</div></div>
    <span class="material-symbols-outlined" style="color:var(--accent);font-size:16px">chat</span>
  </div>`).join("");
  c.querySelectorAll(".emp-item").forEach(el => el.addEventListener("click", async () => {
    if (!authToken) { showLogin(); return; }
    const r = await apiPost("/api/chat/dm", { target_empleado_id: el.dataset.empleadoId });
    if (r?.ok) { closeModal("peopleModal"); openConversation({ group_id: r.group_id, display_name: el.dataset.empleadoNombre||"DM", is_dm: true, online: null, avatar_url: null }); refreshConversations(); }
    else alert("Error al iniciar DM");
  }));
}
document.getElementById("peopleSearch").addEventListener("input", e => { const q = e.target.value.toLowerCase(); renderPeopleList(allEmployees.filter(emp => emp.nombre?.toLowerCase().includes(q))); });

// ─── New Group ────────────────────────────────────────────────────────────
let selectedMembers = [];
document.getElementById("newGroupBtn").addEventListener("click", () => { if(!authToken){showLogin();return;} openModal("newGroupModal"); loadMemberSearch(); });

async function loadMemberSearch() {
  const d = await apiGet("/api/chat/employees"); const emps = (d?.ok) ? d.employees : allEmployees; allEmployees = emps;
  renderMemberList(emps.filter(e => !selectedMembers.find(m => m.airtable_id === e.airtable_id)));
}
function renderMemberList(list) {
  const c = document.getElementById("memberSearchResults");
  if (!list.length) { c.innerHTML = '<div class="emp-empty">Sin resultados</div>'; return; }
  c.innerHTML = list.map(e => `<div class="emp-item" data-airtable="${e.airtable_id||""}" data-name="${esc(e.nombre)}">
    <div class="emp-avatar-mini">${e.avatar_url?`<img src="${e.avatar_url}" class="emp-avatar-img">`:(e.nombre||"?")[0].toUpperCase()}</div>
    <div style="flex:1;font-size:13px">${esc(e.nombre)}</div>
    ${selectedMembers.find(m=>m.airtable_id===e.airtable_id)?'<span class="material-symbols-outlined" style="color:var(--success);font-size:16px">check</span>':'<span class="material-symbols-outlined" style="color:var(--accent);font-size:16px">add</span>'}
  </div>`).join("");
  c.querySelectorAll(".emp-item").forEach(el => el.addEventListener("click", () => {
    const aid = el.dataset.airtable;
    if (selectedMembers.find(m=>m.airtable_id===aid)) selectedMembers = selectedMembers.filter(m=>m.airtable_id!==aid);
    else selectedMembers.push({ airtable_id: aid, nombre: el.dataset.name });
    renderSelectedMembers(); renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)));
  }));
}
function renderSelectedMembers() {
  const c = document.getElementById("selectedMembers");
  if (!selectedMembers.length) { c.innerHTML = ""; return; }
  c.innerHTML = selectedMembers.map(m => `<div class="selected-member">${esc(m.nombre)}<span class="remove-member" data-airtable="${m.airtable_id}">✕</span></div>`).join("");
  c.querySelectorAll(".remove-member").forEach(el => el.addEventListener("click", () => {
    selectedMembers = selectedMembers.filter(m=>m.airtable_id!==el.dataset.airtable);
    renderSelectedMembers(); renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)));
  }));
}
document.getElementById("memberSearch").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  renderMemberList(allEmployees.filter(e => !selectedMembers.find(m=>m.airtable_id===e.airtable_id) && e.nombre?.toLowerCase().includes(q)));
});
document.getElementById("createGroupBtn").addEventListener("click", async () => {
  const name = document.getElementById("newGroupName").value.trim();
  if (!name) { alert("Poné un nombre al grupo"); return; }
  const d = await apiPost("/api/chat/grupos", { nombre: name, descripcion: document.getElementById("newGroupDesc").value.trim(), creado_por: currentUser?.airtable_id, miembros: selectedMembers.map(m=>m.airtable_id) });
  if (d?.ok) { closeModal("newGroupModal"); document.getElementById("newGroupName").value=""; document.getElementById("newGroupDesc").value=""; selectedMembers=[]; renderSelectedMembers(); refreshConversations(); }
  else alert("Error al crear grupo");
});

// ─── Modal helpers ─────────────────────────────────────────────────────────
function openModal(id) { const el = document.getElementById(id); if (el) el.style.display = "flex"; }
function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
document.querySelectorAll(".close-modal").forEach(b => b.addEventListener("click", () => closeModal(b.dataset.modal)));

// =============================================================================
// INIT — Multi-user: login-first, clear storage on logout
// =============================================================================
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});

(async function() {
  const ok = await restoreSession();
  if (ok) {
    // Load mute prefs
    chatMuted = store.get("sgsa_chat_muted") !== false;
    alertsMuted = store.get("sgsa_alerts_muted") !== false;
    document.getElementById("toggleChatMute").checked = chatMuted;
    document.getElementById("toggleAlertsMute").checked = alertsMuted;
    showApp();
  } else {
    showLogin();
  }
})();
