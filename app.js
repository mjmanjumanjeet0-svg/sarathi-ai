"use strict";

/* ========================================
   SARATHI AI — APP.JS
======================================== */

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "sarathi_ai_chats_v1";
const SETTINGS_KEY = "sarathi_ai_settings_v1";

const state = {
  chats: [],
  activeId: null,
  busy: false,
  webEnabled: false,
  recognition: null,
};

function makeId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.chats)
    );
  } catch {
    setStatus("चैट सेव नहीं हो सकी।");
  }
}

function getSettings() {
  return loadJSON(SETTINGS_KEY, {
    workerUrl: "",
    assistantName: "सारथी",
  });
}

function saveSettings(settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify(settings)
  );
}

function activeChat() {
  return (
    state.chats.find(
      (chat) => chat.id === state.activeId
    ) || null
  );
}

function setStatus(message) {
  const element = $("status");

  if (element) {
    element.textContent = message || "";
  }
}

/* ========================================
   HTML ESCAPING AND TEXT FORMATTING
======================================== */

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return replacements[character];
  });
}

function formatInline(text) {
  let safe = escapeHTML(text);

  safe = safe.replace(
    /`([^`]+)`/g,
    "<code>$1</code>"
  );

  safe = safe.replace(
    /\*\*(.+?)\*\*/g,
    "<strong>$1</strong>"
  );

  safe = safe.replace(
    /\*(.+?)\*/g,
    "<em>$1</em>"
  );

  return safe;
}

function formatText(raw) {
  const lines = String(raw || "")
    .replace(/\r/g, "")
    .split("\n");

  const output = [];

  let listType = null;
  let codeMode = false;
  let codeLines = [];

  function closeList() {
    if (listType) {
      output.push(
        listType === "ul" ? "</ul>" : "</ol>"
      );

      listType = null;
    }
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      closeList();

      if (!codeMode) {
        codeMode = true;
        codeLines = [];
      } else {
        output.push(
          "<pre><code>" +
          escapeHTML(codeLines.join("\n")) +
          "</code></pre>"
        );

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

        output.push(
          nextType === "ul" ? "<ul>" : "<ol>"
        );

        listType = nextType;
      }

      output.push(
        "<li>" +
        formatInline((unordered || ordered)[1]) +
        "</li>"
      );

      continue;
    }

    closeList();

    const heading = line.match(
      /^\s{0,3}(#{1,3})\s+(.+)/
    );

    if (heading) {
      const level = heading[1].length;

      output.push(
        `<h${level}>${formatInline(heading[2])}</h${level}>`
      );
    } else {
      output.push(
        "<p>" + formatInline(line) + "</p>"
      );
    }
  }

  closeList();

  if (codeMode) {
    output.push(
      "<pre><code>" +
      escapeHTML(codeLines.join("\n")) +
      "</code></pre>"
    );
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
    updatedAt: Date.now(),
  };

  state.chats.unshift(chat);
  state.activeId = chat.id;

  saveChats();
  renderAll();

  $("messageInput")?.focus();
}

function updateTitle(chat) {
  if (!chat) return;

  const firstMessage = chat.messages.find(
    (message) => message.role === "user"
  );

  if (
    firstMessage &&
    chat.title === "नई चैट"
  ) {
    chat.title =
      firstMessage.content.trim().slice(0, 35) ||
      "नई चैट";
  }

  chat.updatedAt = Date.now();

  state.chats.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    return b.updatedAt - a.updatedAt;
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

    button.className =
      "history-item" +
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
   SEARCH SOURCE LINKS
======================================== */

function renderSources(container, sources) {
  if (!Array.isArray(sources) || !sources.length) {
    return;
  }

  const section = document.createElement("div");
  section.className = "source-list";

  const heading = document.createElement("p");
  heading.textContent = "🌐 इंटरनेट खोज के स्रोत";
  section.appendChild(heading);

  for (const source of sources) {
    if (!source || typeof source.url !== "string") {
      continue;
    }

    let parsed;

    try {
      parsed = new URL(source.url);
    } catch {
      continue;
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {
      continue;
    }

    const link = document.createElement("a");

    link.href = parsed.href;
    link.textContent = source.title || parsed.hostname;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    section.appendChild(link);
  }

  if (section.querySelector("a")) {
    container.appendChild(section);
  }
}

/* ========================================
   RENDER MESSAGES
======================================== */

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

    row.className =
      "message " +
      (message.role === "user" ? "user" : "assistant");

    const avatar = document.createElement("div");
    avatar.className = "avatar";

    avatar.textContent =
      message.role === "user" ? "🙂" : "🦚";

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
          await navigator.clipboard.writeText(
            message.content
          );

          setStatus("उत्तर कॉपी हो गया।");
        } catch {
          setStatus("कॉपी नहीं हो सका।");
        }
      });

      actions.appendChild(copy);
      column.appendChild(actions);
    }

    if (message.role === "user") {
      row.append(column, avatar);
    } else {
      row.append(avatar, column);
    }

    box.appendChild(row);
  }

  const chatArea = $("chatArea");

  if (chatArea) {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
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

  if (!activeChat()) {
    createChat();
  }

  const chat = activeChat();

  chat.messages.push({
    role: "user",
    content: text,
  });

  updateTitle(chat);
  saveChats();
  renderAll();

  const input = $("messageInput");

  if (input) {
    input.value = "";
    input.style.height = "auto";
  }

  const sendButton = $("sendBtn");

  if (sendButton) {
    sendButton.disabled = true;
  }

  state.busy = true;

  setStatus("सारथी जवाब तैयार कर रहा है...");

  try {
    const settings = getSettings();

    if (!settings.workerUrl) {
      throw new Error(
        "पहले सेटिंग्स में Cloudflare Worker URL सेव करें।"
      );
    }

    const base = settings.workerUrl
      .trim()
      .replace(/\/+$/, "");

    const endpoint = base.endsWith("/api/chat")
      ? base
      : base + "/api/chat";

    const messages = chat.messages
      .filter((message) =>
        ["user", "assistant"].includes(message.role)
      )
      .slice(-30)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const response = await fetch(endpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        messages,
        webSearch: state.webEnabled,
      }),

      signal: AbortSignal.timeout(90000),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
      throw new Error(
        data.error ||
        `सर्वर में समस्या आई (HTTP ${response.status})।`
      );
    }

    if (
      typeof data.reply !== "string" ||
      !data.reply.trim()
    ) {
      throw new Error("सर्वर से सही उत्तर नहीं मिला।");
    }

    chat.messages.push({
      role: "assistant",
      content: data.reply.trim(),
      sources: Array.isArray(data.sources)
        ? data.sources
        : [],
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
      content:
        "माफ कीजिए, अभी जवाब नहीं मिल पाया।\n\nकारण: " +
        (error?.message || "कनेक्शन में समस्या है।"),
    });

    setStatus("कनेक्शन की समस्या");
  } finally {
    state.busy = false;

    if (sendButton) {
      sendButton.disabled = false;
    }

    updateTitle(chat);
    saveChats();
    renderAll();

    input?.focus();
  }
}

/* ========================================
   WEB SEARCH TOGGLE
======================================== */

function updateWebButton() {
  const button = $("webSearchBtn");

  if (!button) return;

  button.textContent = state.webEnabled
    ? "🌐 इंटरनेट खोज: चालू"
    : "🌐 इंटरनेट खोज: बंद";

  button.setAttribute(
    "aria-pressed",
    String(state.webEnabled)
  );
}

/* ========================================
   SETTINGS
======================================== */

function openSettings() {
  const settings = getSettings();

  const workerUrl = prompt(
    "Cloudflare Worker URL डालें:",
    settings.workerUrl || ""
  );

  if (workerUrl === null) return;

  const cleanedUrl = workerUrl.trim().replace(/\/+$/, "");

  if (cleanedUrl) {
    try {
      const parsed = new URL(cleanedUrl);

      if (
        parsed.protocol !== "https:" ||
        !parsed.hostname.endsWith(".workers.dev")
      ) {
        setStatus(
          "HTTPS Cloudflare workers.dev URL डालें।"
        );
        return;
      }
    } catch {
      setStatus("Worker URL सही नहीं है।");
      return;
    }
  }

  settings.workerUrl = cleanedUrl;

  saveSettings(settings);

  setStatus("Worker URL सेव हो गया।");
}

/* ========================================
   NEW CHAT AND DELETE
======================================== */

function deleteCurrentChat() {
  const chat = activeChat();

  if (!chat) return;

  if (!confirm("क्या इस बातचीत को हटाना चाहते हैं?")) {
    return;
  }

  state.chats = state.chats.filter(
    (item) => item.id !== chat.id
  );

  state.activeId = state.chats[0]?.id || null;

  saveChats();
  renderAll();
}

/* ========================================
   BUTTON EVENTS
======================================== */

$("chatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();

  sendMessage($("messageInput")?.value || "");
});

$("messageInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("chatForm")?.requestSubmit();
  }
});

$("newChatBtn")?.addEventListener("click", createChat);

$("webSearchBtn")?.addEventListener("click", () => {
  state.webEnabled = !state.webEnabled;
  updateWebButton();

  setStatus(
    state.webEnabled
      ? "इंटरनेट खोज चालू है।"
      : "इंटरनेट खोज बंद है।"
  );
});

$("settingsBtn")?.addEventListener("click", openSettings);

$("deleteChatBtn")?.addEventListener(
  "click",
  deleteCurrentChat
);

$("menuBtn")?.addEventListener("click", () => {
  $("sidebar")?.classList.toggle("open");
});

/* ========================================
   INITIALIZATION
======================================== */

function initialize() {
  const saved = loadJSON(STORAGE_KEY, []);

  state.chats = Array.isArray(saved)
    ? saved.filter(
        (chat) =>
          chat &&
          typeof chat.id === "string" &&
          Array.isArray(chat.messages)
      )
    : [];

  state.chats.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  state.activeId = state.chats[0]?.id || null;

  if (!state.activeId) {
    createChat();
  } else {
    renderAll();
  }

  updateWebButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
