"use strict";

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "sarathi_ai_chats_v1";
const SETTINGS_KEY = "sarathi_ai_settings_v1";

const state = {
  chats: [],
  activeId: null,
  busy: false,
  recognition: null,
  findMatches: [],
  findIndex: 0
};

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveChats() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.chats));
  } catch {
    setStatus("चैट सेव नहीं हो सकी। फोन में स्टोरेज खाली करें।");
  }
}

function getSettings() {
  return loadJSON(SETTINGS_KEY, {
    workerUrl: "",
    assistantName: "सारथी"
  });
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function activeChat() {
  return state.chats.find(chat => chat.id === state.activeId) || null;
}

function createChat() {
  const chat = {
    id: makeId(),
    title: "नई चैट",
    messages: [],
    pinned: false,
    project: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  state.chats.unshift(chat);
  state.activeId = chat.id;
  saveChats();
  renderAll();
  $("messageInput").focus();
}

function setStatus(message) {
  $("status").textContent = message || "";
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

/* सरल टेक्स्ट प्रदर्शन; AI के उत्तर को HTML की तरह नहीं चलाता। */
function formatText(text) {
  return escapeHTML(text).replace(/\n/g, "<br>");
}

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();

  for (const chat of state.chats) {
    const button = document.createElement("button");
    button.className = "history-item" +
      (chat.id === state.activeId ? " active" : "");

    const pin = document.createElement("span");
    pin.className = "pin-mark";
    pin.textContent = chat.pinned ? "📌" : "";

    const title = document.createElement("span");
    title.textContent = chat.title || "नई चैट";
    title.title = title.textContent;

    button.append(pin, title);
    button.addEventListener("click", () => {
      state.activeId = chat.id;
      renderAll();
      closeSidebarOnMobile();
    });

    list.appendChild(button);
  }
}

function renderMessages() {
  const chat = activeChat();
  const messages = $("messages");
  messages.replaceChildren();

  $("welcome").classList.toggle(
    "hidden",
    !!(chat && chat.messages.length)
  );

  if (!chat) return;

  for (const msg of chat.messages) {
    const row = document.createElement("div");
    row.className = "message " + (msg.role === "user" ? "user" : "assistant");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = msg.role === "user" ? "🙂" : "🦚";

    const column = document.createElement("div");
    column.className = "message-column";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = formatText(msg.content);

    column.appendChild(bubble);

    if (msg.role === "assistant") {
      const actions = document.createElement("div");
      actions.className = "message-actions";

      const copy = document.createElement("button");
      copy.textContent = "कॉपी";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(msg.content);
          setStatus("उत्तर कॉपी हो गया।");
        } catch {
          setStatus("कॉपी नहीं हुआ। उत्तर को चुनकर कॉपी करें।");
        }
      });

      actions.appendChild(copy);
      column.appendChild(actions);
    }

    if (msg.role === "user") {
      row.append(column, avatar);
    } else {
      row.append(avatar, column);
    }

    messages.appendChild(row);
  }

  $("chatArea").scrollTop = $("chatArea").scrollHeight;
}

function renderAll() {
  renderHistory();
  renderMessages();
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 700) {
    $("sidebar").classList.remove("open");
  }
}

function updateTitle(chat) {
  if (!chat) return;

  const first = chat.messages.find(msg => msg.role === "user");
  if (first && chat.title === "नई चैट") {
    chat.title = first.content.trim().slice(0, 35) || "नई चैट";
  }

  chat.updatedAt = Date.now();
  state.chats.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

async function sendMessage(text) {
  text = String(text || "").trim();
  if (!text || state.busy) return;

  if (!activeChat()) createChat();

  const chat = activeChat();
  chat.messages.push({ role: "user", content: text });
  updateTitle(chat);
  saveChats();
  renderAll();

  $("messageInput").value = "";
  $("messageInput").style.height = "auto";
  $("sendBtn").disabled = true;
  state.busy = true;
  setStatus("सारथी जवाब तैयार कर रहा है...");

  try {
    const settings = getSettings();

    if (!settings.workerUrl) {
      throw new Error(
        "पहले सेटिंग्स में Cloudflare Worker URL सेव करें।"
      );
    }

    const baseURL = settings.workerUrl.trim().replace(/\/+$/, "");
    const endpoint = baseURL.endsWith("/api/chat")
      ? baseURL
      : baseURL + "/api/chat";

    const messages = chat.messages
      .filter(msg => msg.role === "user" || msg.role === "assistant")
      .slice(-30)
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "सर्वर में समस्या आई (HTTP " + response.status + ")।");
    }

    if (typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error("सर्वर से सही उत्तर नहीं मिला। Worker का कोड जाँचें।");
    }

    chat.messages.push({
      role: "assistant",
      content: data.reply.trim()
    });

    setStatus("");
  } catch (error) {
    const message = error && error.message
      ? error.message
      : "इंटरनेट या सर्वर से कनेक्शन नहीं हो पाया।";

    chat.messages.push({
      role: "assistant",
      content: "माफ कीजिए, अभी उत्तर नहीं मिल पाया।\n\nकारण: " + message
    });

    setStatus("कनेक्शन की समस्या");
  } finally {
    state.busy = false;
    $("sendBtn").disabled = false;
    updateTitle(chat);
    saveChats();
    renderAll();
    $("messageInput").focus();
  }
}

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  sendMessage($("messageInput").value);
});

$("messageInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("chatForm").requestSubmit();
  }
});

$("messageInput").addEventListener("input", () => {
  const input = $("messageInput");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
});

$("newChatBtn").addEventListener("click", () => {
  createChat();
  closeSidebarOnMobile();
});

$("topNewBtn").addEventListener("click", createChat);

$("menuBtn").addEventListener("click", () => {
  if (window.innerWidth <= 700) {
    $("sidebar").classList.toggle("open");
  } else {
    $("sidebar").classList.toggle("open");
  }
});

$("moreBtn").addEventListener("click", () => {
  $("moreMenu").classList.toggle("hidden");
});

document.addEventListener("click", event => {
  if (!event.target.closest("#moreMenu") &&
      !event.target.closest("#moreBtn")) {
    $("moreMenu").classList.add("hidden");
  }
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});

$("moreMenu").addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const chat = activeChat();
  $("moreMenu").classList.add("hidden");

  if (action === "settings") {
    openSettings();
    return;
  }

  if (action === "home") {
    state.activeId = null;
    renderAll();
    return;
  }

  if (action === "find") {
    $("findInput").value = "";
    $("findResult").textContent = "";
    $("findDialog").showModal();
    $("findInput").focus();
    return;
  }

  if (!chat) {
    setStatus("पहले कोई चैट शुरू करें।");
    return;
  }

  if (action === "share") {
    const text = chat.messages.map(msg =>
      (msg.role === "user" ? "आप: " : "सारथी: ") + msg.content
    ).join("\n\n");

    try {
      if (navigator.share) {
        await navigator.share({ title: chat.title, text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setStatus("चैट का टेक्स्ट कॉपी हो गया।");
      } else {
        setStatus("इस ब्राउज़र में शेयर सुविधा उपलब्ध नहीं है।");
      }
    } catch (error) {
      if (error.name !== "AbortError") setStatus("शेयर नहीं हो पाया।");
    }
  }

  if (action === "pin") {
    chat.pinned = !chat.pinned;
    saveChats();
    renderAll();
    setStatus(chat.pinned ? "चैट पिन हो गई।" : "चैट अनपिन हो गई।");
  }

  if (action === "rename") {
    const title = prompt("चैट का नया नाम लिखें:", chat.title);
    if (title && title.trim()) {
      chat.title = title.trim().slice(0, 70);
      saveChats();
      renderAll();
    }
  }

  if (action === "project") {
    chat.project = !chat.project;
    saveChats();
    setStatus(
      chat.project
        ? "चैट को प्रोजेक्ट के रूप में चिह्नित किया गया।"
        : "प्रोजेक्ट चिह्न हटाया गया।"
    );
  }

  if (action === "delete") {
    if (confirm("क्या आप यह पूरी चैट हटाना चाहते हैं?")) {
      state.chats = state.chats.filter(item => item.id !== chat.id);
      state.activeId = state.chats[0]?.id || null;
      saveChats();
      renderAll();
      setStatus("चैट हटा दी गई।");
    }
  }
});

function openSettings() {
  const settings = getSettings();
  $("workerUrl").value = settings.workerUrl || "";
  $("assistantName").value = settings.assistantName || "सारथी";
  $("settingsDialog").showModal();
}

$("settingsBtn").addEventListener("click", openSettings);
$("cancelSettings").addEventListener("click", () => $("settingsDialog").close());

$("saveSettings").addEventListener("click", () => {
  const rawURL = $("workerUrl").value.trim();
  let workerUrl = "";

  if (rawURL) {
    try {
      const parsed = new URL(rawURL);
      if (parsed.protocol !== "https:") {
        setStatus("Worker URL https:// से शुरू होना चाहिए।");
        return;
      }
      workerUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
    } catch {
      setStatus("सही Worker URL लिखें।");
      return;
    }
  }

  saveSettings({
    workerUrl,
    assistantName: $("assistantName").value.trim() || "सारथी"
  });

  $("settingsDialog").close();
  setStatus("सेटिंग्स सेव हो गईं।");
});

$("findNext").addEventListener("click", () => {
  const query = $("findInput").value.trim().toLowerCase();
  const chat = activeChat();

  if (!query || !chat) {
    $("findResult").textContent = "पहले शब्द लिखें और चैट खोलें।";
    return;
  }

  const matches = chat.messages
    .map((msg, index) => ({ msg, index }))
    .filter(item => item.msg.content.toLowerCase().includes(query));

  state.findMatches = matches;
  state.findIndex = 0;

  if (!matches.length) {
    $("findResult").textContent = "कोई परिणाम नहीं मिला।";
    return;
  }

  const result = matches[0];
  $("findResult").textContent =
    `${matches.length} परिणाम मिले। पहला परिणाम: संदेश ${result.index + 1} — ` +
    result.msg.content.slice(0, 100);

  const messageRows = $("messages").querySelectorAll(".message");
  messageRows[result.index]?.scrollIntoView({ behavior: "smooth", block: "center" });
});

$("micBtn").addEventListener("click", () => {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus("इस ब्राउज़र में आवाज से लिखने की सुविधा उपलब्ध नहीं है।");
    return;
  }

  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;
    $("micBtn").textContent = "🎙️";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "hi-IN";
  recognition.interimResults = true;
  recognition.continuous = false;
  state.recognition = recognition;
  $("micBtn").textContent = "⏹️";
  setStatus("बोलिए, सारथी सुन रहा है...");

  recognition.onresult = event => {
    let text = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    $("messageInput").value = text;
    $("messageInput").dispatchEvent(new Event("input"));
  };

  recognition.onerror = () => {
    setStatus("माइक काम नहीं कर पाया। माइक्रोफोन अनुमति जाँचें।");
  };

  recognition.onend = () => {
    state.recognition = null;
    $("micBtn").textContent = "🎙️";
    if ($("status").textContent.includes("सुन रहा है")) setStatus("");
  };

  try {
    recognition.start();
  } catch {
    state.recognition = null;
    $("micBtn").textContent = "🎙️";
    setStatus("माइक शुरू नहीं हो पाया।");
  }
});

/* ऐप शुरू करना */
(function init() {
  const loaded = loadJSON(STORAGE_KEY, []);
  state.chats = Array.isArray(loaded)
    ? loaded.filter(chat =>
        chat &&
        typeof chat.id === "string" &&
        Array.isArray(chat.messages)
      )
    : [];

  if (state.chats.length) {
    state.chats.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    state.activeId = state.chats[0].id;
  }

  renderAll();
})();
