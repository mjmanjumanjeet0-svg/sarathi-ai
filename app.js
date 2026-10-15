"use strict";
const $=id=>document.getElementById(id);
const STORAGE_KEY="sarathi_ai_chats_v1",SETTINGS_KEY="sarathi_ai_settings_v1";
const state={chats:[],activeId:null,busy:false,recognition:null,findMatches:[],findIndex:0,attachments:[],webEnabled:false};
function makeId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function loadJSON(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f}catch{return f}}
function saveChats(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state.chats))}catch{setStatus("चैट सेव नहीं हो सकी। फोन में स्टोरेज खाली करें।")}}
function getSettings(){return loadJSON(SETTINGS_KEY,{workerUrl:"",assistantName:"सारथी"})}
function saveSettings(s){localStorage.setItem(SETTINGS_KEY,JSON.stringify(s))}
function activeChat(){return state.chats.find(c=>c.id===state.activeId)||null}
function createChat(){const c={id:makeId(),title:"नई चैट",messages:[],pinned:false,project:false,createdAt:Date.now(),updatedAt:Date.now()};state.chats.unshift(c);state.activeId=c.id;saveChats();renderAll();$("messageInput").focus()}
function setStatus(m){$("status").textContent=m||""}
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function formatText(raw){
 const lines=String(raw).replace(/\r/g,"").split("\n");let out=[],list=null,codeMode=false,code=[];
 const inline=s=>escapeHTML(s).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,"$1<em>$2</em>");
 const closeList=()=>{if(list){out.push(list==="ul"?"</ul>":"</ol>");list=null}};
 for(const line of lines){
  if(/^```/.test(line.trim())){closeList();if(!codeMode){codeMode=true;code=[]}else{out.push("<pre><code>"+escapeHTML(code.join("\n"))+"</code></pre>");codeMode=false}continue}
  if(codeMode){code.push(line);continue}if(!line.trim()){closeList();continue}
  const ul=line.match(/^\s*[-*]\s+(.+)/),ol=line.match(/^\s*\d+[.)]\s+(.+)/);
  if(ul||ol){const type=ul?"ul":"ol";if(list!==type){closeList();out.push(type==="ul"?"<ul>":"<ol>");list=type}out.push("<li>"+inline((ul||ol)[1])+"</li>");continue}
  closeList();const h=line.match(/^\s{0,3}(#{1,3})\s+(.+)/);
  if(h){const n=h[1].length;out.push(`<h${n}>${inline(h[2])}</h${n}>`)}else out.push("<p>"+inline(line)+"</p>");
 }
 closeList();if(codeMode)out.push("<pre><code>"+escapeHTML(code.join("\n"))+"</code></pre>");return out.join("");
}
function renderHistory(){const list=$("historyList");list.replaceChildren();for(const c of state.chats){const b=document.createElement("button");b.className="history-item"+(c.id===state.activeId?" active":"");const p=document.createElement("span");p.className="pin-mark";p.textContent=c.pinned?"📌":"";const t=document.createElement("span");t.textContent=c.title||"नई चैट";t.title=t.textContent;b.append(p,t);b.addEventListener("click",()=>{state.activeId=c.id;renderAll();closeSidebarOnMobile()});list.appendChild(b)}}
function renderMessages(){const c=activeChat(),box=$("messages");box.replaceChildren();$("welcome").classList.toggle("hidden",!!(c&&c.messages.length));if(!c)return;
 for(const m of c.messages){const row=document.createElement("div");row.className="message "+(m.role==="user"?"user":"assistant");const a=document.createElement("div");a.className="avatar";a.textContent=m.role==="user"?"🙂":"🦚";const col=document.createElement("div");col.className="message-column";const bubble=document.createElement("div");bubble.className="bubble";bubble.innerHTML=formatText(m.content);col.appendChild(bubble);
  if(m.role==="assistant"){const actions=document.createElement("div");actions.className="message-actions";const copy=document.createElement("button");copy.textContent="कॉपी";copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(m.content);setStatus("उत्तर कॉपी हो गया।")}catch{setStatus("कॉपी नहीं हुआ। उत्तर को चुनकर कॉपी करें।")}});actions.appendChild(copy);col.appendChild(actions)}
  if(m.role==="user")row.append(col,a);else row.append(a,col);box.appendChild(row)}$("chatArea").scrollTop=$("chatArea").scrollHeight}
function renderAll(){renderHistory();renderMessages()}
function closeSidebarOnMobile(){if(innerWidth<=700)$("sidebar").classList.remove("open")}
function updateTitle(c){if(!c)return;const first=c.messages.find(m=>m.role==="user");if(first&&c.title==="नई चैट")c.title=first.content.trim().slice(0,35)||"नई चैट";c.updatedAt=Date.now();state.chats.sort((a,b)=>a.pinned!==b.pinned?(a.pinned?-1:1):b.updatedAt-a.updatedAt)}
function showAttachments(){const box=$("attachmentPreview");if(!state.attachments.length){box.classList.add("hidden");box.textContent="";return}box.classList.remove("hidden");box.textContent="चुनी गई फाइलें: "+state.attachments.map(f=>f.name).join(", ")+" — हटाने के लिए टैप करें";box.onclick=()=>{state.attachments=[];$("fileInput").value="";showAttachments()}}
async function sendMessage(text){
 text=String(text||"").trim();if((!text&&!state.attachments.length)||state.busy)return;
 if(state.attachments.length){setStatus("फोटो/फाइल चुनी गई है, लेकिन उसे AI तक भेजने के लिए Worker में फाइल/इमेज सपोर्ट जोड़ना होगा।");if(!text)return}
 if(!activeChat())createChat();const c=activeChat();c.messages.push({role:"user",content:text+(state.attachments.length?"\n[संलग्न फाइल: "+state.attachments.map(f=>f.name).join(", ")+"]":"")});updateTitle(c);saveChats();renderAll();
 $("messageInput").value="";$("messageInput").style.height="auto";$("sendBtn").disabled=true;state.busy=true;setStatus("सारथी जवाब तैयार कर रहा है...");
 try{const s=getSettings();if(!s.workerUrl)throw new Error("पहले सेटिंग्स में Cloudflare Worker URL सेव करें।");const base=s.workerUrl.trim().replace(/\/+$/,""),endpoint=base.endsWith("/api/chat")?base:base+"/api/chat";
  const messages=c.messages.filter(m=>m.role==="user"||m.role==="assistant").slice(-30).map(m=>({role:m.role,content:m.content}));
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages,webSearch:state.webEnabled}),signal:AbortSignal.timeout(90000)});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"सर्वर में समस्या आई (HTTP "+response.status+")।");if(typeof data.reply!=="string"||!data.reply.trim())throw new Error("सर्वर से सही उत्तर नहीं मिला। Worker का कोड जाँचें।");c.messages.push({role:"assistant",content:data.reply.trim()});setStatus("");
 }catch(e){c.messages.push({role:"assistant",content:"माफ कीजिए, अभी उत्तर नहीं मिल पाया।\n\nकारण: "+(e&&e.message?e.message:"इंटरनेट या सर्वर से कनेक्शन नहीं हो पाया।")});setStatus("कनेक्शन की समस्या")}
 finally{state.busy=false;$("sendBtn").disabled=false;updateTitle(c);saveChats();renderAll();$("messageInput").focus()}
}
$("chatForm").addEventListener("submit",e=>{e.preventDefault();sendMessage($("messageInput").value)});
$("messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("chatForm").requestSubmit()}});
$("messageInput").addEventListener("input",()=>{const x=$("messageInput");x.style.height="auto";x.style.height=Math.min(x.scrollHeight,150)+"px"});
$("newChatBtn").addEventListener("click",()=>{createChat();closeSidebarOnMobile()});$("topNewBtn").addEventListener("click",createChat);$("menuBtn").addEventListener("click",()=>$("sidebar").classList.toggle("open"));$("moreBtn").addEventListener("click",()=>$("moreMenu").classList.toggle("hidden"));
document.addEventListener("click",e=>{if(!e.target.closest("#moreMenu")&&!e.target.closest("#moreBtn"))$("moreMenu").classList.add("hidden")});
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>sendMessage(b.dataset.prompt)));
$("webToggle").addEventListener("click",()=>{state.webEnabled=!state.webEnabled;$("webToggle").classList.toggle("on",state.webEnabled);$("webToggle").setAttribute("aria-pressed",String(state.webEnabled));$("webToggle").textContent=state.webEnabled?"🌐 इंटरनेट खोज: चालू":"🌐 इंटरनेट खोज: बंद";setStatus(state.webEnabled?"इंटरनेट खोज का अनुरोध भेजा जाएगा; Worker में वेब-सर्च सुविधा भी जरूरी है।":"इंटरनेट खोज बंद है।")});
$("attachBtn").addEventListener("click",()=>$("attachDialog").showModal());$("closeAttach").addEventListener("click",()=>$("attachDialog").close());
$("cameraOption").addEventListener("click",()=>{$("fileInput").setAttribute("accept","image/*");$("fileInput").setAttribute("capture","environment");$("attachDialog").close();$("fileInput").click()});
$("photosOption").addEventListener("click",()=>{$("fileInput").setAttribute("accept","image/*");$("fileInput").removeAttribute("capture");$("attachDialog").close();$("fileInput").click()});
$("filesOption").addEventListener("click",()=>{$("fileInput").setAttribute("accept","image/*,.pdf,.txt,.doc,.docx");$("fileInput").removeAttribute("capture");$("attachDialog").close();$("fileInput").click()});
$("fileInput").addEventListener("change",e=>{state.attachments=Array.from(e.target.files||[]);showAttachments()});
$("moreMenu").addEventListener("click",async e=>{const b=e.target.closest("[data-action]");if(!b)return;const action=b.dataset.action,c=activeChat();$("moreMenu").classList.add("hidden");if(action==="settings"){openSettings();return}if(action==="home"){state.activeId=null;renderAll();return}if(action==="find"){$("findInput").value="";$("findResult").textContent="";$("findDialog").showModal();$("findInput").focus();return}if(!c){setStatus("पहले कोई चैट शुरू करें।");return}
 if(action==="share"){const text=c.messages.map(m=>(m.role==="user"?"आप: ":"सारथी: ")+m.content).join("\n\n");try{if(navigator.share)await navigator.share({title:c.title,text});else if(navigator.clipboard){await navigator.clipboard.writeText(text);setStatus("चैट का टेक्स्ट कॉपी हो गया।")}else setStatus("इस ब्राउज़र में शेयर सुविधा उपलब्ध नहीं है।")}catch(err){if(err.name!=="AbortError")setStatus("शेयर नहीं हो पाया।")}}
 if(action==="pin"){c.pinned=!c.pinned;saveChats();renderAll();setStatus(c.pinned?"चैट पिन हो गई।":"चैट अनपिन हो गई।")}
 if(action==="rename"){const t=prompt("चैट का नया नाम लिखें:",c.title);if(t&&t.trim()){c.title=t.trim().slice(0,70);saveChats();renderAll()}}
 if(action==="project"){c.project=!c.project;saveChats();setStatus(c.project?"चैट को प्रोजेक्ट के रूप में चिह्नित किया गया।":"प्रोजेक्ट चिह्न हटाया गया।")}
 if(action==="delete"&&confirm("क्या आप यह पूरी चैट हटाना चाहते हैं?")){state.chats=state.chats.filter(x=>x.id!==c.id);state.activeId=state.chats[0]?.id||null;saveChats();renderAll();setStatus("चैट हटा दी गई।")}
});
function openSettings(){const s=getSettings();$("workerUrl").value=s.workerUrl||"";$("assistantName").value=s.assistantName||"सारथी";$("settingsDialog").showModal()}
$("settingsBtn").addEventListener("click",openSettings);$("cancelSettings").addEventListener("click",()=>$("settingsDialog").close());
$("saveSettings").addEventListener("click",()=>{const raw=$("workerUrl").value.trim();let workerUrl="";if(raw){try{const u=new URL(raw);if(u.protocol!=="https:"){setStatus("Worker URL https:// से शुरू होना चाहिए।");return}workerUrl=u.origin+u.pathname.replace(/\/+$/,"")}catch{setStatus("सही Worker URL लिखें।");return}}saveSettings({workerUrl,assistantName:$("assistantName").value.trim()||"सारथी"});$("settingsDialog").close();setStatus("सेटिंग्स सेव हो गईं।")});
$("findNext").addEventListener("click",()=>{const q=$("findInput").value.trim().toLowerCase(),c=activeChat();if(!q||!c){$("findResult").textContent="पहले शब्द लिखें और चैट खोलें।";return}const found=c.messages.map((msg,index)=>({msg,index})).filter(x=>x.msg.content.toLowerCase().includes(q));state.findMatches=found;state.findIndex=0;if(!found.length){$("findResult").textContent="कोई परिणाम नहीं मिला।";return}const r=found[0];$("findResult").textContent=`${found.length} परिणाम मिले। पहला परिणाम: संदेश ${r.index+1} — ${r.msg.content.slice(0,100)}`;$("messages").querySelectorAll(".message")[r.index]?.scrollIntoView({behavior:"smooth",block:"center"})});
$("micBtn").addEventListener("click",()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setStatus("इस ब्राउज़र में आवाज से लिखने की सुविधा उपलब्ध नहीं है। Chrome में माइक्रोफोन अनुमति जाँचें।");return}if(state.recognition){state.recognition.stop();state.recognition=null;$("micBtn").textContent="🎙️";$("micBtn").classList.remove("listening");return}
 const r=new SR();r.lang="hi-IN";r.interimResults=true;r.continuous=false;state.recognition=r;$("micBtn").textContent="⏹️";$("micBtn").classList.add("listening");setStatus("बोलिए, सारथी सुन रहा है...");
 r.onresult=e=>{let t="";for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;$("messageInput").value=t;$("messageInput").dispatchEvent(new Event("input"))};
 r.onerror=()=>setStatus("माइक काम नहीं कर पाया। माइक्रोफोन अनुमति जाँचें।");r.onend=()=>{state.recognition=null;$("micBtn").textContent="🎙️";$("micBtn").classList.remove("listening");if($("status").textContent.includes("सुन रहा है"))setStatus("")};try{r.start()}catch{state.recognition=null;$("micBtn").textContent="🎙️";$("micBtn").classList.remove("listening");setStatus("माइक शुरू नहीं हो पाया।")}
});
(function init(){const a=loadJSON(STORAGE_KEY,[]);state.chats=Array.isArray(a)?a.filter(c=>c&&typeof c.id==="string"&&Array.isArray(c.messages)):[];if(state.chats.length){state.chats.sort((a,b)=>a.pinned!==b.pinned?(a.pinned?-1:1):(b.updatedAt||0)-(a.updatedAt||0));state.activeId=state.chats[0].id}renderAll()})();
