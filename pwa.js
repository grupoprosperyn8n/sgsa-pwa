// =============================================================================
// SGSA PWA — Chat + Alertas con Auth (Standalone Web App)
// =============================================================================
const API_BASE = "https://web-production-2584d.up.railway.app";
const REFRESH_INTERVAL = 30000;

// ─── Storage wrapper (localStorage instead of chrome.storage) ─────────────
const storage = {
  get(keys, cb) { try { const result = {}; for (const k of keys) result[k] = JSON.parse(localStorage.getItem(k)); cb(result); } catch { cb({}); } },
  set(obj, cb) { try { for (const [k, v] of Object.entries(obj)) localStorage.setItem(k, JSON.stringify(v)); if (cb) cb(); } catch {} },
  remove(keys, cb) { try { for (const k of keys) localStorage.removeItem(k); if (cb) cb(); } catch {} },
};

// ─── Auth ──────────────────────────────────────────────────────────────────────
let authToken = null;
let currentUser = null;
let currentEmployee = null; // for alerts
let employees = [];
let conversations = [];
let selectedConversation = null;
let allEmployees = [];
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;
let recordSeconds = 0;

function saveSession(token, user) {
  storageSet({ sgsa_token: token, sgsa_user: user });
}

function clearSession() {
  storageRemove(["sgsa_token", "sgsa_user"]);
  authToken = null;
  currentUser = null;
}

async function restoreSession() {
  const data = await storageGet(["sgsa_token", "sgsa_user"]);
  if (data.sgsa_token && data.sgsa_user) {
    authToken = data.sgsa_token;
    currentUser = data.sgsa_user;
    const me = await apiGet("/api/chat/auth/me");
    if (me && me.ok) {
      currentUser = me.user;
      saveSession(authToken, currentUser);
      return true;
    }
    // Token expired
    clearSession();
    return false;
  }
  return false;
}

// ─── API helpers ────────────────────────────────────────────────────────────────
async function apiGet(path) {
  try {
    const resp = await fetch(API_BASE + path, {
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
    });
    if (resp.status === 401 && authToken) {
      clearSession();
      showLogin();
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.error("apiGet", path, e);
    return null;
  }
}

async function apiPost(path, body) {
  try {
    const resp = await fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 401 && authToken) {
      clearSession();
      showLogin();
      return null;
    }
    return await resp.json();
  } catch (e) {
    console.error("apiPost", path, e);
    return null;
  }
}

// ─── Login screen ──────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById("login-screen").style.display = "";
  document.getElementById("main-app").style.display = "none";
  document.getElementById("loginError").textContent = "";
  document.getElementById("loginLoading").style.display = "none";
}

function showMainApp(tabToActivate) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("main-app").style.display = "";
  document.getElementById("employee-label").textContent =
    "👤 " + (currentUser?.nombre || "Sin seleccionar");
  initChat();
  initAlerts();
  if (tabToActivate) switchTab(tabToActivate);
}

let _pendingChatTab = false; // true when login was triggered by clicking Chat tab

document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!email || !password) {
    document.getElementById("loginError").textContent = "Completá ambos campos";
    return;
  }
  document.getElementById("loginLoading").style.display = "";
  document.getElementById("loginError").textContent = "";

  const result = await apiPost("/api/chat/auth/login", { email, password });
  document.getElementById("loginLoading").style.display = "none";
  if (result && result.ok) {
    authToken = result.access_token;
    currentUser = result.user;
    saveSession(authToken, currentUser);
    showMainApp(_pendingChatTab ? "chat" : null);
    _pendingChatTab = false;
  } else {
    document.getElementById("loginError").textContent =
      "Credenciales incorrectas. Usá tu mismo email y contraseña del portal empleado.";
  }
});

document.getElementById("loginPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("loginEmail").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginPassword").focus();
});

// ─── Logout (moved to chat header) ─────────────────────────────────────────────
document.getElementById("chatLogoutBtn").addEventListener("click", () => {
  clearSession();
  stopPolling();
  showMainApp();
});

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  // Chat tab requires login
  if (tab === "chat" && !authToken) {
    _pendingChatTab = true;
    showLogin();
    return;
  }
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (btn) btn.classList.add("active");
  const content = document.getElementById(tab + "-tab");
  if (content) content.classList.add("active");
  if (tab === "chat") refreshConversations();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// =============================================================================
// ALERTS (mostly unchanged from original, adapted for auth)
// =============================================================================
let alerts = [];
let alertTimer = null;
let selectedAirtableId = null;

async function loadEmployeeModal() {
  if (employees.length) {
    renderEmployeeList(employees);
    return;
  }
  try {
    const resp = await fetch(API_BASE + "/api/chat/employees", {
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
    });
    const data = await resp.json();
    if (data.ok) employees = data.employees;
    renderEmployeeList(employees);
  } catch (e) {
    console.error("Error loading employees:", e);
  }
}

function renderEmployeeList(list) {
  const container = document.getElementById("modalList");
  if (!list.length) {
    container.innerHTML = '<div class="emp-empty">Sin resultados</div>';
    return;
  }
  container.innerHTML = list
    .map(
      (e) =>
        `<div class="emp-item" data-id="${e.id}" data-airtable="${e.airtable_id || ""}">
          <div class="emp-avatar-mini">${e.avatar_url ? `<img src="${e.avatar_url}" class="emp-avatar-img" />` : (e.nombre || "?")[0].toUpperCase()}</div>
          <div class="emp-info"><span class="emp-nombre">${e.nombre}</span>${e.oficina_nombre ? `<span class="emp-oficina">${e.oficina_nombre}</span>` : ""}</div>
        </div>`
    )
    .join("");

  container.querySelectorAll(".emp-item").forEach((el) => {
    el.addEventListener("click", () => {
      const airtable = el.dataset.airtable;
      if (airtable) selectEmployee(airtable, el.querySelector("span").textContent);
      closeModal("employee-modal");
    });
  });
}

function selectEmployee(airtableId, name) {
  selectedAirtableId = airtableId;
  selectedEmployeeName = name;
  document.getElementById("employee-label").textContent = "👤 " + name;
  storageSet({ sgsa_selected_employee: airtableId, sgsa_employee_name: name });
  closeModal("employee-modal");
  // Immediately open office selection modal
  openModal("office-modal");
  loadOfficeModal();
}

// ─── Office selection (second step after employee) ────────────────────────────
let selectedOffice = "";
let selectedEmployeeName = "";
let offices = [];

async function loadOfficeModal() {
  if (offices.length) {
    renderOfficeList(offices);
    return;
  }
  try {
    const resp = await fetch(API_BASE + "/api/oficinas");
    const data = await resp.json();
    if (data.ok) offices = data.oficinas;
    renderOfficeList(offices);
  } catch (e) {
    console.error("Error loading offices:", e);
  }
}

function renderOfficeList(list) {
  const container = document.getElementById("officeList");
  if (!list.length) {
    container.innerHTML = '<div class="emp-empty">Sin sucursales</div>';
    return;
  }
  container.innerHTML = list.map((o) =>
    `<div class="emp-item" data-id="${escapeHtml(o.id)}" data-name="${escapeHtml(o.nombre)}">
      <div class="emp-avatar-mini">🏢</div>
      <div class="emp-info">
        <span class="emp-nombre">${escapeHtml(o.nombre)}</span>
        ${o.localidad ? `<span class="emp-oficina">${escapeHtml(o.localidad)}</span>` : ""}
      </div>
    </div>`
  ).join("");

  container.querySelectorAll(".emp-item").forEach((el) => {
    el.addEventListener("click", () => {
      selectedOffice = el.dataset.name;
      storageSet({ sgsa_selected_office: selectedOffice });
      document.getElementById("employee-label").textContent =
        "👤 " + selectedEmployeeName + " 🏢 " + selectedOffice;
      closeModal("office-modal");
      loadAlerts();
    });
  });
}

// Office modal back button → go back to employee selection
document.addEventListener("DOMContentLoaded", () => {
  const officeBack = document.getElementById("officeBackBtn");
  if (officeBack) {
    officeBack.addEventListener("click", () => {
      closeModal("office-modal");
      openModal("employee-modal");
      loadEmployeeModal();
    });
  }
  const closeOffice = document.getElementById("closeOfficeModalBtn");
  if (closeOffice) {
    closeOffice.addEventListener("click", () => closeModal("office-modal"));
  }
  // Office search
  const officeSearch = document.getElementById("officeSearch");
  if (officeSearch) {
    officeSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      renderOfficeList(offices.filter((o) => o.nombre?.toLowerCase().includes(q) || o.localidad?.toLowerCase().includes(q)));
    });
  }
});

async function loadAlerts() {
  if (!selectedAirtableId) return;
  try {
    const resp = await fetch(API_BASE + "/api/alerts?leidas=false", {
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
    });
    const data = await resp.json();
    alerts = (data.alerts || []).filter(a => !a.leida);
    renderAlerts();
  } catch (e) {
    console.error("Error loading alerts:", e);
  }
}

async function doAck(alertId) {
  try {
    await fetch(API_BASE + "/api/alerts/" + alertId + "/ack", {
      method: "POST",
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
    });
  } catch (e) {
    console.error("Error ack:", e);
  }
}

async function doStatusUpdate(alertId, estado) {
  try {
    await fetch(API_BASE + "/api/alerts/" + alertId + "/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
      },
      body: JSON.stringify({ estado }),
    });
  } catch (e) {
    console.error("Error status:", e);
  }
}

function renderAlerts() {
  const container = document.getElementById("alerts-list");
  const pending = alerts.filter((a) => !a.leida);
  document.getElementById("alerts-badge").textContent = pending.length;

  if (!alerts.length) {
    container.innerHTML = '<div class="empty">✅ Sin alertas pendientes</div>';
    return;
  }

  container.innerHTML = alerts
    .map((a, i) => {
      const prioridadStr = a.prioridad || "⚪";
      let urgClass = 0;
      if (prioridadStr.includes("🔴")) urgClass = 3;
      else if (prioridadStr.includes("🟠")) urgClass = 2;
      else if (prioridadStr.includes("🟡")) urgClass = 1;
      const expanded = a._expanded ? "expanded" : "";
      const leida = a.leida ? "" : "no-leida";
      const fechaStr = (a.fecha || a.created_at || "").slice(0, 10);

      // Parse detalle text (Clave: Valor\nClave2: Valor2 format)
      let detalleRows = "";
      if (a.detalle) {
        const lines = a.detalle.split("\n");
        for (const line of lines) {
          const colonIdx = line.indexOf(":");
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const val = line.slice(colonIdx + 1).trim();
            if (key && val) {
              detalleRows += `<div class="row"><span class="label">${escapeHtml(key)}</span><span class="value">${escapeHtml(val)}</span></div>`;
            } else {
              detalleRows += `<div class="row-full">${escapeHtml(line)}</div>`;
            }
          } else {
            detalleRows += `<div class="row-full">${escapeHtml(line)}</div>`;
          }
        }
      }
      if (a.link_registro) {
        detalleRows += `<div class="row"><span class="label">Link</span><span class="value"><a href="${escapeHtml(a.link_registro)}" target="_blank" style="color:#3b82f6">🔗 Abrir</a></span></div>`;
      }
      return `
        <div class="alert-card urgencia-${urgClass} ${expanded} ${leida}" data-index="${i}" data-id="${a.id}">
          <div class="head">
            <div class="title">${a.titulo || "Alerta"}</div>
            <div class="urgencia">${prioridadStr}</div>
          </div>
          <div class="cuerpo">${a.cuerpo || ""}</div>
          <div class="meta">
            <span>${fechaStr}</span>
            <span class="tag">${a.tipo_alerta || "General"}</span>
            <span class="expand-icon">${expanded ? "▼" : "▶"}</span>
          </div>
          <div class="detalle">
            ${detalleRows}
            <div class="alert-actions${selectedOffice ? "" : " disabled-actions"}">
              ${selectedOffice ? `
              <button class="action-btn progreso-btn">👷 En progreso</button>
              <button class="action-btn confirmar-btn">📅 Turnos</button>
              <button class="action-btn concluido-btn">✅ Concluido</button>
              <button class="action-btn anular-btn">❌ Anular</button>
              <button class="ack-btn">✓ Leído</button>
              ` : '<span style="font-size:11px;color:#64748b">Seleccioná una sucursal para gestionar</span>'}
            </div>
          </div>
        </div>`;
    })
    .join("");

  // Click to expand (not on buttons/links)
  container.querySelectorAll(".alert-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".ack-btn")) return;
      if (e.target.closest(".action-btn")) return;
      if (e.target.closest(".detalle a")) return;
      card.classList.toggle("expanded");
      const idx = parseInt(card.dataset.index);
      alerts[idx]._expanded = card.classList.contains("expanded");
      const icon = card.querySelector(".expand-icon");
      if (icon) icon.textContent = alerts[idx]._expanded ? "▼" : "▶";
    });
  });

  // Ack button
  container.querySelectorAll(".ack-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await doAck(btn.closest(".alert-card").dataset.id);
      loadAlerts();
    });
  });

  // Status buttons
  container.querySelectorAll(".progreso-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await doStatusUpdate(btn.closest(".alert-card").dataset.id, "EN_PROGRESO");
      loadAlerts();
    });
  });
  container.querySelectorAll(".confirmar-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await doStatusUpdate(btn.closest(".alert-card").dataset.id, "TURNO_CONFIRMADO");
      loadAlerts();
    });
  });
  container.querySelectorAll(".concluido-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await doStatusUpdate(btn.closest(".alert-card").dataset.id, "CONCLUIDA");
      loadAlerts();
    });
  });
  container.querySelectorAll(".anular-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await doStatusUpdate(btn.closest(".alert-card").dataset.id, "ANULADA");
      loadAlerts();
    });
  });
}

function initAlerts() {
  storageGet(["sgsa_selected_employee", "sgsa_employee_name", "sgsa_selected_office"], (data) => {
    if (data.sgsa_selected_employee) {
      selectedAirtableId = data.sgsa_selected_employee;
      selectedEmployeeName = data.sgsa_employee_name || "Seleccionado";
      let label = "👤 " + selectedEmployeeName;
      if (data.sgsa_selected_office) {
        selectedOffice = data.sgsa_selected_office;
        label += " 🏢 " + data.sgsa_selected_office;
      }
      document.getElementById("employee-label").textContent = label;
      loadAlerts();
    }
  });
}

const alertsTab = document.getElementById("alerts-tab");
if (alertsTab) {
  document.getElementById("changeEmployeeBtn").addEventListener("click", () => {
    openModal("employee-modal");
    loadEmployeeModal();
  });

  document.getElementById("closeModalBtn").addEventListener("click", () => closeModal("employee-modal"));

  document.getElementById("modalSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderEmployeeList(employees.filter((emp) => emp.nombre?.toLowerCase().includes(q)));
  });

  document.getElementById("refreshBtn").addEventListener("click", loadAlerts);

  document.getElementById("ackAllBtn").addEventListener("click", async () => {
    const cards = document.querySelectorAll(".alert-card");
    for (const card of cards) {
      const id = card.dataset.id;
      if (id) await doAck(id);
    }
    loadAlerts();
  });
}

function startAlertPolling() {
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = setInterval(loadAlerts, REFRESH_INTERVAL);
}

function stopPolling() {
  if (alertTimer) clearInterval(alertTimer);
  if (window._chatTimer) clearInterval(window._chatTimer);
  stopPing();
  alertTimer = null;
  window._chatTimer = null;
}

// =============================================================================
// CHAT — Unified Inbox + DMs + Groups
// =============================================================================

function initChat() {
  if (!authToken) return;  // don't poll until logged in
  refreshConversations();
  loadMutePref();
  startPing();
  if (window._chatTimer) clearInterval(window._chatTimer);
  window._chatTimer = setInterval(refreshConversations, REFRESH_INTERVAL);
}

async function refreshConversations() {
  const data = await apiGet("/api/chat/conversations");
  if (data && data.ok) {
    conversations = data.conversations;
    renderConversations();
    const totalUnread = conversations.reduce((s, c) => s + (c.unread || 0), 0);
    document.getElementById("chat-badge").textContent = totalUnread;
  }
}

function renderConversations() {
  const q = (document.getElementById("conversationSearch")?.value || "").toLowerCase();
  let filtered = conversations;
  if (q) {
    filtered = conversations.filter((c) => c.display_name?.toLowerCase().includes(q));
  }

  const container = document.getElementById("conversationList");
  const empty = document.getElementById("inboxEmpty");

  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";

  container.innerHTML = filtered
    .map(
      (c) => `
      <div class="group-card ${selectedConversation?.group_id === c.group_id ? "selected" : ""}" data-gid="${c.group_id}">
        <div class="group-avatar" style="position:relative">
          ${c.is_dm ? (c.avatar_url ? `<img src="${c.avatar_url}" class="group-avatar-img" />` : "👤") : "👥"}
          ${c.is_dm ? `<span class="online-dot ${c.online ? "online" : "offline"}"></span>` : ""}
        </div>
        <div class="group-info">
          <div class="group-name">${c.display_name}</div>
          <div class="group-last-msg">${c.last_message || "Sin mensajes"}</div>
        </div>
        <div class="group-meta">
          <div class="group-time">${c.last_message_time ? timeAgo(c.last_message_time) : ""}</div>
          ${c.unread > 0 ? `<div class="group-unread">${c.unread > 99 ? "99+" : c.unread}</div>` : ""}
        </div>
      </div>`
    )
    .join("");

  container.querySelectorAll(".group-card").forEach((card) => {
    card.addEventListener("click", () => {
      const gid = card.dataset.gid;
      const conv = conversations.find((c) => c.group_id == gid);
      if (conv) openConversation(conv);
    });
  });
}

document.getElementById("conversationSearch")?.addEventListener("input", renderConversations);

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + "d";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

async function openConversation(conv) {
  selectedConversation = conv;
  document.getElementById("inbox-view").style.display = "none";
  document.getElementById("message-view").style.display = "flex";
  document.getElementById("chatBackBtn").style.display = "";

  const title = conv.display_name;
  const onlineStatus = conv.is_dm ? (conv.online ? " 🟢" : " 🔴") : "";
  document.getElementById("chatHeaderTitle").textContent = "💬 " + title + onlineStatus;

  await loadMessages(conv.group_id);
}

async function loadMessages(groupId) {
  const container = document.getElementById("messageList");
  const empty = document.getElementById("messageEmpty");
  container.innerHTML = '<div class="empty" style="padding:20px">🔄 Cargando...</div>';
  empty.style.display = "none";

  // Fetch messages via the existing group messages endpoint
  const data = await apiGet("/api/chat/mensajes/" + groupId);
  if (!data || !data.ok) {
    container.innerHTML = '<div class="empty">Error cargando mensajes</div>';
    return;
  }

  const mensajes = data.mensajes || [];
  if (!mensajes.length) {
    container.innerHTML = "";
    empty.style.display = "";
    return;
  }

  container.innerHTML = mensajes
    .map((m) => {
      const isMine = m.creado_por === currentUser?.airtable_id;
      const sender = m.sender_name || "";
      const hasFile = m.archivo_url || m.tiene_archivo;
      return `
        <div class="message ${isMine ? "mine" : "theirs"}">
          ${!isMine && sender ? `<div class="sender-name">${sender}</div>` : ""}
          <div class="msg-text">${escapeHtml(m.contenido || "")}</div>
          ${hasFile ? renderAttachment(m) : ""}
          <div class="msg-time">${m.created_at ? timeAgo(m.created_at) : ""}</div>
        </div>`;
    })
    .join("");

  container.scrollTop = container.scrollHeight;

  // Mark as read
  const lastMsg = mensajes[mensajes.length - 1];
  if (lastMsg) {
    apiPost("/api/chat/read", {
      grupo_id: groupId,
      empleado_id: currentUser?.airtable_id,
      ultimo_mensaje_id: lastMsg.id,
    });
  }
}

function renderAttachment(m) {
  const url = m.archivo_url || "";
  const isImage = url.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i);
  const isVideo = url.match(/\.(mp4|webm|mov|avi)(\?|$)/i);
  const isAudio = url.match(/\.(mp3|wav|ogg|m4a)(\?|$)/i);

  if (isImage) {
    return `<div class="msg-attachment"><img src="${url}" alt="Imagen" loading="lazy" /></div>`;
  } else if (isVideo) {
    return `<div class="msg-attachment"><video src="${url}" controls></video></div>`;
  } else if (isAudio) {
    return `<div class="msg-attachment"><audio src="${url}" controls></audio></div>`;
  } else {
    const name = url.split("/").pop() || "Archivo";
    return `<div class="msg-attachment"><a class="file-link" href="${url}" target="_blank">📎 ${name}</a></div>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Mute notifications (individual per tab) ────────────────────────────────
let chatMuted = false;
let alertsMuted = false;

document.getElementById("muteBtn")?.addEventListener("click", async () => {
  chatMuted = !chatMuted;
  await storageSet({ sgsa_chat_muted: chatMuted });
  document.getElementById("muteBtn").textContent = chatMuted ? "🔇" : "🔔";
  document.getElementById("muteBtn").title = chatMuted ? "Notificaciones de chat silenciadas" : "Silenciar notificaciones de chat";
});

document.getElementById("alertsMuteBtn")?.addEventListener("click", async () => {
  alertsMuted = !alertsMuted;
  await storageSet({ sgsa_alerts_muted: alertsMuted });
  document.getElementById("alertsMuteBtn").textContent = alertsMuted ? "🔇" : "🔔";
  document.getElementById("alertsMuteBtn").title = alertsMuted ? "Notificaciones de alertas silenciadas" : "Silenciar notificaciones de alertas";
});

async function loadMutePref() {
  const data = await storageGet(["sgsa_chat_muted", "sgsa_alerts_muted"]);
  chatMuted = data.sgsa_chat_muted === true;
  alertsMuted = data.sgsa_alerts_muted === true;
  const chatBtn = document.getElementById("muteBtn");
  if (chatBtn) {
    chatBtn.textContent = chatMuted ? "🔇" : "🔔";
    chatBtn.title = chatMuted ? "Notificaciones de chat silenciadas" : "Silenciar notificaciones de chat";
  }
  const alertsBtn = document.getElementById("alertsMuteBtn");
  if (alertsBtn) {
    alertsBtn.textContent = alertsMuted ? "🔇" : "🔔";
    alertsBtn.title = alertsMuted ? "Notificaciones de alertas silenciadas" : "Silenciar notificaciones de alertas";
  }
}

// ─── Online ping ──────────────────────────────────────────────────────────────
let _pingTimer = null;

function startPing() {
  if (_pingTimer) clearInterval(_pingTimer);
  // Ping immediately
  apiPost("/api/chat/ping", {});
  // Then every 30s
  _pingTimer = setInterval(() => apiPost("/api/chat/ping", {}), 30000);
}

function stopPing() {
  if (_pingTimer) {
    clearInterval(_pingTimer);
    _pingTimer = null;
  }
}

// ─── Chat navigation ──────────────────────────────────────────────────────────
document.getElementById("chatBackBtn").addEventListener("click", () => {
  selectedConversation = null;
  document.getElementById("inbox-view").style.display = "";
  document.getElementById("message-view").style.display = "none";
  document.getElementById("chatBackBtn").style.display = "none";
  document.getElementById("chatHeaderTitle").textContent = "💬 Conversaciones";
  refreshConversations();
});

// ─── Send message ──────────────────────────────────────────────────────────────
document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !selectedConversation) return;

  input.value = "";
  const data = await apiPost("/api/chat/send", {
    grupo_id: selectedConversation.group_id,
    empleado_id: currentUser?.airtable_id,
    contenido: text,
  });

  if (data && data.ok) {
    loadMessages(selectedConversation.group_id);
    refreshConversations();
  }
}

// ─── File attachment ──────────────────────────────────────────────────────────
document.getElementById("attachBtn").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !selectedConversation) return;
  e.target.value = "";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("grupo_id", selectedConversation.group_id);
  formData.append("empleado_id", currentUser?.airtable_id);

  try {
    const resp = await fetch(API_BASE + "/api/chat/upload?" + new URLSearchParams({
      grupo_id: selectedConversation.group_id,
      empleado_id: currentUser?.airtable_id,
    }), {
      method: "POST",
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
      body: formData,
    });
    const data = await resp.json();
    if (data.ok) {
      loadMessages(selectedConversation.group_id);
    }
  } catch (e) {
    console.error("Upload error:", e);
  }
});

// ─── New Group ──────────────────────────────────────────────────────────────────
document.getElementById("newGroupBtn").addEventListener("click", () => {
  if (!authToken) {
    _pendingChatTab = true;
    showLogin();
    return;
  }
  openModal("newGroupModal");
  loadMemberSearch();
});

document.getElementById("closeNewGroupModal").addEventListener("click", () => {
  closeModal("newGroupModal");
});

let selectedMembers = [];

async function loadMemberSearch() {
  if (allEmployees.length) {
    renderMemberList(allEmployees);
    return;
  }
  const data = await apiGet("/api/chat/employees");
  if (data && data.ok) {
    allEmployees = (data.employees || []).filter(
      (e) => e.airtable_id && e.airtable_id !== currentUser?.airtable_id
    );
    renderMemberList(allEmployees);
  }
}

function renderMemberList(list) {
  const container = document.getElementById("memberSearchResults");
  const selectedIds = selectedMembers.map((m) => m.airtable_id);
  container.innerHTML = list
    .filter((e) => !selectedIds.includes(e.airtable_id))
    .map(
      (e) =>
        `<div class="emp-item" data-airtable="${e.airtable_id}" data-nombre="${e.nombre}">
          <div class="emp-avatar-mini">${e.avatar_url ? `<img src="${e.avatar_url}" class="emp-avatar-img" />` : (e.nombre || "?")[0].toUpperCase()}</div>
          <div class="emp-info"><span class="emp-nombre">${e.nombre}</span>${e.oficina_nombre ? `<span class="emp-oficina">${e.oficina_nombre}</span>` : ""}</div>
        </div>`
    )
    .join("");

  container.querySelectorAll(".emp-item").forEach((el) => {
    el.addEventListener("click", () => {
      selectedMembers.push({
        airtable_id: el.dataset.airtable,
        nombre: el.dataset.nombre,
      });
      renderSelectedMembers();
      renderMemberList(
        allEmployees.filter(
          (e) => !selectedMembers.find((m) => m.airtable_id === e.airtable_id)
        )
      );
    });
  });
}

function renderSelectedMembers() {
  const container = document.getElementById("selectedMembers");
  if (!selectedMembers.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = selectedMembers
    .map(
      (m) =>
        `<span class="selected-member-tag">
          ${m.nombre}
          <span class="remove-member" data-airtable="${m.airtable_id}">✕</span>
        </span>`
    )
    .join("");

  container.querySelectorAll(".remove-member").forEach((el) => {
    el.addEventListener("click", () => {
      selectedMembers = selectedMembers.filter((m) => m.airtable_id !== el.dataset.airtable);
      renderSelectedMembers();
      renderMemberList(allEmployees.filter((e) => !selectedMembers.find((m) => m.airtable_id === e.airtable_id)));
    });
  });
}

document.getElementById("memberSearch").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allEmployees.filter(
    (emp) =>
      emp.nombre?.toLowerCase().includes(q) &&
      !selectedMembers.find((m) => m.airtable_id === emp.airtable_id)
  );
  renderMemberList(filtered);
});

document.getElementById("createGroupBtn").addEventListener("click", async () => {
  const name = document.getElementById("newGroupName").value.trim();
  if (!name) {
    alert("El nombre del grupo es obligatorio");
    return;
  }
  if (!selectedMembers.length) {
    alert("Seleccioná al menos un miembro");
    return;
  }

  const memberIds = selectedMembers.map((m) => m.airtable_id);

  // Create group via existing endpoint
  const data = await apiPost("/api/chat/grupos", {
    nombre: name,
    descripcion: document.getElementById("newGroupDesc").value.trim(),
    creado_por: currentUser?.airtable_id,
    miembros: memberIds,
  });

  if (data && data.ok) {
    closeModal("newGroupModal");
    document.getElementById("newGroupName").value = "";
    document.getElementById("newGroupDesc").value = "";
    selectedMembers = [];
    renderSelectedMembers();
    refreshConversations();
  } else {
    alert("Error al crear grupo");
  }
});

// ─── People / DM ────────────────────────────────────────────────────────────────
document.getElementById("peopleBtn").addEventListener("click", () => {
  if (!authToken) {
    _pendingChatTab = true;
    showLogin();
    return;
  }
  openModal("peopleModal");
  loadPeopleList();
});

document.getElementById("closePeopleModal").addEventListener("click", () => {
  closeModal("peopleModal");
});

async function loadPeopleList() {
  const data = await apiGet("/api/chat/employees");
  if (data && data.ok) {
    allEmployees = (data.employees || []).filter((e) => {
      const myAirtableId = currentUser?.airtable_id;
      return e.id !== myAirtableId;
    });
    renderPeopleList(allEmployees);
  } else if (allEmployees.length) {
    renderPeopleList(allEmployees);
  }
}

function renderPeopleList(list) {
  const container = document.getElementById("peopleList");
  if (!list.length) {
    container.innerHTML = '<div class="emp-empty">Sin resultados</div>';
    return;
  }
  container.innerHTML = list
    .map(
      (e) =>
        `<div class="emp-item" data-empleado-id="${e.id}" data-empleado-nombre="${e.nombre}">
           <div class="emp-avatar-mini" style="position:relative">
             ${e.avatar_url ? `<img src="${e.avatar_url}" class="emp-avatar-img" />` : (e.nombre || "?")[0].toUpperCase()}
             <span class="online-dot ${e.online ? "online" : "offline"}"></span>
           </div>
           <div style="flex:1">
             <div style="font-size:13px;font-weight:500">${e.nombre}</div>
             ${e.oficina_nombre ? `<div style="font-size:11px;color:#94a3b8">${e.oficina_nombre}</div>` : ""}
             <div style="font-size:11px;color:#64748b">${e.online ? "🟢 En línea" : "🔴 Desconectado"}</div>
           </div>
           <span style="color:#3b82f6;font-size:12px">💬 DM</span>
         </div>`
    )
    .join("");

  container.querySelectorAll(".emp-item").forEach((el) => {
    el.addEventListener("click", async () => {
      if (!authToken) {
        _pendingChatTab = true;
        showLogin();
        return;
      }
      const targetId = el.dataset.empleadoId;
      const targetNombre = el.dataset.empleadoNombre;
      const result = await apiPost("/api/chat/dm", { target_empleado_id: targetId });
      if (result && result.ok) {
        closeModal("peopleModal");
        switchTab("chat");
        // Build a synthetic conversation object so we open the message view directly
        // without waiting for refreshConversations() to complete
        const conv = {
          group_id: result.group_id,
          display_name: targetNombre || "DM",
          is_dm: true,
          online: null,
          avatar_url: null,
        };
        openConversation(conv);
        // Refresh conversations in background for the inbox list
        refreshConversations();
      } else {
        alert("Error al iniciar DM. Revisá que el empleado exista.");
      }
    });
  });
}

document.getElementById("peopleSearch").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderPeopleList(allEmployees.filter((emp) => emp.nombre?.toLowerCase().includes(q)));
});

// ─── Audio recording ──────────────────────────────────────────────────────────
document.getElementById("attachBtn")?.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openModal("audioModal");
});

document.getElementById("closeAudioModal").addEventListener("click", () => {
  closeModal("audioModal");
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
});

document.getElementById("startRecordBtn").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      document.getElementById("sendAudioBtn").style.display = "";
      if (recordTimer) clearInterval(recordTimer);
    };

    mediaRecorder.start();
    document.getElementById("startRecordBtn").style.display = "none";
    document.getElementById("stopRecordBtn").style.display = "";
    recordSeconds = 0;
    recordTimer = setInterval(() => {
      recordSeconds++;
      const m = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
      const s = String(recordSeconds % 60).padStart(2, "0");
      document.getElementById("audioTimer").textContent = m + ":" + s;
    }, 1000);
  } catch (e) {
    console.error("Audio error:", e);
  }
});

document.getElementById("stopRecordBtn").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    document.getElementById("startRecordBtn").style.display = "";
    document.getElementById("stopRecordBtn").style.display = "none";
  }
});

document.getElementById("sendAudioBtn").addEventListener("click", async () => {
  if (!audioChunks.length || !selectedConversation) return;
  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const file = new File([blob], "audio.webm", { type: "audio/webm" });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("grupo_id", selectedConversation.group_id);
  formData.append("empleado_id", currentUser?.airtable_id);

  try {
    const resp = await fetch(API_BASE + "/api/chat/upload?" + new URLSearchParams({
      grupo_id: selectedConversation.group_id,
      empleado_id: currentUser?.airtable_id,
    }), {
      method: "POST",
      headers: authToken ? { Authorization: "Bearer " + authToken } : {},
      body: formData,
    });
    const data = await resp.json();
    if (data.ok) {
      closeModal("audioModal");
      document.getElementById("audioTimer").textContent = "00:00";
      document.getElementById("sendAudioBtn").style.display = "none";
      loadMessages(selectedConversation.group_id);
    }
  } catch (e) {
    console.error("Audio upload error:", e);
  }
});

// ─── Modal helpers ──────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).style.display = "flex";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

// Close modals by clicking backdrop
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m) m.style.display = "none";
  });
});

// =============================================================================
// INIT — alerts always accessible, chat requires login
// =============================================================================
// Track window resize → save dimensions for next session
let _resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "windowResized",
      width: window.outerWidth,
      height: window.outerHeight,
    }).catch(() => {}); // svc worker might not be listening, ignore
  }, 300);
});

(async function init() {
  // Silently restore session for Chat tab
  const loggedIn = await restoreSession();
  if (!loggedIn) { authToken = null; currentUser = null; }
  showMainApp();
  if (loggedIn) initChat();
})();
