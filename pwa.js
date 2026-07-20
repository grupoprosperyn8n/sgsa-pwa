// =============================================================================
// SGSA PWA v3 — Multi-user profiles, auto-employee, refined UX
// =============================================================================
const API = "https://web-production-2584d.up.railway.app";
const R = 30000; // refresh interval

// ─── Storage ──────────────────────────────────────────────────────────────
const S = {
  get(k){try{return JSON.parse(localStorage.getItem(k))}catch{return null}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},
  del(k){try{localStorage.removeItem(k)}catch{}},
};

// ─── Profile system ───────────────────────────────────────────────────────
function getProfiles(){return S.get("sgsa_profiles")||{}}
function saveProfiles(p){S.set("sgsa_profiles",p)}
function getProfile(email){const p=getProfiles();return p[email]||null}
function saveProfile(email,data){const p=getProfiles();p[email]={...p[email],...data};saveProfiles(p)}
function removeProfile(email){const p=getProfiles();delete p[email];saveProfiles(p)}
function getLastUser(){return S.get("sgsa_lastUser")||""}

// ─── Auth state ───────────────────────────────────────────────────────────
let authToken=null,currentUser=null,selectedOffice="",offices=[];
let chatMuted=true,alertsMuted=true;

async function restoreToken(t){
  try{
    const r=await fetch(API+"/api/chat/auth/me",{headers:{Authorization:"Bearer "+t}});
    if(r.ok){const d=await r.json();if(d.ok)return d.user}
  }catch{}
  return null;
}

function saveSession(t,u,email){
  authToken=t;currentUser=u;
  saveProfile(email,{token:t,user:u,name:u.nombre||"",airtable_id:u.airtable_id,login_id:u.login_id,email:email});
  S.set("sgsa_lastUser",email);
}

function clearCurrent(){authToken=null;currentUser=null;selectedOffice="";}

// ─── API helpers ──────────────────────────────────────────────────────────
async function G(path){
  try{
    const r=await fetch(API+path,{headers:authToken?{Authorization:"Bearer "+authToken}:{}});
    if(r.status===401&&authToken){clearCurrent();showLogin();return null}
    return await r.json();
  }catch{return null}
}
async function P(path,body){
  try{
    const r=await fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify(body)});
    if(r.status===401&&authToken){clearCurrent();showLogin();return null}
    return await r.json();
  }catch{return null}
}
function esc(t){const d=document.createElement("div");d.textContent=t;return d.innerHTML}

// ===========================================================================
// LOGIN
// ===========================================================================
function showLogin(){
  document.getElementById("login-screen").style.display="flex";
  document.getElementById("app").style.display="none";
  document.getElementById("loginError").textContent="";
  document.getElementById("loginEmail").value="";
  document.getElementById("loginPassword").value="";
  renderSavedProfiles();
}
function renderSavedProfiles(){
  const profiles=getProfiles(),last=getLastUser();
  const emails=Object.keys(profiles);
  const container=document.getElementById("savedProfiles");
  const form=document.getElementById("loginForm");
  const otherBtn=document.getElementById("showOtherLogin");

  if(emails.length===0){container.style.display="none";form.style.display="flex";otherBtn.style.display="none";return}

  container.style.display="flex";
  container.innerHTML=emails.map(email=>{
    const p=profiles[email];
    return `<div class="profile-card" data-email="${esc(email)}">
      <div class="profile-avatar">${(p.name||email)[0].toUpperCase()}</div>
      <div class="profile-info">
        <div class="profile-name">${esc(p.name||email)}</div>
        <div class="profile-office">${p.officeName?`<span class="material-symbols-outlined">apartment</span>${esc(p.officeName)}`:""}</div>
      </div>
      <div class="profile-actions">
        <button class="remove-profile-btn" data-email="${esc(email)}" title="Olvidar">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>`;
  }).join("");

  // Click profile → ask for PIN
  container.querySelectorAll(".profile-card").forEach(card=>{
    card.addEventListener("click",async e=>{
      if(e.target.closest(".remove-profile-btn"))return;
      const email=card.dataset.email;
      document.getElementById("loginEmail").value=email;
      form.style.display="flex";otherBtn.style.display="flex";
      container.querySelectorAll(".profile-card").forEach(c=>c.style.opacity=c===card?"1":".4");
      document.getElementById("loginPassword").focus();
    });
  });

  // Remove profile
  container.querySelectorAll(".remove-profile-btn").forEach(b=>{
    b.addEventListener("click",e=>{e.stopPropagation();removeProfile(b.dataset.email);renderSavedProfiles();});
  });

  form.style.display="none";otherBtn.style.display="none";
}

document.getElementById("showOtherLogin").addEventListener("click",()=>{
  document.getElementById("loginEmail").value="";
  document.getElementById("loginForm").style.display="flex";
  document.getElementById("showOtherLogin").style.display="none";
  document.getElementById("savedProfiles").querySelectorAll(".profile-card").forEach(c=>c.style.opacity="1");
});

document.getElementById("loginBtn").addEventListener("click",async()=>{
  const email=document.getElementById("loginEmail").value.trim();
  const pw=document.getElementById("loginPassword").value.trim();
  if(!email||!pw){document.getElementById("loginError").textContent="Completá ambos campos";return}

  // Try saved profile first (fast restore without API call)
  const saved=getProfile(email);
  if(saved?.token&&saved?.user&&!saved._forceRelogin){
    const user=await restoreToken(saved.token);
    if(user){authToken=saved.token;currentUser=user;S.set("sgsa_lastUser",email);enterApp();return}
  }

  // Full login
  const r=await P("/api/chat/auth/login",{email,password:pw});
  if(r?.ok){saveSession(r.access_token,r.user,email);enterApp()}
  else{document.getElementById("loginError").textContent="Credenciales incorrectas"}
});
document.getElementById("loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("loginBtn").click();});

function enterApp(){
  document.getElementById("login-screen").style.display="none";
  document.getElementById("app").style.display="flex";

  // Restore office from profile
  const email=currentUser?.email||getLastUser();
  const profile=getProfile(email);
  selectedOffice=profile?.office||"";
  if(selectedOffice&&profile?.officeName){
    document.getElementById("office-label").innerHTML=`<span class="material-symbols-outlined">apartment</span>${esc(profile.officeName)}`;
    document.getElementById("selectOfficeBtn").classList.add("filled");
  }

  // Mute prefs
  chatMuted=profile?.chatMuted!==false;
  alertsMuted=profile?.alertsMuted!==false;
  document.getElementById("toggleChatMute").checked=chatMuted;
  document.getElementById("toggleAlertsMute").checked=alertsMuted;

  // Init
  updateSettingsUI();
  initChat();initAlerts();
  if(!selectedOffice)openModal("office-modal"),loadOfficeModal();
}

// ===========================================================================
// TABS
// ===========================================================================
function switchTab(tab){
  if(tab==="chat"&&!authToken){showLogin();return}
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");
  document.getElementById(tab+"-tab")?.classList.add("active");
  if(tab==="chat")refreshConversations();
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));

// ===========================================================================
// SETTINGS
// ===========================================================================
document.getElementById("settingsBtn").addEventListener("click",()=>{
  updateSettingsUI();
  document.getElementById("settings-overlay").style.display="block";
  document.getElementById("settings-panel").style.display="flex";
});
document.getElementById("closeSettingsBtn").addEventListener("click",closeSettings);
document.getElementById("settings-overlay").addEventListener("click",closeSettings);
function closeSettings(){
  document.getElementById("settings-overlay").style.display="none";
  document.getElementById("settings-panel").style.display="none";
}
function updateSettingsUI(){
  document.getElementById("settingsName").textContent=currentUser?.nombre||"—";
  document.getElementById("settingsEmail").textContent=currentUser?.email||"—";
}

document.getElementById("settingsChangeOffice").addEventListener("click",()=>{closeSettings();openModal("office-modal");loadOfficeModal();});

document.getElementById("toggleChatMute").addEventListener("change",function(){
  chatMuted=this.checked;const p=getProfile(currentUser?.email||"");if(p)p.chatMuted=chatMuted,saveProfile(currentUser.email,p);
});
document.getElementById("toggleAlertsMute").addEventListener("change",function(){
  alertsMuted=this.checked;const p=getProfile(currentUser?.email||"");if(p)p.alertsMuted=alertsMuted,saveProfile(currentUser.email,p);
});

document.getElementById("settingsSwitchUser").addEventListener("click",()=>{
  closeSettings();clearCurrent();
  if(window._chatTimer)clearInterval(window._chatTimer);stopPing();
  showLogin();
});
document.getElementById("settingsLogout").addEventListener("click",()=>{
  closeSettings();clearCurrent();
  if(window._chatTimer)clearInterval(window._chatTimer);stopPing();
  // Mark profile for re-login (force password next time)
  const email=currentUser?.email;if(email){const p=getProfile(email);if(p)p._forceRelogin=true,saveProfile(email,p);}
  showLogin();
});

// ===========================================================================
// OFFICE SELECTION
// ===========================================================================
async function loadOfficeModal(){
  if(offices.length){renderOfficeList(offices);return}
  try{const r=await fetch(API+"/api/oficinas");const d=await r.json();if(d.ok)offices=d.oficinas;renderOfficeList(offices)}catch{}
}
function renderOfficeList(list){
  const q=(document.getElementById("officeSearch")?.value||"").toLowerCase();
  const f=q?list.filter(o=>o.nombre?.toLowerCase().includes(q)||o.localidad?.toLowerCase().includes(q)):list;
  const c=document.getElementById("officeList");
  if(!f.length){c.innerHTML='<div class="empty-state"><span class="material-symbols-outlined empty-icon">apartment</span><p>Sin resultados</p></div>';return}
  c.innerHTML=f.map(o=>`<div class="item-row" data-name="${esc(o.nombre)}" data-id="${esc(o.id)}">
    <div class="item-avatar"><span class="material-symbols-outlined">apartment</span></div>
    <div class="item-info"><div class="item-name">${esc(o.nombre)}</div>${o.localidad?`<div class="item-sub">${esc(o.localidad)}</div>`:""}</div>
  </div>`).join("");
  c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",()=>{
    selectedOffice=el.dataset.name;
    document.getElementById("office-label").innerHTML=`<span class="material-symbols-outlined">apartment</span>${esc(selectedOffice)}`;
    document.getElementById("selectOfficeBtn").classList.add("filled");
    const email=currentUser?.email;if(email)saveProfile(email,{office:selectedOffice,officeName:selectedOffice});
    closeModal("office-modal");loadAlerts();
  }));
}
document.getElementById("officeSearch").addEventListener("input",()=>renderOfficeList(offices));
document.getElementById("selectOfficeBtn").addEventListener("click",()=>{openModal("office-modal");loadOfficeModal();});

// ===========================================================================
// ALERTS
// ===========================================================================
let alerts=[],alertTimer=null;

async function loadAlerts(){
  const aid=currentUser?.airtable_id;if(!aid)return;
  try{
    const r=await fetch(API+"/api/alerts?leidas=false",{headers:authToken?{Authorization:"Bearer "+authToken}:{}});
    const d=await r.json();alerts=(d.alerts||[]).filter(a=>!a.leida);renderAlerts();
  }catch(e){console.error(e)}
}
async function doAck(id){try{await fetch(API+"/api/alerts/"+id+"/ack",{method:"POST",headers:authToken?{Authorization:"Bearer "+authToken}:{}})}catch{}}
async function doStatus(id,estado){try{await fetch(API+"/api/alerts/"+id+"/status",{method:"POST",headers:{"Content-Type":"application/json",...(authToken?{Authorization:"Bearer "+authToken}:{})},body:JSON.stringify({estado})})}catch{}}

function renderAlerts(){
  const c=document.getElementById("alerts-list"),empty=document.getElementById("emptyAlerts");
  const pending=alerts.filter(a=>!a.leida);document.getElementById("alerts-badge").textContent=pending.length;
  if(!alerts.length){empty.style.display="flex";c.innerHTML="";return}
  empty.style.display="none";

  c.innerHTML=alerts.map((a,i)=>{
    const p=a.prioridad||"";let urg=0,urgLabel="",urgClass="";
    if(p.includes("🔴")){urg=3;urgLabel="Urgente";urgClass="urg-3"}
    else if(p.includes("🟠")){urg=2;urgLabel="Alta";urgClass="urg-2"}
    else if(p.includes("🟡")){urg=1;urgLabel="Media";urgClass="urg-1"}
    else{urgLabel="Info";urgClass="urg-1"}

    let rows="";
    if(a.detalle)for(const line of a.detalle.split("\n")){
      const ci=line.indexOf(":");if(ci>0){const k=line.slice(0,ci).trim(),v=line.slice(ci+1).trim();
      rows+=k&&v?`<div class="d-row"><span class="d-label">${esc(k)}</span><span class="d-value">${esc(v)}</span></div>`:""}
      else rows+=`<div>${esc(line)}</div>`;
    }
    if(a.link_registro)rows+=`<a class="d-link" href="${esc(a.link_registro)}" target="_blank"><span class="material-symbols-outlined" style="font-size:12px">open_in_new</span> Abrir registro</a>`;

    const hasOffice=!!selectedOffice;

    return `<div class="alert-card urgencia-${urg}" data-index="${i}" data-id="${a.id}">
      <div class="card-surface">
        <div class="card-head">
          <div class="card-title">${esc(a.titulo||"Alerta")}</div>
          <div class="card-badge ${urgClass}">${urgLabel}</div>
        </div>
        <div class="card-body">${esc(a.cuerpo||"")}</div>
        <div class="card-meta">
          <span>${(a.fecha||a.created_at||"").slice(0,10)}</span>
          <span class="meta-tag">${esc(a.tipo_alerta||"General")}</span>
          <span class="material-symbols-outlined meta-chevron" style="font-size:14px">expand_more</span>
        </div>
      </div>
      <div class="card-detail">
        ${rows}
        ${hasOffice?`<div class="alert-actions">
          <button class="act-btn progreso"><span class="material-symbols-outlined">pending</span> En progreso</button>
          <button class="act-btn confirmar"><span class="material-symbols-outlined">calendar_month</span> Turnos</button>
          <button class="act-btn concluido"><span class="material-symbols-outlined">check_circle</span> Concluido</button>
          <button class="act-btn anular"><span class="material-symbols-outlined">cancel</span> Anular</button>
          <button class="act-btn ack"><span class="material-symbols-outlined">mark_email_read</span> Leído</button>
        </div>`:`<div class="alert-actions-disabled">
          <span class="material-symbols-outlined">apartment</span> Seleccioná una sucursal para gestionar alertas
        </div>`}
      </div></div>`;
  }).join("");

  // Delegated click handler on alerts-list (single listener for all cards + buttons)
  if (!c._delegated) {
    c._delegated = true;
    c.addEventListener("click", async (e) => {
      // Button clicks
      const btn = e.target.closest(".act-btn");
      if (btn) {
        e.stopPropagation();
        const card = btn.closest(".alert-card");
        const id = card?.dataset.id;
        if (!id) return;
        if (btn.classList.contains("ack")) { await doAck(id); }
        else if (btn.classList.contains("progreso")) { await doStatus(id, "EN_PROGRESO"); }
        else if (btn.classList.contains("confirmar")) { await doStatus(id, "TURNO_CONFIRMADO"); }
        else if (btn.classList.contains("concluido")) { await doStatus(id, "CONCLUIDA"); }
        else if (btn.classList.contains("anular")) { await doStatus(id, "ANULADA"); }
        loadAlerts();
        return;
      }
      // Link clicks in detail
      if (e.target.closest(".d-link")) return;
      // Card expand/collapse
      const card = e.target.closest(".alert-card");
      if (card) { card.classList.toggle("expanded"); }
    });
  }
}

function initAlerts(){
  if(!currentUser?.airtable_id)return;
  if(selectedOffice)loadAlerts();
}
document.getElementById("refreshBtn").addEventListener("click",loadAlerts);
document.getElementById("ackAllBtn").addEventListener("click",async()=>{
  for(const card of document.querySelectorAll(".alert-card")){const id=card.dataset.id;if(id)await doAck(id);}
  loadAlerts();
});

// ===========================================================================
// CHAT
// ===========================================================================
let conversations=[],selectedConversation=null,allEmployees=[];
let _pingTimer=null,_chatTimer=null;

function initChat(){if(!authToken)return;refreshConversations();startPing();
  if(_chatTimer)clearInterval(_chatTimer);_chatTimer=setInterval(refreshConversations,R);}
async function refreshConversations(){const d=await G("/api/chat/conversations");if(d?.ok){conversations=d.conversations;renderConversations();}}

function renderConversations(){
  const q=(document.getElementById("conversationSearch")?.value||"").toLowerCase();
  let f=q?conversations.filter(c=>c.display_name?.toLowerCase().includes(q)):conversations;
  const c=document.getElementById("conversationList"),e=document.getElementById("inboxEmpty");
  if(!f.length){c.innerHTML="";e.style.display="flex";return}e.style.display="none";
  c.innerHTML=f.map(cv=>`<div class="group-card ${selectedConversation?.group_id===cv.group_id?"selected":""}" data-gid="${cv.group_id}">
    <div class="group-avatar">${cv.is_dm?(cv.avatar_url?`<img src="${cv.avatar_url}" class="group-avatar-img">`:`<span class="material-symbols-outlined">person</span>`):`<span class="material-symbols-outlined">groups</span>`}
      ${cv.is_dm?`<span class="online-dot ${cv.online?"online":"offline"}"></span>`:""}</div>
    <div class="group-info"><div class="group-name">${esc(cv.display_name||"Chat")}</div><div class="group-last-msg">${cv.last_message||"Sin mensajes"}</div></div>
    <div class="group-meta"><div class="group-time">${cv.last_message_time?timeAgo(cv.last_message_time):""}</div>${cv.unread>0?`<div class="group-unread">${cv.unread>99?"99+":cv.unread}</div>`:""}</div>
  </div>`).join("");
  c.querySelectorAll(".group-card").forEach(card=>card.addEventListener("click",()=>{const gid=card.dataset.gid;const cv=conversations.find(x=>x.group_id==gid);if(cv)openConversation(cv);}));
}
document.getElementById("conversationSearch")?.addEventListener("input",renderConversations);

function timeAgo(iso){if(!iso)return"";const d=Date.now()-new Date(iso).getTime();const m=Math.floor(d/60000);if(m<1)return"ahora";if(m<60)return m+"m";const h=Math.floor(m/60);if(h<24)return h+"h";return Math.floor(h/24)+"d";}

async function openConversation(cv){selectedConversation=cv;document.getElementById("inbox-view").style.display="none";document.getElementById("message-view").style.display="";document.getElementById("chatBackBtn").style.display="";document.getElementById("chatHeaderTitle").textContent=cv.display_name||"Chat";await loadMessages(cv.group_id);renderConversations();}
document.getElementById("chatBackBtn").addEventListener("click",()=>{selectedConversation=null;document.getElementById("inbox-view").style.display="";document.getElementById("message-view").style.display="none";document.getElementById("chatBackBtn").style.display="none";document.getElementById("chatHeaderTitle").textContent="Conversaciones";refreshConversations();});

async function loadMessages(gid){const d=await G("/api/chat/mensajes/"+gid);const c=document.getElementById("messageList");const e=document.getElementById("messageEmpty");
  if(!d?.ok){c.innerHTML='<div class="empty-state"><p>Error al cargar mensajes</p></div>';return}
  const msgs=d.mensajes||[];if(!msgs.length){e.style.display="flex";c.innerHTML="";return}e.style.display="none";
  const myId=currentUser?.airtable_id||currentUser?.id||"";
  c.innerHTML=msgs.reverse().map(m=>{const isMine=m.remitente_id===myId;let body=`<div class="msg-text">${esc(m.texto||"")}</div>`;
    if(m.tipo_mensaje==="imagen"&&m.archivo_url)body=`<div class="msg-attachment"><img src="${m.archivo_url}" loading="lazy"></div>`;
    else if((m.tipo_mensaje==="video"||m.tipo_mensaje==="audio")&&m.archivo_url)body=`<div class="msg-attachment">${m.tipo_mensaje==="audio"?`<audio controls src="${m.archivo_url}"></audio>`:`<video controls src="${m.archivo_url}" style="max-width:100%;max-height:300px"></video>`}</div>`;
    else if(m.archivo_url)body=`<div class="msg-attachment"><a class="file-link" href="${m.archivo_url}" target="_blank"><span class="material-symbols-outlined" style="font-size:16px">attach_file</span>${esc(m.archivo_nombre||"Archivo")}</a></div>`;
    return `<div class="message ${isMine?"mine":"theirs"}">${!isMine?`<div class="sender-name">${esc(m.remitente_nombre||"")}</div>`:""}${body}<div class="msg-time">${timeAgo(m.created_at)}</div></div>`;}).join("");
  c.scrollTop=c.scrollHeight;}

async function sendMessage(){const input=document.getElementById("chatInput");const text=input.value.trim();if(!text||!selectedConversation)return;input.value="";const d=await P("/api/chat/send",{grupo_id:selectedConversation.group_id,empleado_id:currentUser?.airtable_id,contenido:text});if(d?.ok){loadMessages(selectedConversation.group_id);refreshConversations();}}
document.getElementById("sendBtn").addEventListener("click",sendMessage);
document.getElementById("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}});

// Attach
document.getElementById("attachBtn").addEventListener("click",()=>document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change",async e=>{const file=e.target.files[0];if(!file||!selectedConversation)return;e.target.value="";const fd=new FormData();fd.append("file",file);try{const r=await fetch(API+"/api/chat/upload",{method:"POST",headers:authToken?{Authorization:"Bearer "+authToken}:{},body:fd});const res=await r.json();if(res?.url){await P("/api/chat/messages",{grupo_id:selectedConversation.group_id,sender_id:currentUser?.airtable_id||currentUser?.id,mensaje:file.name,tipo:res.type||"documento",adjunto_url:res.url,adjunto_nombre:file.name});loadMessages(selectedConversation.group_id);refreshConversations();}}catch{}});

// Ping
function startPing(){stopPing();P("/api/chat/ping",{});_pingTimer=setInterval(()=>P("/api/chat/ping",{}),30000);}
function stopPing(){if(_pingTimer){clearInterval(_pingTimer);_pingTimer=null;}}

// ─── Directory / DM ──────────────────────────────────────────────────────
document.getElementById("peopleBtn").addEventListener("click",()=>{if(!authToken){showLogin();return}openModal("peopleModal");loadPeopleList();});
async function loadPeopleList(){const d=await G("/api/chat/employees");if(d?.ok){allEmployees=(d.employees||[]).filter(e=>e.airtable_id!==(currentUser?.airtable_id)&&e.id!==(currentUser?.airtable_id));renderPeopleList(allEmployees);}else if(allEmployees.length)renderPeopleList(allEmployees);}
function renderPeopleList(list){
  const q=(document.getElementById("peopleSearch")?.value||"").toLowerCase();const f=q?list.filter(e=>e.nombre?.toLowerCase().includes(q)):list;
  const c=document.getElementById("peopleList");if(!f.length){c.innerHTML='<div class="empty-state"><p>Sin resultados</p></div>';return}
  c.innerHTML=f.map(e=>`<div class="item-row" data-empleado-id="${e.id}" data-empleado-nombre="${esc(e.nombre)}">
    <div class="item-avatar">${e.avatar_url?`<img src="${e.avatar_url}">`:(e.nombre||"?")[0].toUpperCase()}<span class="online-dot ${e.online?"online":"offline"}"></span></div>
    <div class="item-info"><div class="item-name">${esc(e.nombre)}</div>${e.oficina_nombre?`<div class="item-sub">${esc(e.oficina_nombre)}</div>`:""}<div class="item-sub">${e.online?"En línea":"Desconectado"}</div></div>
    <span class="item-action"><span class="material-symbols-outlined" style="font-size:16px">chat</span> DM</span>
  </div>`).join("");
  c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",async()=>{if(!authToken){showLogin();return}const r=await P("/api/chat/dm",{target_empleado_id:el.dataset.empleadoId});if(r?.ok){closeModal("peopleModal");openConversation({group_id:r.group_id,display_name:el.dataset.empleadoNombre||"DM",is_dm:true,online:null,avatar_url:null});refreshConversations();}else alert("Error al iniciar DM");}));
}
document.getElementById("peopleSearch").addEventListener("input",()=>renderPeopleList(allEmployees));

// ─── New group ────────────────────────────────────────────────────────────
let selectedMembers=[];
document.getElementById("newGroupBtn").addEventListener("click",()=>{if(!authToken){showLogin();return}openModal("newGroupModal");loadMemberSearch();});
async function loadMemberSearch(){const d=await G("/api/chat/employees");const emps=(d?.ok)?d.employees:allEmployees;allEmployees=emps;renderMemberList(emps.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)));}
function renderMemberList(list){const c=document.getElementById("memberSearchResults");if(!list.length){c.innerHTML='<div class="empty-state"><p>Sin resultados</p></div>';return}
  c.innerHTML=list.map(e=>`<div class="item-row" data-airtable="${e.airtable_id||""}" data-name="${esc(e.nombre)}">
    <div class="item-avatar">${e.avatar_url?`<img src="${e.avatar_url}">`:(e.nombre||"?")[0].toUpperCase()}</div>
    <div class="item-info"><div class="item-name">${esc(e.nombre)}</div></div>
    ${selectedMembers.find(m=>m.airtable_id===e.airtable_id)?`<span class="material-symbols-outlined" style="color:var(--success)">check</span>`:`<span class="material-symbols-outlined" style="color:var(--accent)">add</span>`}
  </div>`).join("");
  c.querySelectorAll(".item-row").forEach(el=>el.addEventListener("click",()=>{const aid=el.dataset.airtable;if(selectedMembers.find(m=>m.airtable_id===aid))selectedMembers=selectedMembers.filter(m=>m.airtable_id!==aid);else selectedMembers.push({airtable_id:aid,nombre:el.dataset.name});renderSelectedMembers();renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)));}));
}
function renderSelectedMembers(){const c=document.getElementById("selectedMembers");if(!selectedMembers.length){c.innerHTML="";return}
  c.innerHTML=selectedMembers.map(m=>`<div class="selected-member">${esc(m.nombre)}<span class="remove-member" data-airtable="${m.airtable_id}">✕</span></div>`).join("");
  c.querySelectorAll(".remove-member").forEach(el=>el.addEventListener("click",()=>{selectedMembers=selectedMembers.filter(m=>m.airtable_id!==el.dataset.airtable);renderSelectedMembers();renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)));}));
}
document.getElementById("memberSearch").addEventListener("input",()=>{const q=document.getElementById("memberSearch").value.toLowerCase();renderMemberList(allEmployees.filter(e=>!selectedMembers.find(m=>m.airtable_id===e.airtable_id)&&e.nombre?.toLowerCase().includes(q)));});
document.getElementById("createGroupBtn").addEventListener("click",async()=>{const name=document.getElementById("newGroupName").value.trim();if(!name){alert("Poné un nombre");return}const d=await P("/api/chat/grupos",{nombre:name,descripcion:document.getElementById("newGroupDesc").value.trim(),creado_por:currentUser?.airtable_id,miembros:selectedMembers.map(m=>m.airtable_id)});if(d?.ok){closeModal("newGroupModal");document.getElementById("newGroupName").value="";document.getElementById("newGroupDesc").value="";selectedMembers=[];renderSelectedMembers();refreshConversations();}else alert("Error al crear grupo");});

// ─── Modal helpers ─────────────────────────────────────────────────────────
function openModal(id){const el=document.getElementById(id);if(el)el.style.display="flex";}
function closeModal(id){const el=document.getElementById(id);if(el)el.style.display="none";}
document.querySelectorAll(".close-modal").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.modal)));

// ===========================================================================
// INIT
// ===========================================================================
if("serviceWorker"in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});

(async function(){
  const last=getLastUser();
  if(last){const profile=getProfile(last);
    if(profile?.token){const user=await restoreToken(profile.token);
      if(user){authToken=profile.token;currentUser=user;enterApp();return}}
  }
  showLogin();
})();
