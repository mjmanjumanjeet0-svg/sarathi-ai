"use strict";

const $ = (id) => document.getElementById(id);

const WORKER_URL =
  "https://sarathi-ai.mjmanjumanjeet0.workers.dev";

const CHAT_KEY = "sarathi_ai_chats_v1";

let chats = [];
let currentChatId = null;
let isSending = false;

function makeId() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
}

// =========================
// चैट लोड करना
// =========================

function loadChats() {
  try {
    chats = JSON.parse(
      localStorage.getItem(CHAT_KEY) || "[]"
    );

    if (!Array.isArray(chats)) chats = [];
  } catch {
    chats = [];
  }

  chats = chats.filter(
    (chat) =>
      chat &&
      chat.id &&
      Array.isArray(chat.messages)
  );

  if (!chats.length) {
    createChat(false);
  } else {
    currentChatId = chats[0].id;
    renderHistory();
    renderMessages();
  }
}

function saveChats() {
  localStorage.setItem(
    CHAT_KEY,
    JSON.stringify(chats)
  );
}

function getCurrentChat() {
  return chats.find(
    (chat) => chat.id === currentChatId
  );
}

// =========================
// नई चैट
// =========================

function createChat(closeMenu = true) {
  const chat = {
    id: makeId(),
    title: "नई बातचीत",
    messages: [],
    createdAt: Date.now()
  };

  chats.unshift(chat);
  currentChatId = chat.id;

  saveChats();
  renderHistory();
  renderMessages();

  if (closeMenu) closeMenus();

  $("messageInput")?.focus();
}

// =========================
// मेन्यू बंद करना
// =========================

function closeMenus() {
  $("sidebar")?.classList.remove("open");
  $("moreMenu")?.classList.add("hidden");
}

// =========================
// चैट डिलीट करना
// =========================

function deleteChat(chatId) {
  const chat = chats.find(
    (item) => item.id === chatId
  );

  if (!chat) return;

  const confirmed = confirm(
    "क्या तुम इस बातचीत को डिलीट करना चाहते हो?"
  );

  if (!confirmed) return;

  chats = chats.filter(
    (item) => item.id !== chatId
  );

  if (currentChatId === chatId) {
    currentChatId = chats.length
      ? chats[0].id
      : null;
  }

  if (chats.length === 0) {
    const newChat = {
      id: makeId(),
      title: "नई बातचीत",
      messages: [],
      createdAt: Date.now()
    };

    chats.push(newChat);
    currentChatId = newChat.id;
  }

  saveChats();
  renderHistory();
  renderMessages();
}

// =========================
// चैट हिस्ट्री दिखाना
// =========================

function renderHistory() {
  const list = $("historyList");
  if (!list) return;

  list.replaceChildren();

  chats.forEach((chat) => {
    const row = document.createElement("div");
    row.className = "history-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.textContent =
      chat.title || "नई बातचीत";

    if (chat.id === currentChatId) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      currentChatId = chat.id;

      renderHistory();
      renderMessages();
      closeMenus();
    });

    const deleteButton =
      document.createElement("button");

    deleteButton.type = "button";
    deleteButton.className = "delete-chat-btn";
    deleteButton.textContent = "🗑️";
    deleteButton.title = "चैट डिलीट करें";
    deleteButton.setAttribute(
      "aria-label",
      "चैट डिलीट करें"
    );

    deleteButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteChat(chat.id);
      }
    );

    row.appendChild(button);
    row.appendChild(deleteButton);
    list.appendChild(row);
  });
}

// =========================
// संदेश दिखाना
// =========================

function renderMessages() {
  const messages = $("messages");
  const welcome = $("welcome");

  if (!messages) return;

  messages.replaceChildren();

  const chat = getCurrentChat();

  if (!chat) {
    if (welcome) welcome.hidden = false;
    return;
  }

  if (welcome) {
    welcome.hidden = chat.messages.length > 0;
  }

  chat.messages.forEach((message) => {
    const item = document.createElement("div");

    item.className =
      "message " + message.role;

    const text = document.createElement("div");
    text.className = "message-content";
    text.textContent = message.content;

    item.appendChild(text);
    messages.appendChild(item);
  });

  messages.scrollTop = messages.scrollHeight;
}

// =========================
// संदेश जोड़ना
// =========================

function addMessage(role, content) {
  const chat = getCurrentChat();

  if (!chat) return;

  chat.messages.push({
    role,
    content
  });

  if (
    chat.messages.length === 1 &&
    role === "user"
  ) {
    chat.title = content.slice(0, 35);
  }

  saveChats();
  renderHistory();
  renderMessages();
}

// =========================
// AI को संदेश भेजना
// =========================

async function sendMessage(text) {
  if (isSending) return;

  const message = (text || "").trim();

  if (!message) return;

  if (!getCurrentChat()) {
    createChat(false);
  }

  const input = $("messageInput");

  if (input) input.value = "";

  addMessage("user", message);

  isSending = true;

  const sendButton = $("sendBtn");

  if (sendButton) {
    sendButton.disabled = true;
  }

  try {
    const chat = getCurrentChat();

    const response = await fetch(
      WORKER_URL.replace(/\/+$/, "") +
        "/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: chat.messages.map(
            (item) => ({
              role: item.role,
              content: item.content
            })
          ),
          message,
          webSearch: Boolean(
            $("webToggle")?.checked
          )
        })
      }
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        "सर्वर से जवाब नहीं मिला।"
      );
    }

    const answer =
      data.reply ||
      data.response ||
      data.content ||
      data.choices?.[0]?.message?.content;

    if (!answer) {
      throw new Error(
        "AI का जवाब खाली मिला।"
      );
    }

    addMessage(
      "assistant",
      String(answer)
    );
  } catch (error) {
    addMessage(
      "assistant",
      "माफ़ करना, अभी जवाब नहीं मिल पाया। " +
      (error.message ||
        "इंटरनेट या सर्वर जाँचें।")
    );
  } finally {
    isSending = false;

    if (sendButton) {
      sendButton.disabled = false;
    }

    input?.focus();
  }
}

// =========================
// सभी बटन
// =========================

function bindEvents() {
  $("chatForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      sendMessage(
        $("messageInput")?.value || ""
      );
    }
  );

  $("messageInput")?.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        $("chatForm")?.requestSubmit();
      }
    }
  );

  $("newChatBtn")?.addEventListener(
    "click",
    () => createChat()
  );

  $("topNewBtn")?.addEventListener(
    "click",
    () => createChat()
  );

  $("menuBtn")?.addEventListener(
    "click",
    () => {
      $("sidebar")?.classList.toggle("open");
    }
  );

  $("moreBtn")?.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();

      const menu = $("moreMenu");

      if (menu) {
        menu.classList.toggle("hidden");
      }
    }
  );

  document.addEventListener(
    "click",
    (event) => {
      const menu = $("moreMenu");
      const button = $("moreBtn");

      if (
        menu &&
        !menu.contains(event.target) &&
        !button?.contains(event.target)
      ) {
        menu.classList.add("hidden");
      }
    }
  );

  document
    .querySelectorAll("[data-prompt]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          sendMessage(
            button.dataset.prompt || ""
          );
        }
      );
    });

  document
    .querySelectorAll("[data-action]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const action = button.dataset.action;

          closeMenus();

          if (action === "new-chat") {
            createChat();
          } else if (action === "settings") {
            $("settingsDialog")?.showModal();
          } else if (action === "find") {
            $("findDialog")?.showModal();
          }
        }
      );
    });

  $("settingsBtn")?.addEventListener(
    "click",
    () => {
      $("settingsDialog")?.showModal();
    }
  );

  $("cancelSettings")?.addEventListener(
    "click",
    () => {
      $("settingsDialog")?.close();
    }
  );

  $("settingsForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();

      const url = $("workerUrl")?.value.trim();
      const name =
        $("assistantName")?.value.trim();

      if (url) {
        try {
          const parsed = new URL(url);

          if (parsed.protocol !== "https:") {
            alert(
              "Worker URL https से शुरू होना चाहिए।"
            );
            return;
          }
        } catch {
          alert("सही Worker URL डालें।");
          return;
        }
      }

      localStorage.setItem(
        "sarathi_ai_settings_v1",
        JSON.stringify({
          workerUrl: url || WORKER_URL,
          assistantName: name || "सारथी"
        })
      );

      $("settingsDialog")?.close();

      alert("सेटिंग्स सेव हो गईं।");
    }
  );

  $("attachBtn")?.addEventListener(
    "click",
    () => {
      $("attachDialog")?.showModal();
    }
  );

  $("closeAttach")?.addEventListener(
    "click",
    () => {
      $("attachDialog")?.close();
    }
  );

  $("filesOption")?.addEventListener(
    "click",
    () => {
      $("attachDialog")?.close();
      $("fileInput")?.click();
    }
  );

  $("photosOption")?.addEventListener(
    "click",
    () => {
      $("attachDialog")?.close();
      $("fileInput")?.click();
    }
  );

  $("cameraOption")?.addEventListener(
    "click",
    () => {
      $("attachDialog")?.close();

      alert(
        "कैमरा सुविधा इस संस्करण में उपलब्ध नहीं है।"
      );
    }
  );

  $("fileInput")?.addEventListener(
    "change",
    () => {
      const preview = $("attachmentPreview");

      if (!preview) return;

      preview.replaceChildren();

      Array.from(
        $("fileInput")?.files || []
      ).forEach((file) => {
        const item =
          document.createElement("div");

        item.textContent =
          "चुनी गई फ़ाइल: " + file.name;

        preview.appendChild(item);
      });
    }
  );

  $("findNext")?.addEventListener(
    "click",
    () => {
      const query =
        $("findInput")?.value
          .trim()
          .toLowerCase();

      const result = $("findResult");
      const chat = getCurrentChat();

      if (!result || !query || !chat) return;

      const found = chat.messages.find(
        (message) =>
          message.content
            .toLowerCase()
            .includes(query)
      );

      result.textContent = found
        ? "संदेश मिला: " +
          found.content.slice(0, 180)
        : "इस बातचीत में संदेश नहीं मिला।";
    }
  );

  $("micBtn")?.addEventListener(
    "click",
    () => {
      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        alert(
          "इस ब्राउज़र में आवाज़ पहचान उपलब्ध नहीं है।"
        );
        return;
      }

      const recognition =
        new SpeechRecognition();

      recognition.lang = "hi-IN";

      recognition.onresult = (event) => {
        const input = $("messageInput");

        if (input) {
          input.value +=
            event.results[0][0].transcript;

          input.focus();
        }
      };

      recognition.onerror = () => {
        alert(
          "माइक काम नहीं कर पाया। माइक की अनुमति जाँचें।"
        );
      };

      recognition.start();
    }
  );
}

// =========================
// ऐप शुरू करना
// =========================

function initialize() {
  loadChats();
  bindEvents();

  try {
    const settings = JSON.parse(
      localStorage.getItem(
        "sarathi_ai_settings_v1"
      ) || "{}"
    );

    if ($("workerUrl")) {
      $("workerUrl").value =
        settings.workerUrl || WORKER_URL;
    }

    if ($("assistantName")) {
      $("assistantName").value =
        settings.assistantName || "सारथी";
    }
  } catch {
    // डिफ़ॉल्ट सेटिंग्स इस्तेमाल करें।
  }
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initialize
  );
} else {
  initialize();
}
