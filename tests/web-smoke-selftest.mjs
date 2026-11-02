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
assert.ok(app.includes("shouldShowSearchSources(data) ? filterSourcesForPrompt"), "assistant messages must display sources returned by automatic search");
assert.ok(app.includes("if (data.searchAttempted && data.searchWarning)"), "automatic search failures must be surfaced in status");

assert.ok(scriptFiles.indexOf("app.js") >= 0, "Main app script must be loaded");
assert.ok(scriptFiles.indexOf("voice.js") > scriptFiles.indexOf("app.js"), "Voice integration must load after app.js");
assert.match(html, /data-voice-action=["']start["']/, "Welcome voice action must be present");
assert.match(app, /data-voice-action/, "Main app must wire the welcome voice action");
assert.match(voice, /window\.SarathiVoice\.start = start/, "Voice start API must be exposed");
for (const selector of [".message-content", ".message-body", ".composer", ".send-btn", ".mic-btn", ".bottom-nav"]) {
  assert.ok(css.includes(selector), "Required layout styling missing: " + selector);
}
console.log("WEB SMOKE SELF-TEST: " + requiredIds.length + " required IDs, duplicate-ID check, local scripts, voice wiring and core styles passed");
