
(function(){
const ROLES=["Portiere","Difensore","Centrocampista","Attaccante"];
const MESI=["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const GG=["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
const APP_V="1794478691";
const TRAIN="img/train.webp", MATCHBG="img/match.webp", LOGO="img/logo.webp";
/* dati: arrivano dal database condiviso; sul telefono resta una copia per aprire subito l'app (anche offline) */
const LOGOS=window.AB_LOGOS||{};
const EMPTY={team:"Alta Brianza Tavernerio",short:"Alta Brianza Tavernerio",categoria:"Esordienti U12",stagione:"2026/27",players:[],events:[],standings:[],tactics:{},staff:[]};
function withLogos(d){return Object.assign({},EMPTY,d||{},{logos:LOGOS})}
function stripLogos(o){const {logos,...r}=o;return r}
let S=withLogos((()=>{try{return JSON.parse(localStorage.getItem("ab-cache")||"null")}catch(_){return null}})());
const ORDER=["squadra","allenamenti","partite","rosa","tattica"];
let anim="", calAnim="", dayAnim=false, pillFromX=null, dayTouched=false, dragJustEnded=false;
let dirty=false, canEdit=false, editMode=false, art=null, saving=false;
/* accesso: solo al primo ingresso, poi resta collegato su questo telefono */
const CFG=window.AB_CONFIG||{};
const SB=(window.supabase&&CFG.url&&CFG.key&&!/INSERISCI/.test(CFG.url+CFG.key))?window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"ab-auth"}}):null;
let ABD_ME=null, MYID=null;
try{ABD_ME=JSON.parse(localStorage.getItem("abd-user")||"null")}catch(_){}
const IS_APP=!!(navigator.standalone||(window.matchMedia&&(matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: fullscreen)").matches)));
function webOK(){if(/[?&]installa\b/.test(location.search))return false;try{return localStorage.getItem("ab-web")==="1"}catch(_){return true}}
const slug=t=>t.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z]/g,"");
const capW=w=>w.charAt(0).toUpperCase()+w.slice(1);
/* controlla la sessione salvata sul telefono */
const sessReady=(async()=>{
  if(!SB){return}
  const offlineMode=()=>{/* senza rete: si usa la copia sul telefono, le modifiche partono al ritorno della connessione */
    let id=null;try{id=localStorage.getItem("ab-myid")}catch(_){}
    if(ABD_ME&&id){MYID=id;art=true;canEdit=true;render()}};
  try{const {data,error}=await SB.auth.getSession();const u=data&&data.session&&data.session.user;
    if(u){MYID=u.id;try{localStorage.setItem("ab-myid",u.id)}catch(_){}const m=u.user_metadata||{};if(!ABD_ME&&m.first)ABD_ME={first:m.first,last:m.last};onLogged()}
    else if(ABD_ME&&(!navigator.onLine||error))offlineMode();
    else if(ABD_ME){/* sessione scaduta: si rientra */ABD_ME=null;try{localStorage.removeItem("abd-user")}catch(_){}}
  }catch(_){offlineMode()}
})();
async function abdSignIn(first,last,code){
  if(!SB)throw {msg:"App non ancora collegata al database."};
  const pw=code.trim().toLowerCase();
  let r=await SB.auth.signInWithPassword({email:`${slug(first)}.${slug(last)}@altabrianza.app`,password:pw});
  if(r.error&&/invalid/i.test(r.error.message||"")){const r2=await SB.auth.signInWithPassword({email:`${slug(last)}.${slug(first)}@altabrianza.app`,password:pw});
    if(!r2.error){r=r2;[first,last]=[last,first]}}
  if(r.error){const net=!navigator.onLine||/fetch|network/i.test(r.error.message||"");throw {msg:net?"Nessuna connessione: riprova quando sei online.":"Nome o codice non corretti."}}
  const u=r.data.user, m=u.user_metadata||{};MYID=u.id;try{localStorage.setItem("ab-myid",u.id)}catch(_){}
  const me={first:m.first||capW(first.toLowerCase()),last:(m.last||last).toUpperCase()};
  ABD_ME=me;try{localStorage.setItem("abd-user",JSON.stringify(me))}catch(_){}
  onLogged();await loadData(true).catch(()=>{});return me}
function onLogged(){art=true;canEdit=true;subscribe();if(isPending()){dirty=true;save().then(ok=>{if(ok)loadData().catch(()=>{})})}else loadData().catch(()=>{});render()}
/* ---------- DATABASE ---------- */
let REMOTE_AT=null, pendingRemote=null, rtChan=null;
function cacheS(){try{localStorage.setItem("ab-cache",JSON.stringify(stripLogos(S)))}catch(_){}}
/* modifiche fatte senza connessione: restano sul telefono e partono appena torna la rete, anche dopo aver chiuso l'app */
function setPending(on){try{on?localStorage.setItem("ab-pending","1"):localStorage.removeItem("ab-pending")}catch(_){}}
function isPending(){try{return localStorage.getItem("ab-pending")==="1"}catch(_){return false}}
function idleUI(){const a=document.activeElement;return !dirty&&!saving&&!document.getElementById("sheetbg")&&!document.getElementById("mOpen")&&!document.getElementById("cvOpen")&&!document.getElementById("trOpen")&&!document.getElementById("rpOpen")&&!tEdit&&!(a&&a.matches&&a.matches("input,textarea,select"))}
async function loadData(force){
  if(!SB||!MYID)return;
  const {data,error}=await SB.from("app_state").select("data,updated_at").eq("id","main").maybeSingle();
  if(error)throw error;if(data)applyRemote(data,force);runFixes()}
/* correzioni una tantum sui dati condivisi */
function runFixes(){if(!canEdit||isPending()||dirty)return;
  if(!S.fix10nov){const t=S.events.find(e=>e.type!=="partita"&&e.date==="2026-11-10");if(t)delete t.att;S.fix10nov=1;dirty=true;
    if(!document.querySelector(".splash")){const y=window.scrollY;anim="";render();window.scrollTo(0,y)}save()}}
function applyRemote(row,force){
  if(!row||!row.data)return;
  if(isPending())return; /* prima si inviano le modifiche fatte offline */
  if(REMOTE_AT&&row.updated_at&&row.updated_at<=REMOTE_AT)return;
  if(!force&&!idleUI()){pendingRemote=row;return}
  pendingRemote=null;REMOTE_AT=row.updated_at||REMOTE_AT;
  if(JSON.stringify(stripLogos(withLogos(row.data)))===JSON.stringify(stripLogos(S)))return; /* niente di nuovo: nessun ridisegno */
  S=withLogos(row.data);cacheS();
  if(document.querySelector(".splash"))return; /* sotto l'intro: si vede già aggiornato all'apertura */
  anim="a-soft";const y=window.scrollY;render();window.scrollTo(0,y);anim=""}
setInterval(()=>{if(pendingRemote&&idleUI())applyRemote(pendingRemote)},1500);
function subscribe(){
  if(!SB||rtChan)return;
  try{rtChan=SB.channel("ab-state").on("postgres_changes",{event:"UPDATE",schema:"public",table:"app_state",filter:"id=eq.main"},p=>{
    const n=p&&p.new;if(n&&n.updated_by!==MYID)applyRemote(n)}).subscribe()}catch(_){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&MYID)loadData().catch(()=>{})});
addEventListener("online",async()=>{if(!MYID||!SB)return;
  try{const {data}=await SB.auth.getSession();if(!(data&&data.session)){/* sessione da rinnovare: riprova tra poco */return}}catch(_){return}
  subscribe();if((dirty||isPending())&&!saving){dirty=true;save().then(ok=>{if(ok)loadData().catch(()=>{})})}else loadData().catch(()=>{})});
let RESUME=null;try{const u=JSON.parse(sessionStorage.getItem("ab-upd")||"null");sessionStorage.removeItem("ab-upd");if(u&&Date.now()-u.t<60000)RESUME=u}catch(_){}
let tab=RESUME&&ORDER.includes(RESUME.tab)?RESUME.tab:ORDER.includes(location.hash.slice(1))?location.hash.slice(1):"squadra";
const now=new Date(); const todayISO=iso(now);
let calY=now.getFullYear(), calM=now.getMonth(), selDay=todayISO;
const $=s=>document.querySelector(s);
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function iso(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function pd(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}
function uid(){return "x"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function played(e){return e.type==="partita"&&e.gf!=null&&e.ga!=null&&e.gf!==""&&e.ga!==""}
function res(e){return e.gf>e.ga?"V":e.gf<e.ga?"P":"N"}
function sorted(){return [...S.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}
function matchTitle(e){const me=S.short||S.team;return e.home?`${me} – ${e.opponent}`:`${e.opponent} – ${me}`}
function evTitle(e){return e.type==="partita"?matchTitle(e):"Allenamento"}
function dayLabel(s){const d=pd(s);return `${GG[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`}
function crestImg(name,us,cls=""){const L=S.logos||{};const src=us?(L[S.team]||LOGO):L[name];
  return `<span class="cchip ${cls}">${src?`<img src="${src}" alt="">`:`<b>${esc((name||"?").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase())}</b>`}</span>`}
function teamsRow(e){
  const me=S.short||S.team;
  const H=e.home?{n:me,us:1}:{n:e.opponent}, A=e.home?{n:e.opponent}:{n:me,us:1};
  const side=t=>`<div class="m-team ${t.us?"us":""}">${crestImg(t.n,t.us)}<span>${esc(t.n)}</span></div>`;
  const mid=played(e)?`<span class="m-score">${e.home?e.gf:e.ga}–${e.home?e.ga:e.gf}</span><span class="res ${res(e)}">${res(e)}</span>`:`<span class="vs">VS</span><span class="m-time">${esc(e.time)}</span>`;
  return `<div class="m-teams">${side(H)}<div class="m-mid">${mid}</div>${side(A)}</div>`;
}
function matchRow(e){
  const d=pd(e.date), nowT=new Date().toTimeString().slice(0,5);
  const isPast=!played(e)&&(e.date<todayISO||(e.date===todayISO&&e.time<=nowT));
  const done=played(e)||isPast;
  const st=played(e)?res(e):isPast?"todo":"next";
  const days=Math.round((pd(e.date)-pd(todayISO))/864e5);
  const GGL=["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
  const stat=st==="V"?"Vittoria":st==="N"?"Pareggio":st==="P"?"Sconfitta":st==="todo"?"Da inserire":days===0?"Oggi":days===1?"Domani":`Tra ${days} giorni`;
  const giornata=e.note&&/^Giornata/.test(e.note)?e.note:"";
  const ag=Object.entries(e.scorers||{}).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
  const wm=(S.logos||{})[e.opponent];
  const BALL='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.8 2.8-1.4 4.5H9.6l-1.4-4.5z" fill="currentColor" fill-opacity=".25"/></svg>';
  const PIN='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const foot=ag.length?`<div class="mc-foot goals"><span class="mc-ic">${BALL}</span><ul class="glist inline">${ag.map(([id,n])=>`<li>${nameHTML(pname(id))}${n>1?` <em>(x${n})</em>`:""}</li>`).join("")}</ul></div>`
    :st==="todo"?`<div class="mc-foot todo">${canEdit?"Tocca per inserire risultato e marcatori":"Risultato non ancora inserito"}</div>`
    :e.place?`<div class="mc-foot"><span class="mc-ic">${PIN}</span><span>${esc(e.place)}</span></div>`:"";
  return `<button class="mrow mcard st-${st}" ${done?`data-match="${e.id}"`:`data-open="${e.id}"`}>
    ${wm?`<span class="mc-wm" style="background-image:url('${wm}')" aria-hidden="true"></span>`:""}
    <div class="mc-head">
      <div class="mc-date"><b>${d.getDate()}</b><span>${MESI[d.getMonth()].slice(0,3)}</span></div>
      <div class="mc-meta">${giornata?`<span class="mc-g">${esc(giornata)}</span>`:""}<span class="mc-when">${GGL[d.getDay()]} · ${e.home?"In casa":"Trasferta"}</span></div>
      <span class="mstat s-${st}">${stat}</span>
    </div>
    ${teamsRow(e)}
    ${foot}
  </button>`;
}
function monthList(arr,emptyHTML){
  if(!arr.length)return emptyHTML;let last="",out="";
  arr.forEach(e=>{const d=pd(e.date),k=MESI[d.getMonth()]+" "+d.getFullYear();
    if(k!==last){out+=`<div class="mmonth"><span>${k}</span></div>`;last=k}out+=evRow(e)});
  return out;
}
/* ---------- ALLENAMENTI: presenze e RPE ---------- */
const RPEC=v=>v==null?"var(--muted)":`hsl(${Math.round(130-(v-1)*13.3)} 70% ${v>=8?46:42}%)`;
const RPEL=["","Riposo","Molto facile","Facile","Moderato","Un po' duro","Duro","Molto duro","Durissimo","Quasi al massimo","Massimo"];
/* ordine alfabetico per cognome (Salah Eddin resta sopra Marconcini) */
const surKey=n=>{n=String(n||"");if(/salah eddin/i.test(n))return "machal";const i=n.indexOf(" ");return (i<0?n:n.slice(i+1)+" "+n.slice(0,i)).toLowerCase()};
const bySur=(a,b)=>surKey(a.name).localeCompare(surKey(b.name),"it");
function attOf(e){return e.att||{}}
/* di default tutti presenti: si toglie la spunta solo a chi manca */
function attRec(e,pid){const a=e.att;if(!a||!Object.keys(a).length)return {in:true,rpe:null};return a[pid]||{in:true,rpe:null}}
function attStats(e){const ids=S.players.map(p=>p.id),recs=ids.map(id=>attRec(e,id)),pres=recs.filter(r=>r.in),rp=pres.map(r=>r.rpe).filter(v=>v!=null);
  return {done:trDone(e),pres:pres.length,tot:ids.length,rpe:rp.length?rp.reduce((x,y)=>x+y,0)/rp.length:null,nrpe:rp.length}}
/* i 20 allenamenti fatti prima dell'app contano come presenze */
function playerAtt(pid){let tot=+(S.allenBase??20)||0,pres=tot,sum=0,n=0;S.events.filter(e=>e.type!=="partita"&&(trDone(e)||(e.att&&Object.keys(e.att).length))).forEach(e=>{tot++;const r=attRec(e,pid);if(r.in){pres++;if(r.rpe!=null){sum+=r.rpe;n++}}});
  return {tot,pres,rpe:n?sum/n:null}}
function trDone(e){const nowT=new Date().toTimeString().slice(0,5);return e.date<todayISO||(e.date===todayISO&&(e.end||e.time)<=nowT)}
const CLK='<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function allRow(e){const d=pd(e.date),st=attStats(e),fut=!trDone(e),pct=st.tot?st.pres/st.tot:0,R=15,C=2*Math.PI*R;
  return `<button class="arow ${fut?"fut":""} ${st.done&&st.nrpe?"ok":st.done?"todo":""}" data-att="${e.id}">
    <span class="ar-d"><small>${GG[d.getDay()]}</small><b>${d.getDate()}</b><em>${MESI[d.getMonth()].slice(0,3)}</em>${st.done&&st.nrpe?'<i class="ar-ok" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>':""}</span>
    <span class="ar-m"><b>Allenamento</b><small>${CLK}${esc(e.time)}${e.end?"–"+esc(e.end):""}${e.place?" · "+esc(e.place):""}</small>
      ${st.done?(st.rpe==null?`<span class="ar-tag todo">RPE da inserire</span>`:""):`<span class="ar-tag">In programma</span>`}</span>
    ${st.done?`<span class="ar-stats"><span class="ar-st" style="--c:${PCTC(pct)}"><b>${st.pres}<i>/${st.tot}</i></b><small>Presenti</small></span><span class="ar-st" style="--c:${RPEC(st.rpe==null?null:Math.round(st.rpe))}"><b>${st.rpe==null?"–":st.rpe.toFixed(1)}</b><small>RPE</small></span></span>`
      :`<span class="ar-go" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>`}
  </button>`}
function vAllen(){
  const tr=sorted().filter(e=>e.type!=="partita");
  const past=tr.filter(trDone).reverse(), next=tr.filter(e=>!trDone(e)).slice(0,3);
  const base=+(S.allenBase??20)||0, fatti=base+past.length;
  let sum=0,n=0;tr.forEach(e=>Object.values(e.att||{}).forEach(r=>{if(r&&r.in&&r.rpe!=null){sum+=r.rpe;n++}}));const avgR=n?sum/n:null;
  const months=arr=>{let last="",out="";arr.forEach(e=>{const d=pd(e.date),k=MESI[d.getMonth()]+" "+d.getFullYear();if(k!==last){out+=`<div class="mmonth"><span>${k}</span></div>`;last=k}out+=allRow(e)});return out};
  return `<section><h2>Allenamenti</h2>
    <div class="a-hero">
      <div class="a-big"><b>${fatti}</b><span>Allenamenti fatti</span></div>
      <div class="a-big" style="--c:${RPEC(avgR==null?null:Math.round(avgR))}"><b class="rpe">${avgR==null?"–":avgR.toFixed(1)}</b><span>RPE medio stagione</span>${avgR!=null?`<i class="a-bar"><i style="width:${avgR*10}%"></i></i>`:""}</div>
    </div></section>
  ${presSection()}
  ${next.length?`<section><h2>Prossimi</h2><div class="mlist">${next.map(allRow).join("")}</div></section>`:""}
  <section><h2>Svolti</h2><div class="mlist">${past.length?months(past):'<div class="card empty">Gli allenamenti svolti compariranno qui: toccali per segnare presenze e RPE.</div>'}</div></section>`;
}
let presOpen=false;
const PCTC=v=>v==null?"var(--muted)":`hsl(${Math.round(Math.max(0,Math.min(1,(v-.7)/.3))*125)} 68% 44%)`; /* 100% verde, 85% giallo, 70% o meno rosso */
function presSection(){
  const rows=S.players.map(p=>{const a=playerAtt(p.id);return {p,tot:a.tot,pres:a.pres,ass:a.tot-a.pres,pct:a.tot?a.pres/a.tot:null}})
    .sort((x,y)=>(y.pct??-1)-(x.pct??-1)||x.ass-y.ass||bySur(x.p,y.p));
  if(!rows.length)return "";
  const ini=n=>{const w=n.trim().split(/\s+/);return (w[0][0]+(w[1]?w[1][0]:"")).toUpperCase()};
  const row=(r,i)=>`<div class="pr-row" style="--c:${PCTC(r.pct)};--rc:${RCOL[r.p.role]}">
      <span class="pr-mid"><span class="pr-nm">${nameHTML(r.p.name)}</span></span>
      <span class="pr-r"><b class="pr-pct">${r.pct==null?"–":Math.round(r.pct*100)+"%"}</b><span class="pr-ass ${r.ass?"":"zero"}">${r.ass?`${r.ass} ${r.ass===1?"assenza":"assenze"}`:"mai assente"}</span></span></div>`;
  const top=rows.slice(0,3),rest=rows.slice(3);
  return `<section><h2>Presenze giocatori</h2>
    <div class="card prs ${presOpen?"open":""}">
      <div class="pr-list">${top.map((r,i)=>row(r,i)).join("")}</div>
      ${rest.length?`<div class="pr-more"><div class="pr-in"><div class="pr-list">${rest.map((r,i)=>row(r,i+3)).join("")}</div></div></div>
      <button class="pr-tog" id="prTog" aria-expanded="${presOpen}"><span>${presOpen?"Mostra meno":`Mostra tutti (${rows.length})`}</span><i class="pr-chev"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></i></button>`:""}
    </div></section>`;
}
function bindPres(){const t=$("#prTog");if(!t)return;
  t.onclick=()=>{const card=t.closest(".prs"),more=card.querySelector(".pr-more");
    const label=()=>{t.setAttribute("aria-expanded",presOpen);t.querySelector("span").textContent=presOpen?"Mostra meno":`Mostra tutti (${S.players.length})`};
    if(!presOpen){presOpen=true;card.classList.add("open");label();return}
    /* chiusura leggera per il telefono: le righe sfumano, poi la tendina si chiude in un colpo
       e quello che c'è sotto risale scivolando (solo movimento, niente ricalcoli a ogni fotogramma) */
    presOpen=false;label();
    const red=reducedM();if(red){card.classList.remove("open");return}
    /* se l'inizio della tendina è fuori schermo, prima si risale dolcemente fin lì */
    const top=card.getBoundingClientRect().top,off=top-90,wait=off<0?Math.min(520,220+Math.abs(off)*.4):0;
    if(off<0)window.scrollBy({top:off,behavior:"smooth"});
    setTimeout(()=>card.classList.add("closing"),Math.max(0,wait-170));
    setTimeout(()=>{const h=more.offsetHeight;card.classList.add("snap");card.classList.remove("open");
      const sec=card.closest("section"),movers=[t,...(()=>{const a=[];let n=sec.nextElementSibling;while(n){a.push(n);n=n.nextElementSibling}return a})()];
      movers.forEach(el=>el.animate([{transform:`translateY(${h}px)`},{transform:"none"}],{duration:420,easing:"cubic-bezier(.22,1,.36,1)"}));
      requestAnimationFrame(()=>card.classList.remove("snap","closing"))},Math.max(170,wait))}}
function openAtt(id,onClose){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  const fresh=!e.att||!Object.keys(e.att).length;
  const work=Object.fromEntries(S.players.map(p=>[p.id,{...attRec(e,p.id)}]));
  let changed=false, openP=null;
  const srt=bySur;
  const d=pd(e.date);
  const head=()=>{const ids=S.players.map(p=>p.id),pres=ids.filter(i=>work[i]&&work[i].in),rp=pres.map(i=>work[i].rpe).filter(v=>v!=null),m=rp.length?rp.reduce((x,y)=>x+y,0)/rp.length:null;
    return `<div class="at-sum"><div><b>${pres.length}<i>/${ids.length}</i></b><small>Presenti</small></div><div><b style="color:${RPEC(m==null?null:Math.round(m))}">${m==null?"–":m.toFixed(1)}</b><small>RPE medio</small></div><div><b>${rp.length}<i>/${pres.length}</i></b><small>RPE inseriti</small></div></div>`};
  const badge=r=>r&&r.in?(r.rpe!=null?`<span class="at-rb" style="--c:${RPEC(r.rpe)}"><small>RPE</small>${r.rpe}</span>`:'<span class="at-rb empty"><small>RPE</small>+</span>'):'<span class="at-rb off">Assente</span>';
  const row=p=>{const r=work[p.id]||{in:false};
    return `<div class="at-row ${r.in?"on":""}" data-pr="${p.id}" style="--rc:${RCOL[p.role]};--sc:${r.in?(r.rpe!=null?RPEC(r.rpe):"var(--win)"):"var(--loss)"}">
      <div class="at-line"><button class="at-ck" data-tg="${p.id}" ${canEdit?"":"disabled"} aria-pressed="${!!r.in}" aria-label="Presente"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
        <button class="at-who" data-op="${p.id}" ${canEdit?"":"disabled"}><span class="at-nm">${nameHTML(p.name)}</span>${badge(r)}</button></div>
      <div class="at-pick" aria-hidden="true"><div class="at-rpe">${[1,2,3,4,5,6,7,8,9,10].map(v=>`<button data-rp="${p.id}:${v}" class="${r.rpe===v?"on":""}" style="--c:${RPEC(v)};--i:${v-1}" tabindex="-1" aria-label="RPE ${v}">${v}</button>`).join("")}</div><button class="at-pk-x" data-pkx="${p.id}" tabindex="-1" aria-label="Chiudi">×</button></div>
    </div>`};
  sheet(`<button class="sheet-x" id="atX" aria-label="Chiudi">×</button>
    <h3>Allenamento · ${GG[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}</h3>
    <p class="ev-sub" style="margin:-4px 0 6px">Tutti presenti di default: togli la spunta a chi mancava. Tocca un nome per il suo RPE.</p>
    <div id="atHead">${head()}</div>
    <div class="at-list">${S.players.slice().sort(srt).map(row).join("")}</div>
    <p class="at-leg"><b>RPE</b> 1 riposo · 3 facile · 5 un po' duro · 7 molto duro · 10 massimo</p>
    <div class="sheet-actions">${canEdit&&!fresh?'<button class="btn" id="atReset">Ripristina</button>':"<span></span>"}<button class="btn primary" id="atOk">Fatto</button></div>`,bg=>{
    const q=x=>bg.querySelector(x);
    if($("#trOpen"))bg.style.zIndex=50; /* sopra la schermata dell'allenamento */
    const back=()=>{const y=window.scrollY;anim="";render();window.scrollTo(0,y);onClose&&onClose()};
    const upd=()=>{q("#atHead").innerHTML=head()};
    const red=reducedM();
    const setBadge=(id,pop=true)=>{const rw=work[id]||{};const el0=bg.querySelector(`[data-pr="${id}"]`);if(el0)el0.style.setProperty("--sc",rw.in?(rw.rpe!=null?RPEC(rw.rpe):"var(--win)"):"var(--loss)");const b=bg.querySelector(`[data-op="${id}"] .at-rb`);const t=document.createElement("span");t.innerHTML=badge(work[id]);const nb=t.firstChild;b.replaceWith(nb);
      if(pop&&!red&&nb.animate)nb.animate([{transform:"scale(.6)",opacity:0},{transform:"scale(1.08)",opacity:1,offset:.6},{transform:"scale(1)"}],{duration:420,easing:"cubic-bezier(.22,1,.36,1)"});return nb};
    /* la tendina dei numeri si apre e chiude con una transizione CSS (fluida anche su iPhone) */
    /* i numeri compaiono sopra la targhetta stessa: niente cambi di altezza, quindi fluido anche con tanti giocatori */
    /* i numeri escono sotto il nome: la riga si allunga in un colpo e le righe sotto scivolano
       con il solo spostamento (niente ricalcoli a ogni fotogramma, quindi fluido su iPhone) */
    const setP=(id,open)=>{const el=bg.querySelector(`[data-pr="${id}"]`);if(!el||el.classList.contains("open")===open)return;
      el.classList.toggle("open",open);clearTimeout(el._ct);
      if(open)el.classList.remove("closing");else if(!red){el.classList.add("closing");el._ct=setTimeout(()=>el.classList.remove("closing"),440)}
      const pk=el.querySelector(".at-pick");pk.setAttribute("aria-hidden",!open);pk.querySelectorAll("button").forEach(b=>b.tabIndex=open?0:-1)};
    const flip=(mut,opening)=>{if(red){mut();return}
      const els=[...bg.querySelectorAll(".at-row")];let n=bg.querySelector(".at-list").nextElementSibling;while(n){els.push(n);n=n.nextElementSibling}
      const tops=els.map(x=>x.getBoundingClientRect().top);
      els.forEach(x=>{if(x._fa){x._fa.cancel();x._fa=null}});
      mut();
      els.forEach((x,i)=>{const d=tops[i]-x.getBoundingClientRect().top;if(Math.abs(d)<.5||!x.animate)return;
        x._fa=x.animate([{transform:`translateY(${d}px)`},{transform:"none"}],{duration:opening?480:430,easing:opening?"cubic-bezier(.25,1.3,.4,1)":"cubic-bezier(.22,1,.36,1)"});x._fa.onfinish=()=>{x._fa=null}})};
    const fold=(id,open)=>{flip(()=>setP(id,open),open);
      if(open){const el=bg.querySelector(`[data-pr="${id}"]`);setTimeout(()=>{const sc=el.closest(".sheet")||bg,r=el.getBoundingClientRect(),v=sc.getBoundingClientRect();if(r.bottom>v.bottom-90&&el.scrollIntoView)el.scrollIntoView({block:"center",behavior:"smooth"})},60)}};
    /* il numero scelto "vola" nel riquadro RPE accanto al nome */
    const fly=(btn,id)=>{const el=bg.querySelector(`[data-pr="${id}"]`);const old=el.querySelector(".at-rb");
      if(red||!btn.animate){setBadge(id,false);return}
      const a=btn.getBoundingClientRect();const nb=setBadge(id,false);const z=nb.getBoundingClientRect();nb.style.opacity="0";
      const g=document.createElement("span");g.className="at-fly";g.textContent=btn.textContent;g.style.cssText=`left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;--c:${getComputedStyle(btn).getPropertyValue("--c")}`;
      document.body.appendChild(g);
      const dx=z.left+z.width/2-(a.left+a.width/2),dy=z.top+z.height/2-(a.top+a.height/2);
      g.animate([{transform:"translate(0,0) scale(1.12)"},{transform:`translate(${dx*0.55}px,${dy*0.55-18}px) scale(1.25)`,offset:.5},{transform:`translate(${dx}px,${dy}px) scale(${z.height/a.height})`,borderRadius:"12px"}],{duration:480,easing:"cubic-bezier(.45,0,.2,1)",fill:"forwards"}).onfinish=()=>{g.remove();nb.style.opacity="";
        nb.animate([{transform:"scale(1.12)"},{transform:"scale(1)"}],{duration:260,easing:"cubic-bezier(.22,1,.36,1)"})}};
    const commit=()=>{if(!changed)return;e.att=JSON.parse(JSON.stringify(work));dirty=true;changed=false};
    bg.addEventListener("click",ev=>{if(!canEdit)return;
      const t=ev.target.closest("[data-tg]"),o=ev.target.closest("[data-op]"),r=ev.target.closest("[data-rp]"),x=ev.target.closest("[data-pkx]");
      if(x){fold(x.dataset.pkx,false);if(openP===x.dataset.pkx)openP=null;return}
      if(t){const id=t.dataset.tg,cur=work[id]||{};const on=!cur.in;work[id]={in:on,rpe:on?(cur.rpe??null):null};changed=true;
        const el=bg.querySelector(`[data-pr="${id}"]`);el.classList.toggle("on",on);t.setAttribute("aria-pressed",on);
        if(!on){if(openP===id){fold(id,false);openP=null}el.querySelectorAll(".at-rpe button").forEach(b=>b.classList.remove("on"))}
        setBadge(id);if(navigator.vibrate)navigator.vibrate(8);upd();commit();autosave();return}
      if(o){const id=o.dataset.op;if(!(work[id]&&work[id].in))return;
        if(openP===id){fold(id,false);openP=null;return}
        if(openP){const o=openP;openP=id;flip(()=>{setP(o,false);setP(id,true)},true);return}
        openP=id;fold(id,true);return}
      if(r){const [id,v]=r.dataset.rp.split(":");const n=+v;const cur=work[id]||{in:true};cur.in=true;cur.rpe=n;work[id]=cur;changed=true;
        r.parentElement.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b===r));
        fly(r,id);fold(id,false);if(openP===id)openP=null;upd();commit();autosave();return}
    });
    const close=()=>{commit();closeSheet();back()};
    q("#atOk").onclick=close;q("#atX").onclick=close;
    const rs=q("#atReset");if(rs)rs.onclick=()=>{if(!rs.classList.contains("confirm")){rs.classList.add("confirm");rs.textContent="Tocca di nuovo per ripristinare";setTimeout(()=>{rs.classList.remove("confirm");rs.textContent="Ripristina"},3000);return}
      delete e.att;dirty=true;changed=false;closeSheet();back()};
    bg.addEventListener("click",ev=>{if(ev.target===bg){commit();setTimeout(back,260)}},true);
  });
}
function pname(id){const p=S.players.find(p=>p.id===id);return p?p.name:"Giocatore rimosso"}

const ICON={
squadra:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/></svg>',
partite:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M12 5v14"/><circle cx="12" cy="12" r="2.6"/><path d="M2.5 9.5h2.5v5H2.5M21.5 9.5H19v5h2.5"/></svg>',
allenamenti:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l7.5 15.5h-15z"/><path d="M8 12.2h8M6.3 15.8h11.4"/></svg>',
rosa:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M8 3h8l5 3-2 4-2-1v12H7V9l-2 1-2-4z"/></svg>',
tattica:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3" width="17" height="18" rx="2.5"/><path d="M7.5 7.5l3 3M10.5 7.5l-3 3"/><circle cx="15.5" cy="15.5" r="2"/><path d="M9 16c1.5-2 3-3 4.5-3.2" stroke-dasharray="1.5 2"/></svg>'};

function render(){
  const app=$("#app");
  const sub=`${esc(S.categoria)} · Stagione ${esc(S.stagione)}`;
  let body = tab==="squadra"?vSquadra():tab==="partite"?vPartite():tab==="allenamenti"?vAllen():tab==="rosa"?vRosa():vTattica();
  const hdr=`<header class="top"><div class="wrap">
    <img class="crest" src="${LOGO}" alt="">
    <div class="brand"><h1>Alta Brianza Calcio</h1><p>${sub}</p></div>
    ${ABD_ME?`<button class="prof" id="profBtn" aria-label="Profilo di ${esc(ABD_ME.first)} ${esc(ABD_ME.last)}" aria-haspopup="true"><span>${esc(ABD_ME.first[0])}${esc(ABD_ME.last[0])}</span></button>`:""}
  </div></header>`;
  const rest=`
  <main class="wrap ${anim}">
    ${body}
  </main>
  ${dirty&&saveFailed?`<div class="savebar"><div class="in">Modifiche non salvate <button class="btn bib small" id="save" ${saving?"disabled":""}>${saving?'<span class="spin" aria-hidden="true"></span>':""}Salva</button></div></div>`:""}
  <nav class="tabbar" aria-label="Sezioni"><div class="in"><span class="glass" id="glass" aria-hidden="true"></span>
    ${ORDER.map(t=>`<button data-tab="${t}" ${t===tab?'aria-current="page"':""}>${ICON[t]}${{squadra:"Home",partite:"Partite",allenamenti:"Allenam.",rosa:"Rosa",tattica:"Tattica"}[t]}</button>`).join("")}
  </div></nav>`;
  /* l'intestazione resta ferma: si ridisegna solo se cambia (niente sfarfallio di logo e scritta) */
  const H=app.querySelector("header.top");
  if(H&&app._hdr===hdr){while(H.nextSibling)H.nextSibling.remove();H.insertAdjacentHTML("afterend",rest)}
  else{app.innerHTML=hdr+rest;app._hdr=hdr}
  bind();
  placeGlass(pillFromX);pillFromX=null;bindGlass();
  anim="";calAnim="";dayAnim=false;
}

/* ---------- SQUADRA ---------- */
function vSquadra(){
  const ev=sorted();
  const upcoming=ev.filter(e=>e.date>todayISO||(e.date===todayISO&&(e.end||e.time)>=new Date().toTimeString().slice(0,5))).filter(e=>!played(e));
  const results=ev.filter(played).reverse();
  const nx=upcoming[0];
  let hero="";
  if(nx){
    hero=`<section><h2>Prossimo impegno ${canEdit?'<button class="btn small primary addbtn" data-add="event">+ Impegno</button>':""}</h2>${heroCard(nx,true)}
${queue(upcoming.slice(1,4))}</section>`;
  }
  return hero+vCal()+`
  <section><h2>Campionato · Risultati
    <span class="form">${results.slice(0,5).reverse().map(e=>`<span class="res ${res(e)}" title="${esc(matchTitle(e))}">${res(e)}</span>`).join("")}</span></h2>
    <div class="mlist">${results.slice(0,3).map(evRow).join("")||'<div class="card empty">Nessuna partita giocata.</div>'}</div>
    ${results.length?'<div class="more-wrap"><button class="btn more" data-go="partite">Altro<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button></div>':""}
  </section>
  ${vMarcatori()}`;
}
function evRow(e){
  if(e.type==="partita")return matchRow(e);
  const d=pd(e.date);
  let right;
  if(played(e)) right=`<span class="score">${e.home?e.gf:e.ga}–${e.home?e.ga:e.gf}<span class="res ${res(e)}">${res(e)}</span></span>`;
  else if(e.type==="partita"&&e.date<=todayISO&&(e.date<todayISO||e.time<=new Date().toTimeString().slice(0,5))) right=`<span class="tag">Risultato?</span>`;
  else right=`<span class="tag ${e.type==="partita"?"p":""}">${e.type==="partita"?(e.home?"Casa":"Trasf."):"Allen."}</span>`;
  let sub=[GG[d.getDay()],'ore '+esc(e.time)+(e.end?'–'+esc(e.end):''),e.place?esc(e.place):''].filter(Boolean).join(' · ');
  if(played(e)){const sc=Object.entries(e.scorers||{}).filter(([,n])=>n>0).map(([id,n])=>esc(pname(id))+(n>1?" ×"+n:""));if(sc.length)sub=`⚽ ${sc.join(", ")}`}
  else if(e.note) sub=/^Giornata/.test(e.note)?`${esc(e.note)} · ${sub}`:`${sub} · ${esc(e.note)}`;
  const tag="button";
  return `<${tag} class="ev row-btn" data-open="${e.id}">
    <div class="date-block"><b>${d.getDate()}</b><small>${MESI[d.getMonth()].slice(0,3)}</small></div>
    <div class="ev-main"><div class="ev-title">${esc(evTitle(e))}</div><div class="ev-sub">${sub}</div></div>
    ${right}</${tag}>`;
}
/* festivi nazionali italiani (+ Pasqua e Pasquetta calcolate) */
const FEST_CACHE={};
function festivi(y){if(FEST_CACHE[y])return FEST_CACHE[y];
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
  const p2=n=>String(n).padStart(2,"0"),r={};
  [["01-01","Capodanno"],["01-06","Epifania"],["04-25","Festa della Liberazione"],["05-01","Festa del Lavoro"],["06-02","Festa della Repubblica"],["08-15","Ferragosto"],["10-04","San Francesco"],["11-01","Ognissanti"],["12-08","Immacolata"],["12-25","Natale"],["12-26","Santo Stefano"]].forEach(([md,n])=>r[y+"-"+md]=n);
  const ps=new Date(y,mo-1,da),pm=new Date(y,mo-1,da+1);r[iso(ps)]="Pasqua";r[iso(pm)]="Lunedì dell'Angelo";
  return FEST_CACHE[y]=r}
function festName(k){return festivi(+k.slice(0,4))[k]||""}
function vCal(){
  const first=new Date(calY,calM,1); const off=(first.getDay()+6)%7;
  const start=new Date(calY,calM,1-off);
  const byDay={}; S.events.forEach(e=>(byDay[e.date]=byDay[e.date]||[]).push(e));
  let cells="";
  for(let i=0;i<42;i++){
    const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i); const k=iso(d);
    if(i>=35&&d.getMonth()!==calM) break;
    const evs=byDay[k]||[];
    cells+=`<button class="day ${d.getMonth()!==calM?"out":""} ${festName(k)||d.getDay()===0?"fest":""} ${k===todayISO?"today":""} ${k===selDay?"sel"+(dayAnim?" pop":""):""}" data-day="${k}" aria-label="${dayLabel(k)}${festName(k)?" ("+festName(k)+")":""}${evs.length?", "+evs.length+" impegni":""}">
      ${d.getDate()}<span class="marks">${evs.map(e=>`<i class="mk ${e.type==="partita"?"p":"a"}"></i>`).join("")}</span></button>`;
  }
  const sel=(byDay[selDay]||[]).sort((a,b)=>a.time.localeCompare(b.time));
  return `<section><h2>Calendario</h2><div class="card cal">
    <div class="cal-head"><button class="btn small" id="prevM" aria-label="Mese precedente">‹</button><strong>${MESI[calM]} ${calY}</strong><button class="btn small" id="nextM" aria-label="Mese successivo">›</button></div>
    <div class="cal-grid ${calAnim}">${["L","M","M","G","V","S","D"].map(x=>`<div class="dow">${x}</div>`).join("")}${cells}</div>
    <div class="legend"><span><i class="mk p"></i>Partita</span><span><i class="mk a"></i>Allenamento</span></div>
  </div>
  ${selDay!==todayISO?`${dayTouched?`<div class="card list ${dayAnim?"day-anim":""}" style="margin-top:8px">${sel.length?sel.map(evRow).join(""):`<div class="empty">${esc(dayLabel(selDay))}: nessun impegno.</div>`}</div>`:""}${dayTouched&&festName(selDay)?`<div class="fest-note">${esc(festName(selDay))}</div>`:""}`:""}
  </section>`;
}
function standingRows(){
  return S.standings.map(r=>({...r,pg:(+r.v||0)+(+r.n||0)+(+r.p||0),pt:3*(+r.v||0)+(+r.n||0),dr:(+r.gf||0)-(+r.gs||0)}))
    .sort((a,b)=>b.pt-a.pt||b.dr-a.dr||b.gf-a.gf);
}
function vClassifica(){
  const rows=standingRows();
  return `<section><h2>Classifica${S.girone?" · "+esc(S.girone):""} ${editMode?'<button class="btn small primary addbtn" id="editSt">Aggiorna</button>':""}</h2>
  <div class="card tbl-wrap"><table>
   <thead><tr><th>#</th><th>Squadra</th><th>Pt</th><th>G</th><th>V</th><th>N</th><th>P</th><th>DR</th></tr></thead>
   <tbody>${rows.map((r,i)=>`<tr class="${r.team===S.team?"us":""}"><td class="pos">${i+1}</td><td><span class="team-cell">${crestImg(r.team,r.team===S.team,"sm")}<span>${esc(r.team)}</span></span></td><td class="pts">${r.pt}</td><td>${r.pg}</td><td>${r.v}</td><td>${r.n}</td><td>${r.p}</td><td>${r.dr>0?"+":""}${r.dr}</td></tr>`).join("")}</tbody>
  </table></div></section>`;
}

function heroCard(e,tappable,full){
  const days=Math.round((pd(e.date)-pd(todayISO))/864e5);
  const isM=e.type==="partita";
  return `<div class="next ${isM?"match-bg":"train"} ${tappable?"tap":""}" ${tappable?`data-open="${e.id}" role="button" tabindex="0" aria-label="Apri ${esc(evTitle(e))}"`:""}>${!isM&&TRAIN?`<div class="next-photo" style="background-image:url('${TRAIN}')"></div>`:""}${isM&&MATCHBG?`<div class="match-photo" style="background-image:url('${MATCHBG}')"></div>`:""}
      <div class="kicker">${esc(S.categoria)} · ${isM?(e.home?"Partita in casa":"Partita in trasferta"):"Allenamento"}</div>
      ${isM?teamsRow(e):`<div class="match">Allenamento</div>`}
      <div class="meta"><span>${esc(dayLabel(e.date))}, ore ${esc(e.time)}${e.end?"–"+esc(e.end):""}</span>${(tappable||full)&&e.place?`<span>${esc(e.place)}</span>`:""}${(tappable||full)&&e.note?`<span>${esc(e.note)}</span>`:""}</div>
      <div class="countdown">${played(e)?"Finale":(days<0||(days===0&&e.time<=new Date().toTimeString().slice(0,5)))?"Conclusa":days===0?"Oggi":days===1?"Domani":"Tra "+days+" giorni"}</div>
    </div>`;
}
function openEvent(id,fromEl){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  const isM=e.type==="partita";
  const row=(ic,t,v)=>v?`<div class="drow"><span class="dic">${ic}</span><div><small>${t}</small><div>${v}</div></div></div>`:"";
  const tactic=isM&&(S.tactics||{})[e.id];
  const old=$("#evOpen");if(old)old.remove();
  const ov=document.createElement("div");ov.className="evo";ov.id="evOpen";
  ov.innerHTML=`<button class="evo-back" aria-label="Indietro"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="evo-in" role="dialog" aria-modal="true">
    ${heroCard(e,false)}
    <div class="card dcard">
      ${row("<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M8 3v4M16 3v4\"/></svg>","Quando",esc(dayLabel(e.date))+", ore "+esc(e.time)+(e.end?" – "+esc(e.end):""))}
      ${row("<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.5\"/></svg>","Dove",esc(e.place||""))}
      ${isM?row("<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7l4 3-1.5 5h-5L8 10z\"/></svg>","Partita",esc((e.note&&/^Giornata/.test(e.note)?e.note+" · ":"")+(e.home?"in casa":"in trasferta")+" contro "+e.opponent)):""}
      ${isM&&tactic?row("<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3.5\" y=\"3\" width=\"17\" height=\"18\" rx=\"2.5\"/><path d=\"M8 8l3 3M11 8l-3 3\"/><circle cx=\"15.5\" cy=\"15.5\" r=\"2\"/></svg>","Formazione",esc(tactic.periods?tactic.periods.map((p,i)=>(i+1)+"° "+p.module).join(" · "):"Modulo "+tactic.module)):""}
      ${isM?convRow(e):""}
      ${!(isM&&/^Giornata/.test(e.note||""))?row("<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 20h4L19 9l-4-4L4 16z\"/><path d=\"M14 6l4 4\"/></svg>","Note",esc(e.note||"")):""}
    </div>
    <div class="evo-act">${canEdit?`<button class="btn" id="evEdit">Modifica</button>`:""}${isM?`<button class="btn primary" id="evConv">Convocazioni</button>`:""}<button class="btn" id="evClose">Chiudi</button></div>
  </div>`;
  document.body.appendChild(ov);lockScroll(true);
  const box=ov.querySelector(".evo-in");
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(fromEl&&!reduced&&box.animate){
    const r=fromEl.getBoundingClientRect(),c=box.querySelector(".next").getBoundingClientRect();
    const sx=r.width/c.width,dx=r.left-c.left,dy=r.top-c.top;
    box.querySelector(".next").animate([{transform:`translate(${dx}px,${dy}px) scale(${sx},${r.height/c.height})`,borderRadius:"18px"},{transform:"none"}],{duration:520,easing:"cubic-bezier(.22,1,.36,1)"});
    [...box.children].slice(1).forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(18px)"},{opacity:1,transform:"none"}],{duration:420,delay:140+i*60,easing:"cubic-bezier(.22,1,.36,1)",fill:"backwards"}));
  }
  const close=()=>{lockScroll(false);if(reduced||!ov.animate){ov.remove();return}
    ov.animate([{opacity:1},{opacity:0}],{duration:220,easing:"ease",fill:"forwards"}).onfinish=()=>ov.remove();
    box.animate([{transform:"none"},{transform:"translateY(14px) scale(.97)"}],{duration:220,easing:"ease-in",fill:"forwards"})};
  ov.addEventListener("click",ev=>{if(ev.target===ov)close()});
  ov.querySelector("#evClose").onclick=close;ov.querySelector(".evo-back").onclick=close;
  const eb=ov.querySelector("#evEdit");if(eb)eb.onclick=()=>{ov.remove();lockScroll(false);editEvent(e.id)};
  const cb=ov.querySelector("#evConv");if(cb)cb.onclick=()=>openConv(e.id,cb);
  ov.querySelector("#evClose").focus({preventScroll:true});
}
/* ---------- SCHERMATA ALLENAMENTO ---------- */
function trainTiles(e){const st=attStats(e),has=e.att&&Object.keys(e.att).length;
  const sub=has||st.done?`${st.pres}/${st.tot} presenti${st.rpe!=null?" · RPE "+st.rpe.toFixed(1):""}`:"Da inserire";
  return `<button class="tr-tile" id="trRep"><span class="tr-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg></span><b>Resoconto</b><small>${repSub(e)}</small></button>
    <button class="tr-tile pri" id="trAtt"><span class="tr-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l2 2 3.5-4M4 16l2 2 3.5-4M13 7h7M13 17h7"/></svg></span><b>Presenze e RPE</b><small>${sub}</small></button>`}
function openTrain(id,fromEl){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  const red=reducedM()||!document.body.animate,E="cubic-bezier(.22,1,.36,1)";
  const old=$("#trOpen");if(old)old.remove();
  const ov=document.createElement("div");ov.className="evo tro";ov.id="trOpen";
  ov.innerHTML=`${canEdit?'<button class="evo-edit" id="trEdit">Modifica</button>':""}<button class="evo-back" aria-label="Indietro"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="evo-in" role="dialog" aria-modal="true" aria-label="Allenamento">
    ${heroCard(e,false,true)}<div class="tr-tiles">${trainTiles(e)}</div></div>`;
  document.body.appendChild(ov);lockScroll(true);
  const q=x=>ov.querySelector(x),card=q(".next");card.style.transformOrigin="0 0";
  if(!red)try{
    if(fromEl&&fromEl.isConnected){const r=fromEl.getBoundingClientRect(),c=card.getBoundingClientRect();
      card.animate([{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`},{transform:"none"}],{duration:540,easing:E})}
    else card.animate([{opacity:0,transform:"translateY(-16px) scale(.96)"},{opacity:1,transform:"none"}],{duration:440,easing:E});
    ov.querySelectorAll(".tr-tile").forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(34px) scale(.9)"},{opacity:1,transform:"none"}],{duration:500,delay:170+i*80,easing:"cubic-bezier(.25,1.3,.4,1)",fill:"backwards"}));
    const ed=q(".evo-edit");if(ed)ed.animate([{opacity:0,transform:"translateX(12px) scale(.9)"},{opacity:1,transform:"none"}],{duration:420,delay:160,easing:E,fill:"backwards"})}catch(_){}
  /* chiusura: i tasti scendono e il riquadro torna nella riga da cui era partito */
  const close=()=>{if(!ov.id)return;ov.id="";lockScroll(false);if(red){ov.remove();return}
    ov.style.pointerEvents="none";
    ov.querySelectorAll(".tr-tiles,.evo-back,.evo-edit").forEach(el=>el.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(30px) scale(.95)"}],{duration:260,easing:"cubic-bezier(.4,0,.8,.4)",fill:"forwards"}));
    const row=document.querySelector(`#app [data-att="${id}"],#app [data-open="${id}"]`),r=row&&row.getBoundingClientRect(),c=card.getBoundingClientRect();
    if(r&&r.bottom>0&&r.top<innerHeight)card.animate([{transform:"none",opacity:1},{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`,opacity:.25}],{duration:480,delay:40,easing:"cubic-bezier(.5,0,.15,1)",fill:"forwards"});
    else card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.92)"}],{duration:320,easing:"ease-in",fill:"forwards"});
    let ended=false;const end=()=>{if(ended)return;ended=true;ov.remove()};
    ov.animate([{opacity:1},{opacity:1,offset:.65},{opacity:0}],{duration:560,easing:"ease",fill:"forwards"}).onfinish=end;setTimeout(end,700)};
  const bindTiles=()=>{
    q("#trAtt").onclick=()=>openAtt(id,()=>{if(!ov.id)return;lockScroll(true);const cur=S.events.find(x=>x.id===id);if(!cur){close();return}
      q(".tr-tiles").innerHTML=trainTiles(cur);bindTiles()});
    q("#trRep").onclick=()=>openRep(id,q("#trRep"),()=>{if(!ov.id)return;const cur=S.events.find(x=>x.id===id);if(!cur){close();return}
      q(".tr-tiles").innerHTML=trainTiles(cur);bindTiles()})};
  bindTiles();
  q(".evo-back").onclick=close;ov.addEventListener("click",ev=>{if(ev.target===ov)close()});
  const eb=q("#trEdit");if(eb)eb.onclick=()=>{ov.id="";ov.remove();lockScroll(false);editEvent(id)};
}
/* ---------- RESOCONTO ALLENAMENTO ---------- */
/* partitelle 9 contro 8 preparate per ogni allenamento della stagione:
   la squadra da 9 gioca 3-3-2, quella da 8 con una sola punta */
const PT={"ids":["xmw6vun11wv3s","p2","p9","xmw6vtr2ukbay","xmw6w0g3bssjb","p3","xmw6vvgxm2gkx","xmw6vzz5nxa0q","p1","p11","p12","p8","p5","xmw6vyzpsbchz","p4","p6","p10"],"by":{"2026-11-10":"ibgdempcjkaoflnhq","2026-11-13":"kodfenhjqibgalmpc","2026-11-17":"ibdfempcjkogalnhq","2026-11-20":"kdogenhjqibaflmpc","2026-11-24":"igdfempcjkboalnhq","2026-11-27":"kbodenhjqiagflmpc","2026-12-01":"iodfempcjkbgalnhq","2026-12-04":"kbgdenhjqiaoflmpc","2026-12-08":"idgbempcjkaoflnhq","2026-12-11":"kfdoenhjqibgalmpc","2026-12-15":"ibdfempcjkagolnhq","2026-12-18":"kgdoenhjqibaflmpc","2026-12-22":"ibodempcjkagflnhq","2027-01-05":"kgdfenhjqiboalmpc","2027-01-08":"ifdoempcjkbgalnhq","2027-01-12":"kdgbenhjqiaoflmpc","2027-01-15":"ifdgempcjkboalnhq","2027-01-19":"kdobenhjqiagflmpc","2027-01-22":"ibdfempcjkgoalnhq","2027-01-26":"kdgoenhjqibfalmpc","2027-01-29":"ibdgempcjkfoalnhq","2027-02-02":"kdofenhjqibgalmpc","2027-02-05":"idofempcjkbgalnhq","2027-02-09":"kbdgenhjqifoalmpc","2027-02-12":"idgfempcjkboalnhq","2027-02-16":"kbdoenhjqifgalmpc","2027-02-19":"idogempcjkbaflnhq","2027-02-23":"kbdfenhjqiogalmpc","2027-02-26":"ibdfempcjkogalnhq","2027-03-02":"kdogenhjqibfalmpc","2027-03-05":"ibgdempcjkfoalnhq","2027-03-09":"kodfenhjqibgalmpc","2027-03-12":"idobempcjkagflnhq","2027-03-16":"kfdgenhjqiboalmpc","2027-03-19":"iodfempcjkbgalnhq","2027-03-23":"kbgdenhjqifoalmpc","2027-03-26":"ibdfempcjkagolnhq","2027-03-30":"kgdoenhjqibfalmpc","2027-04-02":"igdoempcjkbaflnhq","2027-04-06":"kbdfenhjqiagolmpc","2027-04-09":"igdfempcjkboalnhq","2027-04-13":"kbodenhjqifgalmpc","2027-04-16":"idgbempcjkfoalnhq","2027-04-20":"kfdoenhjqibgalmpc","2027-04-23":"ibdoempcjkfgalnhq","2027-04-27":"kdgfenhjqiboalmpc","2027-04-30":"idgoempcjkbfalnhq","2027-05-04":"kbdfenhjqigoalmpc","2027-05-07":"ifdgempcjkboalnhq","2027-05-11":"kdobenhjqifgalmpc","2027-05-14":"ifdoempcjkbgalnhq","2027-05-18":"kdgbenhjqifoalmpc","2027-05-21":"ibdfempcjkgoalnhq","2027-05-25":"kdgoenhjqiabflmpc","2027-05-28":"ibodempcjkfgalnhq"}};
const EXN=["Attivazione","Tecnica","Duelli"];
const PT_K=[["POR","TS","DC","TD","AS","CC","AD","PS","PD"],["POR","TS","DC","TD","AS","CC","AD","ATT"]];
const PT_XY=()=>[MODULI["3-3-2"],[[50,7],[20,26],[50,24],[80,26],[18,50],[50,48],[82,50],[50,74]]];
function ptBase(e){const ks=Object.keys(PT.by).sort();let c=PT.by[e.date];
  if(!c){let h=0;for(const ch of String(e.date||e.id))h=(h*31+ch.charCodeAt(0))>>>0;c=PT.by[ks[h%ks.length]]}
  const ids=[...c].map(ch=>PT.ids[ch.charCodeAt(0)-97]);return [ids.slice(0,9),ids.slice(9)]}
/* chi non è presente lascia il suo posto libero */
function ptView(e){const raw=e.pt||ptBase(e);
  return raw.map(t=>t.map(pid=>pid&&S.players.some(p=>p.id===pid)&&attRec(e,pid).in?pid:null))}
function repSub(e){const n=(e.rep||[]).filter(x=>x&&(x.t||x.d)).length;return n?`${n} eserciz${n===1?"io":"i"} · partitella`:"Esercizi e partitella"}
let rpEdit=false, rpSel=null, rpTap=0;
function openRep(id,fromEl,onClose){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  rpEdit=false;rpSel=null;
  const red=reducedM()||!document.body.animate,E="cubic-bezier(.22,1,.36,1)";
  const old=$("#rpOpen");if(old)old.remove();
  const ov=document.createElement("div");ov.className="evo rpo";ov.id="rpOpen";document.body.appendChild(ov);lockScroll(true);
  const q=x=>ov.querySelector(x);
  const view=()=>ptView(e);
  const mut=fn=>{if(!e.pt)e.pt=view();fn(e.pt);dirty=true;autosave()};
  const surn=p=>p.name.includes(" ")?p.name.slice(p.name.indexOf(" ")+1):p.name;
  const pitchHTML=(t,V)=>{const K=PT_K[t],XY=PT_XY()[t];
    return `<div class="pitch pt-pitch ${rpEdit?"editing":""}" data-ptp="${t}">
      <svg class="pitch-lines" viewBox="0 0 60 90" preserveAspectRatio="none" aria-hidden="true">
        <rect x="3" y="3" width="54" height="84" rx="1"/><line x1="3" y1="45" x2="57" y2="45"/><circle cx="30" cy="45" r="7.5"/>
        <rect x="16" y="3" width="28" height="13"/><rect x="24" y="3" width="12" height="5"/><path d="M24 16 Q30 20.5 36 16"/>
        <rect x="16" y="74" width="28" height="13"/><rect x="24" y="82" width="12" height="5"/><path d="M24 74 Q30 69.5 36 74"/>
        <rect x="26" y="1.2" width="8" height="1.8" class="goal"/><rect x="26" y="87" width="8" height="1.8" class="goal"/></svg>
      ${V[t].map((pid,i)=>{const p=pid&&S.players.find(x=>x.id===pid),k=K[i],f=p?fit(p,k):null,sel=rpSel&&rpSel.t===t&&rpSel.i===i;
        return `<button class="tok ${i===0?"gk":""} ${p?"":"empty"} ${sel?"sel":""}" data-pts="${t}:${i}" style="left:${XY[i][0]}%;top:${100-XY[i][1]}%;--rc:${p?RCOL[p.role]:"#fff"}" ${rpEdit?"":'tabindex="-1"'} aria-label="${p?esc(p.name):"Posto libero"}">
          <span class="tok-sh" aria-hidden="true"></span><span class="tok-pos f${f==null?"x":f}" title="${esc(POS[k])}">${k==="ATT"?"P":k}</span>
          <span class="tok-n">${p?jersey(i===0?{...p,role:"Portiere"}:{...p,role:p.role==="Portiere"?"Difensore":p.role}):"+"}</span>
          <span class="tok-l">${p?esc(surn(p)):"Libero"}</span></button>`}).join("")}</div>`};
  const exHTML=()=>{const R=e.rep||[];return [0,1,2].map(i=>{const x=R[i]||{},has=x.t||x.d;
    return `<button class="rp-ex ${has?"":"empty"}" data-ex="${i}" ${canEdit?"":"disabled"}><span class="rp-num">${i+1}</span><span class="rp-tx"><small class="rp-lab">${EXN[i]}</small><b>${has?esc(x.t||EXN[i]):EXN[i]}</b><small>${has?esc(x.d||""):canEdit?"Tocca per scrivere titolo e descrizione":"Non ancora scritto"}</small></span>${canEdit?'<svg class="rp-pen" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>':""}</button>`}).join("")};
  const draw=()=>{const V=view(),d=pd(e.date);
    const on=new Set(V.flat().filter(Boolean));
    const pres=S.players.filter(p=>attRec(e,p.id).in),abs=S.players.filter(p=>!attRec(e,p.id).in).sort(bySur);
    const out=pres.filter(p=>!on.has(p.id)).sort(bySur);
    const selP=rpSel&&V[rpSel.t][rpSel.i];
    const st=ov.scrollTop;
    ov.innerHTML=`<button class="evo-back" aria-label="Indietro"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="evo-in" role="dialog" aria-modal="true" aria-label="Resoconto">
      <div class="cv-top rp-top"><span class="tr-ic"><svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="4.5" y="5.5" width="17" height="22" rx="2.6" fill="#c9a46a" stroke="#f1d39c" stroke-width="1.4"/>
  <rect x="7.5" y="9" width="11" height="15.5" rx="1" fill="#fff"/>
  <rect x="9.5" y="3.5" width="7" height="4" rx="1.3" fill="#e9eefc" stroke="#0d1a58" stroke-width="1.2"/>
  <path d="M9.6 13h6.8M9.6 16.2h6.8M9.6 19.4h4.2" stroke="#8aa0e6" stroke-width="1.3"/>
  <g transform="rotate(40 23.5 18)"><rect x="21.6" y="8.5" width="3.8" height="14" rx=".6" fill="#f0a21e" stroke="#fff" stroke-width="1"/><path d="M21.6 22.5l1.9 3.6 1.9-3.6z" fill="#f6d7b0" stroke="#fff" stroke-width="1"/><path d="M23.1 25.3l.4.8.4-.8z" fill="#0d1a58"/><rect x="21.6" y="7.2" width="3.8" height="2.4" rx=".6" fill="#ff7a8a" stroke="#fff" stroke-width="1"/></g>
</svg></span><div><small>Resoconto</small><b>Allenamento</b><span>${esc(dayLabel(e.date))}, ore ${esc(e.time)}${e.end?"–"+esc(e.end):""}</span></div></div>
      <div class="rp-sec"><h4>Esercizi</h4><div class="rp-exs">${exHTML()}</div></div>
      <div class="rp-sec"><h4>Partitella${e.pt&&canEdit?'<button class="rp-reset" id="rpReset">Ripristina</button>':""}</h4>
        ${pd(e.date).getDay()===2?`<button class="rp-tema ${e.tema?"":"empty"}" id="rpTema" ${canEdit?"":"disabled"}><span>Tema:</span><b>${e.tema?esc(e.tema):canEdit?"tocca per scriverlo":"non ancora scritto"}</b>${canEdit?'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>':""}</button>`:""}
        <div class="rp-team"><span class="rp-dot a"></span><b>Squadra A</b><small>9 giocatori · 3-3-2</small></div>
        ${pitchHTML(0,V)}
        <div class="rp-team"><span class="rp-dot b"></span><b>Squadra B</b><small>8 giocatori · una punta</small></div>
        ${pitchHTML(1,V)}
        ${canEdit?`<div class="p-bar rp-bar ${rpEdit?"on":""}">${rpEdit?`<span>${rpSel?"Tocca un altro giocatore, anche dell'altra squadra, per scambiarli":"Tocca un giocatore per spostarlo o toglierlo"}</span>${rpSel&&selP?'<button class="btn small danger" id="rpDel">Togli</button>':""}<button class="btn small primary" id="rpDone">Fine</button>`:`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6a1.5 1.5 0 0 1 3 0v4"/><path d="M12 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M15 10V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4 14.5a1.6 1.6 0 0 1 2.6-1.8L9 15V11"/></svg><span>Tocca due volte un campo per modificare</span>`}</div>`:""}
        ${out.length?`<div class="rp-out"><h5>Fuori dal campo · ${out.length}</h5><div class="bench">${out.map(p=>`<button class="bch ${rpEdit&&rpSel?"pick":""}" data-ptb="${p.id}" style="--rc:${RCOL[p.role]}" ${rpEdit?"":"disabled"}><span class="tok-n">${jersey(p)}</span><span class="bch-t"><b>${nameHTML(p.name)}</b><small>${esc(POSS[(p.pos1||[])[0]]||p.role)}</small></span></button>`).join("")}</div></div>`:""}
        ${abs.length?`<p class="rp-abs"><em>Assenti</em>${abs.map(p=>nameHTML(p.name)).join(", ")}</p>`:""}
      </div>
      <div class="evo-act"><button class="btn" id="rpClose">Chiudi</button></div></div>`;
    ov.classList.add("static");ov.scrollTop=st;bind()};
  const pop=sel=>{if(red)return;const el=q(sel);el&&el.querySelectorAll(".tok-n,.tok-l").forEach(n=>n.animate([{transform:"scale(.6)",opacity:.3},{transform:"none",opacity:1}],{duration:460,easing:"cubic-bezier(.3,1.5,.5,1)"}))};
  const bind=()=>{
    q(".evo-back").onclick=close;q("#rpClose").onclick=close;
    ov.querySelectorAll("[data-ex]").forEach(b=>b.onclick=()=>{if(canEdit)editEx(+b.dataset.ex)});
    const tm=q("#rpTema");if(tm&&canEdit)tm.onclick=()=>sheet(`<h3>Tema della partitella</h3>
      <label class="field">Tema<input id="tm_v" value="${esc(e.tema||"")}" placeholder="Es. superiorità numerica sulle fasce" maxlength="120"></label>
      <div class="sheet-actions">${e.tema?'<button class="btn danger" id="tm_clr">Svuota</button>':"<span></span>"}<div><button class="btn" id="tm_no">Annulla</button><button class="btn primary" id="tm_ok">Fatto</button></div></div>`,
      bg=>{bg.style.zIndex=60;const g=x=>bg.querySelector(x);g("#tm_no").onclick=closeSheet;
        const set=v=>{if(v)e.tema=v;else delete e.tema;dirty=true;closeSheet();autosave();draw()};
        const cl=g("#tm_clr");if(cl)cl.onclick=()=>{if(!cl.dataset.c){cl.dataset.c=1;cl.textContent="Conferma";return}set("")};
        g("#tm_ok").onclick=()=>set(g("#tm_v").value.trim());
        g("#tm_v").addEventListener("keydown",k=>{if(k.key==="Enter"){k.preventDefault();set(g("#tm_v").value.trim())}})});
    const rs=q("#rpReset");if(rs)rs.onclick=()=>{if(!rs.dataset.c){rs.dataset.c=1;rs.textContent="Conferma ripristino";return}delete e.pt;rpSel=null;dirty=true;autosave();draw()};
    const dn=q("#rpDone");if(dn)dn.onclick=()=>{rpEdit=false;rpSel=null;draw()};
    const dl=q("#rpDel");if(dl)dl.onclick=()=>{const s=rpSel;mut(P=>{P[s.t][s.i]=null});rpSel=null;draw()};
    if(!canEdit)return;
    ov.querySelectorAll("[data-ptp]").forEach(pt=>pt.addEventListener("pointerup",ev=>{if(rpEdit&&ev.target.closest(".tok"))return;const now=Date.now();
      if(now-rpTap<330){rpTap=0;rpEdit=!rpEdit;rpSel=null;draw();
        if(!red)ov.querySelectorAll(".pt-pitch").forEach(p=>p.animate([{transform:"scale(1)"},{transform:rpEdit?"scale(1.025)":"scale(.985)"},{transform:"scale(1)"}],{duration:420,easing:"cubic-bezier(.3,1.3,.5,1)"}))}
      else rpTap=now}));
    if(!rpEdit)return;
    ov.querySelectorAll("[data-pts]").forEach(b=>b.onclick=()=>{const [t,i]=b.dataset.pts.split(":").map(Number);
      if(!rpSel){rpSel={t,i};draw();return}
      if(rpSel.t===t&&rpSel.i===i){rpSel=null;draw();return}
      const a=rpSel;mut(P=>{const x=P[a.t][a.i];P[a.t][a.i]=P[t][i];P[t][i]=x});rpSel=null;draw();
      pop(`[data-pts="${t}:${i}"]`);pop(`[data-pts="${a.t}:${a.i}"]`)});
    ov.querySelectorAll("[data-ptb]").forEach(b=>b.onclick=()=>{if(!rpSel){toast("Prima tocca il posto in campo dove metterlo");return}
      const s=rpSel;mut(P=>{P[s.t][s.i]=b.dataset.ptb});rpSel=null;draw();pop(`[data-pts="${s.t}:${s.i}"]`)})};
  const editEx=i=>{const R=e.rep||[],x=R[i]||{};
    sheet(`<h3>${EXN[i]}</h3>
      <label class="field">Titolo<input id="ex_t" value="${esc(x.t||"")}" placeholder="Es. Rondo 4 contro 2" maxlength="80"></label>
      <label class="field">Descrizione<textarea id="ex_d" rows="6" placeholder="Come si svolge, durata, obiettivo…">${esc(x.d||"")}</textarea></label>
      <div class="sheet-actions">${x.t||x.d?'<button class="btn danger" id="ex_clr">Svuota</button>':"<span></span>"}<div><button class="btn" id="ex_no">Annulla</button><button class="btn primary" id="ex_ok">Fatto</button></div></div>`,
    bg=>{bg.style.zIndex=60;const g=s=>bg.querySelector(s);
      g("#ex_no").onclick=closeSheet;
      const set=v=>{const r=(e.rep||[]).slice();while(r.length<3)r.push(null);r[i]=v;e.rep=r.some(Boolean)?r:undefined;if(!e.rep)delete e.rep;dirty=true;closeSheet();autosave();draw();
        if(!red){const c=q(`[data-ex="${i}"]`);c&&c.animate([{transform:"scale(.96)",opacity:.6},{transform:"none",opacity:1}],{duration:420,easing:"cubic-bezier(.3,1.4,.5,1)"})}};
      const cl=g("#ex_clr");if(cl)cl.onclick=()=>{if(!cl.dataset.c){cl.dataset.c=1;cl.textContent="Conferma";return}set(null)};
      g("#ex_ok").onclick=()=>{const t=g("#ex_t").value.trim(),d=g("#ex_d").value.trim();set(t||d?{t,d}:null)}})};
  const close=()=>{if(!ov.id)return;ov.id="";autosave();
    const back=()=>{onClose&&onClose();if(!$("#trOpen"))lockScroll(false)};
    if(red){ov.remove();back();return}
    ov.style.pointerEvents="none";
    const top=q(".rp-top"),btn=document.querySelector("#trOpen #trRep");
    ov.querySelectorAll(".rp-sec,.evo-act,.evo-back").forEach(el=>el.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(44px) scale(.95)"}],{duration:300,easing:"cubic-bezier(.4,0,.8,.4)",fill:"forwards"}));
    if(btn&&top){const r=btn.getBoundingClientRect(),c=top.getBoundingClientRect();
      [...top.children].forEach(el=>el.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards"}));
      top.animate([{transform:"none",opacity:1},{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`,opacity:.5}],{duration:500,delay:50,easing:"cubic-bezier(.5,0,.15,1)",fill:"forwards"})}
    let ended=false;const end=()=>{if(ended)return;ended=true;ov.remove();back()};
    ov.animate([{opacity:1},{opacity:1,offset:.65},{opacity:0}],{duration:600,easing:"ease",fill:"forwards"}).onfinish=end;setTimeout(end,720)};
  draw();ov.classList.remove("static");
  /* apertura: l'intestazione nasce dal tasto Resoconto, le sezioni salgono una dopo l'altra */
  if(!red)try{const top=q(".rp-top");
    if(fromEl&&fromEl.isConnected){top.style.transformOrigin="0 0";const r=fromEl.getBoundingClientRect(),c=top.getBoundingClientRect();
      top.animate([{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`},{transform:"none"}],{duration:540,easing:E});
      [...top.children].forEach(el=>el.animate([{opacity:0},{opacity:0,offset:.4},{opacity:1}],{duration:500}))}
    ov.querySelectorAll(".rp-ex").forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(26px) scale(.96)"},{opacity:1,transform:"none"}],{duration:480,delay:160+i*70,easing:"cubic-bezier(.25,1.3,.4,1)",fill:"backwards"}));
    [...ov.querySelectorAll(".rp-sec")].slice(1).concat([q(".evo-act")]).forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(40px)"},{opacity:1,transform:"none"}],{duration:520,delay:360+i*90,easing:E,fill:"backwards"}));
    ov.querySelector(".rp-sec h4").animate([{opacity:0},{opacity:1}],{duration:400,delay:120,fill:"backwards"})}catch(_){}
  ov.addEventListener("click",ev=>{if(ev.target===ov)close()});
}
/* ---------- CONVOCAZIONI ---------- */
/* di default tutti convocati: in e.nc restano solo gli esclusi */
let cvT=null;
const TICK='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function convSplit(e){const nc=new Set(e.nc||[]),all=S.players.slice().sort(bySur);return {all,yes:all.filter(p=>!nc.has(p.id)),no:all.filter(p=>nc.has(p.id))}}
function convToggle(e,pid){const s=new Set(e.nc||[]);s.has(pid)?s.delete(pid):s.add(pid);const l=[...s].filter(id=>S.players.some(p=>p.id===id));if(l.length)e.nc=l;else delete e.nc;dirty=true;return !s.has(pid)}
function convCount(c){return `${c.yes.length}<i>/${c.all.length}</i>`}
function convView(e){const c=convSplit(e);if(!c.all.length)return "";
  return `<div class="card cv-card"><div class="cv-h"><span>Convocati</span><b>${convCount(c)}</b></div>
    ${c.yes.length?`<ul class="cv-ul">${c.yes.map(p=>`<li><span>${nameHTML(p.name)}</span></li>`).join("")}</ul>`:'<p class="ev-sub">Nessun convocato.</p>'}
    ${c.no.length?`<div class="cv-no"><div class="cv-h"><span>Non convocati</span><b>${c.no.length}</b></div><ul class="cv-ul">${c.no.map(p=>`<li><span>${nameHTML(p.name)}</span></li>`).join("")}</ul></div>`:""}</div>`}
function convEditHTML(e){const c=convSplit(e),nc=new Set(e.nc||[]);if(!c.all.length)return "";
  return `<div class="card cv-card edit"><div class="cv-h"><span>Convocati</span><b id="cvN">${convCount(c)}</b></div>
    <p class="ev-sub cv-help">Togli la spunta a chi non è convocato.</p>
    <div class="at-list">${c.all.map(p=>{const on=!nc.has(p.id);return `<button class="at-row cv-row ${on?"on":""}" data-cv="${p.id}" aria-pressed="${on}" style="--sc:${on?"var(--win)":"var(--loss)"}"><span class="at-ck" aria-hidden="true">${TICK}</span><span class="at-nm">${nameHTML(p.name)}</span></button>`}).join("")}</div></div>`}
function bindConv(root,e,after){root.querySelectorAll("[data-cv]").forEach(b=>b.onclick=()=>{if(!canEdit)return;
  const on=convToggle(e,b.dataset.cv);b.classList.toggle("on",on);b.setAttribute("aria-pressed",on);b.style.setProperty("--sc",on?"var(--win)":"var(--loss)");
  const n=root.querySelector("#cvN");if(n)n.innerHTML=convCount(convSplit(e));if(navigator.vibrate)navigator.vibrate(8);after&&after()})}
function convRow(e){const c=convSplit(e);if(!c.all.length)return "";
  return `<div class="drow cv-drow"><span class="dic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="17" rx="2.5"/><path d="M9 2.5h6v3H9z"/></svg></span><div><small>Convocati</small><div>${c.no.length?`${c.yes.length} su ${c.all.length}`:`Tutti (${c.all.length})`}</div>${c.no.length?`<p class="cv-out"><em>Non convocati</em>${c.no.map(p=>nameHTML(p.name)).join(", ")}</p>`:""}</div></div>`}
function openConv(id,fromEl){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  let edit=false;const red=reducedM()||!document.body.animate,E="cubic-bezier(.22,1,.36,1)";
  const old=$("#cvOpen");if(old)old.remove();
  const ov=document.createElement("div");ov.className="evo cvo";ov.id="cvOpen";document.body.appendChild(ov);lockScroll(true);
  const q=x=>ov.querySelector(x);
  /* le righe entrano una dopo l'altra, solo con spostamento e trasparenza */
  const stagger=d0=>ov.querySelectorAll(".cv-card > .cv-ul > li,.cv-row,.cv-no").forEach((el,i)=>el.animate([{opacity:0,transform:"translateX(-16px)"},{opacity:1,transform:"none"}],{duration:380,delay:d0+Math.min(i,13)*26,easing:E,fill:"backwards"}));
  /* apertura: l'intestazione nasce dal tasto "Convocazioni" e si allarga, l'elenco sale da sotto */
  const enter=()=>{if(red)return;const top=q(".cv-top"),card=q(".cv-card"),act=q(".evo-act");
    if(fromEl){const r=fromEl.getBoundingClientRect(),c=top.getBoundingClientRect();
      top.animate([{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`,borderRadius:"14px"},{transform:"none"}],{duration:560,easing:E});
      [...top.children].forEach(el=>el.animate([{opacity:0},{opacity:0,offset:.4},{opacity:1}],{duration:520}))}
    else top.animate([{opacity:0,transform:"translateY(-18px) scale(.95)"},{opacity:1,transform:"none"}],{duration:440,easing:E});
    if(card)card.animate([{opacity:0,transform:"translateY(56px) scale(.94)"},{opacity:1,transform:"none"}],{duration:540,delay:80,easing:E,fill:"backwards"});
    act.animate([{opacity:0,transform:"translateY(26px)"},{opacity:1,transform:"none"}],{duration:420,delay:300,easing:E,fill:"backwards"});
    const ed=q(".evo-edit");if(ed)ed.animate([{opacity:0,transform:"translateX(12px) scale(.9)"},{opacity:1,transform:"none"}],{duration:420,delay:160,easing:E,fill:"backwards"});
    stagger(210)};
  /* chiusura: l'elenco scende, l'intestazione si rimpicciolisce dentro il tasto da cui era uscita */
  const close=()=>{if(!ov.id)return;ov.id="";autosave();
    /* niente lavoro pesante prima di animare: sotto si aggiorna solo la riga "Convocati", il resto a fine animazione */
    const under=$("#evOpen"),rowEl=under&&under.querySelector(".cv-drow");if(rowEl)rowEl.outerHTML=convRow(e);
    if(!under)lockScroll(false);
    const done=()=>{ov.remove();const y=window.scrollY;anim="";render();window.scrollTo(0,y)};
    if(red){done();return}
    ov.style.pointerEvents="none";
    const top=q(".cv-top"),btn=under&&under.querySelector("#evConv");
    ov.querySelectorAll(".cv-card,.evo-act,.evo-back,.evo-edit").forEach(el=>el.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(44px) scale(.95)"}],{duration:300,easing:"cubic-bezier(.4,0,.8,.4)",fill:"forwards"}));
    if(btn){const r=btn.getBoundingClientRect(),c=top.getBoundingClientRect();
      [...top.children].forEach(el=>el.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards"}));
      top.animate([{transform:"none",opacity:1},{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`,opacity:.6}],{duration:520,delay:60,easing:"cubic-bezier(.5,0,.15,1)",fill:"forwards"});
      btn.animate([{transform:"scale(1)"},{transform:"scale(1.08)"},{transform:"scale(1)"}],{duration:360,delay:520,easing:"cubic-bezier(.3,.7,.4,1.4)"})}
    else top.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(-18px) scale(.95)"}],{duration:300,easing:"ease-in",fill:"forwards"});
    const fin=ov.animate([{opacity:1},{opacity:1,offset:.7},{opacity:0}],{duration:640,easing:"ease",fill:"forwards"});
    let ended=false;const end=()=>{if(ended)return;ended=true;done()};fin.onfinish=end;setTimeout(end,760)};
  const draw=first=>{
    ov.innerHTML=`${canEdit?`<button class="evo-edit ${edit?"on":""}" id="cv_mode">${edit?"Fine":"Modifica"}</button>`:""}<button class="evo-back" aria-label="Indietro"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="evo-in" role="dialog" aria-modal="true" aria-label="Convocazioni">
      <div class="cv-top">${crestImg(e.opponent,false)}<div><small>Convocazioni</small><b>vs ${esc(e.opponent)}</b><span>${esc(dayLabel(e.date))}, ore ${esc(e.time)} · ${e.home?"in casa":"in trasferta"}</span></div></div>
      ${edit?convEditHTML(e):convView(e)}
      <div class="evo-act">${edit?'<button class="btn primary" id="cv_done">Fatto</button>':'<button class="btn" id="cv_close">Chiudi</button>'}</div></div>`;
    if(!first)ov.classList.add("static");
    q(".evo-back").onclick=close;const c=q("#cv_close");if(c)c.onclick=close;
    /* cambio tra elenco e spunte: la scheda fa un piccolo rimbalzo e le righe rientrano a cascata */
    const tog=()=>{edit=!edit;ov.scrollTop=0;draw();if(red)return;
      const card=q(".cv-card");if(card)card.animate([{transform:"scale(.96)",opacity:.5},{transform:"none",opacity:1}],{duration:420,easing:E});
      q(".evo-act").animate([{opacity:0,transform:"translateY(14px)"},{opacity:1,transform:"none"}],{duration:360,delay:120,easing:E,fill:"backwards"});stagger(40)};
    const m=q("#cv_mode");if(m)m.onclick=tog;const dn=q("#cv_done");if(dn)dn.onclick=tog;
    if(edit)bindConv(ov,e,autosave)};
  draw(true);enter();
  ov.addEventListener("click",ev=>{if(ev.target===ov)close()});
}
/* ---------- SCHEDA PARTITA GIOCATA ---------- */
let mMenuNew=false, mEdit=false, mOpen=null, mMenu=false, mScoreEdit=false, mPick=null, mNew=null, mPickNew=false, mSeNew=false;
const NT=4;
function ensurePeriods(e){if(!Array.isArray(e.periods)||e.periods.length!==NT){const old=e.periods||[];e.periods=Array.from({length:NT},(_,i)=>old[i]||{gf:null,ga:null,scorers:[]})}return e.periods}
function aggS(list){const m=new Map();(list||[]).forEach(id=>m.set(id,(m.get(id)||0)+1));return [...m].map(([id,n])=>({id,n}))}
function syncScorers(e){const m={};e.periods.forEach(p=>(p.scorers||[]).forEach(id=>{m[id]=(m[id]||0)+1}));e.scorers=m}
function hv(e,gf,ga){return e.home?[gf,ga]:[ga,gf]}  /* da noi/loro a casa/ospiti */
function matchSheetHTML(e){
  const can=canEdit&&mEdit, P=ensurePeriods(e);
  const num=v=>v==null||v===""?"":v;
  const sumF=P.reduce((a,p)=>a+(+p.gf||0),0), sumA=P.reduce((a,p)=>a+(+p.ga||0),0), anyP=P.some(p=>p.gf!=null&&p.gf!==""||p.ga!=null&&p.ga!=="");
  const [sh,sa]=hv(e,sumF,sumA);
  const me=S.short||S.team, Hn=e.home?me:e.opponent, An=e.home?e.opponent:me;
  const scoreEditor=mScoreEdit?`<div class="card sedit ${mSeNew?"opening":""}">
      <div class="se-row"><span class="se-n">${esc(Hn)}</span><input id="se_h" type="number" min="0" inputmode="numeric" value="${num(hv(e,e.gf,e.ga)[0])}" aria-label="Gol ${esc(Hn)}"><span class="se-dash">–</span><input id="se_a" type="number" min="0" inputmode="numeric" value="${num(hv(e,e.gf,e.ga)[1])}" aria-label="Gol ${esc(An)}"><span class="se-n r">${esc(An)}</span></div>
      ${anyP?`<button class="btn small" id="se_sum">Usa la somma dei tempi (${sh}–${sa})</button>`:""}
      <div class="se-act">${played(e)?'<button class="btn small danger" id="se_clear">Cancella risultato</button>':"<span></span>"}<div><button class="btn small" id="se_cancel">Annulla</button><button class="btn small primary" id="se_ok">Conferma</button></div></div>
    </div>`:"";
  const per=(p,i)=>{const [h,a]=hv(e,p.gf,p.ga);
    const ag=aggS(p.scorers);
    const chips=can?ag.map(({id,n})=>{const pl=S.players.find(x=>x.id===id);return `<span class="schip ${mNew&&mNew[0]===i&&mNew[1]===id?"new":""}">${pl?`<b>${esc(pl.num)}</b>`:""}${esc(pname(id))}${n>1?`<em>(x${n})</em>`:""}<button class="sx" data-rm="${i}:${id}" aria-label="Togli un gol">×</button></span>`}).join("")
      :(ag.length?`<ul class="glist">${ag.map(({id,n})=>`<li>${nameHTML(pname(id))}${n>1?` <em>(x${n})</em>`:""}</li>`).join("")}</ul>`:"");
    const picker=mPick===i?`<div class="picker ${mPickNew?"opening":""}">${[...S.players].sort((a,b)=>a.num-b.num).map(pl=>`<button class="pk" data-pk="${i}:${pl.id}"><b>${esc(pl.num)}</b>${esc(pl.name)}</button>`).join("")||'<span class="ev-sub">Aggiungi prima i giocatori nella Rosa.</span>'}</div>`:"";
    return `<div class="per">
      <div class="per-h"><span class="per-t">${i+1}° tempo</span>
        <div class="per-sc">${(p.gf!=null&&p.gf!==""&&p.ga!=null&&p.ga!=="")?`<span class="res ${+p.gf>+p.ga?"V":+p.gf<+p.ga?"P":"N"}">${+p.gf>+p.ga?"V":+p.gf<+p.ga?"P":"N"}</span>`:(can?'<span class="res nil"></span>':"")}${can?`<input type="number" min="0" inputmode="numeric" data-ps="${i}:h" value="${num(h)}" aria-label="${i+1}° tempo gol ${esc(Hn)}"><span>–</span><input type="number" min="0" inputmode="numeric" data-ps="${i}:a" value="${num(a)}" aria-label="${i+1}° tempo gol ${esc(An)}">`:((h==null||h==="")&&(a==null||a==="")?`<span class="ev-sub">non inserito</span>`:`<b>${h==null||h===""?"–":h}</b><span>–</span><b>${a==null||a===""?"–":a}</b>`)}</div></div>
      <div class="per-g">${chips||(!can?'<span class="ev-sub">Nessun gol</span>':"")}${can?`<button class="addg ${mPick===i?"on":""}" data-add-g="${i}">${mPick===i?"Chiudi":"+ Marcatore"}</button>`:""}</div>
      ${picker}</div>`};
  const editBtn=canEdit?`<button class="evo-edit ${mEdit?"on":""}" id="m_mode">${mEdit?"Fine":"Modifica"}</button>`:"";
  return `${editBtn}<button class="evo-back" aria-label="Indietro"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="evo-in mso" role="dialog" aria-modal="true">
    <div class="mpres-wrap">${heroCard(e,false).replace('class="next ','class="next mpres ')}
      ${can&&mMenu&&!mScoreEdit?`<div class="mmenu ${mMenuNew?"opening":""}"><button class="btn primary" id="m_edit">Modifica risultato</button></div>`:""}
      ${can&&!mMenu&&!mScoreEdit?`<div class="mhint">Tocca la partita per modificare il risultato</div>`:""}
    </div>
    ${scoreEditor}
    <div class="card pers"><div class="pers-h"><span>Tempi</span><small>${esc(Hn)} – ${esc(An)}</small></div>${P.map(per).join("")}</div>
    ${can?convEditHTML(e):convView(e)}
    <div class="evo-act">${dirty&&canEdit?`<button class="btn bib" id="m_save">${saving?"Salvo…":"Salva"}</button>`:""}<button class="btn" id="m_close">Chiudi</button></div>
  </div>`;
}
function openMatch(id,fromEl){
  const e=S.events.find(x=>x.id===id);if(!e)return;
  mOpen=id;mMenu=false;mEdit=false;mScoreEdit=false;mPick=null;
  const old=$("#mOpen");if(old)old.remove();
  const ov=document.createElement("div");ov.className="evo";ov.id="mOpen";
  document.body.appendChild(ov);lockScroll(true);drawMatch();
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const box=ov.querySelector(".evo-in");
  if(fromEl&&!reduced&&box.animate){
    const nx=box.querySelector(".next"),r=fromEl.getBoundingClientRect(),c=nx.getBoundingClientRect();
    nx.animate([{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`,borderRadius:"18px"},{transform:"none"}],{duration:520,easing:"cubic-bezier(.22,1,.36,1)"});
    [...box.children].slice(1).forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(18px)"},{opacity:1,transform:"none"}],{duration:420,delay:140+i*60,easing:"cubic-bezier(.22,1,.36,1)",fill:"backwards"}));
  }
  ov.addEventListener("click",ev=>{if(ev.target===ov)closeMatch()});
}
function exitToRow(ov,id){
  lockScroll(false);
  const red=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const row=document.querySelector(`#app [data-match="${id}"]`);
  if(red||!ov.animate){ov.remove();if(row)row.classList.add("returned");return}
  const card=ov.querySelector(".evo-in .next"),rest=[...ov.querySelectorAll(".evo-in > :not(.mpres-wrap), .evo-back, .evo-edit, .mhint, .mmenu")];
  rest.forEach(el=>el.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateY(16px)"}],{duration:260,easing:"ease-in",fill:"forwards"}));
  if(row&&card){const r=row.getBoundingClientRect(),c=card.getBoundingClientRect();
    if(r.bottom>0&&r.top<innerHeight)card.animate([{transform:"none",opacity:1},{transform:`translate(${r.left-c.left}px,${r.top-c.top}px) scale(${r.width/c.width},${r.height/c.height})`,opacity:.15,borderRadius:"18px"}],{duration:520,easing:"cubic-bezier(.5,0,.15,1)",fill:"forwards"});
    else card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.92)"}],{duration:380,easing:"ease-in",fill:"forwards"})}
  ov.animate([{opacity:1},{opacity:1,offset:.6},{opacity:0}],{duration:540,easing:"ease",fill:"forwards"}).onfinish=()=>{ov.remove();if(row){row.classList.remove("returned");void row.offsetWidth;row.classList.add("returned")}};
}
function lockScroll(on){document.documentElement.classList.toggle("lock",on)}
function closeMatch(){const ov=$("#mOpen");if(!ov)return;ov.id="";mOpen=null;lockScroll(false);autosave();
  if(matchMedia("(prefers-reduced-motion: reduce)").matches||!ov.animate){ov.remove();return}
  ov.animate([{opacity:1},{opacity:0}],{duration:220,fill:"forwards"}).onfinish=()=>ov.remove();
  const b=ov.querySelector(".evo-in");b&&b.animate([{transform:"none"},{transform:"translateY(14px) scale(.97)"}],{duration:220,easing:"ease-in",fill:"forwards"})}
function mChanged(){dirty=true;render();drawMatch()}
function drawMatch(){
  const ov=$("#mOpen");if(!ov)return;const e=S.events.find(x=>x.id===mOpen);if(!e){closeMatch();return}
  const st=ov.scrollTop;ov.innerHTML=matchSheetHTML(e);ov.scrollTop=st;
  if(ov.dataset.drawn)ov.classList.add("static");ov.dataset.drawn=1;mNew=null;mPickNew=false;mSeNew=false;mMenuNew=false;
  const q=sel=>ov.querySelector(sel);
  q("#m_close").onclick=closeMatch;q(".evo-back").onclick=closeMatch;
  const sv=q("#m_save");if(sv)sv.onclick=async()=>{if(sv.disabled)return;
    sv.disabled=true;sv.classList.add("busy");sv.innerHTML='<span class="spin" aria-hidden="true"></span>Salva';
    clearTimeout(asT);mOpen=null;resumeBack=e.id;
    const ok=await save();resumeBack=null;
    if(ok){const o=document.querySelector(".evo");if(o)exitToRow(o,e.id)}
    else{sv.disabled=false;sv.classList.remove("busy");sv.textContent="Salva";mOpen=e.id}};
  const mm=q("#m_mode");if(mm)mm.onclick=()=>{mEdit=!mEdit;mMenu=false;mPick=null;mScoreEdit=mEdit&&!played(e);mSeNew=mScoreEdit;ov.classList.remove("static");ov.dataset.drawn="";drawMatch();
    const b=ov.querySelector(".evo-in");if(b&&b.animate&&!matchMedia("(prefers-reduced-motion: reduce)").matches)[...b.children].slice(1).forEach((el,i)=>el.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"none"}],{duration:380,delay:i*50,easing:"cubic-bezier(.22,1,.36,1)",fill:"backwards"}))};
  if(!canEdit||!mEdit)return;
  bindConv(ov,e,()=>{clearTimeout(cvT);cvT=setTimeout(()=>{if(mOpen!==e.id)return;render();if(!ov.querySelector("#m_save"))drawMatch()},340)});
  const pres=q(".mpres");pres.classList.add("tap");pres.onclick=()=>{if(mScoreEdit)return;
    const red=matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(mMenu){const mn=q(".mmenu");if(mn&&mn.animate&&!red){mn.animate([{maxHeight:mn.offsetHeight+"px",opacity:1,transform:"none"},{maxHeight:"0px",opacity:0,transform:"translateY(-8px) scale(.96)"}],{duration:260,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"}).onfinish=()=>{mMenu=false;drawMatch()};return}mMenu=false;drawMatch();return}
    mMenu=true;mMenuNew=true;
    if(pres.animate&&!red)pres.animate([{transform:"scale(1)"},{transform:"scale(.97)"},{transform:"scale(1)"}],{duration:320,easing:"cubic-bezier(.3,.7,.4,1.4)"});
    drawMatch()};
  const me=q("#m_edit");if(me)me.onclick=()=>{const mn=q(".mmenu");if(mn&&mn.animate&&!matchMedia("(prefers-reduced-motion: reduce)").matches){mn.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.9)"}],{duration:180,easing:"ease-in",fill:"forwards"}).onfinish=()=>{mScoreEdit=true;mSeNew=true;mMenu=false;drawMatch()};return}mScoreEdit=true;mSeNew=true;mMenu=false;drawMatch();};
  if(mScoreEdit){
    const back=()=>{const se=q(".sedit");if(se&&se.animate&&!matchMedia("(prefers-reduced-motion: reduce)").matches){se.animate([{maxHeight:se.offsetHeight+"px",opacity:1},{maxHeight:"0px",opacity:0,paddingTop:"0px",paddingBottom:"0px"}],{duration:300,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"}).onfinish=()=>{mScoreEdit=false;drawMatch()};return}mScoreEdit=false;drawMatch()};
    q("#se_cancel").onclick=back;
    q("#se_ok").onclick=()=>{const h=q("#se_h").value,a=q("#se_a").value;
      if(h===""||a===""){(h===""?q("#se_h"):q("#se_a")).focus();return}
      const [gf,ga]=e.home?[+h,+a]:[+a,+h];e.gf=gf;e.ga=ga;mScoreEdit=false;mChanged()};
    const su=q("#se_sum");if(su)su.onclick=()=>{const P=e.periods;const f=P.reduce((x,p)=>x+(+p.gf||0),0),a=P.reduce((x,p)=>x+(+p.ga||0),0);const [h,aw]=hv(e,f,a);q("#se_h").value=h;q("#se_a").value=aw};
    const cl=q("#se_clear");if(cl)cl.onclick=()=>{if(!cl.dataset.c){cl.dataset.c=1;cl.textContent="Conferma";return}e.gf=null;e.ga=null;mScoreEdit=false;mChanged()};
  }
  ov.querySelectorAll("[data-ps]").forEach(inp=>inp.onchange=()=>{const [i,side]=inp.dataset.ps.split(":");const p=e.periods[+i];
    const v=inp.value===""?null:+inp.value;const ours=(side==="h")===!!e.home;if(ours)p.gf=v;else p.ga=v;mChanged()});
  ov.querySelectorAll("[data-add-g]").forEach(b=>b.onclick=()=>{const i=+b.dataset.addG;
    if(mPick===i){const pk=ov.querySelector(".picker");if(pk&&pk.animate&&!matchMedia("(prefers-reduced-motion: reduce)").matches){pk.animate([{maxHeight:pk.offsetHeight+"px",opacity:1},{maxHeight:"0px",opacity:0}],{duration:260,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"}).onfinish=()=>{mPick=null;drawMatch()};return}mPick=null;drawMatch();return}
    mPick=i;mPickNew=true;drawMatch()});
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  ov.querySelectorAll("[data-pk]").forEach(b=>b.onclick=()=>{const [i,id]=b.dataset.pk.split(":");const p=e.periods[+i];(p.scorers=p.scorers||[]).push(id);syncScorers(e);
    b.classList.add("chosen");
    const fin=()=>{mPick=null;mNew=[+i,id];mChanged()};
    const pk=ov.querySelector(".picker");if(pk&&pk.animate&&!reduced){pk.animate([{maxHeight:pk.offsetHeight+"px",opacity:1},{maxHeight:"0px",opacity:0}],{duration:280,delay:120,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"}).onfinish=fin}else fin()});
  ov.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{const [ii,id]=b.dataset.rm.split(":");const i=+ii;const arr=e.periods[i].scorers;const k=arr.lastIndexOf(id);const last=arr.filter(x=>x===id).length===1;
    const fin=()=>{if(k>=0)arr.splice(k,1);syncScorers(e);mChanged()};
    if(!last){fin();return}
    const c=b.closest(".schip");if(c&&c.animate&&!reduced){c.animate([{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(.6)"}],{duration:220,easing:"ease-in",fill:"forwards"}).onfinish=fin}else fin()});
}

function queue(list){
  if(!list.length)return "";
  return `<div class="queue">${list.map((e,k)=>{const d=pd(e.date);const isM=e.type==="partita";
    const tag="button";
    return `<${tag} class="qitem row-btn" style="--k:${k}" data-open="${e.id}">
      <div class="q-date"><b>${d.getDate()}</b><small>${GG[d.getDay()]}</small></div>
      <div class="q-main">${isM?`<div class="q-title">${crestImg(e.opponent,false,"sm")}<span>vs ${esc(e.opponent)}</span></div>`:`<div class="q-title"><span>Allenamento</span></div>`}
        <div class="q-sub">ore ${esc(e.time)}${e.end?"–"+esc(e.end):""}${isM?` · ${e.home?"in casa":"trasferta"}`:""}</div></div>
      <span class="tag ${isM?"p":""}">${isM?"Partita":"Allen."}</span></${tag}>`}).join("")}</div>`;
}

const ROLEKEY={"Portiere":"por","Difensore":"dif","Centrocampista":"cen","Attaccante":"att"};
function jersey(p){
  const gk=p.role==="Portiere", id=gk?"kg":"kb";
  const c1=gk?"#f0473a":"#2a4fd0", c2=gk?"#9e1a14":"#0e1d68", num="#ffffff", ns=gk?"#5c0d09":"#0b1650";
  return `<svg class="jersey" viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".22" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient><radialGradient id="hl"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <path d="M37 9 L28 12 L8 25 L15 44 L26 39 L26 91 Q50 96 74 91 L74 39 L85 44 L92 25 L72 12 L63 9 Q50 20 37 9Z" fill="url(#${id})"/>
    <path d="M37 9 L28 12 L8 25 L15 44 L26 39 L26 91 Q50 96 74 91 L74 39 L85 44 L92 25 L72 12 L63 9 Q50 20 37 9Z" fill="url(#sh)"/>
    <path d="M37 9 Q50 20 63 9 Q50 25 37 9Z" fill="#000" fill-opacity=".28"/>
    <ellipse cx="42" cy="40" rx="17" ry="22" fill="url(#hl)"/>
    <path d="M26 39 Q28 62 26 91 L31 91 Q33 62 31 41Z" fill="#000" fill-opacity=".14"/>
    <path d="M74 39 Q72 62 74 91 L69 91 Q67 62 69 41Z" fill="#000" fill-opacity=".18"/>
    <path d="M28 12 L26 39 L15 44 L8 25Z" fill="#fff" fill-opacity=".07"/>
    <path d="M72 12 L74 39 L85 44 L92 25Z" fill="#000" fill-opacity=".16"/>
    <path d="M30 80 Q50 86 70 80 L74 91 Q50 96 26 91Z" fill="#000" fill-opacity=".12"/>
    <text x="50" y="56" text-anchor="middle" dominant-baseline="middle" font-family="Outfit,system-ui,sans-serif" font-weight="800" font-size="${String(p.num).length>1?36:42}" fill="${num}" stroke="${ns}" stroke-width="1.6" paint-order="stroke" letter-spacing="-1">${esc(p.num)}</text>
  </svg>`;
}

/* ---------- PARTITE ---------- */
function vPartite(){
  const ms=sorted().filter(e=>e.type==="partita");
  const nowT=new Date().toTimeString().slice(0,5);
  const past=e=>e.date<todayISO||(e.date===todayISO&&e.time<=nowT);
  const todo=ms.filter(e=>!played(e)&&!past(e)), done=ms.filter(e=>played(e)||past(e)).reverse();
  const add=canEdit?'<button class="btn small primary addbtn" data-add="match">+ Partita</button>':"";
  const tally=k=>done.filter(e=>played(e)&&res(e)===k).length;
  return `${done.some(played)?`<section><h2>Bilancio</h2><div class="totals">
    <div class="card tot"><b style="color:var(--win)">${tally("V")}</b><span>Vinte</span></div>
    <div class="card tot"><b style="color:var(--draw)">${tally("N")}</b><span>Pareggiate</span></div>
    <div class="card tot"><b style="color:var(--loss)">${tally("P")}</b><span>Perse</span></div></div></section>`:""}
  <section><h2>Da giocare · ${todo.length} ${add}</h2>
    <div class="mlist">${monthList(todo,`<div class="card empty">Nessuna partita in programma${canEdit?". Tocca + Partita per aggiungerne una.":"."}</div>`).replace('class="mrow mcard st-next"','class="mrow mcard st-next is-next"')}</div></section>
  <section><h2>Giocate · ${done.length}</h2>
    <div class="mlist">${monthList(done,'<div class="card empty">Ancora nessuna partita giocata.</div>')}</div></section>`;
}

/* ---------- ROSA ---------- */
function goalsMap(){const m={};S.events.filter(e=>e.type==="partita").forEach(e=>Object.entries(e.scorers||{}).forEach(([id,n])=>{n=+n||0;if(n>0)m[id]=(m[id]||0)+n}));return m}
let plOpen=null;
/* posizioni specifiche in campo */
const POS={ATT:"Punta",POR:"Portiere",TS:"Terzino sinistro",DC:"Difensore centrale",TD:"Terzino destro",AS:"Ala sinistra",CC:"Centrocampista centrale",AD:"Ala destra",PS:"Punta sinistra",PD:"Punta destra"};
const POSS={ATT:"Punta",POR:"Portiere",TS:"Terzino sx",DC:"Dif. centrale",TD:"Terzino dx",AS:"Ala sx",CC:"Centrocampista",AD:"Ala dx",PS:"Punta sx",PD:"Punta dx"};
const POSCOL=k=>k==="POR"?"#f0a21e":/^(TS|DC|TD)$/.test(k)?"#22a35a":/^(AS|CC|AD)$/.test(k)?"#2f6fe0":"#e0453a";
const POSROWS=[["PS","PD"],["AS","CC","AD"],["TS","DC","TD"],["POR"]];
const ROLEPOS={Portiere:["POR"],Difensore:["TS","DC","TD"],Centrocampista:["AS","CC","AD"],Attaccante:["PS","PD"]};
const SLOTPOS={"3-3-2":["POR","TS","DC","TD","AS","CC","AD","PS","PD"],"3-2-3":["POR","TS","DC","TD","CC","CC","AS","PD","AD"],
  "2-3-3":["POR","DC","DC","AS","CC","AD","PS","PD","PD"],"3-4-1":["POR","TS","DC","TD","AS","CC","CC","AD","PD"],"2-4-2":["POR","DC","DC","AS","CC","CC","AD","PS","PD"]};
/* 2 = posizione principale, 1 = alternativa, 0 = fuori ruolo */
function fit(p,k){if(!p||!k)return null;if(k==="ATT")return Math.max(fit(p,"PS"),fit(p,"PD"));const a=p.pos1||[],b=p.pos2||[];
  if(a.length||b.length)return a.includes(k)?2:b.includes(k)?1:0;
  return (ROLEPOS[p.role]||[]).includes(k)?2:(ROLEPOS[p.role2]||[]).includes(k)?1:0}
function posChips(p){const a=p.pos1||[],b=(p.pos2||[]).filter(k=>!a.includes(k));
  if(!a.length&&!b.length)return '<span class="ev-sub">Non ancora indicate</span>';
  return a.map(k=>`<span class="pchip" style="--c:${POSCOL(k)}">${POSS[k]}</span>`).join("")+b.map(k=>`<span class="pchip alt" style="--c:${POSCOL(k)}">${POSS[k]}</span>`).join("")}
const PLUR={Portiere:"Portieri",Difensore:"Difensori",Centrocampista:"Centrocampisti",Attaccante:"Attaccanti"};
const RCOL={Portiere:"#f0a21e",Difensore:"#22a35a",Centrocampista:"#2f6fe0",Attaccante:"#e0453a"};
function nameHTML(n){n=String(n||"").trim();const i=n.indexOf(" ");return i<0?esc(n):`${esc(n.slice(0,i))} <b class="sur">${esc(n.slice(i+1))}</b>`}
function rolesHTML(p){const r1=p.role||"Centrocampista",r2=p.role2&&p.role2!==r1?p.role2:"";
  return `<div class="pl-roles"><span class="rpill" style="--c:${RCOL[r1]}">${esc(r1)}</span>${r2?`<span class="rpill alt" style="--c:${RCOL[r2]}">${esc(r2)}</span>`:""}</div>`}
function roleTxt(p){return p.role2&&p.role2!==p.role?`${p.role} · ${p.role2}`:p.role}
function vRosa(){
  const g=goalsMap();
  const groups=ROLES.map(r=>({r,ps:S.players.filter(p=>p.role===r).sort((a,b)=>a.num-b.num)})).filter(x=>x.ps.length);
  const topG=Math.max(0,...Object.values(g));
  const BALL='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.8 2.8-1.4 4.5H9.6l-1.4-4.5z" fill="currentColor"/></svg>';
  const STAR='<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  const byMatch=id=>S.events.filter(e=>e.type==="partita"&&(e.scorers||{})[id]>0).sort((a,b)=>a.date.localeCompare(b.date));
  const BIN='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  const PEN='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  const item=p=>{const ms=byMatch(p.id);const open=plOpen===p.id;
    return `<div class="plw ${open?"open":""}" data-plw="${p.id}">
      ${canEdit?`<div class="pl-acts"><button class="pl-act" data-edit-pl="${p.id}" aria-label="Modifica ${esc(p.name)}" tabindex="-1">${PEN}<span>Modifica</span></button><button class="pl-act del" data-del-pl="${p.id}" aria-label="Elimina ${esc(p.name)}" tabindex="-1">${BIN}<span>Elimina</span></button></div>`:""}
      <div class="card pl r-${ROLEKEY[p.role]||"cen"}" data-pl="${p.id}" role="button" tabindex="0" aria-expanded="${open}">
        <span class="pl-wm" aria-hidden="true">${esc(p.num)}</span>
        ${jersey(p)}<div><div class="pl-name">${nameHTML(p.name)}</div>${rolesHTML(p)}</div>${g[p.id]?`<span class="goalb ${g[p.id]===topG?"top":""}" title="Gol segnati">${g[p.id]===topG?STAR:BALL}<b>${g[p.id]}</b></span>`:""}
      </div>
      <div class="pl-det"><div class="pl-det-in"><div class="card pl-rep" style="--rc:${RCOL[p.role]}">
        <div class="rep-grid">
          <div><small>Nome</small><b class="rn">${nameHTML(p.name)}</b></div>
          <div><small>Numero</small><b>${esc(p.num)}</b></div>
          <div><small>Ruolo</small><b><i style="background:${RCOL[p.role]}"></i>${esc(p.role)}</b></div>
          ${p.role2&&p.role2!==p.role?`<div><small>Secondo ruolo</small><b><i style="background:${RCOL[p.role2]}"></i>${esc(p.role2)}</b></div>`:""}
          <div class="rep-pos"><small>Posizioni in campo ${canEdit?`<button class="rep-ed" data-edit-pl="${p.id}">Modifica</button>`:""}</small><div class="pchips">${posChips(p)}</div>
            ${(p.pos2||[]).length?'<span class="pleg"><i></i>principale <i class="d"></i>alternativa</span>':""}</div>
        </div>
        ${(()=>{const a=playerAtt(p.id);return a.tot?`<div class="rep-att"><div><small>Presenze allenamenti</small><b>${a.pres}<i>/${a.tot}</i> <em>${Math.round(a.pres/a.tot*100)}%</em></b></div><div><small>RPE medio</small><b style="color:${RPEC(a.rpe==null?null:Math.round(a.rpe))}">${a.rpe==null?"–":a.rpe.toFixed(1)}</b></div></div>`:""})()}
        <div class="rep-goals"><div class="rg-h"><small>Gol stagione</small><b>${g[p.id]||0}</b></div>
          ${ms.length?`<div class="rg-list">${ms.map(e=>{const d=pd(e.date);return `<div><span>${crestImg(e.opponent,false,"sm")}vs ${esc(e.opponent)}</span><span class="rg-d">${d.getDate()} ${MESI[d.getMonth()].slice(0,3)}</span><b>${e.scorers[p.id]}</b></div>`}).join("")}</div>`:'<div class="ev-sub">Ancora nessun gol in partita.</div>'}
        </div>
      </div></div></div>
    </div>`};
  return `<section><h2>Rosa · ${S.players.length} giocatori ${canEdit?'<button class="btn small primary addbtn" data-add="player">+ Giocatore</button>':""}</h2>
  ${S.players.length?`<div class="rsum">${ROLES.map(r=>{const n=S.players.filter(p=>p.role===r).length;return `<button class="rsum-t" style="--c:${RCOL[r]}" data-jump="${r}"><b>${n}</b><span>${PLUR[r]}</span></button>`}).join("")}</div>`:""}
  ${canEdit&&S.players.length?'<p class="ev-sub rhint">Tocca un giocatore per il resoconto, trascinalo verso sinistra per modificarlo.</p>':""}
  <div class="role-group">${groups.map(x=>`<h3 id="rg-${ROLEKEY[x.r]}" style="--rc:${RCOL[x.r]}"><span>${PLUR[x.r]}</span><em>${x.ps.length}</em></h3>
    <div class="players">${x.ps.map(item).join("")}</div>`).join("")}
  ${!S.players.length?'<div class="card empty">Nessun giocatore. Tocca + Giocatore per aggiungerne uno.</div>':""}
  ${(S.staff||[]).length?`<h3 style="--rc:var(--pitch)"><span>Mister</span><em>${S.staff.length}</em></h3>
    <div class="staff">${S.staff.map(n=>`<div class="st-row"><span class="st-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="17" rx="2.5"/><path d="M9 3h6v3H9z"/><path d="M9 11h6M9 15h4"/></svg></span><span class="pl-name">${nameHTML(n)}</span></div>`).join("")}</div>`:""}</div></section>`;
}
function bindRosa(){
  if(tab!=="rosa")return;
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>{const h=document.getElementById("rg-"+ROLEKEY[b.dataset.jump]);if(!h)return;
    const y=h.getBoundingClientRect().top+window.scrollY-90;window.scrollTo({top:y,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})});
  const W=170;
  document.querySelectorAll("[data-del-pl]").forEach(b=>b.onclick=()=>{
    if(!b.classList.contains("confirm")){b.classList.add("confirm");b.querySelector("span").textContent="Conferma";return}
    const id=b.dataset.delPl;S.players=S.players.filter(x=>x.id!==id);
    const clear=t=>{if(!t)return;t.slots&&t.slots.forEach(sl=>{if(sl.pid===id)sl.pid=null});t.periods&&t.periods.forEach(clear)};clear(S.tactic);Object.values(S.tactics||{}).forEach(clear);
    const w=b.closest(".plw");if(w&&w.animate&&!matchMedia("(prefers-reduced-motion: reduce)").matches){w.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateX(-40px)"}],{duration:260,easing:"ease-in",fill:"forwards"}).onfinish=()=>changed()}else changed()});
  const closeAll=except=>document.querySelectorAll(".plw.swiped").forEach(w=>{if(w!==except){w.classList.remove("swiped");w.querySelector(".pl").style.transform="";const d=w.querySelector(".pl-act.del");if(d){d.classList.remove("confirm");d.querySelector("span").textContent="Elimina"}}});
  document.querySelectorAll("[data-pl]").forEach(card=>{
    const w=card.closest(".plw"), id=card.dataset.pl;let st=null;
    const toggle=()=>{if(w.classList.contains("swiped")){closeAll(null);return}
      const was=w.classList.contains("open");document.querySelectorAll(".plw.open").forEach(x=>{x.classList.remove("open");x.querySelector(".pl").setAttribute("aria-expanded","false")});
      if(!was){w.classList.add("open");card.setAttribute("aria-expanded","true");plOpen=id}else plOpen=null};
    card.onkeydown=k=>{if(k.key==="Enter"||k.key===" "){k.preventDefault();toggle()}};
    card.onpointerdown=e=>{st={x:e.clientX,y:e.clientY,base:w.classList.contains("swiped")?-W:0,mode:null,id:e.pointerId,lx:e.clientX,lt:performance.now(),v:0}};
    card.onpointermove=e=>{if(!st)return;const dx=e.clientX-st.x,dy=e.clientY-st.y;
      const now=performance.now();st.v=(e.clientX-st.lx)/Math.max(8,now-st.lt);st.lx=e.clientX;st.lt=now;
      if(!st.mode){if(Math.abs(dx)<4&&Math.abs(dy)<4)return;st.mode=(canEdit&&Math.abs(dx)>Math.abs(dy)*.7)?"x":"y";if(st.mode==="x"){try{card.setPointerCapture(st.id)}catch(_){}card.classList.add("dragging");closeAll(w)}}
      if(st.mode!=="x")return;let x=Math.min(0,st.base+dx*1.25);if(x<-W)x=-W+(x+W)*.3;card.style.transform=`translateX(${x}px)`;st.cx=x};
    const up=()=>{if(!st)return;const s0=st;st=null;card.classList.remove("dragging");
      if(!s0.mode){toggle();return}
      if(s0.mode!=="x")return;
      const cx=s0.cx??s0.base, opening=s0.base===0;
      if(opening?(cx<-34||s0.v<-.35):(cx<-W+40&&s0.v<.35)){w.classList.add("swiped");card.style.transform=`translateX(${-W}px)`}else{w.classList.remove("swiped");card.style.transform=""}};
    card.onpointerup=up;card.onpointercancel=()=>{if(st&&st.mode==="x"){st.mode="x";up()}else st=null};
  });
}

/* ---------- MARCATORI ---------- */
function vMarcatori(){
  const g=goalsMap();
  const list=Object.entries(g).map(([id,n])=>({id,n,name:pname(id),num:(S.players.find(p=>p.id===id)||{}).num})).sort((a,b)=>b.n-a.n||bySur(a,b));
  const pl=S.events.filter(played);
  const gf=pl.reduce((s,e)=>s+(+e.gf||0),0), ga=pl.reduce((s,e)=>s+(+e.ga||0),0);
  const max=list[0]?list[0].n:1;
  const top=[list[1],list[0],list[2]];
  const pod=list.length?`<div class="podium">${top.map((x,i)=>{const r=[2,1,3][i];return x?`<div class="pod r${r}"><span class="rk">${r}°</span><span class="g">${x.n}</span><span class="n">${esc(x.name)}</span></div>`:"<div></div>"}).join("")}</div>`:"";
  return `<section><h2>Classifica marcatori</h2>${pod}
  <div class="card list" style="margin-top:10px">${list.map((x,i)=>`<div class="sc-row"><span class="rk">${i+1}</span>
    <div style="min-width:0"><div class="pl-name">${x.num!=null?"("+esc(x.num)+") ":""}${esc(x.name)}</div><div class="bar" style="width:${Math.max(6,x.n/max*100)}%"></div></div>
    <span class="g">${x.n}</span></div>`).join("")||'<div class="empty">Ancora nessun gol. I marcatori si aggiungono dal risultato di ogni partita.</div>'}</div>
  </section>`;
}

/* ---------- TATTICA ---------- */
const MODULI={ /* calcio a 9: portiere + 8. y = distanza dalla nostra porta (0-100), x = da sinistra */
 "3-3-2":[[50,7],[20,26],[50,24],[80,26],[18,50],[50,48],[82,50],[34,67],[65,76]],
 "3-2-3":[[50,7],[20,26],[50,24],[80,26],[35,48],[65,48],[16,72],[50,76],[84,72]],
 "2-3-3":[[50,7],[30,25],[70,25],[16,48],[50,46],[84,48],[16,72],[50,76],[84,72]],
 "3-4-1":[[50,7],[20,26],[50,24],[80,26],[12,50],[37,48],[63,48],[88,50],[50,76]],
 "2-4-2":[[50,7],[30,25],[70,25],[12,50],[37,48],[63,48],[88,50],[35,74],[65,74]]};
let tSel=null, tMatch=null, tPer=0, tEdit=false, tLastTap=0, tCapMode=null;
const tHist={};
try{Object.assign(tHist,JSON.parse(sessionStorage.getItem("abd-thist")||"{}"))}catch(_){}
function saveHist(){try{sessionStorage.setItem("abd-thist",JSON.stringify(tHist))}catch(_){}}
const clone=o=>JSON.parse(JSON.stringify(o));
const reducedM=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
function futureMatches(){const nowT=new Date().toTimeString().slice(0,5);
  return sorted().filter(e=>e.type==="partita"&&!played(e)&&(e.date>todayISO||(e.date===todayISO&&e.time>nowT)))}
/* ogni partita ha 4 formazioni, una per tempo; un tempo nuovo parte dalla copia del precedente */
function tacOf(mid,upto){ensureTactic();S.tactics=S.tactics||{};let t=S.tactics[mid];
  if(!t)t=S.tactics[mid]={periods:[{module:S.tactic.module,slots:clone(S.tactic.slots)}],note:""};
  else if(!t.periods)t=S.tactics[mid]={periods:[{module:t.module,slots:t.slots}],note:t.note||""};
  for(let i=1;i<=(upto||0);i++)if(!t.periods[i])t.periods[i]=clone(t.periods[i-1]);
  return t}
function getT(){return tacOf(tMatch,tPer).periods[tPer]}
function hk(){return tMatch+":"+tPer}
function hist(){return tHist[hk()]||(tHist[hk()]={p:[],f:[]})}
function pushHist(){const h=hist();h.p.push(JSON.stringify(getT()));if(h.p.length>40)h.p.shift();h.f=[];saveHist();
  const T=getT();if(T.sug){delete T.sug;const b=document.querySelector(".sugg");if(b){b.classList.add("out");setTimeout(()=>b.remove(),260)}}}
const HZ=()=>!!(window.matchMedia&&matchMedia("(orientation: landscape) and (min-width:600px)").matches);
/* in orizzontale il campo si gira: la nostra porta a sinistra, l'attacco a destra */
function tokXY(x,y){return HZ()?`left:${(8+y*.85).toFixed(2)}%;top:${(4+x*.92).toFixed(2)}%`:`left:${x}%;top:${100-y}%`}
function tokPos(){return [...document.querySelectorAll("[data-slot]")].map(el=>[el.style.left,el.style.top])}
function flipTok(prev){if(reducedM()||!prev)return;
  document.querySelectorAll("[data-slot]").forEach((el,i)=>{if(!prev[i])return;const nl=el.style.left,nt=el.style.top;
    if(nl===prev[i][0]&&nt===prev[i][1])return;
    el.style.transition="none";el.style.left=prev[i][0];el.style.top=prev[i][1];void el.offsetWidth;
    el.style.transition="";requestAnimationFrame(()=>{el.style.left=nl;el.style.top=nt})})}
function tChanged(){dirty=true;S.tactic={module:getT().module,slots:clone(getT().slots)};
  if(!tEdit){clearTimeout(asT);asT=setTimeout(()=>{if(dirty&&!saving)save()},1200)}}
function ensureTactic(){
  if(S.tactic&&S.tactic.slots)return;
  const srt=(a,b)=>ROLES.indexOf(a.role)-ROLES.indexOf(b.role)||a.num-b.num;
  const gk=S.players.filter(p=>p.role==="Portiere").sort(srt)[0];
  const order=[gk,...S.players.filter(p=>p.role!=="Portiere").sort(srt)].filter(Boolean);
  S.tactic={module:"3-3-2",note:"",slots:MODULI["3-3-2"].map((p,i)=>({x:p[0],y:p[1],pid:order[i]?order[i].id:null}))};
}
function miniForm(m){const pts=MODULI[m];
  return `<svg class="mf" viewBox="0 0 40 54" aria-hidden="true"><rect x="1" y="1" width="38" height="52" rx="4"/><line x1="1" y1="27" x2="39" y2="27"/><rect x="12" y="45" width="16" height="8"/>
    ${pts.map((p,i)=>`<circle cx="${(p[0]*.38+1).toFixed(1)}" cy="${((100-p[1])*.5+2).toFixed(1)}" r="${i===0?2.6:2.9}" class="${i===0?"g":""}"/>`).join("")}</svg>`}
function vTattica(){
  const fm=futureMatches();
  if(!fm.length)return `<section><h2>Tattica</h2><div class="card empty">Nessuna partita in programma. Quando aggiungi le prossime partite, qui potrai preparare la formazione per ognuna.</div></section>`;
  if(!fm.some(e=>e.id===tMatch))tMatch=fm[0].id;
  const M=fm.find(e=>e.id===tMatch);
  const TM=tacOf(tMatch,tPer), T=TM.periods[tPer], can=canEdit, ed=can&&tEdit, H=hist();
  const me=S.short||S.team, L=S.logos||{};
  const chips=`<div class="mbar" id="mbar">${fm.map((e,i)=>{const d=pd(e.date);return `<button class="mchip ${e.id===tMatch?"on":""}" data-tm="${e.id}">
      <span class="mc-crests">${crestImg(e.home?me:e.opponent,e.home,"sm")}${crestImg(e.home?e.opponent:me,!e.home,"sm")}</span>
      <span class="mc-t"><b>${esc(e.opponent)}</b><small>${i===0?"Prossima · ":""}${GG[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()].slice(0,3)}</small></span></button>`}).join("")}</div>`;
  const onField=new Set(T.slots.map(x=>x.pid).filter(Boolean));
  const filled=T.slots.filter(x=>x.pid&&S.players.some(p=>p.id===x.pid)).length;
  const bench=S.players.filter(p=>!onField.has(p.id)).sort((a,b)=>ROLES.indexOf(a.role)-ROLES.indexOf(b.role)||a.num-b.num);
  const d=pd(M.date);
  const hero=`<div class="thero">
      ${MATCHBG?`<div class="th-bg" style="background-image:url('${MATCHBG}')"></div>`:""}
      <div class="th-top"><span>${esc(M.note&&/^Giornata/.test(M.note)?M.note:"Partita")}</span><span>${GG[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()].slice(0,3)} · ${esc(M.time)}</span></div>
      <div class="th-vs">
        <div class="th-t">${crestImg(M.home?me:M.opponent,M.home)}<span>${esc(M.home?me:M.opponent)}</span></div>
        <b>VS</b>
        <div class="th-t">${crestImg(M.home?M.opponent:me,!M.home)}<span>${esc(M.home?M.opponent:me)}</span></div>
      </div>
      <div class="th-stats">
        <div><b>${esc(T.module)}</b><small>Modulo</small></div>
        <div><b>${filled}<i>/9</i></b><small>In campo</small></div>
        <div><b>${bench.length}</b><small>Panchina</small></div>
        <div><b>${M.home?"Casa":"Trasf."}</b><small>Dove</small></div>
      </div>
    </div>`;
  const SP=SLOTPOS[T.module]||[];
  const tok=(sl,i)=>{const p=S.players.find(x=>x.id===sl.pid);const k=SP[i],f=p?fit(p,k):null;
    const surname=p?(p.name.includes(" ")?p.name.slice(p.name.indexOf(" ")+1):p.name):"";
    return `<button class="tok ${i===0?"gk":""} ${p?"":"empty"} ${tSel===i?"sel":""}" data-slot="${i}" style="${tokXY(sl.x,sl.y)};--rc:${p?RCOL[p.role]:"#fff"}" ${ed?"":"disabled tabindex=\"-1\""} aria-label="${p?esc(p.name):"Posto libero"}">
      <span class="tok-sh" aria-hidden="true"></span>${p&&TM.cap===p.id?`<span class="tok-cap" title="Capitano">C</span>`:p&&TM.vice===p.id?`<span class="tok-cap v" title="Vice capitano">VC</span>`:""}${k?`<span class="tok-pos f${f==null?"x":f}" title="${esc(POS[k])}">${k}</span>`:""}
      <span class="tok-n">${p?jersey(i===0?{...p,role:"Portiere"}:{...p,role:p.role==="Portiere"?"Difensore":p.role}):"+"}</span>
      <span class="tok-l">${p?esc(surname):"Libero"}</span></button>`};
  return `<section class="tsec"><h2>Partita</h2>${chips}${hero}</section>
  <section><h2>Modulo · ${tPer+1}° tempo</h2>
    <div class="mods">${Object.keys(MODULI).map(m=>`<button class="mod ${T.module===m?"on":""}" data-mod="${m}" ${can?"":"disabled"}>${miniForm(m)}<span>${m}</span></button>`).join("")}</div></section>
  <section><h2>Tempo</h2>
    <div class="tper" style="--i:${tPer}"><span class="tper-ind" aria-hidden="true"></span>${[0,1,2,3].map(i=>`<button class="${i===tPer?"on":""}" data-per="${i}"><b>${i+1}°</b><small>${TM.periods[i]?esc(TM.periods[i].module):"—"}</small></button>`).join("")}</div></section>
  <section><h2 class="h-form">${T.sug?"Formazione":`Formazione · ${tPer+1}° tempo`}${T.sug?`<span class="sugg">Consigliata</span>`:""}${can?`<span class="hist"><button id="tUndo" aria-label="Annulla" ${H.p.length?"":"disabled"}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button><button id="tRedo" aria-label="Ripeti" ${H.f.length?"":"disabled"}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button></span>`:""}</h2>
    <div class="pitch ${ed?"editing":""} ${HZ()?"hz":""}" id="pitch">
      <div class="p-crest" style="background-image:url('${L[S.team]||LOGO}')" aria-hidden="true"></div>
      <svg class="pitch-lines hz-l" viewBox="0 0 90 60" preserveAspectRatio="none" aria-hidden="true">
        <rect x="3" y="3" width="84" height="54" rx="1"/><line x1="45" y1="3" x2="45" y2="57"/><circle cx="45" cy="30" r="7.5"/>
        <rect x="3" y="16" width="13" height="28"/><rect x="3" y="24" width="5" height="12"/><path d="M16 24 Q20.5 30 16 36"/>
        <rect x="74" y="16" width="13" height="28"/><rect x="82" y="24" width="5" height="12"/><path d="M74 24 Q69.5 30 74 36"/>
        <rect x="1.2" y="26" width="1.8" height="8" class="goal"/><rect x="87" y="26" width="1.8" height="8" class="goal"/>
        <circle cx="45" cy="30" r=".7" class="dot"/></svg>
      <svg class="pitch-lines vt-l" viewBox="0 0 60 90" preserveAspectRatio="none" aria-hidden="true">
        <rect x="3" y="3" width="54" height="84" rx="1"/><line x1="3" y1="45" x2="57" y2="45"/><circle cx="30" cy="45" r="7.5"/>
        <rect x="16" y="3" width="28" height="13"/><rect x="24" y="3" width="12" height="5"/><path d="M24 16 Q30 20.5 36 16"/>
        <rect x="16" y="74" width="28" height="13"/><rect x="24" y="82" width="12" height="5"/><path d="M24 74 Q30 69.5 36 74"/>
        <rect x="26" y="1.2" width="8" height="1.8" class="goal"/><rect x="26" y="87" width="8" height="1.8" class="goal"/>
        <circle cx="30" cy="45" r=".7" class="dot"/><circle cx="30" cy="11.5" r=".5" class="dot"/><circle cx="30" cy="78.5" r=".5" class="dot"/></svg>
      <span class="p-lab top" aria-hidden="true">Attacco</span>
      ${ed?`<div class="capbar" role="group" aria-label="Fascia"><button data-capm="cap" class="${tCapMode==="cap"?"on":""}" aria-label="Scegli il capitano"><b>C</b><small>Capitano</small></button><button data-capm="vice" class="${tCapMode==="vice"?"on":""}" aria-label="Scegli il vice capitano"><b>VC</b><small>Vice</small></button></div>`:""}
      ${T.slots.map(tok).join("")}
    </div>
    ${can?`<div class="p-bar ${ed?"on":""}">${ed?`<span id="tHint">${tCapMode?`Tocca il giocatore da fare ${tCapMode==="cap"?"capitano":"vice capitano"}`:tSel!==null?"Tocca un compagno o un panchinaro per scambiarli":"Trascina per spostare, tocca per scambiare"}</span><button class="btn small primary" id="tDone">Fine</button>`:`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6a1.5 1.5 0 0 1 3 0v4"/><path d="M12 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M15 10V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4 14.5a1.6 1.6 0 0 1 2.6-1.8L9 15V11"/></svg><span>Tocca due volte il campo per modificare</span>`}</div>`:""}</section>
  <section><h2>Panchina · ${bench.length}</h2>
    <div class="bench">${bench.map(p=>`<button class="bch ${ed&&tSel!==null?"pick":""}" data-bench="${p.id}" style="--rc:${RCOL[p.role]}" ${ed?"":"disabled"}><span class="tok-n">${jersey(p)}</span><span class="bfit" aria-hidden="true"></span><span class="bch-t"><b>${nameHTML(p.name)}</b><small>${esc(POSS[(p.pos1||[])[0]]||p.role)}</small></span></button>`).join("")||'<div class="card empty" style="width:100%">Tutti in campo.</div>'}</div></section>
  <section><h2>Note per la partita</h2>
    <div class="chalk"><div class="chalk-h"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>Lavagna del mister</div>
    <textarea id="t_note" class="tnote" rows="4" placeholder="Es. pressare alto, uscire palla a terra dal portiere…" ${can?"":"readonly"}>${esc(TM.note||"")}</textarea></div></section>`;
}
function e2sum(e){const d=pd(e.date);return `${e.note?e.note+" · ":""}${dayLabel(e.date)}, ore ${e.time} · ${e.home?"in casa":"in trasferta"}`}
function setSel(i){tSel=i;
  const k=i!==null?(SLOTPOS[getT().module]||[])[i]:null;
  document.querySelectorAll(".bch").forEach(b=>{const p=S.players.find(x=>x.id===b.dataset.bench);const f=k?fit(p,k):null;
    b.dataset.fit=f==null?"":f;const e=b.querySelector(".bfit");if(e)e.textContent=f==null?"":f===2?"✓ "+k:f===1?"≈ "+k:"✕ "+k});
  document.querySelectorAll("[data-slot]").forEach(el=>el.classList.toggle("sel",+el.dataset.slot===i));
  document.querySelectorAll(".bch").forEach(b=>b.classList.toggle("pick",i!==null));
  const h=$("#tHint");if(h)h.textContent=i!==null?"Tocca un compagno o un panchinaro per scambiarli":"Trascina per spostare, tocca per scambiare"}
function swapFx(pairs,done){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){done();return}
  const pos={};document.querySelectorAll("[data-slot]").forEach(el=>{pos[el.dataset.slot]=el.querySelector(".tok-n").getBoundingClientRect()});
  done();
  pairs.forEach(([from,to])=>{const el=document.querySelector(`[data-slot="${to}"]`),a=pos[from];if(!el||!a)return;const b=el.querySelector(".tok-n").getBoundingClientRect();
    el.querySelectorAll(".tok-n,.tok-l").forEach(n=>n.animate([{transform:`translate(${a.left-b.left}px,${a.top-b.top}px)`},{transform:"none"}],{duration:620,easing:"cubic-bezier(.22,1,.36,1)"}))});
}
function tSwitch(dir,mut,oldPer){
  const prev=tokPos(), sl=($("#mbar")||{}).scrollLeft||0, sy=window.scrollY;
  mut();tSel=null;anim=dir>0?"a-sw-l":"a-sw-r";render();window.scrollTo(0,sy);
  const mb=$("#mbar");if(mb){mb.scrollLeft=sl;const c=mb.querySelector(".mchip.on");
    if(c)mb.scrollTo({left:c.offsetLeft-(mb.clientWidth-c.offsetWidth)/2,behavior:reducedM()?"auto":"smooth"})}
  if(oldPer!=null){const tp=document.querySelector(".tper");if(tp){tp.style.setProperty("--i",oldPer);void tp.offsetWidth;requestAnimationFrame(()=>tp.style.setProperty("--i",tPer))}}
  flipTok(prev);
}
function setEdit(on){
  tEdit=on;tSel=null;tCapMode=null;anim="";
  const sy=window.scrollY;render();window.scrollTo(0,sy);
  const p=$("#pitch");if(p&&!reducedM())p.animate([{transform:"scale(1)"},{transform:on?"scale(1.025)":"scale(.985)"},{transform:"scale(1)"}],{duration:420,easing:"cubic-bezier(.3,1.3,.5,1)"});
  if(!on&&dirty){clearTimeout(asT);asT=setTimeout(()=>{if(dirty&&!saving)save()},450)}
}
function histStep(back){const h=hist();const from=back?h.p:h.f,to=back?h.f:h.p;if(!from.length)return;
  const prev=tokPos();to.push(JSON.stringify(getT()));Object.assign(getT(),JSON.parse(from.pop()));saveHist();
  tSel=null;anim="";const sy=window.scrollY;tChanged();render();window.scrollTo(0,sy);flipTok(prev)}
function bindTattica(){
  if(tab!=="tattica")return;
  const fm=futureMatches();
  document.querySelectorAll("[data-tm]").forEach(b=>b.onclick=()=>{if(b.dataset.tm===tMatch)return;
    const oi=fm.findIndex(e=>e.id===tMatch),ni=fm.findIndex(e=>e.id===b.dataset.tm);
    tSwitch(ni>oi?1:-1,()=>{tMatch=b.dataset.tm;tPer=0})});
  document.querySelectorAll("[data-per]").forEach(b=>b.onclick=()=>{const n=+b.dataset.per;if(n===tPer)return;const o=tPer;
    tSwitch(n>o?1:-1,()=>{tPer=n},o)});
  if(!canEdit||!$("#pitch"))return;
  const T=getT(), TM=tacOf(tMatch,tPer), pitch=$("#pitch");
  const mutate=(fn,{keepRender}={})=>{pushHist();fn();tSel=null;tChanged();if(!keepRender){anim="";const sy=window.scrollY;render();window.scrollTo(0,sy)}};
  const u=$("#tUndo"),r=$("#tRedo");if(u)u.onclick=()=>histStep(true);if(r)r.onclick=()=>histStep(false);
  const dn=$("#tDone");if(dn)dn.onclick=()=>setEdit(false);
  /* doppio tocco sul campo: entra o esce dalla modifica */
  pitch.addEventListener("pointerup",ev=>{if(tEdit&&ev.target.closest(".tok,.capbar"))return;const now=Date.now();
    if(now-tLastTap<330){tLastTap=0;setEdit(!tEdit)}else tLastTap=now});
  document.querySelectorAll("[data-mod]").forEach(b=>b.onclick=()=>{const m=b.dataset.mod;if(m===T.module)return;
    const prev=tokPos();mutate(()=>{T.module=m;T.slots=MODULI[m].map((p,i)=>({x:p[0],y:p[1],pid:T.slots[i]?T.slots[i].pid:null}))});flipTok(prev)});
  const nt=$("#t_note");nt.oninput=()=>{TM.note=nt.value;dirty=true};
  nt.onblur=()=>{if(dirty&&!tEdit){clearTimeout(asT);asT=setTimeout(()=>{if(dirty&&!saving)save()},600)}};
  if(!tEdit)return;
  document.querySelectorAll("[data-bench]").forEach(b=>b.onclick=()=>{if(tSel===null){toast("Prima tocca il giocatore in campo da sostituire");return}
    const j=tSel;const rr=b.getBoundingClientRect();mutate(()=>{T.slots[j].pid=b.dataset.bench});
    const t=document.querySelector(`[data-slot="${j}"]`);if(t&&t.animate&&!reducedM()){const q=t.querySelector(".tok-n").getBoundingClientRect();
      t.querySelectorAll(".tok-n,.tok-l").forEach(el=>el.animate([{transform:`translate(${rr.left+30-q.left}px,${rr.top+14-q.top}px) scale(.7)`,opacity:.4},{transform:"none",opacity:1}],{duration:600,easing:"cubic-bezier(.22,1,.36,1)"}))}});
  document.querySelectorAll("[data-capm]").forEach(b=>b.onclick=()=>{const m=b.dataset.capm;tCapMode=tCapMode===m?null:m;tSel=null;
    const sy=window.scrollY;anim="";render();window.scrollTo(0,sy)});
  document.querySelectorAll("[data-slot]").forEach(el=>{
    const i=+el.dataset.slot;let sx,sy,moved=false;
    el.onpointerdown=ev=>{ev.preventDefault();el.setPointerCapture(ev.pointerId);sx=ev.clientX;sy=ev.clientY;moved=false;el.classList.add("drag")};
    el.onpointermove=ev=>{if(!el.classList.contains("drag"))return;if(Math.hypot(ev.clientX-sx,ev.clientY-sy)>6)moved=true;if(!moved)return;
      const rc=pitch.getBoundingClientRect();const x=Math.min(96,Math.max(4,(ev.clientX-rc.left)/rc.width*100)),y=Math.min(97,Math.max(3,(ev.clientY-rc.top)/rc.height*100));
      el.style.left=x+"%";el.style.top=y+"%";const hz=pitch.classList.contains("hz");el.dataset.x=hz?Math.min(100,Math.max(0,(y-4)/.92)):x;el.dataset.y=hz?100-Math.min(100,Math.max(0,(x-8)/.85)):y};
    el.onpointerup=el.onpointercancel=()=>{el.classList.remove("drag");
      if(moved){mutate(()=>{T.slots[i].x=+el.dataset.x;T.slots[i].y=100-el.dataset.y});return}
      if(tCapMode){const pid=T.slots[i].pid,key=tCapMode;tCapMode=null;
        if(!pid){const sy=window.scrollY;render();window.scrollTo(0,sy);return}
        {if(TM[key]===pid)delete TM[key];else{TM[key]=pid;const o=key==="cap"?"vice":"cap";if(TM[o]===pid)delete TM[o]}
          tSel=null;tChanged();anim="";const sy=window.scrollY;render();window.scrollTo(0,sy)}
        const c=document.querySelector(`[data-slot="${i}"] .tok-cap`);if(c&&c.animate&&!reducedM()){const B="translateX(calc(-50% - 22px)) ";c.animate([{transform:B+"scale(.2)",opacity:0},{transform:B+"scale(1.2)",opacity:1,offset:.6},{transform:B+"scale(1)",opacity:1}],{duration:420,easing:"cubic-bezier(.22,1,.36,1)"})};
        return}
      if(tSel===null){setSel(i)}else if(tSel===i){setSel(null)}else{const j=tSel;swapFx([[j,i],[i,j]],()=>mutate(()=>{const a=T.slots[j].pid;T.slots[j].pid=T.slots[i].pid;T.slots[i].pid=a}))}};
  });
}

/* ---------- MODIFICA ---------- */
function sheet(html,onMount,pre){
  closeSheet();
  const bg=document.createElement("div");bg.className="sheet-bg";bg.id="sheetbg";
  bg.innerHTML=`${pre?`<div class="pv-wrap">${pre}</div>`:""}<div class="sheet" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  bg.addEventListener("click",e=>{if(e.target===bg)closeSheet()});
  document.body.appendChild(bg);lockScroll(true);onMount&&onMount(bg);
  /* niente tastiera all'apertura: il fuoco va al pannello, non a un campo */
  const sh=bg.querySelector(".sheet");sh.focus({preventScroll:true});
  /* quando compare la tastiera, il pannello sale sopra di lei */
  const vv=window.visualViewport;
  if(vv){const fit=()=>{const kb=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);bg.style.paddingBottom=kb+"px";sh.style.maxHeight=(vv.height*(pre?.62:.88))+"px"};
    vv.addEventListener("resize",fit);vv.addEventListener("scroll",fit);bg._off=()=>{vv.removeEventListener("resize",fit);vv.removeEventListener("scroll",fit)};fit()}
  /* targhetta in rilievo mentre si scrive */
  const pv=bg.querySelector(".pv-wrap");
  if(pv){bg.addEventListener("focusin",e=>{if(e.target.matches("input,select,textarea"))pv.classList.add("lift")});
    bg.addEventListener("focusout",()=>setTimeout(()=>{if(!bg.querySelector(":focus")?.matches("input,select,textarea"))pv.classList.remove("lift")},0))}
}
let asT=null, resumeBack=null, saveFailed=false;
function autosave(){if(!dirty||!canEdit||!art)return;clearTimeout(asT);asT=setTimeout(()=>{if(dirty&&!saving)save()},450)}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&dirty&&!saving&&canEdit&&art){clearTimeout(asT);save()}});
function unswipeAll(){document.querySelectorAll(".plw.swiped").forEach(w=>{w.classList.remove("swiped");const c=w.querySelector(".pl");if(c){c.classList.remove("dragging");c.style.transform=""}
  const d=w.querySelector(".pl-act.del");if(d){d.classList.remove("confirm");d.querySelector("span").textContent="Elimina"}})}
function closeSheet(){unswipeAll();const b=$("#sheetbg");if(!b)return;b.id="";b._off&&b._off();setTimeout(autosave,0);
  if(!document.querySelector("#evOpen,#mOpen,#cvOpen,#trOpen,#rpOpen"))lockScroll(false);
  const pv=b.querySelector(".pv-wrap");if(pv)pv.remove();
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){b.remove();return}
  b.classList.add("out");setTimeout(()=>b.remove(),240)}
function changed(){dirty=true;render()}

function editEvent(id,newType){
  const e=id?S.events.find(x=>x.id===id):{id:uid(),type:newType||"allenamento",date:selDay||todayISO,time:"18:00",end:"19:30",place:"",opponent:"",home:true,gf:null,ga:null,scorers:{},note:""};
  const isNew=!id;
  const scorers=S.players.slice().sort((a,b)=>a.num-b.num).map(p=>`<label class="scorer"><span>#${esc(p.num)} ${esc(p.name)}</span><input type="number" min="0" inputmode="numeric" id="sc_${p.id}" data-sc="${p.id}" value="${(e.scorers||{})[p.id]||""}" placeholder="0"></label>`).join("");
  sheet(`<h3>${isNew?"Nuovo impegno":"Modifica impegno"}</h3>
   <div class="seg"><label><input type="radio" name="type" id="ty_a" value="allenamento" ${e.type!=="partita"?"checked":""}>Allenamento</label><label><input type="radio" name="type" id="ty_p" value="partita" ${e.type==="partita"?"checked":""}>Partita</label></div>
   <label class="field">Data<input type="date" id="f_date" value="${esc(e.date)}"></label>
   <div class="grid2"><label class="field">Dalle<input type="time" id="f_time" value="${esc(e.time)}"></label><label class="field">Alle<input type="time" id="f_end" value="${esc(e.end||"")}"></label></div>
   <label class="field">Luogo<input id="f_place" value="${esc(e.place)}" placeholder="Campo comunale"></label>
   <div id="matchFields">
    <div style="display:flex;flex-direction:column;gap:14px">
     <div class="grid2"><label class="field">Avversario<input id="f_opp" value="${esc(e.opponent||"")}"></label>
     <label class="field">Dove<select id="f_home"><option value="1" ${e.home!==false?"selected":""}>In casa</option><option value="0" ${e.home===false?"selected":""}>In trasferta</option></select></label></div>
     <div id="resFields" style="display:flex;flex-direction:column;gap:14px">
     <div class="grid2"><label class="field">Gol ${esc(S.team)}<input type="number" min="0" inputmode="numeric" id="f_gf" value="${e.gf??""}" placeholder="—"></label><label class="field">Gol avversari<input type="number" min="0" inputmode="numeric" id="f_ga" value="${e.ga??""}" placeholder="—"></label></div>
     <div class="field">Marcatori<div class="scorers">${scorers||'<span class="ev-sub">Aggiungi prima i giocatori nella Rosa.</span>'}</div></div>
     </div>
    </div>
   </div>
   <label class="field">Note<input id="f_note" value="${esc(e.note||"")}" placeholder="Es. ritrovo 9:15, portare borraccia"></label>
   <div class="sheet-actions">${isNew?"<span></span>":'<button class="btn danger" id="del">Elimina</button>'}<div><button class="btn" id="cancel">Annulla</button><button class="btn primary" id="ok">Fatto</button></div></div>`,
  bg=>{
    const nowT=new Date().toTimeString().slice(0,5);
    const sync=()=>{bg.querySelector("#matchFields").hidden=!bg.querySelector("#ty_p").checked;
      const d=bg.querySelector("#f_date").value,t=bg.querySelector("#f_time").value||"00:00";
      bg.querySelector("#resFields").hidden=!(played(e)||d<todayISO||(d===todayISO&&t<=nowT))};sync();
    bg.querySelector("#f_date").addEventListener("change",sync);bg.querySelector("#f_time").addEventListener("change",sync);
    bg.querySelectorAll('input[name=type]').forEach(r=>r.addEventListener("change",sync));
    bg.querySelector("#cancel").onclick=closeSheet;
    const del=bg.querySelector("#del"); if(del) del.onclick=()=>{if(del.dataset.c){S.events=S.events.filter(x=>x.id!==e.id);closeSheet();changed()}else{del.dataset.c=1;del.textContent="Conferma eliminazione"}};
    bg.querySelector("#ok").onclick=()=>{
      const v=s=>bg.querySelector(s).value.trim();
      const type=bg.querySelector("#ty_p").checked?"partita":"allenamento";
      if(!v("#f_date")){bg.querySelector("#f_date").focus();return}
      const n={id:e.id,type,date:v("#f_date"),time:v("#f_time")||"00:00",end:v("#f_end"),place:v("#f_place"),note:v("#f_note")};
      if(type==="partita"){
        n.opponent=v("#f_opp")||"Avversario";n.home=v("#f_home")==="1";
        n.gf=v("#f_gf")===""?null:+v("#f_gf");n.ga=v("#f_ga")===""?null:+v("#f_ga");
        n.scorers={};bg.querySelectorAll("[data-sc]").forEach(i=>{const k=+i.value;if(k>0)n.scorers[i.dataset.sc]=k});
      }
      if(isNew)S.events.push(n);else S.events[S.events.findIndex(x=>x.id===e.id)]=n;
      selDay=n.date;const d=pd(n.date);calY=d.getFullYear();calM=d.getMonth();
      closeSheet();changed();
    };
  });
}
function editPlayer(id){
  const p=id?S.players.find(x=>x.id===id):{id:uid(),num:(Math.max(0,...S.players.map(x=>+x.num||0))+1),name:"",role:"Centrocampista"};
  const isNew=!id;
  const pvHTML=d=>`<span class="pl-wm" aria-hidden="true">${esc(d.num||"")}</span>${jersey(d)}<div><div class="pl-name">${d.name?nameHTML(d.name):"Nuovo giocatore"}</div>${rolesHTML(d)}</div>`;
  const pvCard=`<div class="card pl pv r-${ROLEKEY[p.role]||"cen"}" id="pvCard">${pvHTML(p)}</div>`;
  sheet(`<h3>${isNew?"Nuovo giocatore":"Modifica giocatore"}</h3>
   <label class="field">Numero di maglia<input type="number" min="0" inputmode="numeric" id="p_num" value="${esc(p.num)}"></label>
   <div class="field">Ruolo principale<div class="rchips">${ROLES.map((r,i)=>`<label style="--rc:${RCOL[r]}"><input type="radio" name="p_role" id="pr1_${i}" value="${r}" ${r===p.role?"checked":""}><span>${r}</span></label>`).join("")}</div></div>
   <div class="field">Secondo ruolo<div class="rchips">${["",...ROLES].map((r,i)=>`<label style="--rc:${r?RCOL[r]:"var(--muted)"}"><input type="radio" name="p_role2" id="pr2_${i}" value="${r}" ${(p.role2||"")===r?"checked":""}><span>${r||"Nessuno"}</span></label>`).join("")}</div></div>
   <label class="field">Nome<input id="p_name" value="${esc(p.name)}" placeholder="Nome e iniziale del cognome"></label>
   <div class="field">Posizioni in campo<span class="ev-sub" style="font-weight:500">Tocca una volta per <b>principale</b>, due per <b>alternativa</b>, tre per toglierla.</span>
     <div class="pospick">${POSROWS.map(r=>`<div class="pp-row">${r.map(k=>{const st=(p.pos1||[]).includes(k)?2:(p.pos2||[]).includes(k)?1:0;return `<button type="button" class="pp s${st}" data-pp="${k}" style="--c:${POSCOL(k)}"><b>${k}</b><small>${POSS[k]}</small><i>${st===2?"1°":st===1?"2°":""}</i></button>`}).join("")}</div>`).join("")}</div></div>
   <div class="sheet-actions">${isNew?"<span></span>":'<button class="btn danger" id="del">Togli dalla rosa</button>'}<div><button class="btn" id="cancel">Annulla</button><button class="btn primary" id="ok">Fatto</button></div></div>`,
  bg=>{
    const rv=n=>(bg.querySelector(`input[name=${n}]:checked`)||{}).value||"";
    const live=()=>{const d={num:bg.querySelector("#p_num").value,name:bg.querySelector("#p_name").value.trim(),role:rv("p_role")||"Centrocampista",role2:rv("p_role2")};
      const c=bg.querySelector("#pvCard");c.className=`card pl pv r-${ROLEKEY[d.role]||"cen"}`;c.innerHTML=pvHTML(d)};
    bg.querySelectorAll("#p_num,#p_name,input[name=p_role],input[name=p_role2]").forEach(i=>{i.addEventListener("input",live);i.addEventListener("change",live)});
    bg.querySelectorAll("[data-pp]").forEach(b=>b.onclick=()=>{const st=(b.classList.contains("s2")?2:b.classList.contains("s1")?1:0);const n=st===0?2:st===2?1:0;
      b.className=`pp s${n}`;b.querySelector("i").textContent=n===2?"1°":n===1?"2°":"";
      if(b.animate&&!reducedM())b.animate([{transform:"scale(.9)"},{transform:"scale(1.04)"},{transform:"none"}],{duration:320,easing:"cubic-bezier(.3,1.3,.5,1)"})});
    bg.querySelector("#cancel").onclick=closeSheet;
    const del=bg.querySelector("#del"); if(del) del.onclick=()=>{if(del.dataset.c){S.players=S.players.filter(x=>x.id!==p.id);closeSheet();changed()}else{del.dataset.c=1;del.textContent="Conferma"}};
    bg.querySelector("#ok").onclick=()=>{
      const name=bg.querySelector("#p_name").value.trim(); if(!name){bg.querySelector("#p_name").focus();return}
      const r2=rv("p_role2");const n={id:p.id,num:+bg.querySelector("#p_num").value||0,name,role:rv("p_role")||"Centrocampista"};if(r2&&r2!==n.role)n.role2=r2;
      n.pos1=[...bg.querySelectorAll(".pp.s2")].map(b=>b.dataset.pp);n.pos2=[...bg.querySelectorAll(".pp.s1")].map(b=>b.dataset.pp);
      if(isNew)S.players.push(n);else S.players[S.players.findIndex(x=>x.id===p.id)]=n;
      closeSheet();changed();
    };
  },pvCard);
}
function editStandings(){
  const row=(r,i)=>`<tr data-i="${i}"><td><input id="st_t_${i}" value="${esc(r.team)}" aria-label="Squadra"></td>${["v","n","p","gf","gs"].map(k=>`<td><input id="st_${k}_${i}" type="number" min="0" inputmode="numeric" data-k="${k}" value="${esc(r[k])}" aria-label="${k}"></td>`).join("")}<td><button class="btn small danger" data-rm="${i}" aria-label="Rimuovi">×</button></td></tr>`;
  let rows=S.standings.map(r=>({...r}));
  const draw=bg=>{bg.querySelector("tbody").innerHTML=rows.map(row).join("");bg.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{read(bg);rows.splice(+b.dataset.rm,1);draw(bg)})};
  const read=bg=>{rows=[...bg.querySelectorAll("tbody tr")].map(tr=>{const i=tr.dataset.i;const o={team:tr.querySelector(`#st_t_${i}`).value.trim()};["v","n","p","gf","gs"].forEach(k=>o[k]=+tr.querySelector(`#st_${k}_${i}`).value||0);return o})};
  sheet(`<h3>Classifica</h3><p class="ev-sub" style="margin:0">Vinte, pareggiate, perse, gol fatti e subiti. Punti e posizione si calcolano da soli. Scrivi la tua squadra esattamente come "${esc(S.team)}" per evidenziarla.</p>
   <div class="tbl-wrap"><table class="st-edit"><thead><tr><th>Squadra</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th></th></tr></thead><tbody></tbody></table></div>
   <button class="btn small" id="addRow">+ Squadra</button>
   <details><summary class="ev-sub" style="cursor:pointer">Nome squadra, categoria e stagione</summary>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
    <label class="field">Nome squadra<input id="s_team" value="${esc(S.team)}"></label>
    <div class="grid2"><label class="field">Categoria<input id="s_cat" value="${esc(S.categoria)}"></label><label class="field">Stagione<input id="s_sea" value="${esc(S.stagione)}"></label></div>
    <label class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="s_ex" style="width:auto" ${S.esempio?"checked":""}> Mostra avviso "dati di esempio"</label></div>
   </details>
   <div class="sheet-actions"><span></span><div><button class="btn" id="cancel">Annulla</button><button class="btn primary" id="ok">Fatto</button></div></div>`,
  bg=>{
    draw(bg);
    bg.querySelector("#addRow").onclick=()=>{read(bg);rows.push({team:"",v:0,n:0,p:0,gf:0,gs:0});draw(bg)};
    bg.querySelector("#cancel").onclick=closeSheet;
    bg.querySelector("#ok").onclick=()=>{
      read(bg);
      const oldTeam=S.team;S.team=bg.querySelector("#s_team").value.trim()||S.team;
      S.standings=rows.filter(r=>r.team).map(r=>r.team===oldTeam?{...r,team:S.team}:r);
      S.categoria=bg.querySelector("#s_cat").value.trim();S.stagione=bg.querySelector("#s_sea").value.trim();
      S.esempio=bg.querySelector("#s_ex").checked;
      closeSheet();changed();
    };
  });
}

/* ---------- SALVATAGGIO ---------- */
function toast(msg){const t=document.createElement("div");t.className="toast";t.setAttribute("role","status");t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),3200)}
function buildDoc(){
  const reset='<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
  const keep=[...document.querySelectorAll("[data-keep]")];
  const head=keep.filter(el=>el.id!=="appjs").map(el=>el.outerHTML).join("\n");
  const js=keep.find(el=>el.id==="appjs").outerHTML;
  const json=JSON.stringify(S).replace(/</g,"\\u003c");
  return reset+head+'\n<div id="app"></div>\n<script type="application/json" id="data">'+json+'<\/script>\n'+js+"</body></html>";
}
async function save(){
  if(!SB||!MYID||saving)return false;saving=true;const wasFailed=saveFailed;
  const snap=JSON.stringify(stripLogos(S));
  try{const {data,error}=await SB.from("app_state").update({data:JSON.parse(snap),updated_by:MYID}).eq("id","main").select("updated_at").single();
    if(error)throw error;
    REMOTE_AT=data&&data.updated_at||REMOTE_AT;saving=false;saveFailed=false;cacheS();setPending(false);
    if(JSON.stringify(stripLogos(S))===snap)dirty=false;else autosave();
    if(wasFailed)render();return true}
  catch(e){saving=false;saveFailed=true;cacheS();setPending(true);
    toast(!navigator.onLine?"Sei offline: le modifiche restano sul telefono e le salvo appena torna la connessione.":"Salvataggio non riuscito. Riprova tra poco.");
    render();return false}
}

function glassX(){const g=$("#glass");if(!g)return 0;try{return new DOMMatrixReadOnly(getComputedStyle(g).transform).m41}catch(_){return 0}}
function placeGlass(fromX){
  const g=$("#glass"),b=document.querySelector('.tabbar button[aria-current="page"]');if(!g||!b)return;
  const x=b.offsetLeft,w=b.offsetWidth;g.style.width=w+"px";
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(fromX==null||reduced||Math.abs(fromX-x)<1){g.style.transition="none";g.style.transform=`translateX(${x}px)`;void g.offsetWidth;g.style.transition="";return}
  g.style.transition="none";g.style.transform=`translateX(${fromX}px) scale(1.18,.86)`;void g.offsetWidth;g.style.transition="";
  requestAnimationFrame(()=>{g.style.transform=`translateX(${x}px)`});
}
function goTab(t,fromX){
  if(t===tab)return;
  const from=ORDER.indexOf(tab),to=ORDER.indexOf(t);anim=to>from?"a-in-l":"a-in-r";
  pillFromX=fromX??glassX();tab=t;try{history.replaceState(null,"","#"+tab)}catch(_){location.hash=tab}
  render();window.scrollTo(0,0);autosave();
}
function bindGlass(){
  const bar=document.querySelector(".tabbar .in"),g=$("#glass");if(!bar||!g)return;
  const btns=[...bar.querySelectorAll("button")];let st=null;
  const near=x=>{const c=x+g.offsetWidth/2;let bi=0,bd=1e9;btns.forEach((b,i)=>{const d=Math.abs(b.offsetLeft+b.offsetWidth/2-c);if(d<bd){bd=d;bi=i}});return bi};
  bar.onpointerdown=e=>{st={x:e.clientX,gx:glassX(),drag:false,lx:e.clientX,lt:performance.now(),cx:glassX(),id:e.pointerId}};
  bar.onpointermove=e=>{if(!st)return;const dx=e.clientX-st.x;
    if(!st.drag){if(Math.abs(dx)<7)return;st.drag=true;try{bar.setPointerCapture(st.id)}catch(_){}g.classList.add("lift");g.style.transition="transform .12s ease-out,box-shadow .3s"}
    const max=bar.clientWidth-g.offsetWidth-4,x=Math.min(max,Math.max(4,st.gx+dx));
    const now=performance.now(),v=Math.abs(e.clientX-st.lx)/Math.max(8,now-st.lt);st.lx=e.clientX;st.lt=now;
    const sx=1+Math.min(.28,v*.35);
    g.style.transform=`translateX(${x}px) scale(${1.1*sx},${1.1/sx})`;st.cx=x;
    const i=near(x);btns.forEach((b,k)=>b.classList.toggle("hov",k===i))};
  const end=()=>{if(!st)return;const s=st;st=null;if(!s.drag)return;
    g.classList.remove("lift");g.style.transition="";btns.forEach(b=>b.classList.remove("hov"));
    dragJustEnded=true;setTimeout(()=>dragJustEnded=false,60);
    const t=ORDER[near(s.cx)];
    if(t===tab){g.style.transform=`translateX(${btns[ORDER.indexOf(t)].offsetLeft}px)`;return}
    goTab(t,s.cx)};
  bar.onpointerup=end;bar.onpointercancel=end;
}
addEventListener("resize",()=>placeGlass(null));
function bind(){
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{if(dragJustEnded)return;if(b.dataset.tab===tab){window.scrollTo({top:0,behavior:"smooth"});return}goTab(b.dataset.tab)});
  const sv=$("#save");if(sv)sv.onclick=save;
  const pm=$("#prevM"),nm=$("#nextM");
  if(pm)pm.onclick=()=>{calAnim="cal-r";calM--;if(calM<0){calM=11;calY--}render()};
  if(nm)nm.onclick=()=>{calAnim="cal-l";calM++;if(calM>11){calM=0;calY++}render()};
  document.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{dayTouched=!(dayTouched&&selDay===b.dataset.day);selDay=b.dataset.day;dayAnim=true;const d=pd(selDay);if(d.getMonth()!==calM)calAnim=d<new Date(calY,calM,1)?"cal-r":"cal-l";calY=d.getFullYear();calM=d.getMonth();render()});
  document.querySelectorAll("[data-edit-ev]").forEach(b=>b.onclick=()=>editEvent(b.dataset.editEv));
  document.querySelectorAll("[data-edit-pl]").forEach(b=>b.onclick=()=>{unswipeAll();editPlayer(b.dataset.editPl)});
  document.querySelectorAll('[data-add="event"]').forEach(b=>b.onclick=()=>editEvent(null));
  document.querySelectorAll('[data-add="match"]').forEach(b=>b.onclick=()=>editEvent(null,"partita"));
  document.querySelectorAll('[data-add="player"]').forEach(b=>b.onclick=()=>editPlayer(null));
  const es=$("#editSt");if(es)es.onclick=editStandings;
  document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>goTab(b.dataset.go));
  document.querySelectorAll("[data-att]").forEach(b=>b.onclick=()=>openTrain(b.dataset.att,b));
  bindPres();
  document.querySelectorAll("[data-match]").forEach(el=>el.onclick=()=>openMatch(el.dataset.match,el));
  /* un allenamento apre la sua schermata, con Resoconto e Presenze e RPE */
  const openEv=el=>{const ev=S.events.find(x=>x.id===el.dataset.open);
    if(ev&&ev.type!=="partita"){openTrain(ev.id,el);return}
    openEvent(el.dataset.open,el)};
  document.querySelectorAll("[data-open]").forEach(el=>{el.onclick=()=>openEv(el);el.onkeydown=k=>{if(k.key==="Enter"||k.key===" "){k.preventDefault();openEv(el)}}});
  bindTattica();
  bindRosa();
}
addEventListener("keydown",e=>{if(e.key==="Escape"){closeSheet();closeMatch();const o=$("#evClose");o&&o.click()}});
addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(ORDER.includes(h)&&h!==tab)goTab(h)});
addEventListener("beforeunload",e=>{if(dirty&&!saving){e.preventDefault();e.returnValue=""}});

if(RESUME){if(RESUME.tMatch)tMatch=RESUME.tMatch;if(RESUME.tPer)tPer=RESUME.tPer;if(RESUME.tEdit)tEdit=true;if(RESUME.selDay){selDay=RESUME.selDay;calY=RESUME.calY;calM=RESUME.calM}}
render();
if(RESUME){window.scrollTo(0,RESUME.y||0);if(RESUME.mOpen)openMatch(RESUME.mOpen,null);
  if(RESUME.back){const row=document.querySelector(`#app [data-match="${RESUME.back}"]`);if(row)row.classList.add("returned")}}
function dropBoot(slow){const b=document.getElementById("boot");if(!b)return;if(!slow){b.remove();return}
  b.style.transition="opacity .35s ease";requestAnimationFrame(()=>{b.style.opacity="0"});setTimeout(()=>b.remove(),400)}
function runSplash(){if(RESUME&&ABD_ME){RESUME=null;anim="a-open";document.body.classList.add("ready");render();dropBoot(true);return}
  const sp=document.createElement("div");sp.className="splash";if(ABD_ME)sp.setAttribute("aria-hidden","true");
  sp.innerHTML=`<canvas></canvas><div class="sp-row"><div class="sp-logo-wrap"><img class="sp-logo" src="${LOGO}" alt=""><div class="sp-sheen" style="--m:url('${LOGO}')"></div></div><div class="sp-side"><div class="sp-line"></div><div class="sp-text"><span>Alta</span><span>Brianza</span></div></div></div>`;
  document.body.appendChild(sp);
  /* il logo resta fermo al centro, come all'avvio, finché l'animazione è pronta a partire */
  /* a tutto schermo come l'immagine d'avvio di iPhone (anche sotto la barra in basso) */
  if(window.ABTRI&&ABTRI.fh){sp.style.bottom="auto";sp.style.height=ABTRI.fh()+"px"}
  /* lo stesso stemma dell'avvio passa nell'intro, già caricato: nessun buco */
  /* si parte dal blu scuro dell'avvio: l'intro emerge piano da lì */
  sp.style.opacity="0";const hold={remove(){}},still=null;

  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const q=s=>sp.querySelector(s);
  const row=q(".sp-row"),wrap=q(".sp-logo-wrap"),line=q(".sp-line"),[t1,t2]=sp.querySelectorAll(".sp-text span"),sheen=q(".sp-sheen");
  /* sfondo a triangoli blu che luccicano piano */
  const cv=q("canvas"),cx=cv.getContext("2d");let tris=[],raf=0,t0=performance.now(),alive=true;
  const shades=[[20,48,150],[26,58,170],[16,38,128],[32,70,190],[14,30,110],[24,52,160]];
  const T=window.ABTRI;
  function build(){const z=T.size(cv);tris=T.build(z.W,z.H)}
  function draw(now){
    const t=(now-t0)/1000;cx.clearRect(0,0,cv.width,cv.height);T.draw(cx,tris,t);
    if(alive&&!reduced)raf=requestAnimationFrame(draw);
  }
  let t0set=false;build();draw(performance.now());addEventListener("resize",()=>{if(alive){if(window.ABTRI&&ABTRI.fh)sp.style.height=ABTRI.fh()+"px";build();if(reduced)draw(performance.now())}});

  let done=false;
  const hide=()=>{if(done)return;done=true;clearTimeout(safety);anim="a-open";document.body.classList.add("ready");render();setTimeout(()=>{if(anim==="a-open")anim=""},1400);
    const end=()=>{alive=false;cancelAnimationFrame(raf);sp.remove()};
    if(reduced||!sp.animate){end();return}
    row.animate([{transform:getComputedStyle(row).transform==="none"?"none":getComputedStyle(row).transform,opacity:1,filter:"blur(0)"},{transform:"scale(1.08)",opacity:0,filter:"blur(6px)"}],{duration:550,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});
    sp.animate([{opacity:1},{opacity:0}],{duration:650,delay:120,easing:"ease",fill:"forwards"}).onfinish=end;
  };
  sp.addEventListener("click",()=>{if(ABD_ME)hide()});
  /* primo accesso: dopo l'animazione compare il tasto Accedi */
  let gated=false;
  const gate=async()=>{await sessReady;
    if(!IS_APP&&!webOK()){if(gated)return;gated=true;clearTimeout(safety);showInstall();return}
    if(ABD_ME){hide();return}if(gated)return;gated=true;clearTimeout(safety);showLogin()};
  /* aperta dal link (non dall'icona): prima si installa nella schermata Home */
  function showInstall(){
    const ua=navigator.userAgent||"",isIOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const isPad=isIOS&&(/iPad/.test(ua)||Math.min(screen.width,screen.height)>=700),isAndroid=/Android/i.test(ua);
    const inApp=/FBAN|FBAV|Instagram|Line\/|WhatsApp|GSA\//.test(ua)||(isIOS&&!/Safari\//.test(ua));
    const iosV=(()=>{const m=ua.match(/OS (\d+)_/);return m?+m[1]:0})(),newSafari=iosV>=26;
    const SH='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
    const PL='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
    const DOTS='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
    const VD='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
    const ICO=`<img src="icons/apple-touch-icon.png" alt="" width="22" height="22" style="border-radius:6px">`;
    const step=(n,ic,t)=>`<li><span class="in-n">${n}</span><span class="in-ic">${ic}</span><span>${t}</span></li>`;
    let steps="",arrow="",btn="",note="";
    if(inApp){
      steps=step(1,isIOS?DOTS:VD,`Tocca il menu del browser ${isIOS?"(in basso o in alto)":"(i tre puntini)"}`)+step(2,isIOS?"🧭":"🌐",`Scegli <b>Apri in ${isIOS?"Safari":"Chrome"}</b>`)+step(3,PL,"Lì potrai aggiungerla alla Home");
      note="Da WhatsApp o Instagram non si può installare: va aperta nel browser.";
    }else if(isIOS){
      steps=step(1,SH,"Tocca <b>Condividi</b>")
        +step(2,PL,"Scorri e tocca <b>Aggiungi alla schermata Home</b>")+step(3,ICO,"Apri l'app dall'icona <b>Alta Brianza</b>");
      arrow=isPad?"top":(newSafari?"br":"bc");
      note="Se l'hai aperta da WhatsApp e non trovi l'opzione, aprila prima in Safari.";
    }else if(isAndroid){
      btn=`<button type="button" class="sp-go" id="inGo" ${window.__bip?"":"hidden"}>Installa</button>`;
      steps=step(1,VD,"Tocca il menu <b>⋮</b> di Chrome")+step(2,PL,"Scegli <b>Installa app</b> o <b>Aggiungi a schermata Home</b>")+step(3,ICO,"Apri l'app dall'icona <b>Alta Brianza</b>");
    }else{
      steps=step(1,"📱","Apri questo link <b>dal telefono</b>")+step(2,PL,"Aggiungila alla schermata Home")+step(3,ICO,"Aprila dall'icona <b>Alta Brianza</b>");
    }
    const lg=document.createElement("div");lg.className="sp-login";
    lg.innerHTML=`<div class="sp-form sp-inst" role="dialog" aria-label="Installa l'app">
        <b class="sp-ft">Installa l'app</b>
        <p class="in-sub">La trovi nella Home e si apre a tutto schermo, come un'app vera.</p>
        ${btn}<ol class="in-steps">${steps}</ol>
        ${note?`<p class="in-note">${note}</p>`:""}
        <button type="button" class="in-web" id="inWeb">Continua nel browser</button>
      </div>${arrow?`<div class="in-arrow ${arrow}" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M6 13l6 6 6-6"/></svg></div>`:""}`;
    sp.appendChild(lg);sp.removeAttribute("aria-hidden");
    requestAnimationFrame(()=>{lg.classList.add("in");sp.classList.add("login-open")});
    lg.addEventListener("click",e=>e.stopPropagation());
    const go=lg.querySelector("#inGo");
    if(go){const show=()=>{go.hidden=false;lg.querySelector(".in-steps").classList.add("alt");lg.querySelector(".in-sub").textContent="Un tocco e la trovi nella Home, a tutto schermo come un'app vera. Oppure:"};if(window.__bip)show();else window.__bipcb=show;
      go.onclick=async()=>{const ev=window.__bip;if(!ev)return;ev.prompt();try{const r=await ev.userChoice;if(r&&r.outcome==="accepted"){go.textContent="Installata! Aprila dalla Home";go.classList.add("ok");go.disabled=true}}catch(_){}window.__bip=null}}
    lg.querySelector("#inWeb").onclick=()=>{try{localStorage.setItem("ab-web","1")}catch(_){}
      lg.style.transition="opacity .3s ease";lg.style.opacity="0";sp.classList.remove("login-open");
      setTimeout(()=>{lg.remove();gated=false;gate()},320)};
  }
  function showLogin(){
    const lg=document.createElement("div");lg.className="sp-login";
    lg.innerHTML=`<button type="button" class="sp-acc" id="spAcc">Accedi</button>
      <form class="sp-form" id="spForm" novalidate autocomplete="on">
        <button type="button" class="sp-x" id="spX" aria-label="Chiudi">×</button>
        <b class="sp-ft">Accedi</b>
        <label>Nome e cognome<input id="spName" autocomplete="name" autocapitalize="words" enterkeyhint="next" placeholder="Es. Mario Rossi"></label>
        <label>Codice persona<span class="sp-pw"><input id="spCode" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Il tuo codice"><button type="button" class="sp-eye" id="spEye" aria-label="Mostra codice" aria-pressed="false"><svg class="e-on" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="e-off" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg></button></span></label>
        <p class="sp-err" id="spErr" role="alert"></p>
        <button type="submit" class="sp-go" id="spGo">Entra</button>
      </form>`;
    sp.appendChild(lg);
    const acc=lg.querySelector("#spAcc"),form=lg.querySelector("#spForm"),nm=lg.querySelector("#spName"),cd=lg.querySelector("#spCode"),err=lg.querySelector("#spErr"),go=lg.querySelector("#spGo");
    requestAnimationFrame(()=>lg.classList.add("in"));
    const open=on=>{sp.classList.toggle("login-open",on);if(on){setTimeout(()=>nm.focus({preventScroll:true}),320)}else{nm.blur();cd.blur();err.textContent=""}};
    acc.onclick=e=>{e.stopPropagation();open(true)};
    lg.querySelector("#spX").onclick=e=>{e.stopPropagation();open(false)};
    lg.addEventListener("click",e=>e.stopPropagation());
    const eye=lg.querySelector("#spEye");
    eye.addEventListener("pointerdown",e=>e.preventDefault()); /* la tastiera resta aperta */
    eye.onclick=e=>{e.preventDefault();e.stopPropagation();const show=cd.type==="password";cd.type=show?"text":"password";
      eye.setAttribute("aria-pressed",show);eye.setAttribute("aria-label",show?"Nascondi codice":"Mostra codice");eye.classList.toggle("on",show)};
    nm.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();cd.focus()}});
    const norm=t=>t.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().split(/\s+/).filter(Boolean);
    let busy=false;
    form.onsubmit=async e=>{e.preventDefault();if(busy)return;err.textContent="";
      const w=norm(nm.value);
      if(w.length<2||!cd.value.trim()){err.textContent=w.length===1?"Scrivi nome e cognome.":"Scrivi nome, cognome e codice.";shake();return}
      busy=true;go.disabled=true;go.innerHTML='<span class="spin" aria-hidden="true"></span>Entra';
      try{const me=await abdSignIn(w[0],w.slice(1).join(" "),cd.value);
        nm.blur();cd.blur();go.disabled=false;go.classList.add("ok");go.textContent="Ciao "+me.first+"!";
        setTimeout(()=>{lg.style.transition="opacity .35s ease, transform .45s cubic-bezier(.4,0,.2,1)";lg.style.opacity="0";lg.style.transform="translateY(-10px) scale(.97)";hide()},650)}
      catch(x){busy=false;go.disabled=false;go.textContent="Entra";err.textContent=(x&&x.msg)||"Accesso non riuscito.";shake()}};
    function shake(){if(!reduced&&form.animate)form.animate([{transform:"translateX(0)"},{transform:"translateX(-9px)"},{transform:"translateX(8px)"},{transform:"translateX(-5px)"},{transform:"translateX(0)"}],{duration:380,easing:"ease-out"})}
  }

  let fl;try{fl=document.fonts&&document.fonts.load?document.fonts.load('700 40px "Antonio"').catch(()=>{}):null}catch(_){fl=null}
  const fontReady=Promise.race([fl||Promise.resolve(),new Promise(r=>setTimeout(r,700))]);
  const safety=setTimeout(()=>gate(),4500); /* in ogni caso l'intro si chiude */
  const showFinal=()=>{sp.style.opacity="1";dropBoot(false);[wrap,t1,t2,line].forEach(el=>{el.style.opacity=1;el.style.transform="none"})};
  if(reduced||!sp.animate){sp.style.opacity="1";dropBoot(false);
    [wrap,t1,t2,line].forEach(el=>{el.style.opacity=1;el.style.transform="none"});
    setTimeout(gate,1600);return;
  }
  /* il logo entra subito, centrato */
  const E="cubic-bezier(.16,1,.3,1)", S="cubic-bezier(.65,0,.35,1)";
  fontReady.then(()=>{try{
    const rw=row.getBoundingClientRect().width, lw=wrap.getBoundingClientRect().width;
    const dx=(rw-lw)/2;
    const D=380; /* pausa sul blu scuro: copre l'attimo di assestamento all'apertura */
    sp.animate([{opacity:0},{opacity:1}],{duration:700,delay:D,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"}).onfinish=()=>{sp.style.opacity="1";dropBoot(false)};
    wrap.animate([
      {opacity:0,transform:`translateX(${dx}px) scale(.62)`,filter:"blur(14px)",easing:E},
      {opacity:1,transform:`translateX(${dx}px) scale(1.04)`,filter:"blur(0px)",offset:.38,easing:"ease-in-out"},
      {opacity:1,transform:`translateX(${dx}px) scale(1)`,filter:"blur(0px)",offset:.5,easing:S},
      {opacity:1,transform:"translateX(0px) scale(1)",filter:"blur(0px)"}],
      {duration:2000,delay:D,fill:"both"});
    sheen.animate([{backgroundPosition:"-150% 0"},{backgroundPosition:"250% 0"}],{duration:900,delay:D+650,easing:"ease-in-out",fill:"both"});
    line.animate([{opacity:0,transform:"scaleY(0)"},{opacity:1,transform:"scaleY(1)"}],{duration:650,delay:D+1250,easing:E,fill:"forwards"});
    [t1,t2].forEach((el,i)=>el.animate([
      {opacity:0,transform:"translateX(-28px)",filter:"blur(8px)",clipPath:"inset(0 100% 0 0)"},
      {opacity:1,transform:"translateX(0)",filter:"blur(0)",clipPath:"inset(0 0% 0 0)"}],
      {duration:850,delay:D+1400+i*140,easing:E,fill:"forwards"}));
    setTimeout(gate,D+3300);
  }catch(_){showFinal();setTimeout(gate,1200)}}).catch(()=>{showFinal();setTimeout(gate,1200)});
}
runSplash();
/* profilo in alto a destra: nome di chi è collegato ed Esci */
function closeProf(){const m=document.querySelector(".prof-pop");if(!m)return;m.classList.add("out");document.querySelector("#profBtn")?.setAttribute("aria-expanded","false");setTimeout(()=>m.remove(),200)}
document.addEventListener("click",e=>{
  const b=e.target.closest("#profBtn");
  if(b){e.stopPropagation();if(document.querySelector(".prof-pop:not(.out)")){closeProf();return}
    if(!ABD_ME)return;const r=b.getBoundingClientRect();
    const m=document.createElement("div");m.className="prof-pop";m.setAttribute("role","menu");
    m.style.top=(r.bottom+8)+"px";m.style.right=Math.max(12,innerWidth-r.right)+"px";
    m.innerHTML=`<div class="pp-who"><span class="pp-av">${esc(ABD_ME.first[0])}${esc(ABD_ME.last[0])}</span><div><small>Collegato come</small><b>${esc(ABD_ME.first)} ${esc(ABD_ME.last)}</b><em>Mister</em></div></div>
      <button class="pp-out" id="profOut" role="menuitem"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg>Esci</button>`;
    document.body.appendChild(m);b.setAttribute("aria-expanded","true");
    m.querySelector("#profOut").onclick=ev=>{ev.stopPropagation();closeProf();
      const out=async()=>{try{if(SB)await SB.auth.signOut()}catch(_){}
        try{if(rtChan){SB.removeChannel(rtChan);rtChan=null}}catch(_){}
        ABD_ME=null;MYID=null;art=null;canEdit=false;dirty=false;REMOTE_AT=null;
        try{["abd-user","ab-cache","ab-pending","ab-myid"].forEach(k=>localStorage.removeItem(k))}catch(_){}
        S=withLogos(null);RESUME=null;render();runSplash()};
      if(dirty&&!saving&&canEdit&&art){clearTimeout(asT);save().finally(out)}else out()};
    return}
  if(!e.target.closest(".prof-pop"))closeProf();
},true);
addEventListener("scroll",closeProf,{passive:true});
/* aggiornamenti: quando torni nell'app controlla se c'è una versione nuova e si aggiorna da sola */
async function checkUpdate(){
  try{const r=await fetch("version.json?t="+Date.now(),{cache:"no-store"});if(!r.ok)return;const j=await r.json();
    let tried=null;try{tried=localStorage.getItem("ab-upd-try")}catch(_){}
    if(j.v&&j.v!==APP_V&&tried!==j.v){try{localStorage.setItem("ab-upd-try",j.v)}catch(_){}
      const go=()=>{const rl=()=>{try{sessionStorage.setItem("ab-upd",JSON.stringify({t:Date.now(),tab,y:window.scrollY}))}catch(_){}
        /* velo uguale alla schermata d'avvio: l'aggiornamento si vede come una breve dissolvenza, non come un salto */
        const v=document.createElement("div");const li=window.ABTRI&&ABTRI.launchImg&&ABTRI.launchImg();
        v.style.cssText="position:fixed;inset:0;z-index:90;opacity:0;transition:opacity .22s ease;background:#0b1854";
        document.body.appendChild(v);requestAnimationFrame(()=>{v.style.opacity="1"});setTimeout(()=>location.reload(),260)};if(dirty&&!saving&&MYID){save().finally(rl)}else rl()};
      const ok=()=>idleUI()&&!document.querySelector(".splash");if(ok())go();else{const t=setInterval(()=>{if(ok()){clearInterval(t);go()}},1500)}}
  }catch(_){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkUpdate()});
setTimeout(checkUpdate,6000);
/* quando l'app va in sottofondo, iPhone ne fotografa lo schermo e lo rimostra alla riapertura:
   copriamo l'app con l'immagine d'avvio, così la "foto" è identica e non si vede la barra delle sezioni per un attimo */
function veilOn(){if(document.getElementById("bgveil"))return;const li=window.ABTRI&&ABTRI.launchImg&&ABTRI.launchImg();
  const v=document.createElement("div");v.id="bgveil";
  v.style.cssText="position:fixed;left:0;top:0;width:100vw;height:"+((window.ABTRI&&ABTRI.fh)?ABTRI.fh():innerHeight)+"px;z-index:95;pointer-events:none;background:#0b1854";
  document.body.appendChild(v)}
function veilOff(){const v=document.getElementById("bgveil");if(!v)return;v.style.transition="opacity .35s ease";requestAnimationFrame(()=>{v.style.opacity="0"});setTimeout(()=>v.remove(),400)}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")veilOn();else setTimeout(veilOff,60)});
addEventListener("pagehide",veilOn);
addEventListener("pageshow",()=>setTimeout(veilOff,60));
/* app installata: la barra delle sezioni resta inchiodata al fondo dello schermo, anche mentre si scorre
   (su iPhone il bordo in basso "respira" durante lo scorrimento e la trascinava su) */
const pinBar=(()=>{if(!IS_APP)return ()=>{};
  const pr=document.createElement("div");pr.style.cssText="position:fixed;left:0;bottom:0;width:1px;height:1px;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px);pointer-events:none";
  document.body.appendChild(pr);let sab=parseFloat(getComputedStyle(pr).paddingBottom)||0;
  return ()=>{const portrait=innerHeight>=innerWidth;const root=document.documentElement;
    if(!portrait){root.classList.remove("pinbar");return}
    const tb=document.querySelector(".tabbar");if(!tb)return;
    const now=parseFloat(getComputedStyle(pr).paddingBottom)||0;if(now>sab)sab=now; /* il valore più grande è quello vero */
    const fh=Math.max(innerHeight,screen.height),gap=Math.max(6,sab-14);
    root.style.setProperty("--tb-top",(fh-gap-tb.offsetHeight)+"px");root.classList.add("pinbar")}})();
const _render=render;render=function(){_render();pinBar()};
addEventListener("resize",()=>pinBar());
/* girando il telefono la Tattica ridisegna il campo nel verso giusto */
try{matchMedia("(orientation: landscape) and (min-width:600px)").addEventListener("change",m=>{if(tab!=="tattica"||!$("#pitch"))return;const y=window.scrollY;anim="";render();window.scrollTo(0,y);
  /* appena girato in orizzontale, il campo si mette tutto in vista */
  if(m.matches)setTimeout(()=>{const p=$("#pitch");if(p)p.scrollIntoView({block:"start",behavior:reducedM()?"auto":"smooth"})},120)})}catch(_){}addEventListener("orientationchange",()=>setTimeout(pinBar,300));
pinBar();
})();
