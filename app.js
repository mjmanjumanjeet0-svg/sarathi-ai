/*
 * सारथी AI वेब ऐप
 * 1) नीचे API_URL में अपना Cloudflare Worker URL डालें।
 * 2) Groq API key को कभी इस फाइल में न रखें; उसे Cloudflare secret में रखें।
 */
const API_URL = "PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE";

const $ = (selector) => document.querySelector(selector);
const form = $("#chat-form");
const input = $("#message-input");
const messagesEl = $("#messages");
const welcome = $("#welcome");
const sendButton = $("#send-button");
const sidebar = $("#sidebar");
const STORAGE_KEY = "sarathi_ai_chat_v1";
let history = loadHistory();
let busy = false;
let toastTimer;

function loadHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string") : [];
  } catch { return []; }
}
function saveHistory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-80))); }
  catch { showToast("चैट सेव नहीं हो सकी। ब्राउज़र स्टोरेज जाँचें।"); }
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function scrollToBottom() {
  const area = $("#chat-area");
  area.scrollTop = area.scrollHeight;
}
function renderMessage(role, content, extraClass = "") {
  welcome.hidden = true;
  const row = document.createElement("div");
  row.className = `message ${role === "user" ? "user" : "assistant"}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "आप" : "स";
  const bubble = document.createElement("div");
  bubble.className = `bubble ${extraClass}`.trim();
  bubble.textContent = content;
  row.append(avatar, bubble);
  messagesEl.append(row);
  scrollToBottom();
  return row;
}
function renderSavedHistory() {
  messagesEl.replaceChildren();
  if (!history.length) {
    welcome.hidden = false;
    return;
  }
  welcome.hidden = true;
  history.forEach(item => renderMessage(item.role, item.content));
}
function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
async function sendMessage(text) {
  const content = text.trim();
  if (!content || busy) return;
  if (!API_URL.startsWith("https://") || API_URL.includes("PASTE_YOUR")) {
    showToast("पहले app.js में अपना Cloudflare Worker URL डालें।");
    return;
  }
  busy = true;
  sendButton.disabled = true;
  input.disabled = true;
  history.push({ role: "user", content });
  saveHistory();
  renderMessage("user", content);
  input.value = "";
  resizeInput();
  const typing = renderMessage("assistant", "सारथी जवाब तैयार कर रहा है…");
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history.slice(-30).map(({ role, content }) => ({ role, content }))
      })
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("सर्वर से सही जवाब नहीं मिला।"); }
    if (!response.ok) throw new Error(data.error || `अनुरोध पूरा नहीं हुआ (${response.status})`);
    const answer = typeof data.reply === "string" ? data.reply.trim() : "";
    if (!answer) throw new Error("AI से खाली जवाब मिला। फिर कोशिश करें।");
    typing.querySelector(".bubble").textContent = answer;
    history.push({ role: "assistant", content: answer });
    saveHistory();
  } catch (error) {
    const message = error instanceof TypeError
      ? "सर्वर से कनेक्शन नहीं हो पाया। इंटरनेट और Worker URL जाँचें।"
      : (error.message || "कुछ गड़बड़ हुई। दोबारा कोशिश करें।");
    typing.querySelector(".bubble").textContent = message;
    typing.querySelector(".bubble").classList.add("error");
    // Failed assistant replies are not saved in conversation history.
    history = history.filter((item, index) => !(item.role === "user" && index === history.length - 1 && item.content === content));
    saveHistory();
  } finally {
    busy = false;
    sendButton.disabled = false;
    input.disabled = false;
    input.focus();
    scrollToBottom();
  }
}
form.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(input.value);
});
input.addEventListener("input", resizeInput);
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    const label = button.querySelector("b")?.textContent || "";
    const prompts = {
      "पढ़ाई में मदद": "मुझे एक विषय आसान हिंदी में समझाइए और परीक्षा के लिए मुख्य बिंदु दीजिए।",
      "कोडिंग में मदद": "मेरे कोड को समझने और गलतियाँ सुधारने में मदद कीजिए।",
      "कुछ लिखवाएँ": "मेरे लिए एक साफ़, सही और उपयोगी लेखन तैयार करने में मदद कीजिए।",
      "कोई सवाल पूछें": "मुझे किसी विषय के बारे में आसान हिंदी में समझाइए।"
    };
    input.value = prompts[label] || "";
    resizeInput();
    input.focus();
  });
});
$("#new-chat").addEventListener("click", () => {
  history = [];
  saveHistory();
  renderSavedHistory();
  sidebar.classList.remove("open");
  input.focus();
});
$("#clear-chat").addEventListener("click", () => {
  if (!confirm("क्या आप इस ब्राउज़र में सेव पूरी बातचीत मिटाना चाहते हैं?")) return;
  history = [];
  saveHistory();
  renderSavedHistory();
  showToast("बातचीत साफ़ कर दी गई।");
});
$("#menu-button").addEventListener("click", () => sidebar.classList.toggle("open"));
document.addEventListener("click", event => {
  if (window.innerWidth <= 720 && sidebar.classList.contains("open") &&
      !sidebar.contains(event.target) && !$("#menu-button").contains(event.target)) {
    sidebar.classList.remove("open");
  }
});
renderSavedHistory();
