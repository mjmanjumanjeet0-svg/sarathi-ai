"use strict";

/* ========================================
   SARATHI AI — APP.JS
   Login + Chat + History + Settings
======================================== */

const $ = id => document.getElementById(id);

const STORAGE_KEY = "sarathi_ai_chats_v1";
const SETTINGS_KEY = "sarathi_ai_settings_v1";
const AUTH_TOKEN_KEY = "sarathi_ai_auth_token_v1";

const DEFAULT_SETTINGS = {
  workerUrl: "https://sarathi-ai.mjmanjumanjeet0.workers.dev",
  assistantName: "सारथी"
};

const state = {
  chats: [],
  activeId: null,
  busy: false,
  webEnabled: localStorage.getItem("sarathi_ai_web_search_v1") === "true",
  recognition: null,
  attachments: [],
  voiceReplyPending: false
};

/* ========================================
   GENERAL HELPERS
======================================== */

function makeId() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
}

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    setStatus("डेटा सेव नहीं हो सका।");
    return false;
  }
}

function setStatus(message) {
  const element = $("status");
  if (element) element.textContent = message || "";
}

function getSettings() {
  const saved = loadJSON(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...(saved && typeof saved === "object" ? saved : {})
  };
}

function saveSettings(settings) {
  return saveJSON(SETTINGS_KEY, settings);
}

function getWorkerUrl() {
  return String(getSettings().workerUrl || "")
    .trim()
    .replace(/\/+$/, "");
}

function activeChat() {
  return state.chats.find(chat => chat.id === state.activeId) || null;
}

function safeDialogOpen(dialog) {
  if (!dialog) return;
  try {
    if (!dialog.open) dialog.showModal();
  } catch {
    setStatus("डायलॉग नहीं खुल सका।");
  }
}

/* ========================================
   LOGIN AND TOKEN
======================================== */

async function loginWorker() {
  const password = window.prompt("अपना Sarathi AI लॉगिन पासवर्ड लिखें:");

  if (!password) {
    throw new Error("लॉगिन पासवर्ड जरूरी है।");
  }

  const response = await fetch(getWorkerUrl() + "/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("लॉगिन सर्वर से सही जवाब नहीं मिला।");
  }

  if (!response.ok || !data.token) {
    throw new Error(data.error || "लॉगिन नहीं हो सका।");
  }

  localStorage.setItem(AUTH_TOKEN_KEY, data.token);
  return data.token;
}

async function getAuthToken() {
  let token = localStorage.getItem(AUTH_TOKEN_KEY);

  if (token) return token;

  return await loginWorker();
}

/* ========================================
   SAFE TEXT FORMATTING
======================================== */

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatInline(text) {
  let safe = escapeHTML(text);
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return safe;
}

function formatText(raw) {
  const lines = String(raw || "").replace(/\r/g, "").split("\n");
  const output = [];
  let listType = null;
  let codeMode = false;
  let codeLines = [];

  function closeList() {
    if (!listType) return;
    output.push(listType === "ul" ? "</ul>" : "</ol>");
    listType = null;
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      closeList();

      if (!codeMode) {
        codeMode = true;
        codeLines = [];
      } else {
        output.push("<pre><code>" +
          escapeHTML(codeLines.join("\n")) +
          "</code></pre>");
        codeMode = false;
      }
      continue;
    }

    if (codeMode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)/);

    if (unordered || ordered) {
      const nextType = unordered ? "ul" : "ol";

      if (listType !== nextType) {
        closeList();
        output.push(nextType === "ul" ? "<ul>" : "<ol>");
        listType = nextType;
      }

      output.push("<li>" + formatInline((unordered || ordered)[1]) + "</li>");
      continue;
    }

    closeList();

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)/);

    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
    } else {
      output.push("<p>" + formatInline(line) + "</p>");
    }
  }

  closeList();

  if (codeMode) {
    output.push("<pre><code>" +
      escapeHTML(codeLines.join("\n")) +
      "</code></pre>");
  }

  return output.join("\n");
}

/* ========================================
   CHAT HISTORY
======================================== */

function saveChats() {
  saveJSON(STORAGE_KEY, state.chats);
}

function createChat() {
  const chat = {
    id: makeId(),
    title: "नई बातचीत",
    messages: [],
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  state.chats.unshift(chat);
  state.activeId = chat.id;

  saveChats();
  renderHistory();
  renderMessages();
  showWelcome();

  return chat;
}

function ensureChat() {
  if (!state.chats.length) {
    createChat();
    return;
  }

  if (!activeChat()) state.activeId = state.chats[0].id;
}

function loadChats() {
  const loaded = loadJSON(STORAGE_KEY, []);

  if (Array.isArray(loaded)) {
    state.chats = loaded
      .filter(chat => chat && typeof chat === "object")
      .map(chat => ({
        id: chat.id || makeId(),
        title: chat.title || "नई बातचीत",
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        pinned: Boolean(chat.pinned),
        createdAt: chat.createdAt || Date.now(),
        updatedAt: chat.updatedAt || Date.now()
      }));
  }

  if (state.chats.length) {
    state.activeId = state.chats[0].id;
  } else {
    createChat();
  }

  ensureChat();
}

function renderHistory() {
  const list = $("historyList");
  if (!list) return;

  list.replaceChildren();

  const chats = [...state.chats].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return Number(b.pinned) - Number(a.pinned);
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = "history-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent = (chat.pinned ? "📌 " : "") + chat.title;
    button.title = chat.title;

    if (chat.id === state.activeId) button.classList.add("active");

    button.addEventListener("click", () => {
      state.activeId = chat.id;
      renderHistory();
      renderMessages();
      showWelcome();
      closeSidebar();
      closeMoreMenu();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-chat-btn";
    deleteButton.textContent = "🗑️";
    deleteButton.title = "बातचीत हटाएँ";

    deleteButton.addEventListener("click", event => {
      event.stopPropagation();
      deleteChatById(chat.id);
    });

    row.append(button, deleteButton);
    list.appendChild(row);
  }
}

function deleteChatById(chatId) {
  if (!window.confirm("क्या यह बातचीत हटानी है?")) return;

  state.chats = state.chats.filter(chat => chat.id !== chatId);

  if (state.activeId === chatId) state.activeId = null;

  if (!state.chats.length) {
    const chat = {
      id: makeId(),
      title: "नई बातचीत",
      messages: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.chats.push(chat);
    state.activeId = chat.id;
  } else if (!activeChat()) {
    state.activeId = state.chats[0].id;
  }

  saveChats();
  renderHistory();
  renderMessages();
  showWelcome();
}

function deleteCurrentChat() {
  const chat = activeChat();
  if (chat) deleteChatById(chat.id);
}

/* ========================================
   WELCOME AND MESSAGES
======================================== */

function showWelcome() {
  const chat = activeChat();
  const hasMessages = Boolean(chat && chat.messages.length);

  if ($("welcome")) $("welcome").hidden = hasMessages;
  if ($("messages")) $("messages").hidden = !hasMessages;
}

function renderMessages() {
  const container = $("messages");
  if (!container) return;

  container.replaceChildren();

  const chat = activeChat();
  if (!chat) {
    showWelcome();
    return;
  }

  for (const message of chat.messages) {
    const wrapper = document.createElement("article");
    wrapper.className = "message " +
      (message.role === "user" ? "user-message" : "assistant-message");

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = message.role === "user" ? "🙂" : "🦚";

    const content = document.createElement("div");
    content.className = "message-content";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = message.role === "user" ? "आप" : getSettings().assistantName;

    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = formatText(message.content || "");

    content.append(label, body);

    if (message.role !== "user") {
      const speakButton = document.createElement("button");
      speakButton.type = "button";
      speakButton.className = "speak-btn";
      speakButton.textContent = "🔊 जवाब सुनें";
      speakButton.setAttribute("aria-label", "जवाब को फ़ोन पर सुनें");
      speakButton.addEventListener("click", () => {
        if (window.SarathiNative && typeof window.SarathiNative.speak === "function") {
          window.SarathiNative.speak(String(message.content || ""));
          setStatus("अगर फ़ोन में ऑफ़लाइन हिंदी आवाज़ उपलब्ध है, तो जवाब सुनाई देगा।");
        } else {
          setStatus("गोपनीयता के लिए ब्राउज़र की संभावित ऑनलाइन आवाज़ का इस्तेमाल नहीं किया गया।");
        }
      });
      content.appendChild(speakButton);
    }

    wrapper.append(avatar, content);
    container.appendChild(wrapper);
  }

  showWelcome();
  container.scrollTop = container.scrollHeight;
}

function addMessage(role, content) {
  let chat = activeChat();
  if (!chat) chat = createChat();

  chat.messages.push({
    id: makeId(),
    role,
    content: String(content || ""),
    createdAt: Date.now()
  });

  chat.updatedAt = Date.now();

  if (chat.title === "नई बातचीत" && role === "user") {
    chat.title = String(content || "नई बातचीत").trim().slice(0, 35) || "नई बातचीत";
  }

  saveChats();
  renderHistory();
  renderMessages();
}

function setBusy(busy) {
  state.busy = busy;

  const button = $("sendBtn");
  const input = $("messageInput");

  if (button) {
    button.disabled = busy;
    button.textContent = busy ? "…" : "➤";
  }

  if (input) input.disabled = busy;
}

/* ========================================
   PRIVACY-FIRST PHONE ACTIONS
   Only exact commands are handled locally.
   Sensitive actions open a review screen; they are never sent automatically.
======================================== */

function handleLocalPhoneCommand(prompt) {
  let action = null;
  let match;

  match = prompt.match(/^(?:सारथी\s*)?(?:कॉल|फोन लगाओ|फोन करो|call)\s+(\+?[0-9][0-9\s-]{5,18})$/i);
  if (match) {
    const phone = match[1].replace(/[\s-]/g, "");
    action = {
      confirm: "फ़ोन का डायलर खुलेगा: " + phone + "\nकॉल अपने-आप नहीं लगेगी। आगे बढ़ें?",
      run: () => window.SarathiNative.openDialer(phone),
      success: "डायलर खुलने पर नंबर जाँचें। कॉल लगाने के लिए आपको फ़ोन में खुद बटन दबाना होगा।"
    };
  }

  if (!action) {
    match = prompt.match(/^(?:sms|एसएमएस|मैसेज)\s+(\+?[0-9][0-9\s-]{5,18})\s*[:：]\s*([\s\S]{1,4000})$/i);
    if (match) {
      const phone = match[1].replace(/[\s-]/g, "");
      const body = match[2].trim();
      action = {
        confirm: "संदेश ऐप में यह ड्राफ़्ट खुलेगा:\nनंबर: " + phone + "\nसंदेश: " + body + "\nइसे अपने-आप नहीं भेजा जाएगा। आगे बढ़ें?",
        run: () => window.SarathiNative.composeSms(phone, body),
        success: "संदेश ऐप खुलने पर नंबर और संदेश जाँचें। भेजने के लिए आपको खुद Send दबाना होगा।"
      };
    }
  }

  if (!action) {
    match = prompt.match(/^(?:ईमेल|email)\s+([^\s:]+@[^\s:]+)\s*[:：]\s*([\s\S]{1,8000})$/i);
    if (match) {
      const email = match[1];
      const body = match[2].trim();
      action = {
        confirm: "ईमेल ड्राफ़्ट खुलेगा:\nप्राप्तकर्ता: " + email + "\nसंदेश: " + body + "\nईमेल अपने-आप नहीं भेजा जाएगा। आगे बढ़ें?",
        run: () => window.SarathiNative.composeEmail(email, "", body),
        success: "ईमेल ऐप खुलने पर प्राप्तकर्ता और संदेश जाँचें। भेजने के लिए आपको खुद Send दबाना होगा।"
      };
    }
  }

  if (!action) {
    match = prompt.match(/^(?:सारथी\s*)?(?:अलार्म|alarm)\s+(?:(सुबह|शाम|रात|am|pm)\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:बजे)?(?:\s+(.+))?$/i);
    if (match) {
      const period = (match[1] || "").toLowerCase();
      let hour = Number(match[2]);
      const minute = Number(match[3] || 0);
      const label = (match[4] || "सारथी अलार्म").trim();

      if (minute > 59 || hour > 23 || (hour > 12 && period) || hour === 0 && period) {
        addMessage("user", prompt);
        addMessage("assistant", "समय स्पष्ट नहीं है। उदाहरण: ‘अलार्म सुबह 7 बजे’ या ‘अलार्म 19:30’। कोई अलार्म नहीं लगाया गया।");
        return true;
      }

      if (!period && hour >= 1 && hour <= 12 && !match[3]) {
        addMessage("user", prompt);
        addMessage("assistant", "सुबह या शाम स्पष्ट नहीं है। ‘अलार्म सुबह 7 बजे’ या ‘अलार्म शाम 7 बजे’ लिखें। अभी कोई अलार्म नहीं लगाया गया।");
        return true;
      }

      if (period === "शाम" || period === "रात" || period === "pm") {
        if (hour < 12) hour += 12;
      } else if ((period === "सुबह" || period === "am") && hour === 12) {
        hour = 0;
      }

      action = {
        confirm: "घड़ी ऐप में " + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") +
          " का अलार्म खोलना है? सेव करने से पहले घड़ी ऐप में समय जाँच सकेंगे।",
        run: () => window.SarathiNative.setAlarm(hour, minute, label),
        success: "घड़ी ऐप खुलेगा। समय जाँचकर वहाँ अलार्म सेव करें।"
      };
    }
  }

  if (!action) {
    match = prompt.match(/^(?:youtube|यूट्यूब)(?:\s+पर)?\s+(?:search|खोजो|ढूँढो|ढूंढो|चलाओ|play)\s+(.+)$/i)
      || prompt.match(/^(?:play|search)\s+(.+?)\s+(?:on\s+youtube|यूट्यूब\s+पर)$/i)
      || prompt.match(/^यूट्यूब\s+पर\s+(.+?)\s+(?:चलाओ|खोजो)$/i);
    if (match) {
      const query = match[1].trim();
      action = {
        confirm: "YouTube पर यह खोज खोलनी है?\n" + query + "\nसही वीडियो चुनकर चलाएँ।",
        run: () => window.SarathiNative.searchYouTube(query),
        success: "YouTube खोज खुल गई। सही वीडियो चुनकर चलाएँ।"
      };
    }
  }

  if (!action) {
    match = prompt.match(/^(?:(?:खोलो|open)\s+(.+)|(.+?)\s+(?:खोलो|open))$/i);
    if (match) {
      const requested = (match[1] || match[2] || "").trim().toLowerCase();
      const apps = {
        "ब्राउज़र": "browser", "browser": "browser", "इंटरनेट": "browser",
        "संदेश": "messages", "messages": "messages", "मैसेज ऐप": "messages",
        "ईमेल ऐप": "email", "email": "email", "कैलेंडर": "calendar", "calendar": "calendar",
        "संपर्क": "contacts", "contacts": "contacts", "मैप": "maps", "maps": "maps",
        "सेटिंग्स": "settings", "settings": "settings", "यूट्यूब": "youtube", "youtube": "youtube",
        "व्हाट्सऐप": "whatsapp", "whatsapp": "whatsapp"
      };
      // Known Hindi names use aliases; any other exact launcher app name is also supported.
      const key = apps[requested] || requested;
      if (key) {
        action = {
          confirm: "फ़ोन में " + requested + " ऐप खोलना है?",
          run: () => window.SarathiNative.openApp(key),
          success: "ऐप खोलने का अनुरोध किया गया।"
        };
      }
    }
  }

  if (!action) return false;

  addMessage("user", prompt);
  if (!window.SarathiNative) {
    addMessage("assistant", "यह फ़ोन वाला काम केवल Sarathi Android ऐप में उपलब्ध होगा। अभी कोई कॉल, संदेश, ईमेल या अलार्म नहीं किया गया।");
    return true;
  }

  if (!window.confirm(action.confirm)) {
    addMessage("assistant", "ठीक है। आपकी अनुमति के बिना कोई फ़ोन कार्रवाई नहीं की गई।");
    return true;
  }

  try {
    action.run();
    addMessage("assistant", action.success);
  } catch {
    addMessage("assistant", "फ़ोन कार्रवाई शुरू नहीं हो सकी। कोई संदेश या ईमेल अपने-आप नहीं भेजा गया।");
  }
  return true;
}

function isSimpleGreeting(prompt) {
  const normalized = String(prompt || "")
    .toLocaleLowerCase("hi-IN")
    .replace(/[!！?？.,،؛:;।॥🙏😊🙂🦚👋]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 70) return false;
  const words = normalized.split(" ");
  const allowed = new Set([
    "नमस्ते", "नमस्कार", "हेलो", "हैलो", "हाय", "सारथी",
    "राम", "प्रणाम", "सुप्रभात", "शुभ", "सुबह", "शाम",
    "hi", "hello", "hey", "good", "morning", "evening"
  ]);
  return words.length <= 6 && words.every(word => allowed.has(word));
}

function filterSourcesForPrompt(prompt, sources) {
  const q = String(prompt || "").toLocaleLowerCase("hi-IN");
  const items = Array.isArray(sources) ? sources : [];
  let pattern = null;

  if (/(सोने|सोना|gold|bullion|22\s*k|24\s*k)/i.test(q)) {
    pattern = /(gold|सोना|सोने|bullion|22\s*k|24\s*k|gold[- ]?(rate|price)|precious[- ]?metal)/i;
  }
  if (/(चांदी|चाँदी|silver)/i.test(q)) {
    const silverPattern = /(silver|चांदी|चाँदी|bullion|precious[- ]?metal)/i;
    pattern = pattern ? {
      test: (value) => pattern.test(value) || silverPattern.test(value)
    } : silverPattern;
  }
  if (/(मौसम|weather|तापमान|temperature)/i.test(q)) {
    pattern = /(weather|मौसम|temperature|forecast|तापमान)/i;
  } else if (/(ट्रेन|रेल|train|railway|पीएनआर|pnr)/i.test(q)) {
    pattern = /(train|railway|रेल|ट्रेन|pnr|indianrail)/i;
  }

  if (!pattern) return items;
  return items.filter(source => pattern.test(
    `${source.title || ""} ${source.url || ""} ${source.snippet || ""}`
  ));
}

function explicitlyRequestsWebSearch(prompt) {
  return /(?:इंटरनेट|वेब|online)\s*(?:पर\s*)?(?:खोज|सर्च|search)|(?:ताज़ा|ताजा|आज की|लेटेस्ट|latest|current|breaking)\s*(?:खबर|समाचार|news|updates?)|(?:search|खोज|सर्च)\s+(?:the\s+)?(?:internet|web|online)/i.test(String(prompt || ""));
}

/* ========================================
   SEND MESSAGE
======================================== */

async function sendMessage(text) {
  const prompt = String(
    text !== undefined ? text : ($("messageInput")?.value || "")
  ).trim();

  if (!prompt || state.busy) return;
  const shouldSpeakReply = state.voiceReplyPending;
  state.voiceReplyPending = false;

  // Phone actions are parsed and handled locally before any cloud request.
  if (handleLocalPhoneCommand(prompt)) {
    const input = $("messageInput");
    if (input) {
      input.value = "";
      input.style.height = "";
    }
    return;
  }

  const workerUrl = getWorkerUrl();

  if (!workerUrl) {
    setStatus("सेटिंग्स में Worker URL भरें।");
    openSettings();
    return;
  }

  const input = $("messageInput");

  if (input) {
    input.value = "";
    input.style.height = "";
  }

  const needsCurrentInfo = /(आज|अभी|वर्तमान|ताज़ा|ताजा|लेटेस्ट|latest|current|today|now|भाव|कीमत|रेट|rate|price|मौसम|weather|तापमान|ट्रेन|रेल|train|pnr|समय सारणी|खबर|समाचार|news|सोने|सोना|gold|चांदी|चाँदी|silver|स्टॉक|शेयर बाजार|share market|exchange rate|डॉलर|रुपया)/i.test(prompt);
  const useWebSearch = !isSimpleGreeting(prompt) && (explicitlyRequestsWebSearch(prompt) || (state.webEnabled && needsCurrentInfo));

  addMessage("user", prompt);
  setBusy(true);
  setStatus(useWebSearch ? "सारथी इंटरनेट पर खोजकर जवाब तैयार कर रहा है…" : "सारथी जवाब तैयार कर रहा है…");

  try {
    let token = await getAuthToken();

    let response = await fetch(workerUrl + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        message: prompt,
        messages: activeChat().messages
          .filter(item => item.role === "user" || item.role === "assistant")
          .slice(-20)
          .map(item => ({
            role: item.role,
            content: item.content
          })),
        webSearch: useWebSearch
      })
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("सर्वर से सही जवाब नहीं मिला।");
    }

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      token = await loginWorker();

      response = await fetch(workerUrl + "/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          message: prompt,
          messages: activeChat().messages
            .filter(item => item.role === "user" || item.role === "assistant")
            .slice(-20)
            .map(item => ({
              role: item.role,
              content: item.content
            })),
          webSearch: useWebSearch
        })
      });

      data = await response.json();
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || `सर्वर त्रुटि: ${response.status}`);
    }

    const answer =
      data.reply ||
      data.response ||
      data.answer ||
      data.content ||
      data.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("AI से खाली जवाब मिला। Worker को जाँचना होगा।");
    }

    addMessage("assistant", answer.trim());

    // Only speak automatically for a reply triggered by the wake-word voice command.
    // Typed messages stay silent; the user can still tap the per-message speaker button.
    if (shouldSpeakReply && window.SarathiNative && typeof window.SarathiNative.speak === "function") {
      window.SarathiNative.speak(answer.trim());
    }

    const relevantSources = filterSourcesForPrompt(prompt, data.sources);

    if (useWebSearch && relevantSources.length) {
      const sourceText = relevantSources.map((source, index) =>
        `${index + 1}. ${source.title}\n${source.url}`
      ).join("\n\n");

      addMessage("assistant", "🌐 इंटरनेट से मिले स्रोत:\n\n" + sourceText);
    }

    if (useWebSearch && data.searchWarning) {
      setStatus("इंटरनेट खोज: " + data.searchWarning);
    } else {
      setStatus("");
    }
  } catch (error) {
    const message = error?.message || "कनेक्शन में समस्या हुई।";

    addMessage(
      "assistant",
      "माफ करना, अभी जवाब नहीं मिल पाया।\n\nसमस्या: " + message
    );

    setStatus("कनेक्शन की समस्या");
  } finally {
    setBusy(false);
    if (input) {
      input.disabled = false;
      input.focus();
    }
  }
}

/* ========================================
   SETTINGS
======================================== */

function openSettings() {
  const settings = getSettings();
  const webButton = $("webToggle");
  if (webButton) {
    webButton.classList.toggle("active", state.webEnabled);
    webButton.setAttribute("aria-pressed", String(state.webEnabled));
    webButton.textContent = state.webEnabled ? "🌐 इंटरनेट खोज: चालू" : "🌐 इंटरनेट खोज: बंद";
  }

  if ($("workerUrl")) $("workerUrl").value = settings.workerUrl || "";
  if ($("assistantName")) $("assistantName").value = settings.assistantName || "सारथी";

  safeDialogOpen($("settingsDialog"));
}

function handleSettingsSubmit(event) {
  event.preventDefault();

  const workerUrl = ($("workerUrl")?.value || "").trim().replace(/\/+$/, "");
  const assistantName = ($("assistantName")?.value || "सारथी").trim().slice(0, 50) || "सारथी";

  if (!workerUrl) {
    setStatus("Worker URL भरना जरूरी है।");
    return;
  }

  try {
    const parsed = new URL(workerUrl);
    if (parsed.protocol !== "https:") {
      setStatus("Worker URL https:// से शुरू होना चाहिए।");
      return;
    }
  } catch {
    setStatus("Worker URL सही नहीं है।");
    return;
  }

  saveSettings({ workerUrl, assistantName });
  $("settingsDialog")?.close();
  setStatus("सेटिंग्स सेव हो गईं।");
  renderMessages();
}

/* ========================================
   SIDEBAR AND MENUS
======================================== */

function closeSidebar() {
  $("sidebar")?.classList.remove("open", "visible");
  $("menuBtn")?.setAttribute("aria-expanded", "false");
}

function toggleSidebar() {
  const sidebar = $("sidebar");
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains("open");
  sidebar.classList.toggle("open", !isOpen);
  $("menuBtn")?.setAttribute("aria-expanded", String(!isOpen));
}

function closeMoreMenu() {
  const menu = $("moreMenu");
  if (!menu) return;

  menu.classList.add("hidden");
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

function toggleMoreMenu() {
  const menu = $("moreMenu");
  if (!menu) return;

  const isClosed = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !isClosed);
  menu.classList.toggle("open", isClosed);
  menu.setAttribute("aria-hidden", String(isClosed));
}

function handleNewChat() {
  createChat();
  closeSidebar();
  closeMoreMenu();

  if ($("messageInput")) {
    $("messageInput").value = "";
    $("messageInput").style.height = "";
    $("messageInput").focus();
  }

  setStatus("");
}

function togglePinCurrentChat() {
  const chat = activeChat();
  if (!chat) return;

  chat.pinned = !chat.pinned;
  chat.updatedAt = Date.now();

  saveChats();
  renderHistory();
  closeMoreMenu();
  setStatus(chat.pinned ? "बातचीत पिन हो गई।" : "पिन हट गया।");
}

function renameCurrentChat() {
  const chat = activeChat();
  if (!chat) return;

  const title = window.prompt("बातचीत का नया नाम लिखो:", chat.title);
  if (title === null) return;

  const cleanTitle = title.trim().slice(0, 60);
  if (!cleanTitle) {
    setStatus("नाम खाली नहीं हो सकता।");
    return;
  }

  chat.title = cleanTitle;
  chat.updatedAt = Date.now();
  saveChats();
  renderHistory();
  closeMoreMenu();
}

async function shareCurrentChat() {
  const chat = activeChat();
  if (!chat) return;

  const text = [
    chat.title,
    "",
    ...chat.messages.map(message =>
      (message.role === "user" ? "आप: " : "सारथी: ") + message.content
    )
  ].join("\n");

  try {
    if (navigator.share) {
      await navigator.share({ title: chat.title, text });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus("बातचीत कॉपी हो गई।");
    } else {
      window.prompt("बातचीत कॉपी करो:", text);
    }
  } catch (error) {
    if (error?.name !== "AbortError") setStatus("शेयर नहीं हो सका।");
  }

  closeMoreMenu();
}

function openFindDialog() {
  closeMoreMenu();
  safeDialogOpen($("findDialog"));

  if ($("findInput")) {
    $("findInput").value = "";
    $("findInput").focus();
  }

  if ($("findResult")) $("findResult").textContent = "";
}

function findInCurrentChat() {
  const query = ($("findInput")?.value || "").trim();
  const result = $("findResult");
  const chat = activeChat();

  if (!query) {
    if (result) result.textContent = "खोजने के लिए शब्द लिखो।";
    return;
  }

  const matches = chat?.messages.filter(message =>
    String(message.content || "").toLowerCase().includes(query.toLowerCase())
  ) || [];

  if (result) {
    result.textContent = matches.length
      ? `${matches.length} संदेश मिले।`
      : "कोई संदेश नहीं मिला।";
  }
}

/* ========================================
   VOICE INPUT
======================================== */

window.SarathiVoice = {
  onResult(transcript) {
    const input = $("messageInput");
    if (input && transcript) {
      input.value = (input.value ? input.value + " " : "") + transcript;
      input.focus();
      setStatus("आवाज़ लिख दी गई है। भेजने से पहले संदेश जाँच लें।");
    }
  },
  onWakeCommandResult(transcript) {
    if (transcript && String(transcript).trim()) {
      setStatus("सारथी आपका आदेश समझ रहा है…");
      state.voiceReplyPending = true;
      sendMessage(String(transcript).trim());
    } else {
      setStatus("आवाज़ से आदेश समझ नहीं आया। फिर कोशिश करें।");
    }
  },
  onError(message) {
    setStatus(message || "ऑफ़लाइन आवाज़ सुविधा अभी उपलब्ध नहीं है।");
  },
  onStatus(message) {
    setStatus(message || "");
  }
};

function startVoiceInput() {
  if (window.SarathiNative && typeof window.SarathiNative.startListening === "function") {
    setStatus("माइक्रोफ़ोन अनुमति दें और हिन्दी या English चुनें। कुछ फ़ोनों में आवाज़ पहचान इंटरनेट सेवा से हो सकती है।");
    window.SarathiNative.startListening();
    return;
  }

  setStatus("गोपनीयता के लिए ब्राउज़र की संभावित ऑनलाइन आवाज़ पहचान बंद है। ऑफ़लाइन आवाज़ के लिए Android ऐप इस्तेमाल करें।");
}

/* ========================================
   ATTACHMENTS
======================================== */

function renderAttachmentPreview() {
  const preview = $("attachmentPreview");
  if (!preview) return;

  preview.replaceChildren();

  for (const file of state.attachments) {
    const item = document.createElement("div");
    item.className = "attachment-item";

    const name = document.createElement("span");
    name.textContent = file.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "फाइल हटाएँ";

    remove.addEventListener("click", () => {
      state.attachments = state.attachments.filter(item => item !== file);
      renderAttachmentPreview();
    });

    item.append(name, remove);
    preview.appendChild(item);
  }

  preview.hidden = state.attachments.length === 0;
}

function addFiles(fileList) {
  if (!fileList) return;

  const files = Array.from(fileList).slice(0, 5 - state.attachments.length);
  state.attachments.push(...files);
  renderAttachmentPreview();

  if (files.length) {
    setStatus("फाइल चुनी गई है; अभी उसकी सामग्री AI को नहीं भेजी जाती।");
  }
}

function openAttachmentDialog() {
  safeDialogOpen($("attachDialog"));
}

function closeAttachmentDialog() {
  $("attachDialog")?.close();
}

function choosePhotos() {
  const input = $("fileInput");
  if (!input) return;

  input.accept = "image/*";
  input.multiple = true;
  input.click();
  closeAttachmentDialog();
}

function chooseFiles() {
  const input = $("fileInput");
  if (!input) return;

  input.accept = "*/*";
  input.multiple = true;
  input.click();
  closeAttachmentDialog();
}

function openCamera() {
  const input = $("fileInput");
  if (!input) return;

  input.accept = "image/*";
  input.setAttribute("capture", "environment");
  input.multiple = false;
  input.click();
  closeAttachmentDialog();

  setTimeout(() => input.removeAttribute("capture"), 1000);
}

/* ========================================
   WEB SEARCH SWITCH
======================================== */

function toggleWebSearch() {
  state.webEnabled = !state.webEnabled;
  localStorage.setItem("sarathi_ai_web_search_v1", String(state.webEnabled));

  const button = $("webToggle");

  if (button) {
    button.classList.toggle("active", state.webEnabled);
    button.setAttribute("aria-pressed", String(state.webEnabled));
    button.textContent = state.webEnabled
      ? "🌐 इंटरनेट खोज: चालू"
      : "🌐 इंटरनेट खोज: बंद";
  }

  setStatus(state.webEnabled ? "इंटरनेट खोज चालू है।" : "इंटरनेट खोज बंद है।");
}

function resizeMessageInput() {
  const input = $("messageInput");
  if (!input) return;

  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}

function handlePromptClick(event) {
  const button = event.target.closest("[data-prompt]");
  const prompt = button?.getAttribute("data-prompt");
  if (prompt) sendMessage(prompt);
}

/* ========================================
   EVENT LISTENERS
======================================== */

function bindEvents() {
  $("chatForm")?.addEventListener("submit", event => {
    event.preventDefault();
    sendMessage();
  });

  $("newChatBtn")?.addEventListener("click", handleNewChat);
  $("topNewBtn")?.addEventListener("click", handleNewChat);
  $("menuBtn")?.addEventListener("click", toggleSidebar);

  $("settingsBtn")?.addEventListener("click", () => {
    closeMoreMenu();
    openSettings();
  });

  $("settingsForm")?.addEventListener("submit", handleSettingsSubmit);

  $("cancelSettings")?.addEventListener("click", () => {
    $("settingsDialog")?.close();
  });

  $("moreBtn")?.addEventListener("click", toggleMoreMenu);
  $("attachBtn")?.addEventListener("click", openAttachmentDialog);
  $("closeAttach")?.addEventListener("click", closeAttachmentDialog);

  $("cameraOption")?.addEventListener("click", openCamera);
  $("photosOption")?.addEventListener("click", choosePhotos);
  $("filesOption")?.addEventListener("click", chooseFiles);
  $("micBtn")?.addEventListener("click", startVoiceInput);
  $("webToggle")?.addEventListener("click", toggleWebSearch);
  const startWakeWord = () => {
    if (window.SarathiNative?.startWakeWord) window.SarathiNative.startWakeWord();
    else setStatus("वेक-वर्ड सुविधा Android ऐप में ही उपलब्ध है।");
  };
  const stopWakeWord = () => {
    if (window.SarathiNative?.stopWakeWord) window.SarathiNative.stopWakeWord();
    else setStatus("वेक-वर्ड सुविधा Android ऐप में ही उपलब्ध है।");
  };
  $("wakeStart")?.addEventListener("click", startWakeWord);
  $("wakeStop")?.addEventListener("click", stopWakeWord);
  $("wakeStartMain")?.addEventListener("click", startWakeWord);
  $("wakeStopMain")?.addEventListener("click", stopWakeWord);

  $("messageInput")?.addEventListener("input", resizeMessageInput);
  $("welcome")?.addEventListener("click", handlePromptClick);
  $("findNext")?.addEventListener("click", findInCurrentChat);

  $("fileInput")?.addEventListener("change", event => {
    addFiles(event.target.files);
    event.target.value = "";
  });

  $("moreMenu")?.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    switch (button.dataset.action) {
      case "share":
        shareCurrentChat();
        break;
      case "pin":
        togglePinCurrentChat();
        break;
      case "find":
        openFindDialog();
        break;
      case "new":
        handleNewChat();
        break;
      case "rename":
        renameCurrentChat();
        break;
      case "delete":
        deleteCurrentChat();
        closeMoreMenu();
        break;
      case "settings":
        closeMoreMenu();
        openSettings();
        break;
      case "home":
        window.location.href = "/";
        break;
      case "project":
        setStatus("प्रोजेक्ट सुविधा अभी उपलब्ध नहीं है।");
        closeMoreMenu();
        break;
      default:
        setStatus("यह विकल्प अभी उपलब्ध नहीं है।");
    }
  });

  document.addEventListener("click", event => {
    const menu = $("moreMenu");
    const button = $("moreBtn");

    if (
      menu &&
      !menu.classList.contains("hidden") &&
      !menu.contains(event.target) &&
      !button?.contains(event.target)
    ) {
      closeMoreMenu();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMoreMenu();
  });
}

/* ========================================
   START
======================================== */

function initApp() {
  loadChats();
  bindEvents();
  renderHistory();
  renderMessages();
  renderAttachmentPreview();
  showWelcome();

  const settings = getSettings();

  if ($("workerUrl")) $("workerUrl").value = settings.workerUrl || "";
  if ($("assistantName")) $("assistantName").value = settings.assistantName || "सारथी";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
