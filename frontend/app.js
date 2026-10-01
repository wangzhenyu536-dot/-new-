const $=id=>document.getElementById(id);
const state={session:null,online:false,accountStep:1,userColor:localStorage.getItem("evertraceColor")||"#ff542e",pack:null,signalFiles:{eeg:null,emg:null}};
document.documentElement.style.setProperty("--user",state.userColor);

const esc=(value="")=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const toast=message=>{const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)};

function finishLoader(){
  $("loader").classList.add("done");
  $("site").classList.add("ready");
  $("site").setAttribute("aria-hidden","false");
  document.body.classList.remove("is-loading");
}
function startLoader(){
  if(sessionStorage.getItem("evertraceIntroSeen")){finishLoader();return}
  let value=0;
  const timer=setInterval(()=>{
    value=Math.min(100,value+Math.max(1,Math.round((100-value)*.12)));
    $("loadingNumber").textContent=String(value).padStart(3,"0")+"%";
    $("loadingBar").style.width=value+"%";
    if(value>=100){clearInterval(timer);sessionStorage.setItem("evertraceIntroSeen","1");setTimeout(finishLoader,420)}
  },55);
  $("skipIntro").onclick=()=>{clearInterval(timer);sessionStorage.setItem("evertraceIntroSeen","1");finishLoader()};
}

function initParallax(){
  const stage=$("portraitStage");
  if(!stage||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  stage.addEventListener("pointermove",event=>{
    const rect=stage.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width-.5,y=(event.clientY-rect.top)/rect.height-.5;
    stage.style.setProperty("--mx",`${x*-78}px`);stage.style.setProperty("--my",`${y*-38}px`);
  });
  stage.addEventListener("pointerleave",()=>{stage.style.setProperty("--mx","0px");stage.style.setProperty("--my","0px")});
}

function initNavigation(){
  const nav=$("nav");let last=0;
  addEventListener("scroll",()=>{const current=scrollY;nav.classList.toggle("hide-nav",current>last&&current>220);last=current},{passive:true});
  $("menuButton").onclick=()=>{const open=nav.classList.toggle("open");$("menuButton").setAttribute("aria-expanded",String(open))};
  nav.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>nav.classList.remove("open")));
  document.querySelectorAll("[data-scroll-studio]").forEach(button=>button.onclick=()=>$("studio").scrollIntoView({behavior:"smooth"}));
}

function initMaterials(){
  const notes={text:"Text carries the facts, feelings, and choices a person explicitly shares. It is the primary source of meaning.",audio:"Audio preserves the rhythm and original phrasing of a story. Transcripts enter the final pack only after review.",image:"Images describe visible scenes, objects, and actions. Facial expressions are not treated as proof of emotion or personality.",signal:"EEG and EMG record signal quality, timing, and relative change only—not thoughts, truthfulness, or medical conditions."};
  document.querySelectorAll("[data-material]").forEach(button=>button.onclick=()=>{document.querySelectorAll("[data-material]").forEach(x=>x.classList.remove("active"));button.classList.add("active");$("materialNote").textContent=notes[button.dataset.material]});
}

const readableSize=bytes=>bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;
function renderSignals(){
  const records=Object.values(state.signalFiles).filter(Boolean);
  $("signalFileCount").textContent=String(records.length).padStart(2,"0");
  $("signalTotalSize").textContent=readableSize(records.reduce((sum,item)=>sum+item.file.size,0));
  $("signalDeskStatus").textContent=records.length?"READY FOR OFFLINE ANALYSIS":"AWAITING DATA";
  for(const type of ["eeg","emg"]){
    const record=state.signalFiles[type],card=document.querySelector(`[data-signal-card="${type}"]`);
    card.classList.toggle("loaded",Boolean(record));
    $(`${type}FileName`).textContent=record?`${record.file.name} / ${readableSize(record.file.size)}`:`NO ${type.toUpperCase()} FILE`;
  }
}
async function attachSignalFiles(){
  if(!state.session)return;
  for(const [type,record] of Object.entries(state.signalFiles)){
    if(!record||record.attachedTo===state.session.id)continue;
    if(state.online){
      const data=new FormData();data.append("file",record.file);
      await api(`/api/sessions/${state.session.id}/upload`,{method:"POST",body:data});
    }else state.session.evidence.push({filename:record.file.name,media_type:`${type.toUpperCase()} SIGNAL`,size:record.file.size});
    record.attachedTo=state.session.id;
  }
  if(state.online)state.session=await api(`/api/sessions/${state.session.id}`);
}
function initSignals(){
  document.querySelectorAll("[data-signal-input]").forEach(input=>input.addEventListener("change",async event=>{
    const file=event.target.files[0];if(!file)return;
    const type=input.dataset.signalInput;state.signalFiles[type]={file,attachedTo:null};renderSignals();
    try{
      if(state.session){await attachSignalFiles();renderSession();toast(`${type.toUpperCase()} SIGNAL ADDED`)}
      else toast(`${type.toUpperCase()} SIGNAL READY FOR YOUR NEXT SESSION`);
    }catch(error){toast(error.message)}
  }));
  renderSignals();
}

function openAccount(mode="register"){
  state.accountStep=1;renderAccount();
  $("accountStepLabel").textContent=mode==="login"?"SIGN IN / PRIVATE ACCOUNT":"REGISTER / 01 OF 03";
  $("accountDialog").showModal();
}
function renderAccount(){
  document.querySelectorAll(".account-step").forEach(step=>step.classList.toggle("active",Number(step.dataset.step)===state.accountStep));
  $("accountBack").disabled=state.accountStep===1;
  $("accountNext").innerHTML=state.accountStep===3?"CREATE ACCOUNT <span>↗</span>":"CONTINUE <span>↗</span>";
  $("accountStepLabel").textContent=`REGISTER / 0${state.accountStep} OF 03`;
}
function initAccount(){
  document.querySelectorAll("[data-open]").forEach(button=>button.onclick=()=>openAccount(button.dataset.open));
  document.querySelector("[data-close]").onclick=()=>$("accountDialog").close();
  $("accountBack").onclick=()=>{state.accountStep=Math.max(1,state.accountStep-1);renderAccount()};
  document.querySelectorAll("[data-color]").forEach(button=>button.onclick=()=>{document.querySelectorAll("[data-color]").forEach(x=>x.classList.remove("selected"));button.classList.add("selected");state.userColor=button.dataset.color;document.documentElement.style.setProperty("--user",state.userColor)});
  $("accountForm").onsubmit=event=>{
    event.preventDefault();
    const active=document.querySelector(`.account-step[data-step="${state.accountStep}"]`);
    const fields=[...active.querySelectorAll("input")];
    if(fields.some(field=>!field.checkValidity())){fields.find(field=>!field.checkValidity())?.reportValidity();return}
    if(state.accountStep<3){state.accountStep++;renderAccount();return}
    localStorage.setItem("evertraceColor",state.userColor);localStorage.setItem("evertraceUser",$("accountName").value||"PRIVATE MEMBER");
    $("accountDialog").close();toast("PRIVATE ARCHIVE CREATED");$("studio").scrollIntoView({behavior:"smooth"});
  };
}

async function api(path,options={}){
  const response=await fetch(path,options);
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"The request could not be completed");
  return data;
}
async function checkBackend(){
  try{const health=await api("/api/health");state.online=true;$("mode").textContent=health.ai_mode==="openai"?"AI ONLINE / LOCAL ARCHIVE":"DEMO AI / LOCAL ARCHIVE"}
  catch{state.online=false;$("mode").textContent="BROWSER DEMO / LOCAL ONLY"}
}
function demoSession(story){
  return{id:"DEMO"+Date.now().toString().slice(-6),title:"My Experience Record",status:"collecting",questions_used:1,evidence:[],messages:[{role:"user",content:story},{role:"agent",content:"What detail from this experience stayed with you most?"}],state:{}};
}
const demoQuestions=["What detail from this experience stayed with you most?","What did you do in response, if anything?","Where did this experience leave off for you?"];
function demoAdvance(answer){
  const s=state.session;s.messages.push({role:"user",content:answer});
  if(s.questions_used>=3){s.status="ready";return s}
  s.messages.push({role:"agent",content:demoQuestions[s.questions_used]});s.questions_used++;return s;
}
function demoPackage(){
  const text=state.session.messages.filter(m=>m.role==="user").map(m=>m.content).join("\n\n");
  return{title:"An Experience Coming Into Focus",one_sentence_summary:text.slice(0,95)+(text.length>95?"…":""),narrative:text,context:"Organized from the person's own account",reflection:"Unstated details remain open for the author to review.",events:["A lived experience preserved in the archive"],skills:[],decisions:[],unknowns:["Details not yet explicitly shared"]};
}

function renderSession(){
  const s=state.session;if(!s)return;
  $("startView").classList.add("hidden");$("sessionView").classList.remove("hidden");
  $("title").textContent=s.title;$("sessionCode").textContent=s.id.toUpperCase();$("used").textContent=s.questions_used;
  [...$("questionTrack").children].forEach((line,index)=>line.classList.toggle("on",index<s.questions_used));
  $("messages").innerHTML=s.messages.map((message,index)=>`<div class="message ${message.role}"><small>${message.role==="agent"?`EVERTRACE / QUESTION ${Math.min(index,3)}`:"YOUR MEMORY"}</small>${esc(message.content)}</div>`).join("");
  $("messages").scrollTop=$("messages").scrollHeight;
  const ready=["ready","ready_for_review","archived","safety_stop"].includes(s.status);
  ["answer","answerBtn","skipBtn","finishBtn"].forEach(id=>$(id).disabled=ready);
  $("packageBtn").disabled=s.status!=="ready";
  $("hint").textContent=ready?"The interview is complete. What remains unsaid will stay open.":`Up to ${Math.max(0,3-s.questions_used)} questions remain. You may also finish now.`;
  $("files").innerHTML=s.evidence.length?s.evidence.map(file=>`<div>${esc(file.filename)}<br><small>${esc(file.media_type||"FILE")}</small></div>`).join(""):"NO MATERIAL ADDED";
}

async function startSession(){
  const story=$("story").value.trim();if(story.length<5){toast("Please share a little more before beginning");return}
  $("startBtn").disabled=true;
  try{state.session=state.online?await api("/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({story})}):demoSession(story);await attachSignalFiles();renderSession()}
  catch(error){toast(error.message)}finally{$("startBtn").disabled=false}
}
async function answerSession(){
  const answer=$("answer").value.trim();if(!answer)return;
  $("answerBtn").disabled=true;
  try{state.session=state.online?await api(`/api/sessions/${state.session.id}/answer`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({answer})}):demoAdvance(answer);$("answer").value="";renderSession()}
  catch(error){toast(error.message);$("answerBtn").disabled=false}
}
async function skipQuestion(){
  if(state.online)state.session=await api(`/api/sessions/${state.session.id}/skip`,{method:"POST"});
  else state.session=demoAdvance("I would like to leave this part open.");renderSession();
}
async function finishSession(){
  if(state.online)state.session=await api(`/api/sessions/${state.session.id}/finish`,{method:"POST"});else state.session.status="ready";renderSession();
}
async function uploadFiles(event){
  for(const file of event.target.files){
    if(state.online){const data=new FormData();data.append("file",file);await api(`/api/sessions/${state.session.id}/upload`,{method:"POST",body:data})}
    else state.session.evidence.push({filename:file.name,media_type:file.type||"FILE",size:file.size});
  }
  if(state.online)state.session=await api(`/api/sessions/${state.session.id}`);renderSession();toast("MATERIAL ADDED");
}
function renderPack(pack){
  const list=(items=[])=>items.length?`<ul>${items.map(item=>`<li>${esc(item)}</li>`).join("")}</ul>`:"<p>Not stated</p>";
  $("preview").innerHTML=`<h2 contenteditable="true">${esc(pack.title)}</h2><blockquote contenteditable="true">${esc(pack.one_sentence_summary)}</blockquote><h3>EXPERIENCE</h3><p contenteditable="true">${esc(pack.narrative)}</p><h3>CONTEXT</h3><p contenteditable="true">${esc(pack.context||"Not stated")}</p><h3>EVENTS</h3>${list(pack.events)}<h3>SKILLS</h3>${list(pack.skills)}<h3>DECISIONS</h3>${list(pack.decisions)}<h3>REFLECTION</h3><p contenteditable="true">${esc(pack.reflection||"Not stated")}</p><h3>OPEN SPACE</h3>${list(pack.unknowns)}`;
  $("result").showModal();
}
async function generatePack(){
  $("packageBtn").disabled=true;$("packageBtn").textContent="ORGANIZING MATERIAL";
  try{
    if(state.online){state.session=await api(`/api/sessions/${state.session.id}/package`,{method:"POST"});state.pack=state.session.state.package;$("folder").textContent="AI DRAFT / CONFIRM TO WRITE INTO YOUR PRIVATE ARCHIVE"}
    else{state.pack=demoPackage();$("folder").textContent="BROWSER DEMO / DOWNLOAD TO KEEP A COPY"}
    renderPack(state.pack);renderSession();
  }catch(error){toast(error.message)}finally{$("packageBtn").textContent="GENERATE WISDOM PACK"}
}
function downloadPack(){
  if(!state.pack)return;const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([JSON.stringify(state.pack,null,2)],{type:"application/json"}));link.download="wisdom-pack.json";link.click();URL.revokeObjectURL(link.href);
}
async function confirmPack(){
  try{
    if(state.online){state.session=await api(`/api/sessions/${state.session.id}/confirm`,{method:"POST"});$("folder").textContent="PRIVATE ARCHIVE: "+state.session.state.archive_folder}
    else if(state.session)state.session.status="archived";
    $("packStatus").textContent="CONFIRMED BY YOU";$("confirmPack").disabled=true;$("confirmPack").textContent="CONFIRMED";document.documentElement.style.setProperty("--user",state.userColor);toast("WISDOM PACK CONFIRMED");renderSession();
  }catch(error){toast(error.message)}
}
function initStudio(){
  $("startBtn").onclick=startSession;$("answerBtn").onclick=answerSession;$("skipBtn").onclick=skipQuestion;$("finishBtn").onclick=finishSession;$("file").onchange=uploadFiles;$("packageBtn").onclick=generatePack;
  $("newBtn").onclick=()=>{state.session=null;$("sessionView").classList.add("hidden");$("startView").classList.remove("hidden");$("story").value=""};
  $("close").onclick=()=>$("result").close();$("downloadPack").onclick=downloadPack;$("confirmPack").onclick=confirmPack;
  $("answer").addEventListener("keydown",event=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter")answerSession()});
}

startLoader();initParallax();initNavigation();initMaterials();initSignals();initAccount();initStudio();checkBackend();
