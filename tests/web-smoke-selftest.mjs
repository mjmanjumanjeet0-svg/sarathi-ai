import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const voice = await readFile(new URL("voice.js", root), "utf8");
const css = await readFile(new URL("style.css", root), "utf8");

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], [], "HTML must not contain duplicate IDs");

const requiredIds = [
  "sidebar", "newChatBtn", "historyList", "settingsBtn", "menuBtn",
  "topNewBtn", "moreBtn", "moreMenu", "chatArea", "welcome", "messages",
  "status", "voicePanel", "voiceTitle", "voiceHint", "voiceStop",
  "voiceWave", "voiceActiveNote", "webToggle", "chatForm", "attachBtn",
  "messageInput", "micBtn", "sendBtn", "fileInput", "attachmentPreview",
  "settingsDialog", "workerUrl", "assistantName", "findDialog", "findInput",
  "findNext", "findResult"
];
for (const id of requiredIds) {
  assert.ok(ids.includes(id), "Required interface element missing: #" + id);
}

const scriptFiles = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(src => !/^(https?:)?\/\//i.test(src));
for (const src of scriptFiles) {
  assert.ok(!src.includes(".."), "Local script must stay inside the site root: " + src);
  await readFile(new URL(src, root), "utf8");
}
const sourceHelperStart = app.indexOf("function shouldShowSearchSources(data) {");
const sourceHelperEnd = app.indexOf("\n}\n", sourceHelperStart);
assert.ok(sourceHelperStart >= 0 && sourceHelperEnd > sourceHelperStart, "automatic-search source visibility helper must exist");
const shouldShowSearchSources = new Function(app.slice(sourceHelperStart, sourceHelperEnd + 3) + "\nreturn shouldShowSearchSources;")();
assert.equal(shouldShowSearchSources({ searchAttempted: true, sources: [{ title: "Official notice", url: "https://example.gov.in/notice" }] }), true, "sources from automatic Worker search must be shown even when the web toggle is off");
assert.equal(shouldShowSearchSources({ searchAttempted: false, sources: [{ title: "Unrequested", url: "https://example.com" }] }), false, "sources must not be shown when the Worker did not search");
assert.equal(shouldShowSearchSources({ searchAttempted: true, sources: [] }), false, "empty search results must not create an empty source list");
const warningHelperStart = app.indexOf("function shouldShowSearchWarning(data) {");
const warningHelperEnd = app.indexOf("\n}\n", warningHelperStart);
assert.ok(warningHelperStart >= 0 && warningHelperEnd > warningHelperStart, "search warning visibility helper must exist");
const shouldShowSearchWarning = new Function(app.slice(warningHelperStart, warningHelperEnd + 3) + "\nreturn shouldShowSearchWarning;")();
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "Exa से वास्तविक वेब परिणाम मिले।", sources: [{ title: "Verified", url: "https://example.com" }] }), false, "successful search must not show a warning");
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "Exa service unavailable", searchUnavailable: true, sources: [] }), true, "unavailable search must show its warning");
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "AI provider busy", providerBusy: true, sources: [{ title: "Real result", url: "https://example.com" }] }), true, "provider fallback must explain that a generated summary was unavailable");
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "No fresh articles", sources: [] }), true, "rejected or empty search results must explain why no sources are shown");
assert.equal(shouldShowSearchWarning({ searchAttempted: false, searchWarning: "No search attempted", sources: [] }), false, "non-search replies must not show search warnings");
const safeSourceStart = app.indexOf("function safeSourceUrl(value) {");
const safeSourceEnd = app.indexOf("\n}\n", safeSourceStart);
assert.ok(safeSourceStart >= 0 && safeSourceEnd > safeSourceStart, "safe source URL helper must exist");
const safeSourceUrl = new Function("URL", app.slice(safeSourceStart, safeSourceEnd + 3) + "\nreturn safeSourceUrl;")(URL);
assert.equal(safeSourceUrl("https://example.com/article#section"), "https://example.com/article", "HTTPS links should be normalized");
assert.equal(safeSourceUrl("http://example.com/article"), "", "HTTP links must be rejected");
assert.equal(safeSourceUrl(["java", "script:"].join("") + "alert(1)"), "", "non-web protocols must be rejected");
assert.equal(safeSourceUrl("https://user:pass@example.com/"), "", "URLs containing credentials must be rejected");
assert.equal(safeSourceUrl("not a URL"), "", "malformed source URLs must be rejected");
const sanitizerStart = app.indexOf("function sanitizeSourceRecords(sources, limit = 8) {");
const sanitizerEnd = app.indexOf("\n}\n", sanitizerStart);
assert.ok(sanitizerStart >= 0 && sanitizerEnd > sanitizerStart, "source record sanitizer must exist");
const sanitizeSourceRecords = new Function("URL", app.slice(safeSourceStart, sanitizerEnd + 3) + "\nreturn sanitizeSourceRecords;")(URL);
const safeRecords = sanitizeSourceRecords([
  { title: "First", url: "https://example.com/story#top" },
  { title: "Duplicate", url: "https://example.com/story" },
  { title: "Insecure", url: "http://example.org/story" },
  { title: "Missing title", url: "https://example.net/story" },
  null
]);
assert.equal(safeRecords.length, 1, "only unique titled HTTPS sources should remain");
assert.equal(safeRecords[0].url, "https://example.com/story");

assert.ok(app.includes("shouldShowSearchSources(data) ? filterSourcesForPrompt"), "assistant messages must display sources returned by automatic search");
assert.ok(app.includes("if (shouldShowSearchWarning(data))"), "only meaningful search failures must be surfaced in status");

assert.ok(scriptFiles.indexOf("app.js") >= 0, "Main app script must be loaded");
assert.ok(scriptFiles.indexOf("voice.js") > scriptFiles.indexOf("app.js"), "Voice integration must load after app.js");
assert.match(html, /data-voice-action=["']start["']/, "Welcome voice action must be present");
assert.match(app, /data-voice-action/, "Main app must wire the welcome voice action");
assert.match(voice, /window\.SarathiVoice\.start = start/, "Voice start API must be exposed");
for (const selector of [".message-content", ".message-body", ".composer", ".send-btn", ".mic-btn", ".bottom-nav"]) {
  assert.ok(css.includes(selector), "Required layout styling missing: " + selector);
}
console.log("WEB SMOKE SELF-TEST: " + requiredIds.length + " required IDs, duplicate-ID check, local scripts, voice wiring and core styles passed");
