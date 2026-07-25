// =============================================================================
// SGSA PWA v37 — fullscreen viewer (lightbox for images+video), download buttons
// =============================================================================
console.log("[SGSA] PWA v37 loaded");
const API="https://web-production-2584d.up.railway.app",R=30000;

// ─── Storage ──────────────────────────────────────────────────────────────
const S={get(k){try{return JSON.parse(localStorage.getItem(k))}catch{return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},del(k){try{localStorage.removeItem(k)}catch{}}};
function esc(t){const d=document.createElement("div");d.textContent=t;return d.innerHTML}
function linkify(text){return esc(text).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>')}

// ─── Avatar color hash ───────────────────────────────────────────────────
const AVATAR_COLORS=["#FF6B6B","#4ECDC4","#45B7D1","#96CEB4","#FFEAA7","#DDA0DD","#98D8C8","#F7DC6F","#BB8FCE","#85C1E9","#F0B27A","#82E0AA","#F1948A","#AED6F1","#A3E4D7","#FAD7A0","#D7BDE2","#A9CCE3"];
function avatarColor(name){let h=0;for(let i=0;i<(name||"").length;i++)h=name.charCodeAt(i)+((h<<5)-h);return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length]}
function avatarInitials(name){return(name||"?").split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase()}
function avatarUrl(url){return url&&url.startsWith("/")?API+url:url||""}

// ─── Sound engine (Web Audio API, no external files) ──────────────────────
const Sound={ctx:null,init(){if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)()},
  beep(freq,dur,vol=.05){try{this.init();const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type="sine";o.frequency.value=freq;g.gain.setValueAtTime(vol,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+dur);o.connect(g);g.connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+dur)}catch{}},
  chat(){this.beep(880,.1,.04);setTimeout(()=>this.beep(1100,.08,.03),80)},
  alert(){this.beep(660,.15,.06);setTimeout(()=>this.beep(880,.1,.04),100);setTimeout(()=>this.beep(1100,.12,.05),200)},
};

// ─── Toast ────────────────────────────────────────────────────────────────
function toast(msg,type=""){const t=document.createElement("div");t.className="toast "+type;t.innerHTML=`<span class="material-symbols-outlined" style="font-size:18px">${type==="success"?"check_circle":type==="error"?"error":"info"}</span>${esc(msg)}`;document.body.appendChild(t);setTimeout(()=>{t.style.opacity="0";t.style.transition="opacity .3s";setTimeout(()=>t.remove(),300)},2500)}

// ─── Voice recorder state ──────────────────────────────────────────
var _recording=false,_recChunks=[],_recTimer=null,_recStart=0;

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
  // Init chat for badge count on startup (conversations load in background)
  initAlerts();flushOfflineQueue();startPing();
  setTimeout(()=>{if(authToken){refreshConversations();G("/api/chat/hidden").then(d=>{if(d?.ok)stats.chatArchived=d.conversations?.length||0;updateStats()}).catch(()=>{})}},100);
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
document.getElementById("settingsBtn").addEventListener("click",async()=>{
  updateSettingsUI();
  // Fetch archived count for stats
  try{const d=await G("/api/chat/hidden");if(d?.ok)stats.chatArchived=d.conversations?.length||0}catch{}
  updateStats();
  document.getElementById("settings-overlay").style.display="block";document.getElementById("settings-panel").style.display="flex";
});
document.getElementById("closeSettingsBtn").addEventListener("click",closeSettings);document.getElementById("settings-overlay").addEventListener("click",closeSettings);
function closeSettings(){document.getElementById("settings-overlay").style.display="none";document.getElementById("settings-panel").style.display="none"}
function updateSettingsUI(){document.getElementById("settingsName").textContent=currentUser?.nombre||"—";document.getElementById("settingsEmail").textContent=currentUser?.email||"—"}
document.getElementById("settingsChangeOffice").addEventListener("click",()=>{closeSettings();openModal("office-modal");loadOfficeModal()});
document.getElementById("toggleChatSound").addEventListener("change",function(){chatSound=this.checked;const p=getProfile(currentUser?.email||"");if(p)p.chatSound=chatSound,saveProfile(currentUser.email,p)});
document.getElementById("toggleAlertsSound").addEventListener("change",function(){alertsSound=this.checked;const p=getProfile(currentUser?.email||"");if(p)p.alertsSound=alertsSound,saveProfile(currentUser.email,p)});
document.getElementById("settingsSwitchUser").addEventListener("click",()=>{closeSettings();clearCurrent();if(window._ct)clearInterval(window._ct);stopPing();showLogin()});
document.getElementById("settingsLogout").addEventListener("click",()=>{closeSettings();clearCurrent();if(window._ct)clearInterval(window._ct);stopPing();const e=currentUser?.email;if(e){const p=getProfile(e);if(p)p._f=true,saveProfile(e,p)}showLogin()});

// ====== STATS ======
let stats={alertsToday:0,alertsDone:0,msgsSent:0,chatActive:0,chatUnread:0,chatArchived:0,chatOnline:0,chatOffline:0};
function updateStats(){
  document.getElementById("statAlertsToday").textContent=stats.alertsToday;
  document.getElementById("statAlertsDone").textContent=stats.alertsDone;
  document.getElementById("statMsgsSent").textContent=stats.msgsSent;
  document.getElementById("statChatActive").textContent=stats.chatActive;
  document.getElementById("statChatUnread").textContent=stats.chatUnread;
  document.getElementById("statChatArchived").textContent=stats.chatArchived;
  document.getElementById("statChatOnline").textContent=stats.chatOnline;
  document.getElementById("statChatOffline").textContent=stats.chatOffline;
}

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
  const c=document.getElementById("conversationList");
  const cached=S.get("sgsa_convCache");if(cached?.length){conversations=cached;renderConversations()}
  refreshConversations();if(_ct)clearInterval(_ct);_ct=setInterval(refreshConversations,R);
  // ONE delegated listener — handles everything: pin, archive, batch, open
  c.addEventListener("click",async function(ev){
    const card=ev.target.closest(".group-card");
    if(!card)return;
    const gid=parseInt(card.dataset.gid);
    const cv=conversations.find(x=>x.group_id==gid);
    // ── Pin ──
    if(ev.target.closest(".pin-btn")){
      ev.stopPropagation();
      const r=await P("/api/chat/pin",{group_id:gid});
      if(r?.ok){if(cv)cv.pinned=r.pinned}
      else{togglePin(gid);if(cv)cv.pinned=getPins().includes(gid)}
      S.del("sgsa_convCache");renderConversations();
      return;
    }
    // ── Archive ──
    if(ev.target.closest(".delete-chat-btn")){
      ev.stopPropagation();
      if(!await _confirm("El chat se archivará y no aparecerá en tu bandeja de entrada. Podés recuperarlo desde la sección de archivados.","Archivar chat"))return;
      const r=await P("/api/chat/hide",{group_id:gid});
      if(r?.ok&&r.hidden){conversations=conversations.filter(x=>x.group_id!=gid);S.del("sgsa_convCache");renderConversations();toast("Chat archivado","success")}
      else if(r?.ok&&!r.hidden){toast("Chat ya estaba archivado","info")}
      else{toast("Error al archivar","error")}
      return;
    }
    // ── Batch mode toggle ──
    if(_batchMode){
      console.log("[batch] toggle gid=",gid,"batchSelected was",[..._batchSelected]);
      const i=_batchSelected.indexOf(gid);
      if(i>-1)_batchSelected.splice(i,1);else _batchSelected.push(gid);
      _updateBatchBtn();
      card.classList.toggle("batch-selected");
      const check=card.querySelector(".batch-check");
      if(check){
        const sel=_batchSelected.includes(gid);
        check.classList.toggle("checked",sel);
        check.innerHTML=sel
          ?'<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger)">check_circle</span>'
          :'<span class="material-symbols-outlined" style="font-size:18px">radio_button_unchecked</span>';
      }
      console.log("[batch] after toggle:",[..._batchSelected]);
      return;
    }
    // ── Open conversation ──
    if(cv)openConversation(cv);
  });
  // ── Attachment actions: download + fullscreen ──
  document.getElementById("messageList").addEventListener("click",function(ev){
    var dl=ev.target.closest(".att-dl");
    if(dl){ev.preventDefault();ev.stopPropagation();_download(dl.dataset.url,dl.dataset.name);return}
    var fs=ev.target.closest(".att-fs");
    if(fs){ev.preventDefault();ev.stopPropagation();_openViewer(fs.dataset.url,fs.dataset.name,fs.dataset.tipo)}
  });
}
// ─── Fullscreen viewer ────────────────────────────────────────────
var _fsOpen=false;
function _openViewer(url,name,tipo){
  if(_fsOpen)return;
  var v=document.getElementById("fullscreenViewer"),img=document.getElementById("fsImage"),video=document.getElementById("fsVideo"),fn=document.getElementById("fsFilename");
  img.style.display="none";video.style.display="none";
  if(tipo==="imagen"||tipo==="video"){
    if(tipo==="imagen"){img.src=url;img.style.display="block"}
    else{video.src=url;video.style.display="block"}
    fn.textContent=name||"";
    v.classList.add("open");_fsOpen=true;
    document.body.style.overflow="hidden";
  }
}
function _closeViewer(){
  var v=document.getElementById("fullscreenViewer"),img=document.getElementById("fsImage"),video=document.getElementById("fsVideo");
  v.classList.remove("open");_fsOpen=false;
  document.body.style.overflow="";
  setTimeout(function(){img.src="";video.src=""},300);
}
document.getElementById("fsCloseBtn").addEventListener("click",_closeViewer);
document.getElementById("fullscreenViewer").addEventListener("click",function(e){if(e.target===this)_closeViewer()});
document.getElementById("fsDownloadBtn").addEventListener("click",function(){
  var img=document.getElementById("fsImage"),video=document.getElementById("fsVideo");
  var url=img.style.display!="none"?img.src:video.src;
  var name=document.getElementById("fsFilename").textContent;
  if(url)_download(url,name);
});
let _refreshing=0;
async function refreshConversations(){
  if(!authToken||_refreshing)return;
  _refreshing=1;
  try{
    // Show cached conversations immediately
    const cached=S.get("sgsa_convCache");if(cached?.length&&!conversations.length){conversations=cached;renderConversations()}
    const d=await G("/api/chat/conversations");
    if(d?.ok){
      // Merge: preserve optimistic last_message_time for new convos with no messages yet
      const oldMap={};conversations.forEach(c=>{oldMap[c.group_id]=c});
      d.conversations.forEach(c=>{
        if(!c.last_message_time && oldMap[c.group_id]?.last_message_time){
          c.last_message_time=oldMap[c.group_id].last_message_time;
        }
      });
      conversations=d.conversations;S.set("sgsa_convCache",conversations);renderConversations();
      const newUnread=conversations.filter(c=>c.unread>0).length;
      document.getElementById("chat-badge").textContent=newUnread||"";
      // Update chat stats
      stats.chatActive=conversations.length;
      stats.chatUnread=conversations.filter(c=>c.unread>0).length;
      stats.chatOnline=conversations.filter(c=>c.online).length;
      stats.chatOffline=conversations.filter(c=>c.is_dm&&!c.online).length;
      // Update selected conversation header with fresh online/offline status
      if(selectedConversation){
        const fresh=conversations.find(c=>c.group_id===selectedConversation.group_id);
        if(fresh){
          selectedConversation.online=fresh.online;
          selectedConversation.display_name=fresh.display_name;
          updateChatHeader(fresh);
        }
      }
    } else if(d?.error){
      console.error("Conversations error:",d.error);
      if(cached?.length){conversations=cached;renderConversations()}
    }
  }finally{_refreshing=0}
}

let _chatFilter="all";
let _batchMode=0,_batchSelected=[];
function _toggleBatch(){_batchMode=!_batchMode;if(!_batchMode)_batchSelected=[];document.getElementById("batchBar")?.classList.toggle("active",_batchMode>0);renderConversations();_updateBatchBtn()}

// ─── Visual confirm (replaces native confirm()) ──────────────────────────
function _confirm(msg, title, danger){
  return new Promise(resolve => {
    const modal=document.getElementById("confirmModal");
    const icon=document.getElementById("confirmIcon");
    const titleEl=document.getElementById("confirmTitle");
    const msgEl=document.getElementById("confirmMsg");
    const okBtn=document.getElementById("confirmOkBtn");
    const cancelBtn=document.getElementById("confirmCancelBtn");
    icon.textContent=danger?"warning":"help";
    icon.style.color=danger?"var(--danger)":"var(--accent)";
    titleEl.textContent=title||(danger?"Atención":"Confirmar");
    msgEl.textContent=msg;
    okBtn.textContent=danger?"Eliminar":"Aceptar";
    okBtn.className=danger?"btn-danger":"btn-primary";
    okBtn.style.marginTop="0";
    modal.style.display="flex";
    const close=()=>{modal.style.display="none"; okBtn.onclick=null; cancelBtn.onclick=null;};
    okBtn.onclick=()=>{close(); resolve(true);};
    cancelBtn.onclick=()=>{close(); resolve(false);};
  });
}
function _updateBatchBtn(){const b=document.getElementById("batchDeleteBtn");if(!b)return;const n=_batchSelected.length;b.textContent=n?"Eliminar ("+n+")":"Eliminar";b.disabled=!n}
let _inboxDateRange="";
let _inboxDateFrom="";
let _inboxDateTo="";
let _inboxDaysAgo="";
function _applyInboxDateFilter(list){
  let f=list;
  const now=new Date();
  const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(_inboxDateRange==="today"){f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=todayStart})}
  else if(_inboxDateRange==="yesterday"){const ys=new Date(todayStart);ys.setDate(ys.getDate()-1);const ye=new Date(todayStart);f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=ys&&d<ye})}
  else if(_inboxDateRange==="week"){const ws=new Date(todayStart);ws.setDate(ws.getDate()-ws.getDay());f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=ws})}
  else if(_inboxDateRange==="month"){const ms=new Date(now.getFullYear(),now.getMonth(),1);f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=ms})}
  else if(_inboxDateRange==="year"){const ys2=new Date(now.getFullYear(),0,1);f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=ys2})}
  if(_inboxDateFrom){const fd=new Date(_inboxDateFrom);f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=fd})}
  if(_inboxDateTo){const td=new Date(_inboxDateTo);td.setHours(23,59,59,999);f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d<=td})}
  if(_inboxDaysAgo){const da=parseInt(_inboxDaysAgo);if(da>0){const dd=new Date(todayStart);dd.setDate(dd.getDate()-da);f=f.filter(c=>{const d=c.last_message_time?new Date(c.last_message_time):null;return d&&d>=dd})}}
  return f;
}
function renderConversations(){
  const q=(document.getElementById("conversationSearch")?.value||"").toLowerCase();
  let f=conversations;
  if(_chatFilter==="groups")f=f.filter(c=>!c.is_dm);
  else if(_chatFilter==="dms")f=f.filter(c=>c.is_dm);
  if(q)f=f.filter(c=>c.display_name?.toLowerCase().includes(q));
  f=_applyInboxDateFilter(f);
  const c=document.getElementById("conversationList"),e=document.getElementById("inboxEmpty");
  if(!f.length){c.innerHTML="";e.style.display="flex";return}e.style.display="none";
  // Sort: pinned first, then by last_message_time DESC (most recent activity first)
  const sorted=[...f].sort((a,b)=>{
    if(a.pinned&&!b.pinned)return -1;
    if(!a.pinned&&b.pinned)return 1;
    const ta=a.last_message_time?new Date(a.last_message_time).getTime():0;
    const tb=b.last_message_time?new Date(b.last_message_time).getTime():0;
    return tb-ta;
  });
  c.innerHTML=sorted.map(cv=>{
    const gid=cv.group_id;
    const initials=avatarInitials(cv.display_name);
    const bgColor=avatarColor(cv.display_name);
    const avUrl=avatarUrl(cv.avatar_url);
    const avatarContent=avUrl
      ?`<img src="${esc(avUrl)}" class="group-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bgColor}">${initials}</span>`
      :`<span class="avatar-initials" style="background:${bgColor}">${initials}</span>`;
    const onlineDot=cv.is_dm?`<span class="online-dot ${cv.online?"online":"offline"}"></span>`:"";
    const subtitle=cv.is_dm?(cv.online?"En línea":"Offline"):(cv.member_count?cv.member_count+" miembros":"");
    const sel=_batchSelected.includes(gid);
    return`<div class="group-card ${cv.pinned?"pinned ":""}${selectedConversation?.group_id===gid?"selected":""}${_batchMode?" batch-mode":""}${_batchMode&&sel?" batch-selected":""}" data-gid="${gid}">
    ${_batchMode?`<span class="batch-check ${sel?"checked":""}">${sel?'<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger)">check_circle</span>':'<span class="material-symbols-outlined" style="font-size:18px">radio_button_unchecked</span>'}</span>`:""}
    <div class="group-avatar">${avatarContent}${onlineDot}</div>
    <div class="group-info"><div class="group-name">${esc(cv.display_name||"Chat")}</div><div class="group-last-msg">${subtitle?`<span class="conv-subtitle">${esc(subtitle)}</span> · `:""}${cv.unread>0&&!cv.last_message?cv.unread+" mensaje"+(cv.unread>1?"s":"")+" nuevo"+(cv.unread>1?"s":""):esc(cv.last_message||"Sin mensajes")}</div></div>
    <div class="group-meta"><div class="group-time">${cv.last_message_time?timeAgo(cv.last_message_time):""}</div>${cv.unread>0?`<div class="group-unread">${cv.unread>99?"99+":cv.unread}</div>`:""}</div>
    <button class="pin-btn ${cv.pinned?"pinned":""}" data-gid="${gid}" title="${cv.pinned?"Desfijar":"Fijar"}"><span class="material-symbols-outlined">push_pin</span></button>
    <button class="delete-chat-btn" data-gid="${gid}" title="Archivar chat"><span class="material-symbols-outlined">archive</span></button>
  </div>`}).join("");
}
document.getElementById("conversationSearch")?.addEventListener("input",renderConversations);
document.querySelectorAll(".filter-btn").forEach(b=>b.addEventListener("click",function(){
  document.querySelectorAll(".filter-btn").forEach(x=>x.classList.remove("active"));
  this.classList.add("active");
  _chatFilter=this.dataset.filter;
  renderConversations();
}));
// Inbox date filter toggle
document.getElementById("batchToggleBtn")?.addEventListener("click",_toggleBatch);
document.getElementById("batchCancelBtn")?.addEventListener("click",_toggleBatch);
document.getElementById("batchDeleteBtn")?.addEventListener("click",async function(){
  const ids=_batchSelected.slice();if(!ids.length)return;
  if(!await _confirm("Se eliminarán "+ids.length+" grupo(s) con todos sus mensajes. Esta acción no se puede deshacer.","Eliminar "+ids.length+" grupo(s)",true))return;
  const btn=document.getElementById("batchDeleteBtn");btn.disabled=true;btn.textContent="Eliminando...";
  let ok=0,err=0;
  for(const gid of ids){
    try{
      const r=await _ft(API+"/api/chat/groups/"+gid,{method:"DELETE",headers:authToken?{Authorization:"Bearer "+authToken}:{}});
      const d=await r.json();
      if(d?.ok){ok++;conversations=conversations.filter(c=>c.group_id!=gid)}
      else err++;
    }catch{err++}
  }
  S.del("sgsa_convCache");
  _batchMode=0;_batchSelected=[];
  document.getElementById("batchBar")?.classList.remove("active");
  renderConversations();
  toast(ok+" grupo(s) eliminado(s)"+(err?" ("+err+" error(es))":""),err?"warning":"success");
});
document.getElementById("inboxFilterToggle")?.addEventListener("click",function(){
  const body=document.getElementById("inboxDateFilters");
  if(!body)return;
  const show=body.style.display!=="flex";
  body.style.display=show?"flex":"none";
  this.classList.toggle("active",show);
});
// Inbox date filter controls
document.querySelectorAll("#inboxDateFilters .arch-filter-btn").forEach(b=>b.addEventListener("click",function(){
  _inboxDateRange=this.dataset.range;
  document.querySelectorAll("#inboxDateFilters .arch-filter-btn").forEach(x=>x.classList.toggle("active",x===this));
  _inboxDateFrom="";_inboxDateTo="";_inboxDaysAgo="";
  document.getElementById("inboxDateFrom").value="";document.getElementById("inboxDateTo").value="";
  document.getElementById("inboxDaysAgo").value="";
  renderConversations();
}));
document.getElementById("inboxDateFrom")?.addEventListener("change",function(){_inboxDateFrom=this.value;_inboxDateRange="";_inboxDaysAgo="";document.querySelectorAll("#inboxDateFilters .arch-filter-btn").forEach(x=>x.classList.remove("active"));document.getElementById("inboxDaysAgo").value="";renderConversations()});
document.getElementById("inboxDateTo")?.addEventListener("change",function(){_inboxDateTo=this.value;_inboxDateRange="";_inboxDaysAgo="";document.querySelectorAll("#inboxDateFilters .arch-filter-btn").forEach(x=>x.classList.remove("active"));document.getElementById("inboxDaysAgo").value="";renderConversations()});
document.getElementById("inboxDaysAgo")?.addEventListener("input",function(){_inboxDaysAgo=this.value;_inboxDateRange="";_inboxDateFrom="";_inboxDateTo="";document.querySelectorAll("#inboxDateFilters .arch-filter-btn").forEach(x=>x.classList.remove("active"));document.getElementById("inboxDateFrom").value="";document.getElementById("inboxDateTo").value="";renderConversations()});
document.getElementById("inboxClearFilter")?.addEventListener("click",function(){
  _inboxDateRange="";_inboxDateFrom="";_inboxDateTo="";_inboxDaysAgo="";
  document.querySelectorAll("#inboxDateFilters .arch-filter-btn").forEach(x=>x.classList.remove("active"));
  document.getElementById("inboxDateFrom").value="";document.getElementById("inboxDateTo").value="";
  document.getElementById("inboxDaysAgo").value="";renderConversations();
});
function timeAgo(iso){if(!iso)return"";const d=Date.now()-new Date(iso).getTime(),m=Math.floor(d/60000);if(m<1)return"ahora";if(m<60)return m+"m";const h=Math.floor(m/60);if(h<24)return h+"h";return Math.floor(h/24)+"d"}

function updateChatHeader(cv){
  const headerTitle=document.getElementById("chatHeaderTitle");
  let headerHtml=`<span class="chat-name">${esc(cv.display_name||"Chat")}</span>`;
  if(cv.is_dm){
    headerHtml+=`<span class="chat-status ${cv.online?"online":"offline"}">${cv.online?"En línea":"Offline"}</span>`;
  }else if(cv.member_count){
    headerHtml+=`<span class="chat-status">${cv.member_count} miembros</span>`;
  }
  headerTitle.innerHTML=headerHtml;
  headerTitle.style.cursor="pointer";
  headerTitle.onclick=cv.is_dm?()=>showEmployeeCard(cv.group_id):()=>showGroupInfo(cv.group_id,cv.avatar_url);
}

async function showEmployeeCard(gidOrId){
  document.getElementById("employeeCardBody").innerHTML='<div class="empty-state"><p>Cargando...</p></div>';
  openModal("employeeCardModal");
  let empId=gidOrId;
  // If it's a group_id (number), get group info to find the other person
  if(typeof gidOrId==="number"||/^\d+$/.test(gidOrId)){
    const d=await G("/api/chat/groups/"+gidOrId);
    if(!d?.ok){document.getElementById("employeeCardBody").innerHTML='<div class="empty-state"><p>Error al cargar</p></div>';return}
    // Try to find other member by all possible currentUser identifiers
    const myIds=[currentUser?.id,currentUser?.login_id,currentUser?.airtable_id,currentUser?.email].filter(Boolean);
    const other=((d.members||[]).find(m=>!myIds.some(id=>m.id===id||m.airtable_id===id||m.email===id)));
    if(!other){document.getElementById("employeeCardBody").innerHTML='<div class="empty-state"><p>Sin datos</p></div>';return}
    empId=other.id||other.airtable_id;
  }
  const ed=await G("/api/chat/employee/"+encodeURIComponent(empId));
  if(!ed?.ok){document.getElementById("employeeCardBody").innerHTML='<div class="empty-state"><p>Error al cargar empleado</p></div>';return}
  const emp=ed.employee,initials=avatarInitials(emp.nombre),bg=avatarColor(emp.nombre);
  const av=avatarUrl(emp.avatar_url);
  document.getElementById("employeeCardBody").innerHTML=`
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px">
      <div style="width:72px;height:72px;border-radius:50%;background:var(--bg4);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;flex-shrink:0">
        ${av?`<img src="${esc(av)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bg};font-size:24px">${initials}</span>`
          :`<span class="avatar-initials" style="background:${bg};font-size:24px">${initials}</span>`}
        ${emp.online?`<span style="position:absolute;bottom:2px;right:2px;width:14px;height:14px;border-radius:50%;background:var(--success);border:3px solid var(--bg2)"></span>`:""}
      </div>
      <h3 style="font-size:18px;font-weight:700;margin:0">${esc(emp.nombre||"—")}</h3>
      <div style="display:flex;flex-direction:column;gap:6px;width:100%">
        ${emp.es_admin?`<div class="detail-field"><span class="detail-label">Rol</span><span class="detail-value" style="color:var(--accent);font-weight:600">Admin</span></div>`:""}
        ${emp.oficina_nombre?`<div class="detail-field"><span class="detail-label">Sucursal</span><span class="detail-value">${esc(emp.oficina_nombre)}</span></div>`:""}
        ${emp.email?`<div class="detail-field"><span class="detail-label">Email</span><span class="detail-value">${esc(emp.email)}</span></div>`:""}
        ${emp.telefono?`<div class="detail-field"><span class="detail-label">Teléfono</span><span class="detail-value">${esc(emp.telefono)}</span></div>`:""}
        <div class="detail-field"><span class="detail-label">Estado</span><span class="detail-value" style="color:${emp.online?'var(--success)':'var(--danger)'}">${emp.online?"En línea":"Desconectado"}</span></div>
      </div>
    </div>
  `;
}
async function openConversation(cv){selectedConversation=cv;
  document.getElementById("chatMainEmpty").style.display="none";
  document.getElementById("message-view").style.display="";
  document.getElementById("chatBackBtn").style.display=window.innerWidth<=768?"":"none";
  document.getElementById("chatMain").classList.add("open");
  updateChatHeader(cv);
  await loadMessages(cv.group_id);renderConversations()}
async function showGroupInfo(gid,currentAvatar){
  document.getElementById("groupInfoTitle").textContent="Cargando...";
  document.getElementById("groupInfoBody").innerHTML='<div class="empty-state"><p>Cargando...</p></div>';
  openModal("groupInfoModal");
  const d=await G("/api/chat/groups/"+gid);
  if(!d?.ok){document.getElementById("groupInfoBody").innerHTML='<div class="empty-state"><p>Error</p></div>';return}
  document.getElementById("groupInfoTitle").textContent=d.group?.nombre||"Grupo";
  // Store current avatar for edit modal
  _editGroupAvatar=currentAvatar||"";
  const members=(d.members||[]).map(m=>{
    const initials=avatarInitials(m.nombre);
    const bgColor=avatarColor(m.nombre);
    const isOnline=m.online||false;
    return`<div class="member-row">
      <div class="member-avatar">${avatarUrl(m.avatar_url)?`<img src="${esc(avatarUrl(m.avatar_url))}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bgColor}">${initials}</span>`:`<span class="avatar-initials" style="background:${bgColor}">${initials}</span>`}
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
    `<div class="members-list">${members}</div>`+
    `<div class="group-actions"><button class="btn-outline" id="editGroupBtn" data-gid="${gid}" data-nombre="${esc(d.group?.nombre||'')}" data-desc="${esc(d.group?.descripcion||'')}"><span class="material-symbols-outlined" style="font-size:16px">edit</span> Editar</button><button class="btn-outline btn-danger" id="deleteGroupBtn" data-gid="${gid}"><span class="material-symbols-outlined" style="font-size:16px">delete</span> Eliminar</button></div>`;
  document.getElementById("editGroupBtn")?.addEventListener("click",function(){
    const gid=this.dataset.gid,name=this.dataset.nombre,desc=this.dataset.desc;
    closeModal("groupInfoModal");
    _editGroupId=gid;
    document.getElementById("editGroupName").value=name;
    document.getElementById("editGroupDesc").value=desc;
    _updateEditAvatarPreview();
    // Load current members
    _loadEditMembers(gid);
    openModal("editGroupModal");
  });
  document.getElementById("deleteGroupBtn")?.addEventListener("click",function(){
    const gid=this.dataset.gid;
    closeModal("groupInfoModal");
    _deleteGroupId=gid;
    openModal("confirmDeleteModal");
  });
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
  const sorted=msgs;
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
    var fsAttr=' data-url="'+m.adjunto_url+'" data-name="'+esc(m.adjunto_nombre||"")+'" data-tipo="'+m.tipo+'"';
    if(m.tipo==="imagen"&&m.adjunto_url)body=`<div class="msg-attachment"><div class="att-preview"><img src="${m.adjunto_url}" loading="lazy"><button class="att-fs"${fsAttr} title="Ver completo"><span class="material-symbols-outlined">fullscreen</span></button><button class="att-dl" data-url="${m.adjunto_url}" data-name="${esc(m.adjunto_nombre||"imagen")}" title="Descargar"><span class="material-symbols-outlined">download</span></button></div></div>`;
    else if((m.tipo==="video"||m.tipo==="audio")&&m.adjunto_url)body=`<div class="msg-attachment"><div class="att-preview">${m.tipo==="audio"?`<audio controls src="${m.adjunto_url}"></audio>`:`<video controls src="${m.adjunto_url}" style="max-width:100%;max-height:300px"></video>`}<button class="att-fs"${fsAttr} title="Ver completo"><span class="material-symbols-outlined">fullscreen</span></button><button class="att-dl" data-url="${m.adjunto_url}" data-name="${esc(m.adjunto_nombre||m.tipo)}" title="Descargar"><span class="material-symbols-outlined">download</span></button></div></div>`;
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

// ─── Attachment menu with per-type file pickers ──────────────────────
const _attachMenu=document.getElementById("attachMenu");
document.getElementById("attachBtn").addEventListener("click",function(e){
  e.stopPropagation();
  _attachMenu.classList.toggle("active");
});
// Close menu on outside click
document.addEventListener("click",function(e){
  if(!e.target.closest(".attach-wrap"))_attachMenu.classList.remove("active");
});
// Map type icons for the uploading message
const _typeIcons={imagen:"photo_camera",video:"videocam",audio:"mic",documento:"description"};
const _fileInputs={imagen:"fileInputImg",video:"fileInputVideo",audio:"fileInputAudio",documento:"fileInputDoc"};
// Wire each attachment option to its file input
document.querySelectorAll(".attach-opt").forEach(function(btn){
  btn.addEventListener("click",function(){
    const tipo=this.dataset.type;
    document.getElementById(_fileInputs[tipo]).click();
    _attachMenu.classList.remove("active");
  });
});
// Unified upload handler for all file inputs
["imagen","video","audio","documento"].forEach(function(tipo){
  document.getElementById(_fileInputs[tipo]).addEventListener("change",async function(e){
    const file=e.target.files[0];
    if(!file||!selectedConversation){e.target.value="";return}
    e.target.value="";
    const c=document.getElementById("messageList");
    const fakeId="upload_"+Date.now();
    const icon=_typeIcons[tipo]||"attach_file";
    const fakeEl=document.createElement("div");
    fakeEl.className="message system";
    fakeEl.dataset.fakeId=fakeId;
    fakeEl.innerHTML='<div class="msg-uploading"><span class="material-symbols-outlined" style="font-size:18px;color:var(--accent)">'+icon+'</span><span class="upload-spinner"></span>Subiendo <strong>'+esc(file.name)+'</strong>…</div>';
    c.appendChild(fakeEl);c.scrollTop=c.scrollHeight;
    try{
      const fd=new FormData();fd.append("file",file);
      const r=await _upload(API+"/api/chat/upload",{method:"POST",headers:authToken?{Authorization:"Bearer "+authToken}:{},body:fd},120000);
      const res=await r.json();
      if(res?.url){
        await P("/api/chat/messages",{
          grupo_id:selectedConversation.group_id,
          sender_id:currentUser?.airtable_id||currentUser?.id,
          mensaje:file.name,
          tipo:tipo,
          adjunto_url:res.url,
          adjunto_nombre:file.name
        });
        // Remove fake message and reload real ones
        const fl=c.querySelector('[data-fake-id="'+fakeId+'"]');
        if(fl)fl.remove();
        await loadMessages(selectedConversation.group_id);
        refreshConversations();
      }else{
        const fl=c.querySelector('[data-fake-id="'+fakeId+'"]');
        if(fl){fl.classList.add("sys-error");fl.querySelector(".msg-uploading").innerHTML='<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger)">error</span> Error al subir — <strong>'+esc(file.name)+'</strong>';}
      }
    }catch(er){
      const fl=c.querySelector('[data-fake-id="'+fakeId+'"]');
      if(fl){fl.classList.add("sys-error");fl.querySelector(".msg-uploading").innerHTML='<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger)">error</span> Error al subir — <strong>'+esc(file.name)+'</strong>';}
    }
  });
});

// ─── Voice recorder (MediaRecorder) ────────────────────────────────
function _startRecording(){
  if(_recording||_sending||!selectedConversation)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){toast("Grabación no soportada","error");return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    _recording=true;_recChunks=[];
    var mr;try{mr=new MediaRecorder(stream,{mimeType:"audio/webm"})}catch(e){try{mr=new MediaRecorder(stream)}catch(e2){toast("Error al iniciar grabación","error");_recording=false;return}}
    mr.ondataavailable=function(e){if(e.data.size>0)_recChunks.push(e.data)};
    mr.onstop=function(){
      stream.getTracks().forEach(function(t){t.stop()});
      if(_recTimer){clearInterval(_recTimer);_recTimer=null}
      _recording=false;
      // Hide voice bar, show input+send+voice
      document.getElementById("voiceBar").classList.remove("active");document.getElementById("voiceBar").style.display="none";
      document.getElementById("voiceBtn").classList.remove("hidden");document.getElementById("sendBtn").classList.remove("hidden");
      document.getElementById("chatInput").style.display="";
      // Upload the blob
      var blob=new Blob(_recChunks,{type:"audio/webm"});
      if(blob.size<100){toast("Grabación muy corta","error");return}
      _sendVoiceBlob(blob);
    };
    mr.onerror=function(){stream.getTracks().forEach(function(t){t.stop()});_recording=false;toast("Error de grabación","error")};
    mr.start(100); // collect data every 100ms
    _mediaRecorder=mr;_recStart=Date.now();
    // Show voice bar, hide input+send+voice
    document.getElementById("voiceBtn").classList.add("hidden");document.getElementById("sendBtn").classList.add("hidden");
    document.getElementById("chatInput").style.display="none";
    var vb=document.getElementById("voiceBar");vb.style.display="flex";setTimeout(function(){vb.classList.add("active")},10);
    _recTimer=setInterval(function(){
      var sec=Math.floor((Date.now()-_recStart)/1000);
      var m=Math.floor(sec/60),s=sec%60;
      document.getElementById("voiceTimer").textContent=m+":"+(s<10?"0":"")+s;
      if(sec>=180){_stopRecording()} // max 3 min
    },200);
  }).catch(function(e){
    if(e.name==="NotAllowedError"||e.name==="PermissionDeniedError"){toast("Permiso de micrófono denegado","error");return}
    toast("No se pudo acceder al micrófono","error")
  });
}
function _stopRecording(){
  if(_mediaRecorder&&_mediaRecorder.state==="recording"){_mediaRecorder.stop()}
}
function _sendVoiceBlob(blob){
  var c=document.getElementById("messageList"),fakeId="voice_"+Date.now();
  var fakeEl=document.createElement("div");fakeEl.className="message system";fakeEl.dataset.fakeId=fakeId;
  fakeEl.innerHTML='<div class="msg-uploading"><span class="material-symbols-outlined" style="font-size:18px;color:var(--accent)">mic</span><span class="upload-spinner"></span>Enviando audio…</div>';
  c.appendChild(fakeEl);c.scrollTop=c.scrollHeight;
  var fd=new FormData();fd.append("file",blob,"audio_"+Date.now()+".webm");
  _upload(API+"/api/chat/upload",{method:"POST",headers:authToken?{Authorization:"Bearer "+authToken}:{},body:fd},120000).then(function(r){return r.json()}).then(function(res){
    if(res?.url){
      return P("/api/chat/messages",{
        grupo_id:selectedConversation.group_id,
        sender_id:currentUser?.airtable_id||currentUser?.id,
        mensaje:"🎤 Nota de voz",
        tipo:"audio",
        adjunto_url:res.url,
        adjunto_nombre:"nota-de-voz.webm"
      });
    }else{throw new Error("upload failed")}
  }).then(function(){
    var fl=c.querySelector('[data-fake-id="'+fakeId+'"]');
    if(fl)fl.remove();
    loadMessages(selectedConversation.group_id);refreshConversations();
  }).catch(function(){
    var fl=c.querySelector('[data-fake-id="'+fakeId+'"]');
    if(fl){fl.classList.add("sys-error");fl.querySelector(".msg-uploading").innerHTML='<span class="material-symbols-outlined" style="font-size:18px;color:var(--danger)">error</span> Error al enviar audio'}
  });
}
document.getElementById("voiceBtn").addEventListener("click",_startRecording);
document.getElementById("voiceStopBtn").addEventListener("click",_stopRecording);

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
function renderPeopleList(list){const q=(document.getElementById("peopleSearch")?.value||"").toLowerCase(),f=q?list.filter(e=>e.nombre?.toLowerCase().includes(q)):list,c=document.getElementById("peopleList");if(!f.length){c.innerHTML='<div class="empty-state"><p>Sin resultados</p></div>';return}c.innerHTML=f.map(e=>{
  const initials=avatarInitials(e.nombre),bg=avatarColor(e.nombre);
  return`<div class="item-row" data-empleado-id="${e.id}" data-empleado-nombre="${esc(e.nombre)}"><div class="item-avatar">${avatarUrl(e.avatar_url)?`<img src="${esc(avatarUrl(e.avatar_url))}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="member-initials" style="display:none;background:${bg}">${initials}</span>`:`<span class="member-initials" style="background:${bg}">${initials}</span>`}<span class="online-dot ${e.online?"online":"offline"}"></span></div><div class="item-info"><div class="item-name">${esc(e.nombre)}</div>${e.oficina_nombre?`<div class="item-sub">${esc(e.oficina_nombre)}</div>`:""}<div class="item-sub">${e.online?"En línea":"Desconectado"}</div></div><span class="item-action">${window._shareMsg?'<span class="material-symbols-outlined" style="font-size:16px">share</span> Compartir':'<span class="material-symbols-outlined" style="font-size:16px">chat</span>'}</span></div>`}).join("");c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",async()=>{if(!authToken){showLogin();return}
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
      const emp=allEmployees.find(e=>e.id===el.dataset.empleadoId||e.airtable_id===el.dataset.empleadoId);
      const dmCv={group_id:r.group_id,display_name:el.dataset.empleadoNombre||"DM",is_dm:true,online:false,avatar_url:emp?.avatar_url||null,pinned:false,unread:0,last_message:txt.slice(0,100),last_message_time:new Date().toISOString()};
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
    const emp=allEmployees.find(e=>e.id===el.dataset.empleadoId||e.airtable_id===el.dataset.empleadoId);
    const dmCv={group_id:r.group_id,display_name:el.dataset.empleadoNombre||"DM",is_dm:true,online:false,avatar_url:emp?.avatar_url||null,pinned:false,unread:0,last_message:null,last_message_time:new Date().toISOString()};
    // Optimistically add to conversations so it appears in sidebar immediately
    if(!conversations.find(x=>x.group_id==r.group_id))conversations.push(dmCv);
    renderConversations();
    await openConversation(dmCv);
    await refreshConversations();
  }else{toast("Error al iniciar DM","error")}
}))}
document.getElementById("peopleSearch").addEventListener("input",()=>renderPeopleList(allEmployees));

// ─── Group member search ───────────────────────────────────────────────────
async function loadMemberSearch(){
  const cached=S.get("sgsa_empCache");
  const list=cached?.length?cached.filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id)):[];
  if(list.length)renderMemberSearch(list);
  const d=await G("/api/chat/employees");
  if(d?.ok){
    S.set("sgsa_empCache",d.employees);
    const emp=(d.employees||[]).filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id));
    renderMemberSearch(emp);
  }else if(!cached){
    renderMemberSearch([]);
  }}
function renderMemberSearch(list){
  const q=(document.getElementById("memberSearch")?.value||"").toLowerCase();
  const f=q?list.filter(e=>e.nombre?.toLowerCase().includes(q)):list;
  const c=document.getElementById("memberSearchResults");
  if(!f.length){c.innerHTML='<div class="empty-state"><p>Sin resultados</p></div>';return}
  const sel=new Set(selectedMembers.map(m=>m.airtable_id));
  c.innerHTML=f.map(e=>{
    const isSel=sel.has(e.airtable_id);
    const initials=avatarInitials(e.nombre),bg=avatarColor(e.nombre);
    return`<div class="item-row ${isSel?'selected':''}" data-airtable-id="${e.airtable_id}" data-nombre="${esc(e.nombre)}" data-avatar="${esc(e.avatar_url||'')}">
      <div class="item-avatar">${avatarUrl(e.avatar_url)?`<img src="${esc(avatarUrl(e.avatar_url))}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="member-initials" style="display:none;background:${bg}">${initials}</span>`:`<span class="member-initials" style="background:${bg}">${initials}</span>`}
        <span class="online-dot ${e.online?'online':'offline'}"></span></div>
      <div class="item-info"><div class="item-name">${esc(e.nombre)}</div><div class="item-sub">${e.oficina_nombre||''}</div></div>
      <span class="item-action">${isSel?'<span class="material-symbols-outlined" style="font-size:18px;color:var(--accent)">check_circle</span>':'<span class="material-symbols-outlined" style="font-size:18px;color:var(--fg3)">add_circle</span>'}</span>
    </div>`}).join("");
  c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",()=>{
    const id=el.dataset.airtableId;
    const name=el.dataset.nombre;
    const avatar=el.dataset.avatar;
    const idx=selectedMembers.findIndex(m=>m.airtable_id===id);
    if(idx>=0)selectedMembers.splice(idx,1);else selectedMembers.push({airtable_id:id,nombre:name,avatar_url:avatar||null});
    renderMemberSearch(list);
    renderSelectedMembers();
  }));
}
function renderSelectedMembers(){
  const c=document.getElementById("selectedMembers");
  if(!selectedMembers.length){c.innerHTML='';return}
  c.innerHTML=selectedMembers.map(m=>{
    const initials=avatarInitials(m.nombre),bg=avatarColor(m.nombre);
    return`<span class="member-chip"><span class="chip-avatar">${m.avatar_url?`<img src="${esc(avatarUrl(m.avatar_url))}" onerror="this.style.display='none';this.parentElement.innerHTML='${initials}'">`:initials}</span>${esc(m.nombre)}<span class="chip-remove" data-id="${m.airtable_id}">×</span></span>`;
  }).join("");
  c.querySelectorAll(".chip-remove").forEach(el=>el.addEventListener("click",function(){
    const id=this.dataset.id;
    selectedMembers=selectedMembers.filter(m=>m.airtable_id!==id);
    const cached=S.get("sgsa_empCache")||[];
    renderMemberSearch(cached.length?cached.filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id)):[]);
    renderSelectedMembers();
  }));
}
document.getElementById("memberSearch").addEventListener("input",()=>{
  const cached=S.get("sgsa_empCache");
  if(cached?.length)renderMemberSearch(cached.filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id)));
});

// ─── Group avatar icons (insurance themed) ────────────────────────────────
const GROUP_ICONS=[
  // Original 16 — insurance/business themed
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%233b82f6'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🛡️%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%2322c55e'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🤝%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23f59e0b'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🚗%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ef4444'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🏠%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%238b5cf6'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E💊%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%230ea5e9'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E☂️%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ec4899'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E👨‍👩‍👧‍👦%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%2314b8a6'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E📋%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23f97316'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E⭐%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%236366f1'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🏢%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%2300bcd4'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='20' fill='white'%3E✈️%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23795548'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='20' fill='white'%3E🏥%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ff5722'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='20' fill='white'%3E🚑%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23007c91'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='20' fill='white'%3E🌊%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%239c27b0'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='20' fill='white'%3E👮%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23e91e63'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='20' fill='white'%3E💼%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ff6f00'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🚲%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%230081cb'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E📱%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23d50000'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E💰%3C/text%3E%3C/svg%3E",
  // Systems & technology
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23344e5c'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🖥️%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%230081cb'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E📊%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23607d8b'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E⚙️%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%237c4dff'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E💡%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ff6f00'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🔧%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%235c6bc0'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E📈%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%231e88e5'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E💬%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%2343a047'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E✅%3C/text%3E%3C/svg%3E",
  // Accidents & claims
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23d50000'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🔥%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ff6f00'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E⚠️%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23e67e22'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🚒%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ff4081'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🚧%3C/text%3E%3C/svg%3E",
  // Security & documents
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%232e7d32'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🔒%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23a1887f'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E📄%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23ffab00'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E🏆%3C/text%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23900ff0'/%3E%3Ctext x='24' y='30' text-anchor='middle' font-size='22' fill='white'%3E👥%3C/text%3E%3C/svg%3E",
];
let _selectedGroupAvatar="";
let _editGroupId=null;
let _editGroupAvatar="";
let _deleteGroupId=null;

// ─── New group ────────────────────────────────────────────────────────────
let selectedMembers=[];
document.getElementById("newGroupBtn").addEventListener("click",()=>{
  if(!authToken){showLogin();return}
  _selectedGroupAvatar="";selectedMembers=[];
  document.getElementById("newGroupName").value="";document.getElementById("newGroupDesc").value="";
  document.getElementById("memberSearch").value="";
  document.getElementById("selectedMembers").innerHTML="";
  renderSelectedMembers();
  openModal("newGroupModal");loadMemberSearch();_updateAvatarPreview()});

function _updateAvatarPreview(){
  const preview=document.getElementById("avatarPreviewImg");
  if(!preview)return;
  if(_selectedGroupAvatar){
    preview.src=_selectedGroupAvatar;
    preview.style.display="block";
    document.getElementById("avatarPreviewPlaceholder").style.display="none";
  }else{
    preview.style.display="none";
    document.getElementById("avatarPreviewPlaceholder").style.display="flex";
  }
}

// Click on avatar preview toggles icon picker
document.getElementById("avatarPreviewWrap").addEventListener("click",function(){
  const body=document.getElementById("avatarPickerBody");
  const icon=document.getElementById("avatarToggleIcon");
  const isOpen=body.style.display==="flex";
  body.style.display=isOpen?"none":"flex";
  icon.textContent=isOpen?"expand_more":"expand_less";
  if(!isOpen)_renderGroupIcons();
});

// File input
document.getElementById("groupAvatarInput").addEventListener("change",function(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=function(ev){
    _selectedGroupAvatar=ev.target.result;
    _updateAvatarPreview();
    // Close picker after selecting
    document.getElementById("avatarPickerBody").style.display="none";
    document.getElementById("avatarToggleIcon").textContent="expand_more";
  };
  reader.readAsDataURL(file);
  e.target.value="";
});

const ICON_CATEGORIES=[
  {name:"Seguros",start:0,end:18},
  {name:"Sistemas",start:19,end:26},
  {name:"Accidentes",start:27,end:30},
  {name:"Seguridad",start:31,end:34},
];
function _renderGroupIcons(){
  const picker=document.getElementById("groupIconPicker");if(!picker)return;
  picker.style.display="block";
  picker.innerHTML=ICON_CATEGORIES.map(function(cat){
    var items=GROUP_ICONS.slice(cat.start,cat.end+1).map(function(ico,i){
      var idx=cat.start+i;
      var sel=_selectedGroupAvatar===ico?'selected':'';
      return`<div class="group-icon-option ${sel}" onclick="window._pickGroupIcon(${idx})"><img src="${ico}" style="width:40px;height:40px;border-radius:50%"></div>`;
    }).join("");
    if(cat.name==="Seguridad")items+=`<div class="group-icon-option upload-icon" onclick="document.getElementById('groupAvatarInput').click()" title="Subir foto"><span class="material-symbols-outlined" style="font-size:22px;line-height:40px">add_a_photo</span></div>`;
    return`<div class="icon-category"><div class="icon-cat-label">${cat.name}</div><div class="icon-cat-grid">${items}</div></div>`;
  }).join("");
}

// Global function for inline onclick
window._pickGroupIcon=function(i){
  _selectedGroupAvatar=GROUP_ICONS[i];
  _updateAvatarPreview();
  // Close picker after selecting
  document.getElementById("avatarPickerBody").style.display="none";
  document.getElementById("avatarToggleIcon").textContent="expand_more";
};
document.getElementById("createGroupBtn").addEventListener("click",async()=>{
  const btn=document.getElementById("createGroupBtn");
  const name=document.getElementById("newGroupName").value.trim();if(!name){toast("Poné un nombre al grupo","error");return}
  if(!selectedMembers.length){toast("Agregá al menos un miembro","error");return}
  btn.disabled=true;btn.textContent="Creando...";
  const d=await P("/api/chat/grupos",{nombre:name,descripcion:document.getElementById("newGroupDesc").value.trim(),creado_por:currentUser?.airtable_id,miembros:selectedMembers.map(m=>m.airtable_id)});
  if(d?.ok){
    if(d.group_id&&_selectedGroupAvatar)await P("/api/chat/group-avatar/"+d.group_id,{avatar:_selectedGroupAvatar}).catch(()=>{});
    closeModal("newGroupModal");
    document.getElementById("newGroupName").value="";document.getElementById("newGroupDesc").value="";
    _selectedGroupAvatar="";selectedMembers=[];renderSelectedMembers();refreshConversations();
    toast("Grupo creado","success");
  }else{
    toast("Error al crear grupo: "+(d?.error||"desconocido"),"error");
    btn.disabled=false;btn.textContent="Crear grupo";
  }
});

// ─── Edit group ─────────────────────────────────────────────────────────────
// Edit modal: avatar preview toggle
document.getElementById("editAvatarPreviewWrap")?.addEventListener("click",function(){
  const body=document.getElementById("editAvatarPickerBody");
  const icon=document.getElementById("editAvatarToggleIcon");
  if(!body||!icon)return;
  const isOpen=body.style.display==="flex";
  body.style.display=isOpen?"none":"flex";
  icon.textContent=isOpen?"expand_more":"expand_less";
  if(!isOpen)_renderEditGroupIcons();
});
function _renderEditGroupIcons(){
  const picker=document.getElementById("editGroupIconPicker");if(!picker)return;
  picker.style.display="block";
  picker.innerHTML=ICON_CATEGORIES.map(function(cat){
    var items=GROUP_ICONS.slice(cat.start,cat.end+1).map(function(ico,i){
      var idx=cat.start+i;
      var sel=_editGroupAvatar===ico?'selected':'';
      return`<div class="group-icon-option ${sel}" onclick="window._editPickGroupIcon(${idx})"><img src="${ico}" style="width:40px;height:40px;border-radius:50%"></div>`;
    }).join("");
    if(cat.name==="Seguridad")items+=`<div class="group-icon-option upload-icon" onclick="document.getElementById('editAvatarFileInput').click()" title="Subir foto"><span class="material-symbols-outlined" style="font-size:22px;line-height:40px">add_a_photo</span></div>`;
    return`<div class="icon-category"><div class="icon-cat-label">${cat.name}</div><div class="icon-cat-grid">${items}</div></div>`;
  }).join("");
}
window._editPickGroupIcon=function(i){
  _editGroupAvatar=GROUP_ICONS[i];
  _updateEditAvatarPreview();
  document.getElementById("editAvatarPickerBody").style.display="none";
  document.getElementById("editAvatarToggleIcon").textContent="expand_more";
};
function _updateEditAvatarPreview(){
  const preview=document.getElementById("editAvatarPreview");
  const placeholder=document.getElementById("editAvatarPreviewPlaceholder");
  if(!preview)return;
  if(_editGroupAvatar&&_editGroupAvatar.startsWith("data:")){
    preview.src=_editGroupAvatar;
    preview.style.display="block";
    if(placeholder)placeholder.style.display="none";
  }else if(_editGroupAvatar){
    preview.src=avatarUrl(_editGroupAvatar);
    preview.style.display="block";
    if(placeholder)placeholder.style.display="none";
  }else{
    preview.style.display="none";
    if(placeholder)placeholder.style.display="flex";
  }
}
// Edit modal: member management
let _editMembers=[];
let _editOriginalMemberIds=[];
async function _loadEditMembers(gid){
  _editMembers=[];_editOriginalMemberIds=[];
  const d=await G("/api/chat/groups/"+gid);
  if(d?.ok){
    _editMembers=d.members||[];
    _editOriginalMemberIds=_editMembers.map(m=>m.id);
    _renderEditMembers();
  }
}
function _renderEditMembers(){
  const c=document.getElementById("editMembersList");
  const count=document.getElementById("editMemberCount");
  if(!c)return;
  if(count)count.textContent="("+_editMembers.length+")";
  if(!_editMembers.length){c.innerHTML='<div class="empty-state" style="padding:8px"><p>Sin miembros</p></div>';return}
  c.innerHTML=_editMembers.map(m=>{
    const initials=avatarInitials(m.nombre),bg=avatarColor(m.nombre);
    return`<div class="edit-member-row">
      <span class="edit-member-avatar">${m.avatar_url?`<img src="${esc(avatarUrl(m.avatar_url))}" onerror="this.remove()">`:''}<span class="avatar-initials-sm" style="background:${bg}">${initials}</span></span>
      <span class="edit-member-name">${esc(m.nombre||m.id||"—")}</span>
      <span class="edit-member-remove" data-id="${m.id}" data-airtable="${m.airtable_id||''}" title="Quitar">×</span>
    </div>`;
  }).join("");
  c.querySelectorAll(".edit-member-remove").forEach(el=>el.addEventListener("click",function(){
    const id=this.dataset.id;
    const airtable=this.dataset.airtable;
    _editMembers=_editMembers.filter(m=>m.id!==id&&m.airtable_id!==airtable);
    _renderEditMembers();
  }));
}
document.getElementById("editAddMemberBtn")?.addEventListener("click",async function(){
  // Open directory to pick a member to add
  const cached=S.get("sgsa_empCache");
  const d=cached?.length?{ok:true,employees:cached}:await G("/api/chat/employees");
  if(!d?.ok){toast("Error al cargar empleados","error");return}
  S.set("sgsa_empCache",d.employees);
  const already=_editMembers.map(m=>m.id);
  const available=(d.employees||[]).filter(e=>!already.includes(e.id)&&!already.includes(e.airtable_id));
  if(!available.length){toast("Todos los empleados ya son miembros","info");return}
  // Show a simple picker
  const names=available.map(e=>e.nombre||e.id);
  const idx=await new Promise(resolve=>{
    const div=document.createElement("div");
    div.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999";
    const inner=document.createElement("div");
    inner.style.cssText="background:var(--bg2);border-radius:14px;padding:16px;max-width:300px;width:90%;max-height:80%;overflow-y:auto";
    inner.innerHTML='<h3 style="font-size:14px;margin-bottom:8px">Agregar miembro</h3>'+
      available.map((e,i)=>'<div class="item-row" data-idx="'+i+'"><div class="item-avatar">'+
        (e.avatar_url?'<img src="'+esc(avatarUrl(e.avatar_url))+'" style="width:34px;height:34px;border-radius:50%;object-fit:cover">':'<span class="avatar-initials" style="background:'+avatarColor(e.nombre)+'">'+avatarInitials(e.nombre)+'</span>')+
        '</div><div class="item-info"><div class="item-name">'+esc(e.nombre||"")+'</div></div></div>'
      ).join('');
    inner.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",()=>{
      document.body.removeChild(div);
      resolve(parseInt(el.dataset.idx));
    }));
    div.appendChild(inner);
    document.body.appendChild(div);
  });
  const picked=available[idx];
  if(picked){
    _editMembers.push(picked);
    _renderEditMembers();
    toast("Miembro agregado","success");
  }
});

// File input for editing avatar
document.getElementById("editAvatarFileInput")?.addEventListener("change",function(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=function(ev){
    _editGroupAvatar=ev.target.result;
    _updateEditAvatarPreview();
    document.getElementById("editAvatarPickerBody").style.display="none";
    document.getElementById("editAvatarToggleIcon").textContent="expand_more";
  };
  reader.readAsDataURL(file);
  e.target.value="";
});
// Fetch with 15s timeout (graceful fallback if AbortController unavailable)
function _ft(url,opts){var ac,t;try{ac=new AbortController();t=setTimeout(function(){ac.abort()},15000)}catch(e){}return fetch(url,{...opts,signal:ac?ac.signal:null}).finally(function(){if(t)clearTimeout(t)})}
// Upload fetch — generous timeout for large files (120s)
function _upload(url,opts,ms){ms=ms||120000;var ac,t;try{ac=new AbortController();t=setTimeout(function(){ac.abort()},ms)}catch(e){}return fetch(url,{...opts,signal:ac?ac.signal:null}).finally(function(){if(t)clearTimeout(t)})}
// Download file as blob (cross-origin safe)
function _download(url,name){
  var x=new XMLHttpRequest();x.open("GET",url,true);x.responseType="blob";
  x.onload=function(){
    var blob=x.response,a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download=name||"download";
    document.body.appendChild(a);a.click();
    setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(a.href)},500);
  };
  x.onerror=function(){toast("Error al descargar","error")};
  x.send();
}
document.getElementById("saveGroupBtn")?.addEventListener("click",async()=>{
  const gid=_editGroupId;if(!gid){toast("Error: no hay grupo","error");return}
  const name=document.getElementById("editGroupName").value.trim();
  const desc=document.getElementById("editGroupDesc").value.trim();
  if(!name){toast("El nombre no puede estar vacío","error");return}
  const btn=document.getElementById("saveGroupBtn");
  btn.disabled=true;btn.textContent="Guardando...";
  try{
    // Update name/description
    const r=await _ft(API+"/api/chat/groups/"+gid,{method:"PATCH",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify({nombre:name,descripcion:desc})});
    const d=await r.json();
    if(d?.ok){
      // Upload new avatar if changed (data URL starts with "data:")
      if(_editGroupAvatar&&_editGroupAvatar.startsWith("data:"))await P("/api/chat/group-avatar/"+gid,{avatar:_editGroupAvatar}).catch(()=>{});
      // Sync members: remove members that were taken out
      const currentIds=_editMembers.map(m=>m.id);
      for(const oldId of _editOriginalMemberIds){
        if(!currentIds.includes(oldId)){
          await _ft(API+"/api/chat/groups/"+gid+"/members/"+encodeURIComponent(oldId),{method:"DELETE",headers:authToken?{Authorization:"Bearer "+authToken}:{}}).catch(()=>{});
        }
      }
      // Add new members
      for(const m of _editMembers){
        if(!_editOriginalMemberIds.includes(m.id)){
          await _ft(API+"/api/chat/groups/"+gid+"/members",{method:"POST",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify({empleado_id:m.airtable_id||m.id})}).catch(()=>{});
        }
      }
      closeModal("editGroupModal");
      _editGroupAvatar="";
      toast("Grupo actualizado","success");
      refreshConversations();
    }else{
      btn.disabled=false;btn.textContent="Guardar cambios";
      toast("Error al guardar: "+(d?.error||r.status||"desconocido"),"error");
    }
  }catch(e){btn.disabled=false;btn.textContent="Guardar cambios";toast("Error de conexión: "+(e?.name||"intentá de nuevo"),"error")}
});

// ─── Delete group ───────────────────────────────────────────────────────────
document.getElementById("confirmDeleteBtn")?.addEventListener("click",async()=>{
  const gid=_deleteGroupId;if(!gid){toast("Error: no hay grupo","error");return}
  const btn=document.getElementById("confirmDeleteBtn");
  btn.disabled=true;btn.textContent="Eliminando...";
  try{
    const r=await _ft(API+"/api/chat/groups/"+gid,{method:"DELETE",headers:authToken?{Authorization:"Bearer "+authToken}:{}});
    const d=await r.json();
    if(d?.ok){
      closeModal("confirmDeleteModal");
      conversations=conversations.filter(c=>c.group_id!=gid);
      if(selectedConversation?.group_id==gid){
        selectedConversation=null;
        document.getElementById("chatMainEmpty").style.display="flex";
        document.getElementById("message-view").style.display="none";
      }
      S.del("sgsa_convCache");
      renderConversations();
      toast("Grupo eliminado","success");
    }else{
      toast("Error al eliminar: "+(d?.error||"desconocido"),"error");
      btn.disabled=false;btn.textContent="Eliminar";
    }
  }catch{
    toast("Error de conexión","error");
    btn.disabled=false;btn.textContent="Eliminar";
  }
});
document.getElementById("cancelDeleteBtn")?.addEventListener("click",()=>closeModal("confirmDeleteModal"));

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
let _archivedCache=[];
let _archDateRange="";
let _archDateFrom="";
let _archDateTo="";
let _archDaysAgo="";

function _applyArchiveFilters(list){
  let f=list;
  const q=(document.getElementById("archivedSearch")?.value||"").toLowerCase();
  if(q)f=f.filter(c=>(c.display_name||"").toLowerCase().includes(q));
  // Quick date range
  const now=new Date();
  const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(_archDateRange==="today"){f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=todayStart})}
  else if(_archDateRange==="yesterday"){const ys=new Date(todayStart);ys.setDate(ys.getDate()-1);const ye=new Date(todayStart);f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=ys&&d<ye})}
  else if(_archDateRange==="week"){const ws=new Date(todayStart);ws.setDate(ws.getDate()-ws.getDay());f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=ws})}
  else if(_archDateRange==="month"){const ms=new Date(now.getFullYear(),now.getMonth(),1);f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=ms})}
  else if(_archDateRange==="year"){const ys2=new Date(now.getFullYear(),0,1);f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=ys2})}
  // Custom from/to
  if(_archDateFrom){const fd=new Date(_archDateFrom);f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=fd})}
  if(_archDateTo){const td=new Date(_archDateTo);td.setHours(23,59,59,999);f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d<=td})}
  // Days ago
  if(_archDaysAgo){const da=parseInt(_archDaysAgo);if(da>0){const dd=new Date(todayStart);dd.setDate(dd.getDate()-da);f=f.filter(c=>{const d=c.archived_at?new Date(c.archived_at):null;return d&&d>=dd})}}
  return f;
}

document.getElementById("archivedSearch")?.addEventListener("input",()=>renderArchived());
// Archived filter button listeners
document.querySelectorAll(".arch-filter-btn").forEach(b=>b.addEventListener("click",function(){
  _archDateRange=this.dataset.range;
  document.querySelectorAll(".arch-filter-btn").forEach(x=>x.classList.toggle("active",x===this));
  _archDateFrom="";_archDateTo="";_archDaysAgo="";
  document.getElementById("archDateFrom").value="";document.getElementById("archDateTo").value="";
  document.getElementById("archDaysAgo").value="";
  renderArchived();
}));
document.getElementById("archDateFrom")?.addEventListener("change",function(){_archDateFrom=this.value;_archDateRange="";_archDaysAgo="";document.querySelectorAll(".arch-filter-btn").forEach(x=>x.classList.remove("active"));document.getElementById("archDaysAgo").value="";renderArchived()});
document.getElementById("archDateTo")?.addEventListener("change",function(){_archDateTo=this.value;_archDateRange="";_archDaysAgo="";document.querySelectorAll(".arch-filter-btn").forEach(x=>x.classList.remove("active"));document.getElementById("archDaysAgo").value="";renderArchived()});
document.getElementById("archDaysAgo")?.addEventListener("input",function(){_archDaysAgo=this.value;_archDateRange="";_archDateFrom="";_archDateTo="";document.querySelectorAll(".arch-filter-btn").forEach(x=>x.classList.remove("active"));document.getElementById("archDateFrom").value="";document.getElementById("archDateTo").value="";renderArchived()});
document.getElementById("archClearFilter")?.addEventListener("click",function(){
  _archDateRange="";_archDateFrom="";_archDateTo="";_archDaysAgo="";
  document.querySelectorAll(".arch-filter-btn").forEach(x=>x.classList.remove("active"));
  document.getElementById("archDateFrom").value="";document.getElementById("archDateTo").value="";
  document.getElementById("archDaysAgo").value="";document.getElementById("archivedSearch").value="";
  renderArchived();
});

async function loadArchivedChats(){
  const list=document.getElementById("archivedList"),empty=document.getElementById("archivedEmpty");
  list.innerHTML='<div class="empty-state"><p>Cargando...</p></div>';empty.style.display="none";
  const d=await G("/api/chat/hidden");
  if(!d?.ok||!d.conversations?.length){_archivedCache=[];list.innerHTML="";empty.style.display="flex";stats.chatArchived=0;updateStats();return}
  _archivedCache=d.conversations;stats.chatArchived=d.conversations.length;updateStats();renderArchived();
}
function renderArchived(){
  const list=document.getElementById("archivedList"),empty=document.getElementById("archivedEmpty");
  const f=_applyArchiveFilters(_archivedCache);
  if(!f.length){list.innerHTML="";empty.style.display="flex";return}
  empty.style.display="none";
  list.innerHTML=f.map(cv=>{
    const initials=(cv.display_name||"?").split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase();
    const bgColor=avatarColor(cv.display_name);
    const avArchUrl=avatarUrl(cv.avatar_url);
    const avatarContent=avArchUrl
      ?`<img src="${esc(avArchUrl)}" class="group-avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="avatar-initials" style="display:none;background:${bgColor}">${initials}</span>`
      :`<span class="avatar-initials" style="background:${bgColor};width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:12px;font-weight:600;color:#fff">${initials}</span>`;
    return`<div class="item-row" data-gid="${cv.group_id}">
      <div class="item-avatar">${avatarContent}</div>
      <div class="item-info"><div class="item-name">${esc(cv.display_name||"Chat")}</div><div class="item-sub">${cv.archived_at?timeAgo(cv.archived_at):""}${cv.is_dm?"":" · "+(cv.member_count||0)+" miembros"}</div></div>
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
    // Unarchive then open
    const r=await P("/api/chat/hide",{group_id:gid});
    if(r?.ok){
      S.del("sgsa_convCache");
      closeModal("archivedModal");
      await refreshConversations();
      // Find the chat in refreshed conversations and open it
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
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js?v=33").catch(()=>{});
if("Notification"in window&&Notification.permission==="default")Notification.requestPermission();

(async function(){
  const last=S.get("sgsa_lastUser");if(last){const p=getProfile(last);if(p?.token){const u=await restoreToken(p.token);if(u){authToken=p.token;currentUser=u;enterApp();return}}}
  showLogin();
})();
