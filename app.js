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
  voiceReplyPending: false,
  voiceStopRequested: false
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
        project: typeof chat.project === "string" ? chat.project.slice(0, 60) : "",
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
    button.textContent = (chat.pinned ? "📌 " : "") +
      (chat.project ? "📁 " + chat.project + " · " : "") + chat.title;
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

function renderQuizCard(message) {
  const quiz = message.quiz;
  if (!quiz || !Array.isArray(quiz.questions)) return null;
  const card = document.createElement("section");
  card.className = "quiz-card";
  const heading = document.createElement("h3");
  heading.textContent = quiz.title || "सारथी अभ्यास टेस्ट";
  card.appendChild(heading);
  const chosen = Array.isArray(quiz.selected) ? quiz.selected : [];
  quiz.questions.forEach((item, index) => {
    const block = document.createElement("fieldset");
    block.className = "quiz-question";
    const legend = document.createElement("legend");
    legend.textContent = (index + 1) + ". " + item.question;
    block.appendChild(legend);
    (item.options || []).forEach((option, optionIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiz-option";
      button.textContent = String.fromCharCode(65 + optionIndex) + ". " + option;
      button.disabled = Boolean(quiz.submitted);
      if (chosen[index] === optionIndex) button.classList.add("selected");
      button.addEventListener("click", () => {
        quiz.selected = Array.isArray(quiz.selected) ? quiz.selected : [];
        quiz.selected[index] = optionIndex;
        saveChats();
        renderMessages();
      });
      block.appendChild(button);
    });
    if (quiz.submitted) {
      const feedback = document.createElement("p");
      const correct = Number(item.answer) === Number(chosen[index]);
      feedback.className = "quiz-feedback " + (correct ? "correct" : "incorrect");
      feedback.textContent = (correct ? "सही उत्तर। " : "सही उत्तर: " + String.fromCharCode(65 + Number(item.answer)) + ". ") + (item.explanation || "");
      block.appendChild(feedback);
    }
    card.appendChild(block);
  });
  const footer = document.createElement("div");
  footer.className = "quiz-footer";
  if (quiz.submitted) {
    const score = document.createElement("strong");
    score.textContent = "आपका परिणाम: " + quiz.score + " / " + quiz.questions.length;
    footer.appendChild(score);
  } else {
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "quiz-submit";
    submit.textContent = "टेस्ट जमा करें";
    submit.disabled = quiz.questions.some((_, i) => !Number.isInteger(chosen[i]));
    submit.addEventListener("click", () => {
      quiz.score = quiz.questions.reduce((total, item, i) => total + (Number(item.answer) === Number(chosen[i]) ? 1 : 0), 0);
      quiz.submitted = true;
      saveChats();
      renderMessages();
    });
    footer.appendChild(submit);
  }
  card.appendChild(footer);
  return card;
}

function parseSarathiQuiz(raw) {
  const text = String(raw || "").replace(/^\s*\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(data.questions) || data.questions.length < 3 || data.questions.length > 20) return null;
    const questions = data.questions.map(q => ({
      question: String(q.question || ""),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : [],
      answer: Number(q.answer),
      explanation: String(q.explanation || "")
    }));
    if (questions.some(q => !q.question || q.options.length !== 4 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3)) return null;
    return { title: String(data.title || "अभ्यास टेस्ट"), questions, selected: [], submitted: false, score: null };
  } catch { return null; }
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
    if (message.imageUrl) {
      const imageWrap = document.createElement("div");
      imageWrap.style.cssText = "position:relative;display:inline-block;max-width:100%;margin-top:10px";
      const image = document.createElement("img");
      image.src = message.imageUrl;
      image.alt = "सारथी द्वारा बनाई गई तस्वीर";
      image.loading = "lazy";
      image.style.cssText = "display:block;max-width:100%;height:auto;border-radius:12px";
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "image-download-btn";
      downloadButton.textContent = "⬇";
      downloadButton.title = "फोटो डाउनलोड करें";
      downloadButton.setAttribute("aria-label", "फोटो डाउनलोड करें");
      downloadButton.style.cssText = "position:absolute;right:9px;bottom:9px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(20,20,20,.78);color:#fff;font-size:21px;cursor:pointer;display:grid;place-items:center";
      downloadButton.addEventListener("click", async () => {
        downloadButton.disabled = true;
        try {
          await downloadSarathiImage(message.imageUrl, true);
          setStatus("फोटो डाउनलोड हो गई।");
        } catch (error) {
          setStatus("फोटो डाउनलोड नहीं हो सकी। फोटो पर देर तक दबाकर सेव करने की कोशिश करें।");
        } finally {
          downloadButton.disabled = false;
        }
      });
      imageWrap.append(image, downloadButton);
      body.append(imageWrap);
    }

    content.append(label, body);
    const quizCard = renderQuizCard(message);
    if (quizCard) content.appendChild(quizCard);

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

function addMessage(role, content, imageUrl) {
  let chat = activeChat();
  if (!chat) chat = createChat();

  chat.messages.push({
    id: makeId(),
    role,
    content: String(content || ""),
    ...(imageUrl ? { imageUrl: String(imageUrl) } : {}),
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

async function fileToImageDataUrl(file, maxSide = 512) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("फोटो खोली नहीं जा सकी।"));
      element.src = sourceUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.76);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function extractVideoFrames(file, count = 5) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("यह वीडियो फ़ोन में नहीं खुल सका। MP4 या WebM वीडियो आज़माएँ।"));
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("वीडियो की अवधि पढ़ी नहीं जा सकी।");
    const total = Math.min(count, Math.max(1, Math.ceil(video.duration)));
    const frames = [];
    for (let i = 0; i < total; i++) {
      const time = total === 1 ? 0 : Math.min(video.duration - 0.08, (video.duration * i) / (total - 1));
      await new Promise((resolve, reject) => {
        const done = () => { video.removeEventListener("seeked", done); resolve(); };
        video.addEventListener("seeked", done, { once: true });
        video.onerror = () => reject(new Error("वीडियो का फ्रेम पढ़ने में समस्या हुई।"));
        video.currentTime = Math.max(0, time);
        if (Math.abs(video.currentTime - time) < 0.02 && video.readyState >= 2) resolve();
      });
      const scale = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.72));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function requestSarathiMediaUnderstanding(prompt, images) {
  const token = await getAuthToken();
  const response = await fetch(getWorkerUrl() + "/api/media/understand", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ prompt, images })
  });
  const data = await response.json();
  if (!response.ok || !data.success || !data.reply) {
    throw new Error(data.error || "फोटो/वीडियो समझा नहीं जा सका।");
  }
  return data.reply;
}

async function requestSarathiImage(prompt, imageFile) {
  const token = await getAuthToken();
  let images;
  if (imageFile) {
    if (!/^image\/(png|jpeg|webp)$/i.test(imageFile.type) || imageFile.size > 4 * 1024 * 1024) {
      throw new Error("फोटो PNG/JPG/WEBP में और 4 MB तक होनी चाहिए।");
    }
    images = [await fileToImageDataUrl(imageFile, 500)];
  }
  const response = await fetch(getWorkerUrl() + "/api/media/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ prompt, ...(images ? { images } : {}) })
  });
  const data = await response.json();
  if (!response.ok || !data.imageUrl) throw new Error(data.error || "फोटो तैयार नहीं हो सकी।");
  return data.imageUrl;
}

async function downloadSarathiImage(imageUrl, edited) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("फोटो डाउनलोड नहीं हो सकी।");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = edited ? "sarathi-edited-photo.png" : "sarathi-created-photo.png";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

async function postChatWithRetry(url, token, payload) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (![502, 503, 504].includes(response.status) || attempt === 1) return response;
      lastError = new Error("सर्वर अस्थायी रूप से व्यस्त है।");
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? new Error("सर्वर से जवाब आने में समय अधिक लगा।")
        : error;
      if (attempt === 1) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise(resolve => setTimeout(resolve, 900));
  }
  throw lastError || new Error("सर्वर से संपर्क नहीं हो सका।");
}

function explicitlyRequestsWebSearch(prompt) {
  return /(?:इंटरनेट|वेब|online)\s*(?:पर\s*)?(?:खोज|सर्च|search)|(?:ताज़ा|ताजा|आज की|लेटेस्ट|latest|current|breaking)\s*(?:खबर|समाचार|news|updates?)|(?:search|खोज|सर्च)\s+(?:the\s+)?(?:internet|web|online)/i.test(String(prompt || ""));
}

/* ========================================
   SEND MESSAGE
======================================== */

async function sendMessage(text) {
  let prompt = String(
    text !== undefined ? text : ($("messageInput")?.value || "")
  ).trim();

  const quietCommand = /^(?:(?:अच्छा|ठीक)\s+है\s+सारथी|(?:ठीक|अच्छा)\s+है\s+बाय(?:\s+सारथी)?|ओके\s+सारथी|okay\s+sarathi|ok\s+sarathi|बस\s+सारथी|धन्यवाद\s+सारथी|बाय(?:\s+सारथी)?|bye(?:\s+sarathi)?|अलविदा(?:\s+सारथी)?)$/i.test(prompt);
  if (quietCommand) {
    state.voiceReplyPending = false;
    state.voiceStopRequested = true;
    if (window.SarathiNative && typeof window.SarathiNative.stopSpeaking === "function") {
      window.SarathiNative.stopSpeaking();
    }
    if (window.SarathiNative && typeof window.SarathiNative.endConversation === "function") {
      window.SarathiNative.endConversation();
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setStatus("ठीक है। बातचीत समाप्त। दोबारा बुलाने के लिए “हेलो सारथी” कहें।");
    const input = $("messageInput");
    if (input) { input.value = ""; input.style.height = ""; }
    return;
  }

  if ((!prompt && !state.attachments.length) || state.busy) return;
  if (!prompt && state.attachments.length) prompt = "कृपया संलग्न फाइल/फोटो की सामग्री पढ़कर समझाओ और मेरे सवालों में मदद करो।";
  const shouldSpeakReply = state.voiceReplyPending;
  state.voiceReplyPending = false;

  const workerUrl = getWorkerUrl();

  if (!workerUrl) {
    setStatus("सेटिंग्स में Worker URL भरें।");
    openSettings();
    return;
  }

  const videoFile = state.attachments.find(file => file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name));
  const imageFile = state.attachments.find(file => file.type.startsWith("image/"));
  const asksToEditImage = /(फोटो|तस्वीर|इमेज|image|photo).{0,45}(एडिट|बदल|सुधार|सुंदर|बैकग्राउंड|पृष्ठभूमि|रंग|हटाओ|जोड़ो|edit|change|modify|background)|(एडिट|बदल|सुधार|सुंदर|बैकग्राउंड|पृष्ठभूमि|रंग|हटाओ|जोड़ो|edit|change|modify|background).{0,45}(फोटो|तस्वीर|इमेज|image|photo)/i.test(prompt);
  const asksToGenerateImage = /(फोटो|तस्वीर|इमेज|image|picture).{0,55}(बनाओ|बना दो|बना लें|बनाएं|बनाकर|तैयार|generate|create|draw)|(बनाओ|बना दो|बना लें|बनाएं|बनाकर|तैयार|generate|create|draw).{0,55}(फोटो|तस्वीर|इमेज|image|picture)/i.test(prompt);
  if (!asksToEditImage && !asksToGenerateImage && (imageFile || videoFile)) {
    if (!window.confirm("चुनी गई फोटो/वीडियो के चुने हुए फ्रेम इंटरनेट के ज़रिए AI को भेजे जाएँगे। क्या भेजना है?")) return;
    addMessage("user", prompt);
    setBusy(true);
    try {
      let frames;
      if (videoFile) {
        setStatus("वीडियो के कुछ फ्रेम पढ़े जा रहे हैं…");
        frames = await extractVideoFrames(videoFile, 5);
      } else {
        setStatus("फोटो तैयार की जा रही है…");
        frames = [await fileToImageDataUrl(imageFile)];
      }
      const question = prompt || (videoFile
        ? "इस वीडियो के चुने हुए फ्रेम देखकर हिंदी में बताओ कि इसमें क्या हो रहा है।"
        : "इस फोटो में क्या दिख रहा है? विस्तार से हिंदी में बताओ।");
      setStatus("AI फोटो/वीडियो समझ रही है…");
      const reply = await requestSarathiMediaUnderstanding(question, frames);
      addMessage("assistant", reply);
      setStatus("मीडिया का विश्लेषण पूरा हुआ।");
      state.attachments = state.attachments.filter(file => file !== imageFile && file !== videoFile);
      renderAttachmentPreview();
    } catch (error) {
      addMessage("assistant", "मीडिया समझा नहीं जा सका: " + (error?.message || "कृपया बाद में कोशिश करें।"));
      setStatus("मीडिया समझने में समस्या आई।");
    } finally {
      setBusy(false);
    }
    return;
  }
  if (asksToEditImage || asksToGenerateImage) {
    if (asksToEditImage && !imageFile) {
      setStatus("जिस फोटो को एडिट करना है, उसे + बटन से पहले जोड़ें।");
      return;
    }
    if (imageFile && !asksToEditImage) {
      setStatus("फोटो एडिट करने के लिए लिखें: इस फोटो का बैकग्राउंड बदल दो।");
      return;
    }
    addMessage("user", prompt);
    if (imageFile) state.attachments = state.attachments.filter(file => file !== imageFile);
    renderAttachmentPreview();
    setBusy(true);
    setStatus(asksToEditImage ? "फोटो एडिट हो रही है…" : "नई फोटो बनाई जा रही है…");
    try {
      const imageUrl = await requestSarathiImage(prompt, imageFile || null);
      addMessage("assistant", asksToEditImage ? "आपकी एडिट की हुई फोटो तैयार है।" : "आपकी बनाई हुई फोटो तैयार है।", imageUrl);
      setStatus("फोटो तैयार है। फोटो के कोने में ⬇ दबाकर डाउनलोड करें।");
    } catch (error) {
      addMessage("assistant", "फोटो तैयार नहीं हो सकी: " + (error?.message || "कृपया बाद में कोशिश करें।"));
      setStatus("फोटो सेवा में समस्या आई।");
    } finally {
      setBusy(false);
    }
    return;
  }

  const input = $("messageInput");

  if (input) {
    input.value = "";
    input.style.height = "";
  }

  let attachmentContext = "";
  if (state.attachments.length) {
    if (!window.confirm("चुनी गई फाइलों से निकाला गया पाठ इंटरनेट के जरिए AI सेवा को भेजा जाएगा। क्या भेजना है?")) return;
    setBusy(true);
    try {
      attachmentContext = await extractAttachmentsText(state.attachments);
      if (!attachmentContext.trim()) throw new Error("फाइलों से कोई पढ़ने योग्य पाठ नहीं मिला।");
      prompt = (prompt + "\n\nसंलग्न सामग्री:\n" + attachmentContext).slice(0, 11500);
      state.attachments = [];
      renderAttachmentPreview();
    } catch (error) {
      setBusy(false);
      setStatus("फाइल नहीं पढ़ी जा सकी: " + (error?.message || "अज्ञात त्रुटि"));
      return;
    }
    setBusy(false);
  }

  const needsCurrentInfo = /(आज|अभी|वर्तमान|ताज़ा|ताजा|लेटेस्ट|latest|current|today|now|भाव|कीमत|रेट|rate|price|मौसम|weather|तापमान|ट्रेन|रेल|train|pnr|समय सारणी|खबर|समाचार|news|सोने|सोना|gold|चांदी|चाँदी|silver|स्टॉक|शेयर बाजार|share market|exchange rate|डॉलर|रुपया|राष्ट्रपति|प्रधानमंत्री|मुख्यमंत्री|राज्यपाल|लोकसभा अध्यक्ष|सिलेबस|पाठ्यक्रम|परीक्षा तिथि|एडमिट कार्ड|प्रवेश पत्र|रिजल्ट|परिणाम|आवेदन|फॉर्म|फीस|पात्रता|नियम|official syllabus|exam date|admit card|result|eligibility|application form)/i.test(prompt);
  // The web toggle enables useful searches, but never search greetings, tiny follow-ups,
  // or stable basic facts such as India's capital.
  const isStableGeneralKnowledge = /(?:भारत|india).{0,18}(?:राजधानी|capital)|(?:राजधानी|capital).{0,18}(?:भारत|india)/i.test(prompt);
  const isTinyFollowUp = prompt.trim().length <= 8 && !needsCurrentInfo && !explicitlyRequestsWebSearch(prompt);
  // Never search merely because the web toggle was left on.
  // Search only when the user explicitly asks for the internet, or a current fact is needed.
  const useWebSearch = !isSimpleGreeting(prompt) && !isStableGeneralKnowledge && !isTinyFollowUp &&
    (explicitlyRequestsWebSearch(prompt) || needsCurrentInfo || state.webEnabled);

  addMessage("user", prompt);
  setBusy(true);
  setStatus(useWebSearch ? "सारथी इंटरनेट पर खोजकर जवाब तैयार कर रहा है…" : "सारथी जवाब तैयार कर रहा है…");

  try {
    let token = await getAuthToken();

    let response = await postChatWithRetry(workerUrl + "/api/chat", token, {
        message: prompt,
        messages: activeChat().messages
          .filter(item => item.role === "user" || item.role === "assistant")
          .slice(-20)
          .map(item => ({ role: item.role, content: item.content })),
        webSearch: useWebSearch
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

      response = await postChatWithRetry(workerUrl + "/api/chat", token, {
        message: prompt,
        messages: activeChat().messages
          .filter(item => item.role === "user" || item.role === "assistant")
          .slice(-20)
          .map(item => ({ role: item.role, content: item.content })),
        webSearch: useWebSearch
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

    // Never display stray or unrelated links in ordinary conversation.
    // Sources are shown only when the user explicitly asks for an internet search.
    let cleanAnswer = answer.trim();
    if (!explicitlyRequestsWebSearch(prompt)) {
      cleanAnswer = cleanAnswer
        // Remove common source/reference sections, including English headings.
        .replace(/\n{0,2}\s*(?:🌐\s*)?(?:इंटरनेट से मिले स्रोत|स्रोत(?: सूची)?|references?|sources?|वेबसाइट(?:ें)?|लिंक(?:\s*सूची)?)\s*[:：]?\s*[\s\S]*$/i, "")
        // Remove standalone URLs and Markdown link lines inserted by a model.
        .replace(/^\s*(?:[-*•]\s*)?(?:\[[^\]]+\]\([^)]*https?:\/\/[^)]+\)|https?:\/\/\S+|www\.\S+)\s*$/gim, "")
        // Remove inline Markdown links while preserving their readable label.
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
        // Remove bare URLs even if the model placed them after a sentence.
        .replace(/https?:\/\/\S+|www\.\S+/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else if (data.sources?.length) {
      cleanAnswer = cleanAnswer
        .replace(/\n{1,2}\s*(?:स्रोत(?: सूची)?|sources?)\s*[:：][\s\S]*$/i, "")
        .trim();
    }

    if (prompt.includes("SARATHI_QUIZ_JSON:")) {
      const quiz = parseSarathiQuiz(cleanAnswer);
      if (quiz) {
        addMessage("assistant", "आपका अभ्यास टेस्ट तैयार है। हर प्रश्न का एक विकल्प चुनकर टेस्ट जमा करें।");
        const chat = activeChat();
        chat.messages[chat.messages.length - 1].quiz = quiz;
        saveChats();
        renderMessages();
      } else {
        addMessage("assistant", "टेस्ट का प्रारूप सही नहीं मिला। कृपया MCQ टेस्ट फिर से शुरू करें।\n\n" + answer.trim());
      }
    } else {
      addMessage("assistant", cleanAnswer);
    }

    // Only speak automatically for a reply triggered by the wake-word voice command.
    // Typed messages stay silent; the user can still tap the per-message speaker button.
    if (shouldSpeakReply && !state.voiceStopRequested && window.SarathiNative && typeof window.SarathiNative.speak === "function") {
      window.SarathiNative.speak(cleanAnswer);
    }

    if (useWebSearch && data.searchWarning) {
      setStatus("इंटरनेट खोज: " + data.searchWarning);
    } else {
      setStatus("");
    }
  } catch (error) {
    const rawMessage = String(error?.message || "");
    const isNetworkError = /networkerror|failed to fetch|load failed|network request failed/i.test(rawMessage);
    const isRateLimit = /429|बहुत अधिक अनुरोध|अनुरोध सीमा/i.test(rawMessage);
    const message = isNetworkError
      ? "इंटरनेट या सर्वर से संपर्क नहीं हो पा रहा। अपना कनेक्शन जाँचें और थोड़ी देर बाद फिर कोशिश करें।"
      : isRateLimit
        ? "AI सेवा पर अभी बहुत अधिक अनुरोध हैं। 30–60 सेकंड बाद दोबारा पूछें।"
        : (rawMessage || "अस्थायी तकनीकी समस्या हुई।");

    addMessage(
      "assistant",
      "माफ़ कीजिए, अभी जवाब नहीं मिल पाया।\n\nकारण: " + message
    );

    setStatus(isNetworkError ? "इंटरनेट कनेक्शन जाँचें" : isRateLimit ? "AI सेवा व्यस्त है" : "अस्थायी समस्या");
    if (shouldSpeakReply && !state.voiceStopRequested && window.SarathiNative && typeof window.SarathiNative.speak === "function") {
      window.SarathiNative.speak("माफ़ कीजिए, अभी जवाब नहीं मिल पाया। " + message);
    }
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

function assignCurrentChatToProject() {
  const chat = activeChat();
  if (!chat) return;
  const current = chat.project || "";
  const entered = window.prompt(
    "इस बातचीत को किस प्रोजेक्ट में रखना है?\nखाली नाम देने पर प्रोजेक्ट से हटा दिया जाएगा।",
    current
  );
  if (entered === null) return;
  chat.project = entered.trim().slice(0, 60);
  chat.updatedAt = Date.now();
  saveChats();
  renderHistory();
  setStatus(chat.project
    ? "बातचीत “" + chat.project + "” प्रोजेक्ट में रखी गई।"
    : "बातचीत प्रोजेक्ट से हटा दी गई।");
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
      state.voiceStopRequested = false;
      state.voiceReplyPending = true;
      // Pause recognition while the request is being processed so one utterance
      // cannot accidentally trigger overlapping requests.
      if (window.SarathiNative && typeof window.SarathiNative.pauseWakeWord === "function") {
        window.SarathiNative.pauseWakeWord();
      }
      sendMessage(String(transcript).trim());
    } else {
      const message = "आवाज़ समझ नहीं आई। कृपया फिर से साफ़ बोलें।";
      setStatus(message);
      if (window.SarathiNative && typeof window.SarathiNative.speak === "function") {
        window.SarathiNative.speak(message);
      }
    }
  },
  onError(message) {
    setStatus(message || "ऑफ़लाइन आवाज़ सुविधा अभी उपलब्ध नहीं है।");
  },
  onStatus(message) {
    setStatus(message || "");
  }
};

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
  const allowed = Array.from(fileList).filter(file =>
    file.size <= 20 * 1024 * 1024 &&
    (["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "video/quicktime"].includes(file.type) ||
      file.type === "application/pdf" ||
      file.type === "text/plain" ||
      file.name.toLowerCase().endsWith(".docx") ||
      /\.(mp4|webm|mov)$/i.test(file.name))
  );
  const files = allowed.slice(0, Math.max(0, 5 - state.attachments.length));
  state.attachments.push(...files);
  renderAttachmentPreview();
  if (files.length) setStatus("फाइल तैयार है। भेजने पर उसका पाठ AI को भेजा जाएगा।");
  else if (fileList.length) setStatus("यह फाइल समर्थित नहीं है या 20 MB से बड़ी है। JPG/PNG/WEBP, MP4/WEBM/MOV, PDF, DOCX या TXT चुनें।");
}

function loadExternalScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (window.__sarathiScriptPromises?.[src]) return window.__sarathiScriptPromises[src];
  window.__sarathiScriptPromises = window.__sarathiScriptPromises || {};
  window.__sarathiScriptPromises[src] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => window[globalName]
      ? resolve(window[globalName])
      : reject(new Error("लाइब्रेरी लोड हुई, लेकिन उपलब्ध नहीं है।"));
    script.onerror = () => reject(new Error("फाइल पढ़ने की लाइब्रेरी डाउनलोड नहीं हो सकी। इंटरनेट जाँचें।"));
    document.head.appendChild(script);
  });
  return window.__sarathiScriptPromises[src];
}

async function extractPdfText(file) {
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageLimit = Math.min(pdf.numPages, 25);
  const pages = [];
  for (let pageNo = 1; pageNo <= pageLimit; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str || "").join(" ").trim();
    if (text) pages.push("[पृष्ठ " + pageNo + "]\n" + text);
    page.cleanup();
  }
  let result = pages.join("\n\n");
  if (!result.trim()) {
    const Tesseract = await loadExternalScript(
      "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", "Tesseract"
    );
    const worker = await Tesseract.createWorker("eng+hin");
    try {
      const ocrPages = [];
      for (let pageNo = 1; pageNo <= Math.min(pageLimit, 5); pageNo++) {
        const page = await pdf.getPage(pageNo);
        const viewport = page.getViewport({ scale: 1.35 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const output = await worker.recognize(canvas);
        if (output.data.text.trim()) ocrPages.push("[पृष्ठ " + pageNo + " OCR]\n" + output.data.text.trim());
        canvas.width = 0; canvas.height = 0;
        page.cleanup();
      }
      result = ocrPages.join("\n\n");
    } finally {
      await worker.terminate();
    }
  }
  return result.slice(0, 8500);
}

async function extractOneFile(file) {
  const name = file.name.toLowerCase();
  if (file.type === "text/plain" || name.endsWith(".txt")) {
    return (await file.text()).slice(0, 8500);
  }
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return await extractPdfText(file);
  }
  if (name.endsWith(".docx")) {
    const mammoth = await loadExternalScript(
      "https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js", "mammoth"
    );
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return String(result.value || "").slice(0, 8500);
  }
  if (file.type.startsWith("image/")) {
    const Tesseract = await loadExternalScript(
      "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js", "Tesseract"
    );
    const worker = await Tesseract.createWorker("eng+hin");
    try {
      const result = await worker.recognize(file);
      return String(result.data.text || "").slice(0, 8500);
    } finally {
      await worker.terminate();
    }
  }
  throw new Error(file.name + ": यह फाइल प्रकार समर्थित नहीं है।");
}

async function extractAttachmentsText(files) {
  const output = [];
  let remaining = 9500;
  for (const file of files) {
    setStatus("फाइल पढ़ी जा रही है: " + file.name);
    const content = await extractOneFile(file);
    const clean = String(content || "").trim();
    if (!clean) {
      output.push("[फाइल: " + file.name + "]\nइस फाइल से पढ़ने योग्य पाठ नहीं मिला।");
      continue;
    }
    const chunk = clean.slice(0, remaining);
    output.push("[फाइल: " + file.name + "]\n" + chunk);
    remaining -= chunk.length;
    if (remaining <= 0) break;
  }
  return output.join("\n\n");
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
   EDUCATION HUB — local learner profile + guided study prompts
======================================== */
const STUDY_PROFILE_KEY = "sarathi_ai_study_profile_v1";

function readStudyProfile() {
  try { return JSON.parse(localStorage.getItem(STUDY_PROFILE_KEY) || "{}"); }
  catch { return {}; }
}

function loadStudyProfile() {
  const profile = readStudyProfile();
  const fields = { studyLevel: "level", studyBoard: "board", studySubject: "subject", studyExam: "exam" };
  for (const [id, key] of Object.entries(fields)) {
    const element = $(id);
    if (element && profile[key]) element.value = profile[key];
  }
}

function runStudyAction(action) {
  const profile = {
    level: $("studyLevel")?.value.trim() || "",
    board: $("studyBoard")?.value.trim() || "",
    subject: $("studySubject")?.value.trim() || "",
    exam: $("studyExam")?.value.trim() || ""
  };
  try { localStorage.setItem(STUDY_PROFILE_KEY, JSON.stringify(profile)); }
  catch { setStatus("पढ़ाई की जानकारी डिवाइस में सेव नहीं हो सकी।"); }

  const topic = $("studyTopic")?.value.trim() || "";
  const context = [
    profile.level && "कक्षा/कोर्स: " + profile.level,
    profile.board && "बोर्ड/विश्वविद्यालय: " + profile.board,
    profile.subject && "विषय/पेपर: " + profile.subject,
    profile.exam && "परीक्षा/वर्ष: " + profile.exam,
    topic && "अध्याय/टॉपिक/सवाल: " + topic
  ].filter(Boolean).join("\n");

  const tasks = {
    explain: "मुझे यह विषय शिक्षक की तरह आसान भाषा में चरणबद्ध समझाओ। उदाहरण और अंत में पुनरावर्तन भी दो।",
    notes: "इस विषय के व्यवस्थित, परीक्षा-उपयोगी अध्यायवार नोट्स बनाओ। महत्वपूर्ण परिभाषाएँ और तथ्य शामिल करो।",
    questions: "इस विषय के महत्वपूर्ण अभ्यास प्रश्न बनाओ। प्रश्नों को अंक और कठिनाई के अनुसार बाँटो। किसी प्रश्न के परीक्षा में आने की गारंटी मत देना।",
    quiz: "SARATHI_QUIZ_JSON: मेरे विषय और टॉपिक पर 10 MCQ का टेस्ट बनाओ। केवल वैध JSON लौटाओ, Markdown नहीं। संरचना: {\"title\":\"टेस्ट का नाम\",\"questions\":[{\"question\":\"प्रश्न\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"answer\":0,\"explanation\":\"कारण\"}]}। answer शून्य-आधारित सही विकल्प संख्या हो। हर प्रश्न के चार विकल्प हों।",
    paper: "इस पाठ्यक्रम के अनुसार अभ्यास के लिए मॉडल प्रश्नपत्र बनाओ। आधिकारिक पुराने पेपर न होने पर इसे स्पष्ट रूप से नमूना बताओ।",
    plan: "मेरे लिए यथार्थवादी पढ़ाई और पुनरावृत्ति योजना बनाओ। विषयों, छोटे अध्ययन सत्रों और अभ्यास को शामिल करो।",
    english: "मुझे अंग्रेजी बिल्कुल शुरुआत से A से Z तक सिखाओ। अक्षर, ध्वनि, उच्चारण, रोजमर्रा के शब्द, छोटे वाक्य और धीरे-धीरे पढ़ना-लिखना सिखाओ। हर चरण पर छोटा अभ्यास कराओ।",
    grammar: "हिंदी और अंग्रेजी व्याकरण की बुनियाद से पढ़ाई कराओ। संज्ञा, सर्वनाम, क्रिया, काल, वचन, लिंग, वाक्य रचना, parts of speech, tenses और उदाहरण समझाओ।",
    writing: "मुझे हिंदी और अंग्रेजी में सही लिखना और बोलना सिखाओ। अक्षर/शब्द से शुरुआत करके वाक्य, अनुच्छेद, आवेदन, पत्र और बातचीत का अभ्यास कराओ। मेरी गलतियाँ विनम्रता से सुधारो।",
    solve: "मेरे दिए सवाल को पहले समझो, जरूरी सूत्र/नियम बताओ और फिर चरण-दर-चरण हल समझाओ। गणना की जाँच भी करो; अगर सवाल अधूरा हो तो जरूरी जानकारी पूछो।",
    flashcards: "इस विषय के जरूरी शब्दों, परिभाषाओं, सूत्रों और तथ्यों के फ्लैशकार्ड बनाओ। पहले एक प्रश्न पूछो, मेरा उत्तर आने पर सही उत्तर और छोटा स्पष्टीकरण दो।",
    paperhelp: "इस परीक्षा के पुराने प्रश्नपत्रों और प्रश्नों का विश्लेषण करने में मदद करो। उपलब्ध आधिकारिक पेपर के स्रोत बताओ; पेपर न मिले तो साफ कहो और नमूना अभ्यास प्रश्न बनाओ।",
    career: "मेरी पढ़ाई और रुचि के अनुसार शिक्षा तथा करियर विकल्प समझाओ। योग्यता, प्रवेश प्रक्रिया, खर्च और आधिकारिक जानकारी के स्रोत बताओ। मेरी उम्र और सुरक्षा का ध्यान रखो।",
    book: "मेरी दी हुई किताब या PDF के उपलब्ध पाठ को अध्यायवार समझने में मदद करो। पहले बताओ कि फाइल की सामग्री वास्तव में पढ़ पा रहे हो या नहीं; न पढ़ पाने पर अनुमान मत लगाओ। कॉपीराइट वाली किताब का पूरा अध्याय न दो, सारांश और समझाइश दो।"
  };
  const prompt = "मेरी पढ़ाई में मदद करो।\n" + (context || "मेरे स्तर के अनुसार पहले जरूरी जानकारी पूछो।") +
    "\nकाम: " + (tasks[action] || tasks.explain) +
    "\nआधिकारिक सिलेबस, परीक्षा तिथि या पुस्तक के तथ्य उपलब्ध स्रोत से सत्यापित करो; जानकारी न हो तो साफ बताओ, अनुमान मत लगाओ।";
  $("educationHub")?.classList.add("hidden");
  $("examCenterToggle")?.setAttribute("aria-expanded", "false");
  sendMessage(prompt);
}

const STUDY_PROGRESS_KEY = "sarathi_ai_study_progress_v1";

function readStudyProgress() {
  try { return JSON.parse(localStorage.getItem(STUDY_PROGRESS_KEY) || '{"sessions":0,"lastDate":""}'); }
  catch { return { sessions: 0, lastDate: "" }; }
}

function renderStudyProgress() {
  const progress = readStudyProgress();
  const count = $("studyProgressCount");
  if (count) count.textContent = String(progress.sessions || 0) + " अध्ययन सत्र पूरे";
  const done = $("studyDoneBtn");
  if (done) {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    done.disabled = progress.lastDate === today;
    done.textContent = done.disabled ? "✓ आज का सत्र दर्ज है" : "✓ आज का सत्र पूरा";
  }
}

function bindStudyProgress() {
  renderStudyProgress();
  $("studyDoneBtn")?.addEventListener("click", () => {
    const progress = readStudyProgress();
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (progress.lastDate !== today) {
      progress.sessions = Number(progress.sessions || 0) + 1;
      progress.lastDate = today;
      try { localStorage.setItem(STUDY_PROGRESS_KEY, JSON.stringify(progress)); } catch {}
    }
    renderStudyProgress();
    setStatus("आज का अध्ययन सत्र दर्ज हो गया।");
  });
  $("studyResetBtn")?.addEventListener("click", () => {
    if (!window.confirm("क्या पढ़ाई की प्रगति का रिकॉर्ड रीसेट करना है?")) return;
    localStorage.removeItem(STUDY_PROGRESS_KEY);
    renderStudyProgress();
  });
}

function bindEducationHub() {
  loadStudyProfile();
  $("examCenterMenuBtn")?.addEventListener("click", () => {
    const hub = $("educationHub");
    if (!hub) return;
    hub.classList.remove("hidden");
    closeSidebar();
    hub.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("educationHub")?.addEventListener("click", event => {
    const button = event.target.closest("[data-study]");
    if (button) runStudyAction(button.dataset.study);
  });
  for (const id of ["studyLevel", "studyBoard", "studySubject", "studyExam"]) {
    $(id)?.addEventListener("change", () => {
      const profile = {
        level: $("studyLevel")?.value || "",
        board: $("studyBoard")?.value || "",
        subject: $("studySubject")?.value || "",
        exam: $("studyExam")?.value || ""
      };
      try { localStorage.setItem(STUDY_PROFILE_KEY, JSON.stringify(profile)); } catch {}
    });
  }
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
  $("messageInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });
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
        window.location.href = new URL("./", window.location.href).href;
        break;
      case "project":
        assignCurrentChatToProject();
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

async function initApp() {
  // ऐप का मुख्य इंटरफ़ेस लॉगिन सफल होने के बाद ही दिखेगा।
  document.documentElement.style.visibility = "hidden";
  try {
    await getAuthToken();
  } catch (error) {
    document.documentElement.style.visibility = "visible";
    document.body.innerHTML = "";
    const gate = document.createElement("main");
    gate.style.cssText = "min-height:100vh;display:grid;place-content:center;text-align:center;padding:24px;font-family:system-ui;background:#07152e;color:white";
    const title = document.createElement("h2");
    title.textContent = "🔒 सारथी AI सुरक्षित लॉगिन";
    const message = document.createElement("p");
    message.textContent = error?.message || "लॉगिन जरूरी है।";
    const retry = document.createElement("button");
    retry.textContent = "दोबारा लॉगिन करें";
    retry.style.cssText = "padding:12px 20px;border:0;border-radius:10px;font-size:16px";
    retry.addEventListener("click", () => location.reload());
    gate.append(title, message, retry);
    document.body.appendChild(gate);
    return;
  }

  loadChats();
  bindEvents();
  bindEducationHub();
  bindStudyProgress();
  renderHistory();
  renderMessages();
  renderAttachmentPreview();
  showWelcome();

  const settings = getSettings();

  if ($("workerUrl")) $("workerUrl").value = settings.workerUrl || "";
  if ($("assistantName")) $("assistantName").value = settings.assistantName || "सारथी";
  document.documentElement.style.visibility = "visible";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
