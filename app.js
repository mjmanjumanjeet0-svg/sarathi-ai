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
