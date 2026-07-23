// =============================================================================
// SGSA PWA v7 — Full-featured: sounds, search, pins, offline, export, etc.
// =============================================================================
const API="https://web-production-2584d.up.railway.app",R=45000;

// ─── Storage ──────────────────────────────────────────────────────────────
const S={get(k){try{return JSON.parse(localStorage.getItem(k))}catch{return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},del(k){try{localStorage.removeItem(k)}catch{}}};
function esc(t){const d=document.createElement("div");d.textContent=t;return d.innerHTML}
function linkify(text){return esc(text).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>')}

// ─── Avatar color hash ───────────────────────────────────────────────────
const AVATAR_COLORS=["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#98D8C8","#F7DC6F","#BB8FCE","#85C1E9","#F0B27A","#82E0AA","#F1948A","#AED6F1","#A3E4D7","#FAD7A0","#D7BDE2","#A9CCE3"];
function avatarColor(name){let h=0;for(let i=0;i<(name||"").length;i++)h=name.charCodeAt(i)+((h<<5)-h);return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length]}
function avatarInitials(name){return(name||"?").split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase()}

// ─── Sound engine (Web Audio API, no external files) ──────────────────────
const Sound={ctx:null,init(){if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)()},
  beep(freq,dur,vol=.05){try{this.init();const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type="sine";o.frequency.value=freq;g.gain.setValueAtTime(vol,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+dur);o.connect(g);g.connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+dur)}catch{}},
  chat(){this.beep(880,.1,.04);setTimeout(()=>this.beep(1100,.08,.03),80)},
  alert(){this.beep(660,.15,.06);setTimeout(()=>this.beep(880,.1,.04),100);setTimeout(()=>this.beep(1100,.12,.05),200)},
};

// ─── Toast ────────────────────────────────────────────────────────────────
function toast(msg,type=""){const t=document.createElement("div");t.className="toast "+type;t.innerHTML=`<span class="material-symbols-outlined" style="font-size:18px">${type==="success"?"check_circle":type==="error"?"error":"info"}</span>${esc(msg)}`;document.body.appendChild(t);setTimeout(()=>{t.style.opacity="0";t.style.transition="opacity .3s";setTimeout(()=>t.remove(),300)},2500)}

// ─── Profiles ─────────────────────────────────────────────────────────────
function getProfiles(){return S.get("sgsa_profiles")||{}}
function saveProfiles(p){S.set("sgsa_profiles",p)}
function getProfile(email){return(getProfiles())[email]||null}
function saveProfile(email,data){const p=getProfiles();p[email]={...p[email],...data};saveProfiles(p)}
function removeProfile(email){const p=getProfiles();delete p[email];saveProfiles(p)}

// ─── Pins (server-side with localStorage fallback) ────────────────────────
function getPins(){return S.get("sgsa_pins")||[]}
function togglePin(gid){let p=getPins();if(p.includes(gid))p=p.filter(x=>x!==gid);else p.push(gid);S.set("sgsa_pins",p);P("/api/chat/pin",{group_id:gid}).catch(()=>{});return p}

// ─── Offline queue ────────────────────────────────────────────────────────
function getOfflineQueue(){return S.get("sgsa_offline")||[]}
function enqueueOffline(msg){const q=getOfflineQueue();q.push({...msg,ts:Date.now()});S.set("sgsa_offline",q)}
function flushOfflineQueue(){const q=getOfflineQueue();if(!q.length)return;S.set("sgsa_offline",[]);q.forEach(async m=>{
  try{const r=await P("/api/chat/send",m);
    if(r?.ok){
      // Remove the failed indicator and reload messages
      if(m._fakeId){const el=document.querySelector(`[data-fake-id="${m._fakeId}"]`);if(el)el.remove()}
      if(selectedConversation?.group_id==m.grupo_id)await loadMessages(m.grupo_id);
      await refreshConversations();
    }else{enqueueOffline(m)}
  }catch{enqueueOffline(m)}
})}
setInterval(flushOfflineQueue,15000);

// ─── Badge ────────────────────────────────────────────────────────────────
function updateBadge(n){try{if(navigator.setAppBadge)navigator.setAppBadge(n);else if(navigator.clearAppBadge&&n===0)navigator.clearAppBadge()}catch{}}

// ─── Auth ─────────────────────────────────────────────────────────────────
let authToken=null,currentUser=null,selectedOffice="",offices=[],chatSound=true,alertsSound=true;

async function restoreToken(t){try{const r=await fetch(API+"/api/chat/auth/me",{headers:{Authorization:"Bearer "+t}});if(r.ok){const d=await r.json();if(d.ok)return d.user}}catch{}return null}
function clearCurrent(){authToken=null;currentUser=null;selectedOffice=""}
function saveSession(t,u,email){authToken=t;currentUser=u;saveProfile(email,{token:t,user:u,name:u.nombre||"",airtable_id:u.airtable_id,login_id:u.login_id,email});S.set("sgsa_lastUser",email)}

async function G(path){try{const r=await fetch(API+path,{headers:authToken?{Authorization:"Bearer "+authToken}:{}});if(r.status===401&&authToken){clearCurrent();showLogin();return null}return await r.json()}catch{return null}}
async function P(path,body){try{const r=await fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify(body)});if(r.status===401&&authToken){clearCurrent();showLogin();return null}return await r.json()}catch{return null}}

// ====== THEME ======
const theme=S.get("sgsa_theme")||"dark";
document.documentElement.className=theme;
document.getElementById("toggleTheme")?.setAttribute("checked",theme==="light");

document.getElementById("toggleTheme")?.addEventListener("change",function(){
  const t=this.checked?"light":"dark";document.documentElement.className=t;S.set("sgsa_theme",t);
});

// ====== LOGIN ======
function showLogin(){document.getElementById("login-screen").style.display="flex";document.getElementById("app").style.display="none";document.getElementById("loginError").textContent="";document.getElementById("loginEmail").value="";document.getElementById("loginPassword").value="";renderSavedProfiles()}
function renderSavedProfiles(){
  const profiles=getProfiles(),emails=Object.keys(profiles),c=document.getElementById("savedProfiles"),f=document.getElementById("loginForm"),o=document.getElementById("showOtherLogin");
  if(!emails.length){c.style.display="none";f.style.display="flex";o.style.display="none";return}
  c.style.display="flex";c.innerHTML=emails.map(e=>{const p=profiles[e];return`<div class="profile-card" data-email="${esc(e)}"><div class="profile-avatar">${(p.name||e)[0].toUpperCase()}</div><div class="profile-info"><div class="profile-name">${esc(p.name||e)}</div><div class="profile-office">${p.officeName?`<span class="material-symbols-outlined" style="font-size:14px">apartment</span>${esc(p.officeName)}`:""}</div></div><div class="profile-actions"><button class="remove-profile-btn" data-email="${esc(e)}"><span class="material-symbols-outlined">close</span></button></div></div>`}).join("");
  c.querySelectorAll(".profile-card").forEach(card=>card.addEventListener("click",e=>{if(e.target.closest(".remove-profile-btn"))return;document.getElementById("loginEmail").value=card.dataset.email;f.style.display="flex";o.style.display="flex";c.querySelectorAll(".profile-card").forEach(x=>x.style.opacity=x===card?"1":".4");document.getElementById("loginPassword").focus()}));
  c.querySelectorAll(".remove-profile-btn").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();removeProfile(b.dataset.email);renderSavedProfiles()}));
  f.style.display="none";o.style.display="none";
}
document.getElementById("showOtherLogin").addEventListener("click",()=>{document.getElementById("loginEmail").value="";document.getElementById("loginForm").style.display="flex";document.getElementById("showOtherLogin").style.display="none";document.getElementById("savedProfiles").querySelectorAll(".profile-card").forEach(c=>c.style.opacity="1")});
document.getElementById("loginBtn").addEventListener("click",async()=>{
  const email=document.getElementById("loginEmail").value.trim(),pw=document.getElementById("loginPassword").value.trim();
  if(!email||!pw){document.getElementById("loginError").textContent="Completá ambos campos";return}
  const saved=getProfile(email);
  if(saved?.token&&saved?.user&&!saved._f){const u=await restoreToken(saved.token);if(u){authToken=saved.token;currentUser=u;S.set("sgsa_lastUser",email);enterApp();return}}
  const r=await P("/api/chat/auth/login",{email,password:pw});
  if(r?.ok){saveSession(r.access_token,r.user,email);enterApp()}else{document.getElementById("loginError").textContent="Credenciales incorrectas"}
});
document.getElementById("loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("loginBtn").click()});

function enterApp(){
  document.getElementById("login-screen").style.display="none";document.getElementById("app").style.display="flex";
  const e=currentUser?.email||S.get("sgsa_lastUser"),p=getProfile(e);
  selectedOffice=p?.office||"";selectedOfficeId=p?.officeId||"";if(selectedOffice&&p?.officeName){document.getElementById("office-label").innerHTML=`<span class="material-symbols-outlined">apartment</span>${esc(p.officeName)}`;document.getElementById("selectOfficeBtn").classList.add("filled")}
  chatSound=p?.chatSound!==false;alertsSound=p?.alertsSound!==false;document.getElementById("toggleChatSound").checked=chatSound;document.getElementById("toggleAlertsSound").checked=alertsSound;
  updateSettingsUI();
  // Lazy load: only init alerts on startup, chat loads on tab click
  // Ping starts here so user is online immediately, not just when chat tab opens
  initAlerts();flushOfflineQueue();startPing();
  if(!selectedOffice){openModal("office-modal");loadOfficeModal()}
  updateBadgeFromAlerts();
}

// ====== KEYBOARD SHORTCUTS ======
document.addEventListener("keydown",e=>{
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"){if(e.key==="Escape")e.target.blur();return}
  if(e.ctrlKey&&e.key==="k"){e.preventDefault();switchTab("chat");setTimeout(()=>document.getElementById("conversationSearch")?.focus(),100)}
  if(e.ctrlKey&&e.key==="n"){e.preventDefault();document.getElementById("newGroupBtn")?.click()}
  if(e.key==="Escape"){closeModal("office-modal");closeModal("peopleModal");closeModal("newGroupModal");closeModal("alert-detail-modal");closeSettings();if(selectedConversation)document.getElementById("chatBackBtn")?.click()}
  if(e.ctrlKey&&e.shiftKey&&e.key==="A"){e.preventDefault();switchTab("chat");setTimeout(()=>{if(selectedConversation)document.getElementById("chatInput")?.focus()},100)}
});

// ====== TABS ======
function switchTab(tab){if(tab==="chat"&&!authToken){showLogin();return}document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");document.getElementById(tab+"-tab")?.classList.add("active");if(tab==="chat"&&!_chatStarted){initChat();_chatStarted=1}else if(tab==="chat")refreshConversations()}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));

// ====== SETTINGS ======
document.getElementById("settingsBtn").addEventListener("click",()=>{updateSettingsUI();updateStats();document.getElementById("settings-overlay").style.display="block";document.getElementById("settings-panel").style.display="flex"});
document.getElementById("closeSettingsBtn").addEventListener("click",closeSettings);document.getElementById("settings-overlay").addEventListener("click",closeSettings);
function closeSettings(){document.getElementById("settings-overlay").style.display="none";document.getElementById("settings-panel").style.display="none"}
function updateSettingsUI(){document.getElementById("settingsName").textContent=currentUser?.nombre||"—";document.getElementById("settingsEmail").textContent=currentUser?.email||"—"}
document.getElementById("settingsChangeOffice").addEventListener("click",()=>{closeSettings();openModal("office-modal");loadOfficeModal()});
document.getElementById("toggleChatSound").addEventListener("change",function(){chatSound=this.checked;const p=getProfile(currentUser?.email||"");if(p)p.chatSound=chatSound,saveProfile(currentUser.email,p)});
document.getElementById("toggleAlertsSound").addEventListener("change",function(){alertsSound=this.checked;const p=getProfile(currentUser?.email||"");if(p)p.alertsSound=alertsSound,saveProfile(currentUser.email,p)});
document.getElementById("settingsSwitchUser").addEventListener("click",()=>{closeSettings();clearCurrent();if(window._ct)clearInterval(window._ct);stopPing();showLogin()});
document.getElementById("settingsLogout").addEventListener("click",()=>{closeSettings();clearCurrent();if(window._ct)clearInterval(window._ct);stopPing();const e=currentUser?.email;if(e){const p=getProfile(e);if(p)p._f=true,saveProfile(e,p)}showLogin()});

// ====== STATS ======
let stats={alertsToday:0,alertsDone:0,msgsSent:0};
function updateStats(){document.getElementById("statAlertsToday").textContent=stats.alertsToday;document.getElementById("statAlertsDone").textContent=stats.alertsDone;document.getElementById("statMsgsSent").textContent=stats.msgsSent}

// ====== OFFICE ======
async function loadOfficeModal(){if(offices.length){renderOfficeList(offices);return}try{const r=await fetch(API+"/api/oficinas");const d=await r.json();if(d.ok)offices=d.oficinas;renderOfficeList(offices)}catch{}}
function renderOfficeList(list){const q=(document.getElementById("officeSearch")?.value||"").toLowerCase(),f=q?list.filter(o=>o.nombre?.toLowerCase().includes(q)||o.localidad?.toLowerCase().includes(q)):list,c=document.getElementById("officeList");if(!f.length){c.innerHTML='<div class="empty-state"><span class="material-symbols-outlined empty-icon">apartment</span><p>Sin resultados</p></div>';return}c.innerHTML=f.map(o=>`<div class="item-row" data-name="${esc(o.nombre)}" data-id="${esc(o.id)}"><div class="item-avatar"><span class="material-symbols-outlined">apartment</span></div><div class="item-info"><div class="item-name">${esc(o.nombre)}</div>${o.localidad?`<div class="item-sub">${esc(o.localidad)}</div>`:""}</div></div>`).join("");c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",()=>{selectedOffice=el.dataset.name;selectedOfficeId=el.dataset.id;document.getElementById("office-label").innerHTML=`<span class="material-symbols-outlined">apartment</span>${esc(selectedOffice)}`;document.getElementById("selectOfficeBtn").classList.add("filled");const e=currentUser?.email;if(e)saveProfile(e,{office:selectedOffice,officeName:selectedOffice,officeId:selectedOfficeId});closeModal("office-modal");loadAlerts(showHistory)}))}
document.getElementById("officeSearch").addEventListener("input",()=>renderOfficeList(offices));
document.getElementById("selectOfficeBtn").addEventListener("click",()=>{openModal("office-modal");loadOfficeModal()});

// ====== ALERTS ======
let alerts=[],alertTimer=null,alertFilterUrg="",showHistory=false,selectedOfficeId="";

async function loadAlerts(hist){
  const aid=currentUser?.airtable_id;if(!aid)return;
  // Show cached alerts immediately
  const cacheKey=hist?"sgsa_alertCacheHist":"sgsa_alertCache";
  const cached=S.get(cacheKey);if(cached?.length){alerts=cached;renderAlerts()}
  setLoading(true);
  try{
    const leidas=hist?"true":"false";
    const r=await fetch(API+"/api/alerts?leidas="+leidas,{headers:authToken?{Authorization:"Bearer "+authToken}:{}});
    const d=await r.json();alerts=d.alerts||[];if(!hist)alerts=alerts.filter(a=>!a.leida);
    S.set(cacheKey,alerts);stats.alertsToday=d.alerts?.length||0;renderAlerts();
  }catch(e){console.error(e)}
  setLoading(false);updateBadgeFromAlerts();
}
async function doAck(id){try{alerts=alerts.filter(a=>a.id!==id);renderAlerts();await fetch(API+"/api/alerts/"+id+"/ack?empleado_que_marco_leido="+encodeURIComponent(currentUser?.airtable_id||"")+"&sucursal_id="+encodeURIComponent(selectedOfficeId||""),{method:"POST",headers:authToken?{Authorization:"Bearer "+authToken}:{}});S.del("sgsa_alertCache");S.del("sgsa_alertCacheHist");stats.alertsDone++}catch{}}
async function doStatus(id,estado){try{alerts=alerts.filter(a=>a.id!==id);renderAlerts();await fetch(API+"/api/alerts/"+id+"/status",{method:"POST",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify({estado,empleado_id:currentUser?.airtable_id||"",sucursal_id:selectedOfficeId||""})});S.del("sgsa_alertCache");S.del("sgsa_alertCacheHist");stats.alertsDone++}catch{}}

function setLoading(v){const sk=document.getElementById("alertsSkeleton");if(sk)sk.style.display=v?"flex":"none"}

function autoRefreshAlerts(){loadAlerts(showHistory)}

function updateBadgeFromAlerts(){const n=alerts.filter(a=>!a.leida).length;updateBadge(n);document.getElementById("alerts-badge").textContent=n}

function renderAlerts(){
  const c=document.getElementById("alerts-list"),empty=document.getElementById("emptyAlerts"),sk=document.getElementById("alertsSkeleton");
  if(!c)return;
  const q=(document.getElementById("alertSearch")?.value||"").toLowerCase();
  let f=alerts;
  if(alertFilterUrg)f=f.filter(a=>{const p=a.prioridad||"";if(alertFilterUrg==="3")return p.includes("🔴");if(alertFilterUrg==="2")return p.includes("🟠");if(alertFilterUrg==="1")return p.includes("🟡");return true});
  if(q)f=f.filter(a=>(a.titulo||"").toLowerCase().includes(q)||(a.cuerpo||"").toLowerCase().includes(q)||(a.tipo_alerta||"").toLowerCase().includes(q));
  if(sk)sk.style.display="none";const pending=f.filter(a=>!a.leida);document.getElementById("alerts-badge").textContent=pending.length;
  if(!f.length){if(empty)empty.style.display="flex";c.innerHTML="";return}if(empty)empty.style.display="none";

  c.innerHTML=f.map((a,i)=>{const p=a.prioridad||"";let urg=0,urgLabel="Info",urgClass="urg-1";if(p.includes("🔴")){urg=3;urgLabel="Urgente";urgClass="urg-3"}else if(p.includes("🟠")){urg=2;urgLabel="Alta";urgClass="urg-2"}else if(p.includes("🟡")){urg=1;urgLabel="Media"}
    let rows="";if(a.detalle)for(const line of a.detalle.split("\n")){const ci=line.indexOf(":");if(ci>0){const k=line.slice(0,ci).trim(),v=line.slice(ci+1).trim();rows+=k&&v?`<div class="d-row"><span class="d-label">${esc(k)}</span><span class="d-value">${esc(v)}</span></div>`:""}else rows+=`<div>${esc(line)}</div>`}
    if(a.link_registro)rows+=`<a class="d-link" href="${esc(a.link_registro)}" target="_blank" onclick="event.stopPropagation()"><span class="material-symbols-outlined" style="font-size:12px">open_in_new</span> Abrir</a>`;
    rows+=`<span class="d-open" data-idx="${i}" onclick="event.stopPropagation()"><span class="material-symbols-outlined" style="font-size:13px">fullscreen</span> Ver detalle</span>
    <button class="d-share" data-idx="${i}" title="Compartir por chat"><span class="material-symbols-outlined" style="font-size:13px">share</span> Compartir</button>`;
    // History mode: show estado badge + gestion info
    const estado=a.estado||"";
    const estadoLabel={EN_PROGRESO:"En progreso",TURNO_CONFIRMADO:"Turno conf.",CONCLUIDA:"Concluido",ANULADA:"Anulado",PENDIENTE:"Pendiente"}[estado]||estado;
    const gestionInfo=a.leida&&estado?`<div class="card-gestion"><span class="gestion-badge ${estado==="CONCLUIDA"?"g-ok":estado==="ANULADA"?"g-del":estado==="EN_PROGRESO"?"g-prog":"g-info"}">${estadoLabel}</span>${a.fecha_visto?` <span style="font-size:10px;color:var(--fg3)">${new Date(a.fecha_visto).toLocaleDateString("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span>`:""}</div>`:"";
    return`<div class="alert-card urgencia-${urg}" data-id="${a.id}" data-idx="${i}"><div class="card-surface"><div class="card-head"><div class="card-title">${esc(a.titulo||"Alerta")}</div><div class="card-badge ${urgClass}">${urgLabel}</div></div><div class="card-body">${esc(a.cuerpo||"")}</div>${gestionInfo}<div class="card-meta"><span>${(a.fecha||a.created_at||"").slice(0,10)}</span><span class="meta-tag">${esc(a.tipo_alerta||"General")}</span><span class="material-symbols-outlined meta-chevron" style="font-size:14px">expand_more</span></div></div><div class="card-detail">${rows}${selectedOffice?`<div class="alert-actions"><button class="act-btn progreso"><span class="material-symbols-outlined">pending</span> Progreso</button><button class="act-btn confirmar"><span class="material-symbols-outlined">calendar_month</span> Turno confirmado</button><button class="act-btn concluido"><span class="material-symbols-outlined">check_circle</span> Concluido</button><button class="act-btn anular"><span class="material-symbols-outlined">cancel</span> Anular</button><button class="act-btn ack"><span class="material-symbols-outlined">mark_email_read</span> Leído</button></div>`:`<div class="alert-actions-disabled"><span class="material-symbols-outlined">apartment</span> Seleccioná una sucursal para gestionar</div>`}</div></div>`}).join("");

  // D-open and D-share buttons
  c.querySelectorAll(".d-open").forEach(b=>{b.onclick=e=>{e.stopPropagation();showAlertDetail(alerts[+b.dataset.idx])}});
  c.querySelectorAll(".d-share").forEach(b=>{b.onclick=e=>{e.stopPropagation();shareAlert(alerts[+b.dataset.idx])}});
}

// Alert search & filter chips
document.getElementById("alertSearch").addEventListener("input",renderAlerts);
document.getElementById("filterChips").addEventListener("click",e=>{
  const chip=e.target.closest(".chip");if(!chip)return;
  document.querySelectorAll("#filterChips .chip").forEach(c=>c.classList.remove("active"));
  chip.classList.add("active");alertFilterUrg=chip.dataset.urg;renderAlerts();
});

// History button — works with search/filter too
document.getElementById("historyBtn").addEventListener("click",function(){
  showHistory=!showHistory;this.classList.toggle("active",showHistory);
  this.style.color=showHistory?"var(--accent)":"";
  document.getElementById("alertSearch").value="";alertFilterUrg="";
  document.querySelectorAll("#filterChips .chip").forEach(c=>c.classList.remove("active"));
  document.querySelector("#filterChips .chip[data-urg='']")?.classList.add("active");
  loadAlerts(showHistory);
});

// Global delegated click handler for alert cards (expand + action buttons)
(function(){
  const c=document.getElementById("alerts-list");if(!c)return;
  c.addEventListener("click",async e=>{
    const btn=e.target.closest(".act-btn");
    if(btn){
      e.stopPropagation();e.preventDefault();
      const card=btn.closest(".alert-card"),id=card?.dataset.id;if(!id)return;
      // Remove card from DOM instantly
      card.style.opacity="0";card.style.transform="translateX(20px)";card.style.transition="all .2s";
      setTimeout(()=>card.remove(),200);
      // Call API in background
      if(btn.classList.contains("ack"))await doAck(id);
      else if(btn.classList.contains("progreso"))await doStatus(id,"EN_PROGRESO");
      else if(btn.classList.contains("confirmar"))await doStatus(id,"TURNO_CONFIRMADO");
      else if(btn.classList.contains("concluido"))await doStatus(id,"CONCLUIDA");
      else if(btn.classList.contains("anular"))await doStatus(id,"ANULADA");
      // Refresh in background — always reload as pending (history is separate view)
      setTimeout(()=>{showHistory=false;loadAlerts(false)},500);
      if(alertsSound)Sound.alert();
      return;
    }
    if(e.target.closest(".d-link,.d-open,.d-share"))return;
    const card=e.target.closest(".alert-card");if(card)card.classList.toggle("expanded");
  });
})();
// Alert detail modal
function showAlertDetail(a){
  const p=a.prioridad||"";let urg=0,urgLabel="Info",urgClass="urg-1";if(p.includes("🔴")){urg=3;urgLabel="Urgente";urgClass="urg-3"}else if(p.includes("🟠")){urg=2;urgLabel="Alta";urgClass="urg-2"}else if(p.includes("🟡")){urg=1;urgLabel="Media"}
  let rows="";if(a.detalle)for(const line of a.detalle.split("\n")){const ci=line.indexOf(":");if(ci>0){const k=line.slice(0,ci).trim(),v=line.slice(ci+1).trim();rows+=k&&v?`<div class="detail-field"><span class="detail-label">${esc(k)}</span><span class="detail-value">${esc(v)}</span></div>`:""}else rows+=`<div class="detail-field"><span class="detail-value">${esc(line)}</span></div>`}
  document.getElementById("alertDetailTitle").textContent=a.titulo||"Detalle de alerta";
  document.getElementById("alertDetailBody").innerHTML=`
    <div class="detail-section"><h3><span class="material-symbols-outlined">info</span> Información</h3>
      <div class="detail-field"><span class="detail-label">Tipo</span><span class="detail-value">${esc(a.tipo_alerta||"—")}</span></div>
      <div class="detail-field"><span class="detail-label">Prioridad</span><span class="detail-value"><span class="detail-badge-urg ${urgClass}">${urgLabel}</span></span></div>
      <div class="detail-field"><span class="detail-label">Fecha</span><span class="detail-value">${(a.fecha||a.created_at||"").slice(0,10)}</span></div>
      ${a.cuerpo?`<div class="detail-field"><span class="detail-label">Descripción</span><span class="detail-value">${esc(a.cuerpo)}</span></div>`:""}
    </div>
    ${rows?`<div class="detail-section"><h3><span class="material-symbols-outlined">list</span> Detalle</h3>${rows}</div>`:""}
    ${a.link_registro?`<a class="d-link" href="${esc(a.link_registro)}" target="_blank"><span class="material-symbols-outlined">open_in_new</span> Abrir registro original</a>`:""}
  `;
  openModal("alert-detail-modal");
}

// Share alert via chat — opens people modal, then sends alert as message
function shareAlert(a){
  const msg=`📋 *${a.titulo||"Alerta"}*\nTipo: ${a.tipo_alerta||"—"} | Prioridad: ${a.prioridad||"—"} | ${(a.fecha||a.created_at||"").slice(0,10)}\n${a.cuerpo?esc(a.cuerpo)+"\n":""}${a.detalle?a.detalle.split("\n").slice(0,8).map(l=>esc(l)).join("\n"):""}`;
  window._shareMsg=msg;
  switchTab("chat"); // ensure chat tab is active so openConversation works
  openModal("peopleModal");loadPeopleList();
  toast("Seleccioná a quién compartir","");
}

function initAlerts(){if(!currentUser?.airtable_id)return;if(selectedOffice)loadAlerts(showHistory)}
document.getElementById("refreshBtn").addEventListener("click",()=>loadAlerts(showHistory));
document.getElementById("ackAllBtn").addEventListener("click",async()=>{const cards=document.querySelectorAll(".alert-card");cards.forEach(c=>{c.style.opacity="0";c.style.transform="translateX(20px)";c.style.transition="all .2s"});for(const card of cards){const id=card.dataset.id;if(id)await doAck(id)}setTimeout(()=>{showHistory=false;loadAlerts(false)},300)});

// ====== CHAT ======
let conversations=[],selectedConversation=null,allEmployees=[],_pingTimer=null,_ct=null,_chatStarted=0;

function initChat(){if(!authToken)return;
  const cached=S.get("sgsa_convCache");if(cached?.length){conversations=cached;renderConversations()}
  refreshConversations();if(_ct)clearInterval(_ct);_ct=setInterval(refreshConversations,R)}
async function refreshConversations(){
  if(!authToken)return;
  // Show cached conversations immediately
  const cached=S.get("sgsa_convCache");if(cached?.length&&!conversations.length){conversations=cached;renderConversations()}
  const d=await G("/api/chat/conversations");
  if(d?.ok){conversations=d.conversations;S.set("sgsa_convCache",conversations);renderConversations();
    const newUnread=conversations.reduce((s,c)=>s+(c.unread||0),0);
    document.getElementById("chat-badge").textContent=newUnread||"";
  } else if(d?.error){
    console.error("Conversations error:",d.error);
    if(cached?.length){conversations=cached;renderConversations()}
  }
}

function renderConversations(){
  const q=(document.getElementById("conversationSearch")?.value||"").toLowerCase(),f=q?conversations.filter(c=>c.display_name?.toLowerCase().includes(q)):conversations;
  const c=document.getElementById("conversationList"),e=document.getElementById("inboxEmpty");
  if(!f.length){c.innerHTML="";e.style.display="flex";return}e.style.display="none";
  // Server-side pinned sort (backend returns pinned field)
  const sorted=[...f].sort((a,b)=>(b.pinned?-1:0)-(a.pinned?-1:0)||(b.unread||0)-(a.unread||0));
  c.innerHTML=sorted.map(cv=>{
    const initials=avatarInitials(cv.display_name);
    const bgColor=avatarColor(cv.display_name);
    const avatarContent=cv.avatar_url
      ?`<img src="${esc(cv.avatar_url)}" class="group-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bgColor}">${initials}</span>`
      :`<span class="avatar-initials" style="background:${bgColor}">${initials}</span>`;
    const onlineDot=cv.is_dm?`<span class="online-dot ${cv.online?"online":"offline"}"></span>`:"";
    const subtitle=cv.is_dm?(cv.online?"En línea":"Offline"):(cv.member_count?cv.member_count+" miembros":"");
    return`<div class="group-card ${cv.pinned?"pinned ":""}${selectedConversation?.group_id===cv.group_id?"selected":""}" data-gid="${cv.group_id}">
    <div class="group-avatar">${avatarContent}${onlineDot}</div>
    <div class="group-info"><div class="group-name">${esc(cv.display_name||"Chat")}</div><div class="group-last-msg">${subtitle?`<span class="conv-subtitle">${esc(subtitle)}</span> · `:""}${cv.unread>0&&!cv.last_message?cv.unread+" mensaje"+(cv.unread>1?"s":"")+" nuevo"+(cv.unread>1?"s":""):esc(cv.last_message||"Sin mensajes")}</div></div>
    <div class="group-meta"><div class="group-time">${cv.last_message_time?timeAgo(cv.last_message_time):""}</div>${cv.unread>0?`<div class="group-unread">${cv.unread>99?"99+":cv.unread}</div>`:""}</div>
    <button class="pin-btn ${cv.pinned?"pinned":""}" data-gid="${cv.group_id}" title="${cv.pinned?"Desfijar":"Fijar"}"><span class="material-symbols-outlined">push_pin</span></button>
    <button class="delete-chat-btn" data-gid="${cv.group_id}" title="Archivar chat"><span class="material-symbols-outlined">archive</span></button>
  </div>`}).join("");
  c.querySelectorAll(".group-card").forEach(card=>card.addEventListener("click",e=>{if(e.target.closest(".pin-btn,.delete-chat-btn"))return;const gid=card.dataset.gid,cv=conversations.find(x=>x.group_id==gid);if(cv)openConversation(cv)}));
  c.querySelectorAll(".pin-btn").forEach(b=>b.addEventListener("click",async e=>{e.stopPropagation();const gid=b.dataset.gid;
    const r=await P("/api/chat/pin",{group_id:gid});
    if(r?.ok){const cv=conversations.find(x=>x.group_id==gid);if(cv)cv.pinned=r.pinned;
    }else{togglePin(gid);const cv=conversations.find(x=>x.group_id==gid);if(cv)cv.pinned=getPins().includes(gid)}
    S.del("sgsa_convCache");renderConversations()}));
  c.querySelectorAll(".delete-chat-btn").forEach(b=>b.addEventListener("click",async e=>{e.stopPropagation();const gid=b.dataset.gid;
    if(!confirm("¿Archivar este chat? No aparecerá en tu bandeja."))return;
    const r=await P("/api/chat/hide",{group_id:gid});
    if(r?.ok&&r.hidden){conversations=conversations.filter(x=>x.group_id!=gid);S.del("sgsa_convCache");renderConversations();toast("Chat archivado","success")}
    else if(r?.ok&&!r.hidden){toast("Chat ya estaba archivado","info")}
    else{toast("Error al archivar","error")}
  }));
}
document.getElementById("conversationSearch")?.addEventListener("input",renderConversations);
function timeAgo(iso){if(!iso)return"";const d=Date.now()-new Date(iso).getTime(),m=Math.floor(d/60000);if(m<1)return"ahora";if(m<60)return m+"m";const h=Math.floor(m/60);if(h<24)return h+"h";return Math.floor(h/24)+"d"}

async function openConversation(cv){selectedConversation=cv;
  document.getElementById("chatMainEmpty").style.display="none";
  document.getElementById("message-view").style.display="";
  document.getElementById("chatBackBtn").style.display=window.innerWidth<=768?"":"none";
  document.getElementById("chatMain").classList.add("open");
  // Header with name, online status, and member count
  const headerTitle=document.getElementById("chatHeaderTitle");
  let headerHtml=`<span class="chat-name">${esc(cv.display_name||"Chat")}</span>`;
  if(cv.is_dm){
    headerHtml+=`<span class="chat-status ${cv.online?"online":"offline"}">${cv.online?"En línea":"Offline"}</span>`;
  }else if(cv.member_count){
    headerHtml+=`<span class="chat-status">${cv.member_count} miembros</span>`;
  }
  headerTitle.innerHTML=headerHtml;
  headerTitle.onclick=cv.is_dm?null:()=>showGroupInfo(cv.group_id);
  await loadMessages(cv.group_id);renderConversations()}
async function showGroupInfo(gid){
  document.getElementById("groupInfoTitle").textContent="Cargando...";
  document.getElementById("groupInfoBody").innerHTML='<div class="empty-state"><p>Cargando...</p></div>';
  openModal("groupInfoModal");
  const d=await G("/api/chat/groups/"+gid);
  if(!d?.ok){document.getElementById("groupInfoBody").innerHTML='<div class="empty-state"><p>Error</p></div>';return}
  document.getElementById("groupInfoTitle").textContent=d.group?.nombre||"Grupo";
  const members=(d.members||[]).map(m=>{
    const initials=avatarInitials(m.nombre);
    const bgColor=avatarColor(m.nombre);
    const isOnline=m.online||false;
    return`<div class="member-row">
      <div class="member-avatar">${m.avatar_url?`<img src="${esc(m.avatar_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bgColor}">${initials}</span>`:`<span class="avatar-initials" style="background:${bgColor}">${initials}</span>`}
        <span class="online-dot ${isOnline?"online":"offline"}"></span>
      </div>
      <div class="member-info">
        <div class="member-name">${esc(m.nombre||m.id||"—")}</div>
        <div class="member-role">${m.es_admin?'Admin':""}</div>
      </div>
      ${isOnline?'<span class="member-status online-text">En línea</span>':'<span class="member-status offline-text">Offline</span>'}
    </div>`;
  }).join("");
  document.getElementById("groupInfoBody").innerHTML=(d.group?.descripcion?`<div class="group-desc">${esc(d.group.descripcion)}</div>`:"")+
    `<div class="members-header"><span class="material-symbols-outlined" style="font-size:16px">group</span> ${d.member_count||0} miembros</div>`+
    `<div class="members-list">${members}</div>`;
}
document.getElementById("chatBackBtn").addEventListener("click",()=>{selectedConversation=null;
  document.getElementById("chatMainEmpty").style.display="flex";
  document.getElementById("message-view").style.display="none";
  document.getElementById("chatHeaderTitle").textContent="Chat";
  document.getElementById("chatMain").classList.remove("open");
  refreshConversations()});

async function loadMessages(gid){const airId=currentUser?.airtable_id||"";const d=await G("/api/chat/mensajes/"+gid+"?airtable_id="+encodeURIComponent(airId)),c=document.getElementById("messageList"),e=document.getElementById("messageEmpty");
  if(!d?.ok){const cached=S.get("sgsa_msgCache_"+gid);if(cached?.length){renderMsgList(c,e,gid,cached);return}c.innerHTML='<div class="empty-state"><span class="material-symbols-outlined empty-icon">cloud_off</span><p>Sin conexión</p><span class="empty-hint">No se pudieron cargar los mensajes</span></div>';return}
  const msgs=d.mensajes||[];S.set("sgsa_msgCache_"+gid,msgs);renderMsgList(c,e,gid,msgs)}
function renderMsgList(c,e,gid,msgs){
  if(!msgs.length){e.style.display="flex";c.innerHTML="";return}
  e.style.display="none";
  const myId=currentUser?.airtable_id||"";
  const myLoginId=currentUser?.id||"";
  let html="";let lastDate="";
  const sorted=msgs.slice().reverse();
  for(const m of sorted){
    // Date separator
    const d=m.created_at?new Date(m.created_at):null;
    if(d){
      const today=new Date();const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
      const ds=d.toDateString();
      let label="";
      if(ds===today.toDateString())label="Hoy";
      else if(ds===yesterday.toDateString())label="Ayer";
      else label=d.toLocaleDateString("es-AR",{day:"numeric",month:"long",year:d.getFullYear()!==today.getFullYear()?"numeric":undefined});
      if(label!==lastDate){html+=`<div class="date-separator"><span>${label}</span></div>`;lastDate=label}
    }
    const isMine=m.sender_id===myId||m.sender_id===myLoginId;
    let body=`<div class="msg-text">${linkify(m.mensaje||m.texto||"")}</div>`;
    if(m.tipo==="imagen"&&m.adjunto_url)body=`<div class="msg-attachment"><img src="${m.adjunto_url}" loading="lazy"></div>`;
    else if((m.tipo==="video"||m.tipo==="audio")&&m.adjunto_url)body=`<div class="msg-attachment">${m.tipo==="audio"?`<audio controls src="${m.adjunto_url}"></audio>`:`<video controls src="${m.adjunto_url}" style="max-width:100%;max-height:300px"></video>`}</div>`;
    else if(m.adjunto_url)body=`<div class="msg-attachment"><a class="file-link" href="${m.adjunto_url}" target="_blank"><span class="material-symbols-outlined" style="font-size:16px">attach_file</span>${esc(m.adjunto_nombre||"Archivo")}</a></div>`;
    // In DMs, don't show sender name at all (it's implied). In groups, show for others.
    const isDM=selectedConversation?.is_dm;
    const senderHtml=!isMine&&!isDM?`<div class="sender-name">${esc(m.sender_nombre||m.remitente_nombre||"")}</div>`:"";
    html+=`<div class="message ${isMine?"mine":"theirs"}">${senderHtml}${body}<div class="msg-time">${timeAgo(m.created_at)}${isMine?` <span class="msg-checks ${m.visto?"seen":"sent"}" title="${m.visto?"Visto":"Enviado"}">${m.visto?"✓✓":"✓"}</span>`:""}</div></div>`;
  }
  c.innerHTML=html;c.scrollTop=c.scrollHeight;
}

let _sending=false;
async function sendMessage(){
  if(_sending)return;_sending=true;
  try{
    const input=document.getElementById("chatInput"),text=input.value.trim();
    if(!text||!selectedConversation)return;input.value="";
    const payload={grupo_id:selectedConversation.group_id,empleado_id:currentUser?.airtable_id,contenido:text};
    // Show message locally immediately with a tracking ID
    const c=document.getElementById("messageList");
    const fakeId="fake_"+Date.now();
    const fakeEl=document.createElement("div");
    fakeEl.className="message mine";fakeEl.dataset.fakeId=fakeId;
    fakeEl.innerHTML=`<div class="msg-text">${esc(text)}</div><div class="msg-time">ahora <span class="msg-checks">⏳</span></div>`;
    c.appendChild(fakeEl);c.scrollTop=c.scrollHeight;
    const d=await P("/api/chat/send",payload);
    if(d?.ok){stats.msgsSent++;await loadMessages(selectedConversation.group_id);await refreshConversations()}
    else{
      // Mark as failed instead of keeping it as pending forever
      const failedEl=c.querySelector(`[data-fake-id="${fakeId}"]`);
      if(failedEl)failedEl.querySelector(".msg-checks").textContent="⚠";
      enqueueOffline({...payload,_fakeId:fakeId});
      toast("Error al enviar — reintentando","error");
    }
  }finally{_sending=false}}
document.getElementById("sendBtn").addEventListener("click",sendMessage);
document.getElementById("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}});

// Attach
document.getElementById("attachBtn").addEventListener("click",()=>document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change",async e=>{const file=e.target.files[0];if(!file||!selectedConversation)return;e.target.value="";const fd=new FormData();fd.append("file",file);try{const r=await fetch(API+"/api/chat/upload",{method:"POST",headers:authToken?{Authorization:"Bearer "+authToken}:{},body:fd});const res=await r.json();if(res?.url){await P("/api/chat/messages",{grupo_id:selectedConversation.group_id,sender_id:currentUser?.airtable_id||currentUser?.id,mensaje:file.name,tipo:res.type||"documento",adjunto_url:res.url,adjunto_nombre:file.name});loadMessages(selectedConversation.group_id);refreshConversations()}}catch{}});

// Ping
function startPing(){stopPing();P("/api/chat/ping",{});_pingTimer=setInterval(()=>P("/api/chat/ping",{}),30000)}
function stopPing(){if(_pingTimer){clearInterval(_pingTimer);_pingTimer=null}}

// ─── Directory ────────────────────────────────────────────────────────────
document.getElementById("peopleBtn").addEventListener("click",()=>{if(!authToken){showLogin();return}openModal("peopleModal");loadPeopleList()});
async function loadPeopleList(){
  // Use cached employees if available
  const cached=S.get("sgsa_empCache");
  if(cached?.length){allEmployees=cached.filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id));renderPeopleList(allEmployees)}
  // Fetch fresh in background
  const d=await G("/api/chat/employees");
  if(d?.ok){S.set("sgsa_empCache",d.employees);allEmployees=(d.employees||[]).filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id));renderPeopleList(allEmployees)}else if(!cached&&allEmployees.length)renderPeopleList(allEmployees)}
function renderPeopleList(list){const q=(document.getElementById("peopleSearch")?.value||"").toLowerCase(),f=q?list.filter(e=>e.nombre?.toLowerCase().includes(q)):list,c=document.getElementById("peopleList");if(!f.length){c.innerHTML='<div class="empty-state"><p>Sin resultados</p></div>';return}c.innerHTML=f.map(e=>`<div class="item-row" data-empleado-id="${e.id}" data-empleado-nombre="${esc(e.nombre)}"><div class="item-avatar">${e.avatar_url?`<img src="${e.avatar_url}">`:(e.nombre||"?")[0].toUpperCase()}<span class="online-dot ${e.online?"online":"offline"}"></span></div><div class="item-info"><div class="item-name">${esc(e.nombre)}</div>${e.oficina_nombre?`<div class="item-sub">${esc(e.oficina_nombre)}</div>`:""}<div class="item-sub">${e.online?"En línea":"Desconectado"}</div></div><span class="item-action">${window._shareMsg?'<span class="material-symbols-outlined" style="font-size:16px">share</span> Compartir':'<span class="material-symbols-outlined" style="font-size:16px">chat</span> DM'}</span></div>`).join("");c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",async()=>{if(!authToken){showLogin();return}
  // Sharing mode
  if(window._shareMsg){
    const txt=window._shareMsg;window._shareMsg=null;
    const r=await P("/api/chat/dm",{target_empleado_id:el.dataset.empleadoId});
    if(!r?.ok){alert("Error al compartir");return}
    closeModal("peopleModal");
    // Send the shared message FIRST, then open conversation
    const sendR=await P("/api/chat/send",{grupo_id:r.group_id,empleado_id:currentUser?.airtable_id,contenido:txt});
    if(sendR?.ok){
      // Optimistically add to conversations
      const dmCv={group_id:r.group_id,display_name:el.dataset.empleadoNombre||"DM",is_dm:true,online:false,avatar_url:null,pinned:false,unread:0,last_message:txt.slice(0,100),last_message_time:new Date().toISOString()};
      if(!conversations.find(x=>x.group_id==r.group_id))conversations.push(dmCv);
      renderConversations();
      await openConversation(dmCv);
      await refreshConversations();
      toast("Compartido","success");
    }else{toast("Error al enviar","error")}
    return;
  }
  // Normal DM
  const r=await P("/api/chat/dm",{target_empleado_id:el.dataset.empleadoId});
  if(r?.ok){
    closeModal("peopleModal");
    const dmCv={group_id:r.group_id,display_name:el.dataset.empleadoNombre||"DM",is_dm:true,online:false,avatar_url:null,pinned:false,unread:0,last_message:null,last_message_time:new Date().toISOString()};
    // Optimistically add to conversations so it appears in sidebar immediately
    if(!conversations.find(x=>x.group_id==r.group_id))conversations.push(dmCv);
    renderConversations();
    await openConversation(dmCv);
    await refreshConversations();
  }else{toast("Error al iniciar DM","error")}
}))}
document.getElementById("peopleSearch").addEventListener("input",()=>renderPeopleList(allEmployees));

// ─── New group ────────────────────────────────────────────────────────────
let selectedMembers=[];
document.getElementById("newGroupBtn").addEventListener("click",()=>{if(!authToken){showLogin();return}openModal("newGroupModal");loadMemberSearch()});
async function loadMemberSearch(){const d=await G("/api/chat/employees");allEmployees=(d?.ok)?d.employees:allEmployees;renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)))}
function renderMemberList(list){const c=document.getElementById("memberSearchResults");if(!list.length){c.innerHTML='<div class="empty-state"><p>Sin resultados</p></div>';return}c.innerHTML=list.map(e=>`<div class="item-row" data-airtable="${e.airtable_id||""}" data-name="${esc(e.nombre)}"><div class="item-avatar">${e.avatar_url?`<img src="${e.avatar_url}">`:(e.nombre||"?")[0].toUpperCase()}</div><div class="item-info"><div class="item-name">${esc(e.nombre)}</div></div>${selectedMembers.find(m=>m.airtable_id===e.airtable_id)?'<span class="material-symbols-outlined" style="color:var(--success)">check</span>':'<span class="material-symbols-outlined" style="color:var(--accent)">add</span>'}</div>`).join("");c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",()=>{const aid=el.dataset.airtable;if(selectedMembers.find(m=>m.airtable_id===aid))selectedMembers=selectedMembers.filter(m=>m.airtable_id!==aid);else selectedMembers.push({airtable_id:aid,nombre:el.dataset.name});renderSelectedMembers();renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)))}))}
function renderSelectedMembers(){const c=document.getElementById("selectedMembers");if(!selectedMembers.length){c.innerHTML="";return}c.innerHTML=selectedMembers.map(m=>`<div class="selected-member">${esc(m.nombre)}<span class="remove-member" data-airtable="${m.airtable_id}">✕</span></div>`).join("");c.querySelectorAll(".remove-member").forEach(el=>el.addEventListener("click",()=>{selectedMembers=selectedMembers.filter(m=>m.airtable_id!==el.dataset.airtable);renderSelectedMembers();renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)))}))}
document.getElementById("memberSearch").addEventListener("input",()=>{const q=document.getElementById("memberSearch").value.toLowerCase();renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)&&e.nombre?.toLowerCase().includes(q)))});
document.getElementById("createGroupBtn").addEventListener("click",async()=>{const name=document.getElementById("newGroupName").value.trim();if(!name){alert("Poné un nombre");return}const d=await P("/api/chat/grupos",{nombre:name,descripcion:document.getElementById("newGroupDesc").value.trim(),creado_por:currentUser?.airtable_id,miembros:selectedMembers.map(m=>m.airtable_id)});if(d?.ok){closeModal("newGroupModal");document.getElementById("newGroupName").value="";document.getElementById("newGroupDesc").value="";selectedMembers=[];renderSelectedMembers();refreshConversations()}else alert("Error al crear grupo")});

// ─── Emoji picker ─────────────────────────────────────────────────────────
const EMOJIS="😀😃😄😁😆🥹😅🤣😂🙂🥰😍🤩😘😗😚😋😛🤔🤫🤭🫡🤐😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🥴😵🤯🤠🥳🥸😎🤓🧐😤😡🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾🙈🙉🙊💌❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💝💘👍👎👊✊🤛🤜🤞✌️🤘🙏🫶✍️💪🦾🔥⭐🌟✨💫🎉🎊💯".split(/(?:)/u);
document.getElementById("emojiBtn").addEventListener("click",()=>{
  const picker=document.getElementById("emojiPicker");
  if(picker.style.display==="none"){
    const grid=document.getElementById("emojiGrid");
    if(!grid.children.length){
      grid.innerHTML=EMOJIS.map(e=>`<button class="emoji-item">${e}</button>`).join("");
      grid.querySelectorAll(".emoji-item").forEach(b=>b.addEventListener("click",()=>{
        const input=document.getElementById("chatInput");
        const start=input.selectionStart,end=input.selectionEnd;
        input.value=input.value.slice(0,start)+b.textContent+input.value.slice(end);
        input.focus();
        input.setSelectionRange(start+b.textContent.length,start+b.textContent.length);
      }));
    }
    picker.style.display="block";
  }else{picker.style.display="none"}
});
document.getElementById("chatInput").addEventListener("focus",()=>{document.getElementById("emojiPicker").style.display="none"});

// ─── Archived chats ──────────────────────────────────────────────────────
document.getElementById("archivedBtn").addEventListener("click",async()=>{
  if(!authToken){showLogin();return}
  openModal("archivedModal");
  await loadArchivedChats();
});
async function loadArchivedChats(){
  const list=document.getElementById("archivedList"),empty=document.getElementById("archivedEmpty");
  list.innerHTML='<div class="empty-state"><p>Cargando...</p></div>';empty.style.display="none";
  const d=await G("/api/chat/hidden");
  if(!d?.ok||!d.conversations?.length){list.innerHTML="";empty.style.display="flex";return}
  list.innerHTML=d.conversations.map(cv=>{
    const initials=(cv.display_name||"?").split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase();
    const bgColor=avatarColor(cv.display_name);
    const avatarContent=cv.avatar_url
      ?`<img src="${esc(cv.avatar_url)}" class="group-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bgColor}">${initials}</span>`
      :`<span class="material-symbols-outlined">${cv.is_dm?'person':'groups'}</span>`;
    return`<div class="item-row" data-gid="${cv.group_id}">
      <div class="item-avatar">${avatarContent}</div>
      <div class="item-info"><div class="item-name">${esc(cv.display_name||"Chat")}</div>${cv.is_dm?"":"<div class='item-sub'>"+(cv.member_count||0)+" miembros</div>"}</div>
      <button class="btn-unarchive" data-gid="${cv.group_id}" title="Restaurar"><span class="material-symbols-outlined">unarchive</span></button>
    </div>`}).join("");
  list.querySelectorAll(".btn-unarchive").forEach(b=>b.addEventListener("click",async e=>{
    e.stopPropagation();
    const gid=b.dataset.gid;
    const r=await P("/api/chat/hide",{group_id:gid});
    if(r?.ok&&!r.hidden){
      S.del("sgsa_convCache");
      toast("Chat restaurado","success");
      await loadArchivedChats();
      refreshConversations();
    }else{toast("Error al restaurar","error")}
  }));
  list.querySelectorAll(".item-row").forEach(row=>row.addEventListener("click",async()=>{
    const gid=row.dataset.gid;
    const r=await P("/api/chat/hide",{group_id:gid});
    if(r?.ok){
      S.del("sgsa_convCache");
      closeModal("archivedModal");
      refreshConversations();
      const cv=conversations.find(x=>x.group_id==gid);
      if(cv)openConversation(cv);
    }
  }));
}

// ─── Modals ───────────────────────────────────────────────────────────────
function openModal(id){const el=document.getElementById(id);if(el)el.style.display="flex"}
function closeModal(id){const el=document.getElementById(id);if(el)el.style.display="none"}
document.querySelectorAll(".close-modal").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.modal)));

// ====== INIT ======
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=7").catch(()=>{});
if("Notification"in window&&Notification.permission==="default")Notification.requestPermission();

(async function(){
  const last=S.get("sgsa_lastUser");if(last){const p=getProfile(last);if(p?.token){const u=await restoreToken(p.token);if(u){authToken=p.token;currentUser=u;enterApp();return}}}
  showLogin();
})();
