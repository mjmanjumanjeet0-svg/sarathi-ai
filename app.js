"use strict";

/* ========================================
   SARATHI AI — APP.JS
   Compatible with the supplied index.html
======================================== */

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "sarathi_ai_chats_v1";
const SETTINGS_KEY = "sarathi_ai_settings_v1";

const DEFAULT_SETTINGS = {
  workerUrl: "https://sarathi-ai.mjmanjumanjeet0.workers.dev",
  assistantName: "सारथी"
};

const state = {
  chats: [],
  activeId: null,
  busy: false,
  webEnabled: false,
  recognition: null,
  attachments: [],
  findMatches: [],
  findIndex: 0
};

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

function saveChats() {
  saveJSON(STORAGE_KEY, state.chats);
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

function activeChat() {
  return state.chats.find(chat => chat.id === state.activeId) || null;
}

function setStatus(message) {
  const element = $("status");
  if (element) element.textContent = message || "";
}

function safeDialogOpen(dialog) {
  if (!dialog) return;
  try {
    if (!dialog.open) dialog.showModal();
  } catch {
    setStatus("यह डायलॉग इस ब्राउज़र में नहीं खुल सका।");
  }
}

/* ========================================
   TEXT FORMATTING
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
   CHAT CREATION AND HISTORY
======================================== */

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

  if (!activeChat()) {
    state.activeId = state.chats[0].id;
  }
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

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, "&#96;");
}

function renderHistory() {
  const list = $("historyList");
  if (!list) return;

  list.replaceChildren();

  const sortedChats = [...state.chats].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return Number(b.pinned) - Number(a.pinned);
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  for (const chat of sortedChats) {
    const row = document.createElement("div");
    row.className = "history-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.dataset.chatId = chat.id;
    button.title = chat.title;

    if (chat.id === state.activeId) {
      button.classList.add("active");
    }

    button.textContent = (chat.pinned ? "📌 " : "") + chat.title;

    button.addEventListener("click", () => {
  state.activeId = chat.id;
  saveChats();
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
    deleteButton.title = "यह बातचीत हटाएँ";
    deleteButton.setAttribute("aria-label", "यह बातचीत हटाएँ");

    deleteButton.addEventListener("click", event => {
      event.stopPropagation();
      deleteChatById(chat.id);
    });

    row.append(button, deleteButton);
    list.appendChild(row);
  }
}

function deleteChatById(chatId) {
  const chat = state.chats.find(item => item.id === chatId);
  if (!chat) return;

  const confirmed = window.confirm(
    `क्या "${chat.title}" बातचीत हटानी है?`
  );

  if (!confirmed) return;

  state.chats = state.chats.filter(item => item.id !== chatId);

  if (state.activeId === chatId) {
    state.activeId = null;
  }

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
  if (!chat) return;

  const confirmed = window.confirm(
    "क्या यह पूरी बातचीत हटानी है?"
  );

  if (!confirmed) return;

  state.chats = state.chats.filter(item => item.id !== chat.id);
  state.activeId = null;

  if (!state.chats.length) {
    const newChat = {
      id: makeId(),
      title: "नई बातचीत",
      messages: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    state.chats.push(newChat);
    state.activeId = newChat.id;
  } else {
    state.activeId = state.chats[0].id;
  }

  saveChats();
  renderHistory();
  renderMessages();
  showWelcome();
}

/* ========================================
   WELCOME SCREEN
======================================== */

function showWelcome() {
  const welcome = $("welcome");
  const messages = $("messages");
  const chat = activeChat();

  const hasMessages = Boolean(
    chat && Array.isArray(chat.messages) && chat.messages.length
  );

  if (welcome) {
    welcome.hidden = hasMessages;
  }

  if (messages) {
    messages.hidden = !hasMessages;
  }
}

/* ========================================
   MESSAGE RENDERING
======================================== */

function renderMessages() {
  const container = $("messages");
  if (!container) return;

  container.replaceChildren();

  const chat = activeChat();
  if (!chat) return;

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
    label.textContent = message.role === "user"
      ? "आप"
      : getSettings().assistantName;

    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = formatText(message.content || "");

    content.append(label, body);
    wrapper.append(avatar, content);
    container.appendChild(wrapper);
  }

  showWelcome();

  container.scrollTop = container.scrollHeight;
}
/* ========================================
   MESSAGE HELPERS
======================================== */

function addMessage(role, content) {
  let chat = activeChat();

  if (!chat) {
    chat = createChat();
  }

  const message = {
    id: makeId(),
    role,
    content: String(content || ""),
    createdAt: Date.now()
  };

  chat.messages.push(message);
  chat.updatedAt = Date.now();

  if (chat.title === "नई बातचीत" && role === "user") {
    chat.title = String(content || "नई बातचीत")
      .trim()
      .slice(0, 35) || "नई बातचीत";
  }

  saveChats();
  renderHistory();
  renderMessages();

  return message;
}

function setBusy(busy) {
  state.busy = busy;

  const sendButton = $("sendBtn");
  const input = $("messageInput");

  if (sendButton) {
    sendButton.disabled = busy;
    sendButton.textContent = busy ? "…" : "➤";
  }

  if (input) {
    input.disabled = busy;
  }
}

function getWorkerUrl() {
  const settings = getSettings();

  return String(settings.workerUrl || "")
    .trim()
    .replace(/\/+$/, "");
}

/* ========================================
   SEND MESSAGE TO SARATHI AI
======================================== */

async function sendMessage(text) {
  const prompt = String(
    text !== undefined ? text : ($("messageInput")?.value || "")
  ).trim();

  if (!prompt || state.busy) return;

  const workerUrl = getWorkerUrl();

  if (!workerUrl) {
    setStatus("पहले सेटिंग्स में Worker URL सेव करें।");
    safeDialogOpen($("settingsDialog"));
    return;
  }

  const input = $("messageInput");

  if (input) {
    input.value = "";
    input.style.height = "";
  }

  state.attachments = [];
  renderAttachmentPreview();

  addMessage("user", prompt);

  setBusy(true);
  setStatus("सारथी जवाब तैयार कर रहा है…");

  try {
    const response = await fetch(workerUrl + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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
        webSearch: state.webEnabled
      })
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("सर्वर से सही जवाब नहीं मिला।");
    }

    if (!response.ok) {
      throw new Error(
        data.error || data.message || `सर्वर त्रुटि: ${response.status}`
      );
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
    setStatus("");
  } catch (error) {
    const errorText = error && error.message
      ? error.message
      : "कनेक्शन में समस्या हुई।";

    addMessage(
      "assistant",
      "माफ करना, अभी जवाब नहीं मिल पाया।\n\nसमस्या: " + errorText
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
   ATTACHMENT PREVIEW
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
      state.attachments = state.attachments.filter(
        current => current !== file
      );

      renderAttachmentPreview();
    });

    item.append(name, remove);
    preview.appendChild(item);
  }

  preview.hidden = state.attachments.length === 0;
}

function addFiles(fileList) {
  if (!fileList) return;

  const incoming = Array.from(fileList);
  const maxFiles = 5;
  const remaining = maxFiles - state.attachments.length;

  if (remaining <= 0) {
    setStatus("एक बार में अधिकतम 5 फाइलें चुन सकते हो।");
    return;
  }

  state.attachments.push(...incoming.slice(0, remaining));
  renderAttachmentPreview();

  setStatus(
    "फाइल चुनी गई है। ध्यान दें: अभी फाइल की सामग्री AI को नहीं भेजी जाती।"
  );
}
/* ========================================
   SETTINGS
======================================== */

function openSettings() {
  const settings = getSettings();

  const workerInput = $("workerUrl");
  const nameInput = $("assistantName");

  if (workerInput) {
    workerInput.value = settings.workerUrl || "";
  }

  if (nameInput) {
    nameInput.value = settings.assistantName || "सारथी";
  }

  safeDialogOpen($("settingsDialog"));
}

function handleSettingsSubmit(event) {
  event.preventDefault();

  const workerUrl = ($("workerUrl")?.value || "")
    .trim()
    .replace(/\/+$/, "");

  const assistantName = ($("assistantName")?.value || "सारथी")
    .trim()
    .slice(0, 50) || "सारथी";

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

  saveSettings({
    workerUrl,
    assistantName
  });

  const dialog = $("settingsDialog");

  if (dialog?.open) {
    dialog.close();
  }

  setStatus("सेटिंग्स सेव हो गईं।");
  renderMessages();
}

/* ========================================
   NEW CHAT
======================================== */

function handleNewChat() {
  createChat();

  closeSidebar();
  closeMoreMenu();

  const input = $("messageInput");

  if (input) {
    input.value = "";
    input.style.height = "";
    input.focus();
  }

  setStatus("");
}

/* ========================================
   SIDEBAR AND MENUS
======================================== */

function toggleSidebar() {
  const sidebar = $("sidebar");

  if (!sidebar) {
    console.error("Sarathi AI: sidebar नहीं मिला");
    return;
  }

  const isOpen = sidebar.classList.contains("open");

  sidebar.classList.toggle("open", !isOpen);

  const button = $("menuBtn");

  if (button) {
    button.setAttribute("aria-expanded", String(!isOpen));
  }
}

function closeSidebar() {
  const sidebar = $("sidebar");

  if (sidebar) {
    sidebar.classList.remove("open");
    sidebar.classList.remove("visible");
  }

  const button = $("menuBtn");

  if (button) {
    button.setAttribute("aria-expanded", "false");
  }
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

  if (!menu) {
    console.error("Sarathi AI: moreMenu नहीं मिला");
    return;
  }

  const isClosed = menu.classList.contains("hidden");

  if (isClosed) {
    menu.classList.remove("hidden");
    menu.classList.add("open");
    menu.setAttribute("aria-hidden", "false");
  } else {
    closeMoreMenu();
  }
}

/* ========================================
   PIN CHAT
======================================== */

function togglePinCurrentChat() {
  const chat = activeChat();

  if (!chat) {
    setStatus("पहले कोई बातचीत खोलो।");
    return;
  }

  chat.pinned = !chat.pinned;
  chat.updatedAt = Date.now();

  saveChats();
  renderHistory();
  closeMoreMenu();

  setStatus(chat.pinned
    ? "बातचीत पिन कर दी गई।"
    : "बातचीत से पिन हट गया।"
  );
}

/* ========================================
   RENAME CHAT
======================================== */

function renameCurrentChat() {
  const chat = activeChat();

  if (!chat) return;

  const newTitle = window.prompt(
    "बातचीत का नया नाम लिखो:",
    chat.title
  );

  if (newTitle === null) return;

  const title = newTitle.trim().slice(0, 60);

  if (!title) {
    setStatus("नाम खाली नहीं हो सकता।");
    return;
  }

  chat.title = title;
  chat.updatedAt = Date.now();

  saveChats();
  renderHistory();
  closeMoreMenu();

  setStatus("बातचीत का नाम बदल गया।");
}

/* ========================================
   SHARE CHAT
======================================== */

async function shareCurrentChat() {
  const chat = activeChat();

  if (!chat) return;

  const text = [
    chat.title,
    "",
    ...chat.messages.map(message =>
      (message.role === "user" ? "आप: " : "सारथी: ") +
      message.content
    )
  ].join("\n");

  try {
    if (navigator.share) {
      await navigator.share({
        title: chat.title,
        text
      });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus("बातचीत कॉपी हो गई।");
    } else {
      window.prompt("बातचीत कॉपी करो:", text);
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("शेयर नहीं हो सका।");
    }
  }

  closeMoreMenu();
}

/* ========================================
   FIND IN CHAT
======================================== */

function openFindDialog() {
  closeMoreMenu();

  const input = $("findInput");

  safeDialogOpen($("findDialog"));

  if (input) {
    input.value = "";
    input.focus();
  }

  const result = $("findResult");

  if (result) {
    result.textContent = "";
  }
}

function findInCurrentChat() {
  const query = ($("findInput")?.value || "").trim();
  const result = $("findResult");
  const chat = activeChat();

  if (!query) {
    if (result) result.textContent = "खोजने के लिए शब्द लिखो।";
    return;
  }

  if (!chat) {
    if (result) result.textContent = "कोई बातचीत नहीं मिली।";
    return;
  }

  const matches = chat.messages.filter(message =>
    String(message.content || "")
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  if (result) {
    result.textContent = matches.length
      ? `${matches.length} संदेश मिले।`
      : "कोई संदेश नहीं मिला।";
  }
}
/* ========================================
   SPEECH TO TEXT
======================================== */

function startVoiceInput() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus("इस ब्राउज़र में वॉइस सुविधा उपलब्ध नहीं है।");
    return;
  }

  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch {}
    state.recognition = null;
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "hi-IN";
  recognition.continuous = false;
  recognition.interimResults = false;

  state.recognition = recognition;

  recognition.onstart = () => {
    setStatus("बोलिए, सारथी सुन रहा है…");
  };

  recognition.onresult = event => {
    const transcript =
      event.results?.[0]?.[0]?.transcript || "";

    const input = $("messageInput");

    if (input && transcript) {
      input.value = (
        input.value ? input.value + " " : ""
      ) + transcript;

      input.focus();
    }

    setStatus("");
  };

  recognition.onerror = () => {
    setStatus("आवाज़ सुनने में समस्या हुई। माइक्रोफोन अनुमति जाँचें।");
  };

  recognition.onend = () => {
    state.recognition = null;
  };

  try {
    recognition.start();
  } catch {
    state.recognition = null;
    setStatus("माइक्रोफोन शुरू नहीं हो सका।");
  }
}

/* ========================================
   ATTACHMENT DIALOG
======================================== */

function openAttachmentDialog() {
  safeDialogOpen($("attachDialog"));
}

function closeAttachmentDialog() {
  const dialog = $("attachDialog");

  if (dialog?.open) {
    dialog.close();
  }
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

  window.setTimeout(() => {
    input.removeAttribute("capture");
  }, 1000);
}

/* ========================================
   WEB SEARCH SWITCH
======================================== */

function toggleWebSearch() {
  state.webEnabled = !state.webEnabled;

  const button = $("webToggle");

  if (button) {
    button.classList.toggle("active", state.webEnabled);

    button.setAttribute(
      "aria-pressed",
      String(state.webEnabled)
    );

    button.textContent = state.webEnabled
      ? "🌐 इंटरनेट खोज: चालू"
      : "🌐 इंटरनेट खोज: बंद";
  }

  setStatus(
    state.webEnabled
      ? "इंटरनेट खोज चालू है।"
      : "इंटरनेट खोज बंद है।"
  );
}

/* ========================================
   AUTO RESIZE INPUT
======================================== */

function resizeMessageInput() {
  const input = $("messageInput");
  if (!input) return;

  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}

/* ========================================
   WELCOME PROMPT BUTTONS
======================================== */

function handlePromptClick(event) {
  const button = event.target.closest("[data-prompt]");
  if (!button) return;

  const prompt = button.getAttribute("data-prompt");
  if (!prompt) return;

  sendMessage(prompt);
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

  $("settingsForm")?.addEventListener(
    "submit",
    handleSettingsSubmit
  );

  $("cancelSettings")?.addEventListener("click", () => {
    $("settingsDialog")?.close();
  });

  $("moreBtn")?.addEventListener("click", toggleMoreMenu);

  $("attachBtn")?.addEventListener(
    "click",
    openAttachmentDialog
  );

  $("closeAttach")?.addEventListener(
    "click",
    closeAttachmentDialog
  );

  $("cameraOption")?.addEventListener("click", openCamera);
  $("photosOption")?.addEventListener("click", choosePhotos);
  $("filesOption")?.addEventListener("click", chooseFiles);

  $("fileInput")?.addEventListener("change", event => {
    addFiles(event.target.files);
    event.target.value = "";
  });

  $("micBtn")?.addEventListener("click", startVoiceInput);

  $("webToggle")?.addEventListener(
    "click",
    toggleWebSearch
  );

  $("messageInput")?.addEventListener(
    "input",
    resizeMessageInput
  );

  $("welcome")?.addEventListener(
    "click",
    handlePromptClick
  );

  $("findNext")?.addEventListener(
    "click",
    findInCurrentChat
  );

  $("moreMenu")?.addEventListener("click", event => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.dataset.action;

    switch (action) {
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
        closeMoreMenu();
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
      !menu.hidden &&
      !menu.contains(event.target) &&
      !button?.contains(event.target)
    ) {
      closeMoreMenu();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeMoreMenu();
    }
  });
}

/* ========================================
   START APPLICATION
======================================== */

function initApp() {
  loadChats();
  bindEvents();
  renderHistory();
  renderMessages();
  renderAttachmentPreview();
  showWelcome();

  const settings = getSettings();

  if ($("workerUrl")) {
    $("workerUrl").value = settings.workerUrl || "";
  }

  if ($("assistantName")) {
    $("assistantName").value = settings.assistantName || "सारथी";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
