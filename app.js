"use strict";

const $ = id => document.getElementById(id);

const STORAGE_KEY = "sarathi_ai_chats_v1";
const SETTINGS_KEY = "sarathi_ai_settings_v1";

const state = {
  chats: [],
  activeId: null,
  busy: false,
  recognition: null,
  findMatches: [],
  findIndex: 0,
  attachments: [],
  webEnabled: false
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

function saveChats() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.chats)
    );
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
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify(settings)
  );
}

function activeChat() {
  return state.chats.find(
    chat => chat.id === state.activeId
  ) || null;
}

function setStatus(message) {
  const element = $("status");
  if (element) {
    element.textContent = message || "";
  }
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

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatText(raw) {
  const lines = String(raw)
    .replace(/\r/g, "")
    .split("\n");

  const output = [];

  let list = null;
  let codeMode = false;
  let code = [];

  const inline = text => escapeHTML(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
      "$1<em>$2</em>"
    );

  const closeList = () => {
    if (list) {
      output.push(list === "ul" ? "</ul>" : "</ol>");
      list = null;
    }
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      closeList();

      if (!codeMode) {
        codeMode = true;
        code = [];
      } else {
        output.push(
          "<pre><code>" +
          escapeHTML(code.join("\n")) +
          "</code></pre>"
        );

        codeMode = false;
      }

      continue;
    }

    if (codeMode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)/);

    if (unordered || ordered) {
      const type = unordered ? "ul" : "ol";

      if (list !== type) {
        closeList();

        output.push(
          type === "ul" ? "<ul>" : "<ol>"
        );

        list = type;
      }

      output.push(
        "<li>" + inline((unordered || ordered)[1]) + "</li>"
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
        `<h${level}>${inline(heading[2])}</h${level}>`
      );
    } else {
      output.push("<p>" + inline(line) + "</p>");
    }
  }

  closeList();

  if (codeMode) {
    output.push(
      "<pre><code>" +
      escapeHTML(code.join("\n")) +
      "</code></pre>"
    );
  }

  return output.join("");
}

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();

  for (const chat of state.chats) {
    const button = document.createElement("button");

    button.className =
      "history-item" +
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
  const box = $("messages");

  box.replaceChildren();

  $("welcome").classList.toggle(
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
      const actions = document.createElement("div");
      actions.className = "message-actions";

      const copy = document.createElement("button");
      copy.textContent = "कॉपी";

      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            message.content
          );

          setStatus("उत्तर कॉपी हो गया।");
        } catch {
          setStatus(
            "कॉपी नहीं हुआ। उत्तर को चुनकर कॉपी करें।"
          );
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

  $("chatArea").scrollTop = $("chatArea").scrollHeight;
}

function renderAll() {
  renderHistory();
  renderMessages();
}

function closeSidebarOnMobile() {
  if (innerWidth <= 700) {
    $("sidebar").classList.remove("open");
  }
}

function updateTitle(chat) {
  if (!chat) return;

  const first = chat.messages.find(
    message => message.role === "user"
  );

  if (first && chat.title === "नई चैट") {
    chat.title = first.content.trim().slice(0, 35) ||
      "नई चैट";
  }

  chat.updatedAt = Date.now();

  state.chats.sort((a, b) =>
    a.pinned !== b.pinned
      ? (a.pinned ? -1 : 1)
      : b.updatedAt - a.updatedAt
  );
}

function showAttachments() {
  const box = $("attachmentPreview");

  if (!state.attachments.length) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }

  box.classList.remove("hidden");

  box.textContent =
    "चुनी गई फाइलें: " +
    state.attachments.map(file => file.name).join(", ") +
    " — हटाने के लिए टैप करें";

  box.onclick = () => {
    state.attachments = [];
    $("fileInput").value = "";
    showAttachments();
  };
}

async function sendMessage(text) {
  text = String(text || "").trim();

  if (
    (!text && !state.attachments.length) ||
    state.busy
  ) {
    return;
  }

  if (state.attachments.length) {
    setStatus(
      "फोटो/फाइल चुनी गई है, लेकिन उसे AI तक भेजने के लिए Worker में फाइल/इमेज सपोर्ट जरूरी है।"
    );

    if (!text) return;
  }

  if (!activeChat()) {
    createChat();
  }

  const chat = activeChat();

  const attachmentText = state.attachments.length
    ? "\n[संलग्न फाइल: " +
      state.attachments.map(file => file.name).join(", ") +
      "]"
    : "";

  chat.messages.push({
    role: "user",
    content: text + attachmentText
  });

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

    const base = settings.workerUrl
      .trim()
      .replace(/\/+$/, "");

    const endpoint = base.endsWith("/api/chat")
      ? base
      : base + "/api/chat";

    const messages = chat.messages
      .filter(message =>
        message.role === "user" ||
        message.role === "assistant"
      )
      .slice(-30)
      .map(message => ({
        role: message.role,
        content: message.content
      }));

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages,
        webSearch: state.webEnabled
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        "सर्वर में समस्या आई (HTTP " +
        response.status +
        ")।"
      );
    }

    if (
      typeof data.reply !== "string" ||
      !data.reply.trim()
    ) {
      throw new Error(
        "सर्वर से सही उत्तर नहीं मिला। Worker का कोड जाँचें।"
      );
    }

    chat.messages.push({
      role: "assistant",
      content: data.reply.trim()
    });

    // इंटरनेट खोज की वास्तविक स्थिति दिखाएँ।
    if (state.webEnabled) {
      if (data.webSearch === true) {
        setStatus("🌐 इंटरनेट खोज के परिणाम इस्तेमाल किए गए।");
      } else if (data.searchWarning) {
        setStatus("⚠️ " + data.searchWarning);
      } else {
        setStatus(
          "⚠️ Worker ने इंटरनेट खोज के परिणाम की पुष्टि नहीं की।"
        );
      }
    } else {
      setStatus("");
    }

  } catch (error) {
    chat.messages.push({
      role: "assistant",
      content:
        "माफ कीजिए, अभी उत्तर नहीं मिल पाया।\n\nकारण: " +
        (
          error && error.message
            ? error.message
            : "इंटरनेट या सर्वर से कनेक्शन नहीं हो पाया।"
        )
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

// संदेश भेजना
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
  input.style.height =
    Math.min(input.scrollHeight, 150) + "px";
});

// चैट और मेनू
$("newChatBtn").addEventListener("click", () => {
  createChat();
  closeSidebarOnMobile();
});

$("topNewBtn").addEventListener("click", createChat);

$("menuBtn").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
});

$("moreBtn").addEventListener("click", () => {
  $("moreMenu").classList.toggle("hidden");
});

document.addEventListener("click", event => {
  if (
    !event.target.closest("#moreMenu") &&
    !event.target.closest("#moreBtn")
  ) {
    $("moreMenu").classList.add("hidden");
  }
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt);
  });
});

// इंटरनेट खोज टॉगल
$("webToggle").addEventListener("click", () => {
  state.webEnabled = !state.webEnabled;

  $("webToggle").classList.toggle(
    "on",
    state.webEnabled
  );

  $("webToggle").setAttribute(
    "aria-pressed",
    String(state.webEnabled)
  );

  $("webToggle").textContent = state.webEnabled
    ? "🌐 इंटरनेट खोज: चालू"
    : "🌐 इंटरनेट खोज: बंद";

  setStatus(
    state.webEnabled
      ? "इंटरनेट खोज चालू है। अगला सवाल वेब-सर्च सुविधा वाले Worker को भेजा जाएगा।"
      : "इंटरनेट खोज बंद है।"
  );
});

// फाइल चुनना
$("attachBtn").addEventListener("click", () => {
  $("attachDialog").showModal();
});

$("closeAttach").addEventListener("click", () => {
  $("attachDialog").close();
});

$("cameraOption").addEventListener("click", () => {
  $("fileInput").setAttribute("accept", "image/*");
  $("fileInput").setAttribute("capture", "environment");

  $("attachDialog").close();
  $("fileInput").click();
});

$("photosOption").addEventListener("click", () => {
  $("fileInput").setAttribute("accept", "image/*");
  $("fileInput").removeAttribute("capture");

  $("attachDialog").close();
  $("fileInput").click();
});

$("filesOption").addEventListener("click", () => {
  $("fileInput").setAttribute(
    "accept",
    "image/*,.pdf,.txt,.doc,.docx"
  );

  $("fileInput").removeAttribute("capture");

  $("attachDialog").close();
  $("fileInput").click();
});

$("fileInput").addEventListener("change", event => {
  state.attachments = Array.from(
    event.target.files || []
  );

  showAttachments();
});

// मेनू की सुविधाएँ
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
    const text = chat.messages
      .map(message =>
        (message.role === "user" ? "आप: " : "सारथी: ") +
        message.content
      )
      .join("\n\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: chat.title,
          text
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setStatus("चैट का टेक्स्ट कॉपी हो गया।");
      } else {
        setStatus("इस ब्राउज़र में शेयर सुविधा उपलब्ध नहीं है।");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setStatus("शेयर नहीं हो पाया।");
      }
    }
  }

  if (action === "pin") {
    chat.pinned = !chat.pinned;
    saveChats();
    renderAll();

    setStatus(
      chat.pinned ? "चैट पिन हो गई।" : "चैट अनपिन हो गई।"
    );
  }

  if (action === "rename") {
    const title = prompt(
      "चैट का नया नाम लिखें:",
      chat.title
    );

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

  if (
    action === "delete" &&
    confirm("क्या आप यह पूरी चैट हटाना चाहते हैं?")
  ) {
    state.chats = state.chats.filter(
      item => item.id !== chat.id
    );

    state.activeId = state.chats[0]?.id || null;

    saveChats();
    renderAll();
    setStatus("चैट हटा दी गई।");
  }
});

// सेटिंग्स
function openSettings() {
  const settings = getSettings();

  $("workerUrl").value = settings.workerUrl || "";

  $("assistantName").value =
    settings.assistantName || "सारथी";

  $("settingsDialog").showModal();
}

$("settingsBtn").addEventListener("click", openSettings);

$("cancelSettings").addEventListener("click", () => {
  $("settingsDialog").close();
});

$("saveSettings").addEventListener("click", () => {
  const raw = $("workerUrl").value.trim();
  let workerUrl = "";

  if (raw) {
    try {
      const url = new URL(raw);

      if (url.protocol !== "https:") {
        setStatus(
          "Worker URL https:// से शुरू होना चाहिए।"
        );
        return;
      }

      workerUrl =
        url.origin + url.pathname.replace(/\/+$/, "");

    } catch {
      setStatus("सही Worker URL लिखें।");
      return;
    }
  }

  saveSettings({
    workerUrl,
    assistantName:
      $("assistantName").value.trim() || "सारथी"
  });

  $("settingsDialog").close();
  setStatus("सेटिंग्स सेव हो गईं।");
});

// चैट में शब्द खोजना
$("findNext").addEventListener("click", () => {
  const query = $("findInput")
    .value.trim().toLowerCase();

  const chat = activeChat();

  if (!query || !chat) {
    $("findResult").textContent =
      "पहले शब्द लिखें और चैट खोलें।";
    return;
  }

  const found = chat.messages
    .map((message, index) => ({ message, index }))
    .filter(item =>
      item.message.content.toLowerCase().includes(query)
    );

  state.findMatches = found;
  state.findIndex = 0;

  if (!found.length) {
    $("findResult").textContent =
      "कोई परिणाम नहीं मिला।";
    return;
  }

  const result = found[0];

  $("findResult").textContent =
    `${found.length} परिणाम मिले। पहला परिणाम: संदेश ` +
    `${result.index + 1} — ` +
    result.message.content.slice(0, 100);

  $("messages")
    .querySelectorAll(".message")[result.index]
    ?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
});

// हिंदी वॉइस इनपुट
$("micBtn").addEventListener("click", () => {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus(
      "इस ब्राउज़र में आवाज से लिखने की सुविधा उपलब्ध नहीं है। Chrome में माइक्रोफोन अनुमति जाँचें।"
    );
    return;
  }

  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;

    $("micBtn").textContent = "🎙️";
    $("micBtn").classList.remove("listening");
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "hi-IN";
  recognition.interimResults = true;
  recognition.continuous = false;

  state.recognition = recognition;

  $("micBtn").textContent = "⏹️";
  $("micBtn").classList.add("listening");

  setStatus("बोलिए, सारथी सुन रहा है...");

  recognition.onresult = event => {
    let text = "";

    for (
      let index = event.resultIndex;
      index < event.results.length;
      index++
    ) {
      text += event.results[index][0].transcript;
    }

    $("messageInput").value = text;

    $("messageInput").dispatchEvent(
      new Event("input")
    );
  };

  recognition.onerror = () => {
    setStatus(
      "माइक काम नहीं कर पाया। माइक्रोफोन अनुमति जाँचें।"
    );
  };

  recognition.onend = () => {
    state.recognition = null;

    $("micBtn").textContent = "🎙️";
    $("micBtn").classList.remove("listening");

    if (
      $("status").textContent.includes("सुन रहा है")
    ) {
      setStatus("");
    }
  };

  try {
    recognition.start();
  } catch {
    state.recognition = null;

    $("micBtn").textContent = "🎙️";
    $("micBtn").classList.remove("listening");

    setStatus("माइक शुरू नहीं हो पाया।");
  }
});

// ऐप शुरू करना
(function init() {
  const chats = loadJSON(STORAGE_KEY, []);

  state.chats = Array.isArray(chats)
    ? chats.filter(
        chat =>
          chat &&
          typeof chat.id === "string" &&
          Array.isArray(chat.messages)
      )
    : [];

  if (state.chats.length) {
    state.chats.sort((a, b) =>
      a.pinned !== b.pinned
        ? (a.pinned ? -1 : 1)
        : (b.updatedAt || 0) - (a.updatedAt || 0)
    );

    state.activeId = state.chats[0].id;
  }

  renderAll();
})();
