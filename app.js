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

  return output.join("");
}

/* ========================================
   CHAT MANAGEMENT
======================================== */

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
  setStatus("नई बातचीत शुरू हुई।");
  $("messageInput")?.focus();
}

function updateTitle(chat) {
  if (!chat) return;

  const firstMessage = chat.messages.find(message => message.role === "user");

  if (firstMessage && (!chat.title || chat.title === "नई चैट")) {
    chat.title = firstMessage.content.trim().slice(0, 35) || "नई चैट";
  }

  chat.updatedAt = Date.now();

  state.chats.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

/* ========================================
   HISTORY
======================================== */

function renderHistory() {
  const list = $("historyList");
  if (!list) return;

  list.replaceChildren();

  for (const chat of state.chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item" +
      (chat.id === state.activeId ? " active" : "");

    const pin = document.createElement("span");
    pin.textContent = chat.pinned ? "📌 " : "";

    const title = document.createElement("span");
    title.textContent = chat.title || "नई चैट";

    button.append(pin, title);

    button.addEventListener("click", () => {
      state.activeId = chat.id;
      renderAll();

      if (window.innerWidth <= 700) {
        $("sidebar")?.classList.remove("open");
      }
    });

    list.appendChild(button);
  }
}

/* ========================================
   SOURCES AND MESSAGES
======================================== */

function renderSources(container, sources) {
  if (!Array.isArray(sources) || !sources.length) return;

  const section = document.createElement("div");
  section.className = "source-list";

  const heading = document.createElement("p");
  heading.textContent = "🌐 इंटरनेट खोज के स्रोत";
  section.appendChild(heading);

  for (const source of sources) {
    if (!source || typeof source.url !== "string") continue;

    let parsed;
    try {
      parsed = new URL(source.url);
    } catch {
      continue;
    }

    if (!["https:", "http:"].includes(parsed.protocol)) continue;

    const link = document.createElement("a");
    link.href = parsed.href;
    link.textContent = source.title || parsed.hostname;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    section.appendChild(link);
  }

  if (section.querySelector("a")) container.appendChild(section);
}

function renderMessages() {
  const chat = activeChat();
  const box = $("messages");
  if (!box) return;

  box.replaceChildren();

  $("welcome")?.classList.toggle(
    "hidden",
    !!(chat && chat.messages.length)
  );

  if (!chat) return;

  for (const message of chat.messages) {
    const row = document.createElement("div");
    row.className = "message " +
      (message.role === "user" ? "user" : "assistant");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "user" ? "🙂" : "🦚";

    const column = document.createElement("div");
    column.className = "message-column";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = formatText(message.content);
    column.appendChild(bubble);

    if (message.role === "assistant") {
      renderSources(column, message.sources);

      const actions = document.createElement("div");
      actions.className = "message-actions";

      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "कॉपी";

      copy.addEventListener("click", async () => {
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(message.content);
          } else {
            const temporary = document.createElement("textarea");
            temporary.value = message.content;
            document.body.appendChild(temporary);
            temporary.select();
            const success = document.execCommand("copy");
            temporary.remove();
            if (!success) throw new Error("copy failed");
          }
          setStatus("उत्तर कॉपी हो गया।");
        } catch {
          setStatus("कॉपी नहीं हो सका। उत्तर को दबाकर कॉपी करें।");
        }
      });

      actions.appendChild(copy);
      column.appendChild(actions);
    }

    if (message.role === "user") row.append(column, avatar);
    else row.append(avatar, column);

    box.appendChild(row);
  }

  const chatArea = $("chatArea");
  if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
}

function renderAll() {
  renderHistory();
  renderMessages();
}

/* ========================================
   SEND MESSAGE
======================================== */

async function sendMessage(text) {
  text = String(text || "").trim();
  if (!text || state.busy) return;

  if (!activeChat()) createChat();

  const chat = activeChat();

  chat.messages.push({
    role: "user",
    content: text
  });

  updateTitle(chat);
  saveChats();
  renderAll();

  const input = $("messageInput");
  if (input) {
    input.value = "";
    input.style.height = "auto";
  }

  state.busy = true;

  const sendButton = $("sendBtn");
  if (sendButton) sendButton.disabled = true;

  setStatus("सारथी जवाब तैयार कर रहा है...");

  try {
    const settings = getSettings();
    if (!settings.workerUrl) {
      throw new Error("सेटिंग्स में Worker URL सेव करें।");
    }

    const base = settings.workerUrl.trim().replace(/\/+$/, "");
    const endpoint = base.endsWith("/api/chat") ? base : base + "/api/chat";

    const messages = chat.messages
      .filter(message => ["user", "assistant"].includes(message.role))
      .slice(-30)
      .map(message => ({
        role: message.role,
        content: message.content
      }));

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        webSearch: state.webEnabled
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
      throw new Error(data.error ||
        `सर्वर में समस्या आई (HTTP ${response.status})।`);
    }

    if (typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error("सर्वर से सही उत्तर नहीं मिला।");
    }

    chat.messages.push({
      role: "assistant",
      content: data.reply.trim(),
      sources: Array.isArray(data.sources) ? data.sources : []
    });

    if (state.webEnabled) {
      if (data.webSearch === true) {
        setStatus("🌐 इंटरनेट खोज के परिणाम इस्तेमाल किए गए।");
      } else if (data.searchWarning) {
        setStatus("⚠️ " + data.searchWarning);
      } else {
        setStatus("⚠️ इंटरनेट खोज के परिणाम नहीं मिले।");
      }
    } else {
      setStatus("");
    }
  } catch (error) {
    chat.messages.push({
      role: "assistant",
      content: "माफ कीजिए, अभी जवाब नहीं मिल पाया।\n\nकारण: " +
        (error?.message || "कनेक्शन में समस्या है।")
    });
    setStatus("कनेक्शन की समस्या");
  } finally {
    state.busy = false;
    if (sendButton) sendButton.disabled = false;

    updateTitle(chat);
    saveChats();
    renderAll();
    input?.focus();
  }
}

/* ========================================
   WEB SEARCH
======================================== */

function updateWebButton() {
  const button = $("webToggle");
  if (!button) return;

  button.textContent = state.webEnabled
    ? "🌐 इंटरनेट खोज: चालू"
    : "🌐 इंटरनेट खोज: बंद";

  button.setAttribute("aria-pressed", String(state.webEnabled));
}

function toggleWebSearch() {
  state.webEnabled = !state.webEnabled;
  updateWebButton();

  setStatus(state.webEnabled
    ? "इंटरनेट खोज चालू है। Worker को इसका समर्थन करना होगा।"
    : "इंटरनेट खोज बंद है।");
}

/* ========================================
   SETTINGS DIALOG
======================================== */

function openSettings() {
  const settings = getSettings();

  if ($("workerUrl")) $("workerUrl").value = settings.workerUrl || "";
  if ($("assistantName")) $("assistantName").value =
    settings.assistantName || "सारथी";

  safeDialogOpen($("settingsDialog"));
}

function saveSettingsFromDialog() {
  const workerInput = $("workerUrl");
  const nameInput = $("assistantName");

  const cleanedUrl = (workerInput?.value || "").trim().replace(/\/+$/, "");

  if (!cleanedUrl) {
    setStatus("Worker URL खाली नहीं हो सकता।");
    workerInput?.focus();
    return;
  }

  try {
    const parsed = new URL(cleanedUrl);
    if (parsed.protocol !== "https:" ||
        !parsed.hostname.endsWith(".workers.dev")) {
      setStatus("HTTPS Cloudflare workers.dev URL डालें।");
      return;
    }
  } catch {
    setStatus("Worker URL सही नहीं है।");
    return;
  }

  const settings = {
    workerUrl: cleanedUrl,
    assistantName: (nameInput?.value || "सारथी").trim() || "सारथी"
  };

  if (saveSettings(settings)) {
    $("settingsDialog")?.close();
    setStatus("सेटिंग्स सेव हो गईं।");
  }
}

/* ========================================
   CHAT ACTIONS
======================================== */

function deleteCurrentChat() {
  const chat = activeChat();
  if (!chat) {
    setStatus("हटाने के लिए कोई चैट नहीं है।");
    return;
  }

  if (!confirm("क्या इस बातचीत को हटाना चाहते हैं?")) return;

  state.chats = state.chats.filter(item => item.id !== chat.id);
  state.activeId = state.chats[0]?.id || null;

  if (!state.activeId) {
    createChat();
  } else {
    saveChats();
    renderAll();
  }

  setStatus("चैट हटा दी गई।");
}

function renameCurrentChat() {
  const chat = activeChat();
  if (!chat) {
    setStatus("पहले कोई चैट खोलें।");
    return;
  }

  const name = prompt("इस चैट का नया नाम लिखें:", chat.title || "नई चैट");
  if (name === null) return;

  const cleaned = name.trim();
  if (!cleaned) {
    setStatus("चैट का नाम खाली नहीं हो सकता।");
    return;
  }

  chat.title = cleaned.slice(0, 60);
  chat.updatedAt = Date.now();
  saveChats();
  renderAll();
  setStatus("चैट का नाम बदल गया।");
}

function togglePinCurrentChat() {
  const chat = activeChat();
  if (!chat) {
    setStatus("पहले कोई चैट खोलें।");
    return;
  }

  chat.pinned = !chat.pinned;
  updateTitle(chat);
  saveChats();
  renderAll();

  setStatus(chat.pinned ? "चैट पिन हो गई।" : "चैट अनपिन हो गई।");
}

async function shareCurrentChat() {
  const chat = activeChat();
  if (!chat || !chat.messages.length) {
    setStatus("शेयर करने के लिए चैट खाली है।");
    return;
  }

  const text = chat.title + "\n\n" +
    chat.messages.map(message =>
      (message.role === "user" ? "आप: " : "सारथी: ") + message.content
    ).join("\n\n");

  try {
    if (navigator.share) {
      await navigator.share({ title: chat.title, text });
      setStatus("शेयर मेन्यू खुल गया।");
    } else if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      setStatus("चैट कॉपी हो गई। अब कहीं भी पेस्ट करें।");
    } else {
      const temporary = document.createElement("textarea");
      temporary.value = text;
      document.body.appendChild(temporary);
      temporary.select();
      const success = document.execCommand("copy");
      temporary.remove();
      setStatus(success
        ? "चैट कॉपी हो गई।"
        : "इस ब्राउज़र में शेयर उपलब्ध नहीं है।");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      setStatus("चैट शेयर नहीं हो सकी।");
    }
  }
}

function openFindDialog() {
  if ($("findInput")) $("findInput").value = "";
  if ($("findResult")) $("findResult").textContent = "";
  state.findMatches = [];
  state.findIndex = 0;
  safeDialogOpen($("findDialog"));
  $("findInput")?.focus();
}

function findInChat() {
  const chat = activeChat();
  const query = ($("findInput")?.value || "").trim().toLowerCase();

  if (!query) {
    setStatus("खोजने के लिए शब्द लिखें।");
    $("findInput")?.focus();
    return;
  }

  if (!chat) {
    if ($("findResult")) $("findResult").textContent = "कोई चैट खुली नहीं है।";
    return;
  }

  state.findMatches = chat.messages
    .map((message, index) => ({ message, index }))
    .filter(item => item.message.content.toLowerCase().includes(query));

  state.findIndex = 0;

  if (!$("findResult")) return;

  if (!state.findMatches.length) {
    $("findResult").textContent = "कोई मिलान नहीं मिला।";
  } else {
    const match = state.findMatches[0];
    $("findResult").textContent =
      `${state.findMatches.length} परिणाम मिले। पहला संदेश: ${match.index + 1}`;
  }
}

function addToProject() {
  const chat = activeChat();
  if (!chat) {
    setStatus("पहले कोई चैट खोलें।");
    return;
  }

  chat.project = !chat.project;
  saveChats();
  setStatus(chat.project
    ? "चैट को प्रोजेक्ट में चिह्नित कर दिया गया।"
    : "चैट प्रोजेक्ट से हटा दी गई।");
}

function goHome() {
  state.activeId = null;
  renderMessages();
  $("welcome")?.classList.remove("hidden");
  $("moreMenu")?.classList.add("hidden");

  if (window.innerWidth <= 700) {
    $("sidebar")?.classList.remove("open");
  }
}

/* ========================================
   MORE MENU
======================================== */

function closeMoreMenu() {
  $("moreMenu")?.classList.add("hidden");
}

function toggleMoreMenu() {
  $("moreMenu")?.classList.toggle("hidden");
}

function handleMoreAction(action) {
  closeMoreMenu();

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
    case "rename":
      renameCurrentChat();
      break;
    case "project":
      addToProject();
      break;
    case "home":
      goHome();
      break;
    case "delete":
      deleteCurrentChat();
      break;
    case "settings":
      openSettings();
      break;
    default:
      setStatus("यह विकल्प उपलब्ध नहीं है।");
  }
}

/* ========================================
   ATTACHMENTS
======================================== */

function openAttachDialog() {
  safeDialogOpen($("attachDialog"));
}

function chooseFiles(mode) {
  const input = $("fileInput");
  if (!input) return;

  if (mode === "camera") {
    input.setAttribute("accept", "image/*");
    input.setAttribute("capture", "environment");
    input.click();
  } else if (mode === "photos") {
    input.setAttribute("accept", "image/*");
    input.removeAttribute("capture");
    input.click();
  } else {
    input.setAttribute("accept", "image/*,.pdf,.txt,.doc,.docx");
    input.removeAttribute("capture");
    input.click();
  }

  $("attachDialog")?.close();
}

function renderAttachmentPreview() {
  const preview = $("attachmentPreview");
  if (!preview) return;

  preview.replaceChildren();

  if (!state.attachments.length) {
    preview.classList.add("hidden");
    return;
  }

  preview.classList.remove("hidden");

  state.attachments.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";

    const label = document.createElement("span");
    label.textContent = file.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "हटाएँ";
    remove.addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderAttachmentPreview();
    });

    item.append(label, remove);
    preview.appendChild(item);
  });
}

function handleFileSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
   const maxSize = 8 * 1024 * 1024;
  const accepted = [];

  for (const file of files) {
    if (file.size > maxSize) {
      setStatus(`"${file.name}" 8 MB से बड़ी है, इसे नहीं जोड़ा गया।`);
      continue;
    }
    accepted.push(file);
  }

  state.attachments.push(...accepted);
  renderAttachmentPreview();

  if (accepted.length) {
    setStatus("फाइल चुनी गई है। ध्यान दें: अभी फाइल की सामग्री AI को नहीं भेजी जाती।");
  }

  event.target.value = "";
}

/* ========================================
   VOICE INPUT
======================================== */

function startVoiceInput() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus("इस ब्राउज़र में आवाज से लिखने की सुविधा उपलब्ध नहीं है।");
    return;
  }

  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch {}
    state.recognition = null;
    setStatus("माइक बंद किया गया।");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "hi-IN";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => setStatus("बोलिए, सारथी सुन रहा है...");
  recognition.onresult = event => {
    const spoken = event.results?.[0]?.[0]?.transcript || "";
    const input = $("messageInput");
    if (input && spoken) {
      input.value = (input.value ? input.value + " " : "") + spoken;
      input.focus();
    }
    setStatus(spoken ? "आवाज लिख दी गई। भेजने से पहले जाँच लें।" : "");
  };
  recognition.onerror = () => setStatus("माइक नहीं चल सका। ब्राउज़र की अनुमति जाँचें।");
  recognition.onend = () => {
    state.recognition = null;
  };

  state.recognition = recognition;

  try {
    recognition.start();
  } catch {
    state.recognition = null;
    setStatus("माइक शुरू नहीं हो सका।");
  }
}

/* ========================================
   SUGGESTIONS
======================================== */

function handleSuggestion(button) {
  const promptText = button.getAttribute("data-prompt");
  if (!promptText) return;

  const input = $("messageInput");
  if (!input) return;

  input.value = promptText;
  input.focus();

  const form = $("chatForm");
  if (form) form.requestSubmit();
}

/* ========================================
   EVENTS
======================================== */

function bindEvents() {
  $("chatForm")?.addEventListener("submit", event => {
    event.preventDefault();

    if (state.attachments.length) {
      setStatus("फाइल का नाम चुना गया है, लेकिन फाइल भेजने की सुविधा अभी Worker में नहीं जुड़ी है।");
    }

    sendMessage($("messageInput")?.value || "");
  });

  $("messageInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("chatForm")?.requestSubmit();
    }
  });

  $("messageInput")?.addEventListener("input", event => {
    const input = event.target;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
  });

  $("newChatBtn")?.addEventListener("click", createChat);
  $("topNewBtn")?.addEventListener("click", createChat);

  $("webToggle")?.addEventListener("click", toggleWebSearch);

  $("settingsBtn")?.addEventListener("click", openSettings);
  $("saveSettings")?.addEventListener("click", saveSettingsFromDialog);
  $("cancelSettings")?.addEventListener("click", () => {
    $("settingsDialog")?.close();
  });

  $("menuBtn")?.addEventListener("click", () => {
    $("sidebar")?.classList.toggle("open");
  });

  $("moreBtn")?.addEventListener("click", toggleMoreMenu);

  $("moreMenu")?.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (button) handleMoreAction(button.dataset.action);
  });

  document.addEventListener("click", event => {
    const menu = $("moreMenu");
    const moreButton = $("moreBtn");

    if (menu && !menu.classList.contains("hidden") &&
        !menu.contains(event.target) &&
        !moreButton?.contains(event.target)) {
      closeMoreMenu();
    }
  });

  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => handleSuggestion(button));
  });

  $("attachBtn")?.addEventListener("click", openAttachDialog);
  $("cameraOption")?.addEventListener("click", () => chooseFiles("camera"));
  $("photosOption")?.addEventListener("click", () => chooseFiles("photos"));
  $("filesOption")?.addEventListener("click", () => chooseFiles("files"));
  $("closeAttach")?.addEventListener("click", () => $("attachDialog")?.close());
  $("fileInput")?.addEventListener("change", handleFileSelection);

  $("micBtn")?.addEventListener("click", startVoiceInput);

  $("findNext")?.addEventListener("click", findInChat);

  $("deleteChatBtn")?.addEventListener("click", deleteCurrentChat);

  $("findInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      findInChat();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMoreMenu();
  });
}

/* ========================================
   INITIALIZATION
======================================== */

function initialize() {
  const saved = loadJSON(STORAGE_KEY, []);

  state.chats = Array.isArray(saved)
    ? saved.filter(chat =>
        chat &&
        typeof chat.id === "string" &&
        Array.isArray(chat.messages)
      )
    : [];

  state.chats.forEach(chat => {
    if (typeof chat.title !== "string") chat.title = "नई चैट";
    if (!Array.isArray(chat.messages)) chat.messages = [];
    if (typeof chat.pinned !== "boolean") chat.pinned = false;
    if (typeof chat.updatedAt !== "number") chat.updatedAt = Date.now();
  });

  state.chats.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  state.activeId = state.chats[0]?.id || null;

  bindEvents();

  if (!state.activeId) {
    createChat();
  } else {
    renderAll();
  }

  updateWebButton();

  const settings = getSettings();
  if (!settings.workerUrl) {
    setStatus("सेटिंग्स में Worker URL जाँचें।");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
