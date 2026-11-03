import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const voice = await readFile(new URL("voice.js", root), "utf8");
const css = await readFile(new URL("style.css", root), "utf8");
const worker = await readFile(new URL("worker.js", root), "utf8");
const relevantFilterStart = worker.indexOf("function filterRelevantSearchResults(query, results) {");
const relevantFilterEnd = worker.indexOf("\\n}\\n", relevantFilterStart);
assert.ok(relevantFilterStart >= 0 && relevantFilterEnd > relevantFilterStart, "search relevance filter must exist");
const filterRelevantSearchResults = new Function(worker.slice(relevantFilterStart, relevantFilterEnd + 3) + "\\nreturn filterRelevantSearchResults;")();
const metalResults = [
  { title: "24K gold rate today", url: "https://example.com/gold", snippet: "Gold price" },
  { title: "Silver price today", url: "https://example.com/silver", snippet: "Silver rate" },
  { title: "Weather forecast", url: "https://example.com/weather", snippet: "Weather" }
];
assert.deepEqual(filterRelevantSearchResults("gold 22K and silver price", metalResults).map(item => item.title), ["24K gold rate today", "Silver price today"], "combined gold and silver searches must retain both metal result types and exclude unrelated results");


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
  { title: "", url: "https://example.net/story" },
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

const quizParserStart = app.indexOf("function parseSarathiQuiz(raw) {");
const quizParserEnd = app.indexOf("\n}\n", quizParserStart);
assert.ok(quizParserStart >= 0 && quizParserEnd > quizParserStart, "MCQ parser must exist");
const parseSarathiQuiz = new Function(app.slice(quizParserStart, quizParserEnd + 3) + "\nreturn parseSarathiQuiz;")();
const validQuiz = {
  title: "अभ्यास",
  questions: Array.from({ length: 3 }, (_, i) => ({
    question: "प्रश्न " + (i + 1),
    options: ["विकल्प A", "विकल्प B", "विकल्प C", "विकल्प D"],
    answer: 1,
    explanation: "कारण"
  }))
};
assert.equal(parseSarathiQuiz(JSON.stringify(validQuiz)).questions.length, 3, "valid four-option MCQ questions should parse");
assert.equal(parseSarathiQuiz("not JSON"), null, "invalid MCQ JSON must be rejected");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.slice(0, 2) })), null, "too few MCQ questions must be rejected");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.map((q, i) => i ? q : { ...q, answer: null }) })), null, "null answer must not be treated as option A");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.map((q, i) => i ? q : { ...q, options: ["A", "", "C", "D"] }) })), null, "empty MCQ options must be rejected");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.map((q, i) => i ? q : { ...q, answer: 4 }) })), null, "out-of-range MCQ answers must be rejected");

const studyActions = [...html.matchAll(/data-study="([^"]+)"/g)].map(match => match[1]);
assert.equal(studyActions.length, 14, "SARATHI LEARNING must expose all 14 study actions");
assert.equal(new Set(studyActions).size, 14, "SARATHI LEARNING action IDs must be unique");
const studySectionStart = app.indexOf("function runStudyAction(action) {");
const studySectionEnd = app.indexOf("function bindEvents()", studySectionStart);
assert.ok(studySectionStart >= 0 && studySectionEnd > studySectionStart, "study action handler and progress logic must exist");
const studySection = app.slice(studySectionStart, studySectionEnd);
for (const action of studyActions) {
  assert.ok(studySection.includes(action + ":"), "study action must have a task prompt: " + action);
}
assert.ok(studySection.includes('addEventListener("input", saveProfile)'), "study topic must autosave while typing");
assert.ok(studySection.includes('addEventListener("change", saveProfile)'), "study profile fields must save after editing");
assert.ok(studySection.includes('progress.lastDate !== today'), "study progress must prevent duplicate daily session counts");
assert.ok(studySection.includes('localStorage.removeItem(STUDY_PROGRESS_KEY)'), "study progress reset must clear the saved progress");
assert.ok(studySection.includes("पहले एक प्रश्न पूछो"), "flashcards must be delivered one question at a time");
assert.ok(studySection.includes("मेरा उत्तर आने पर सही उत्तर"), "flashcards must wait for the learner's response before revealing the answer");
assert.ok(studySection.includes("उपलब्ध आधिकारिक पेपर के स्रोत बताओ"), "old-paper help must point to available official sources");
assert.ok(studySection.includes("पेपर न मिले तो साफ कहो"), "old-paper help must not pretend an unavailable paper exists");
assert.ok(app.includes('submit.disabled = quiz.questions.some((_, i) => !Number.isInteger(chosen[i]))'), "MCQ test must require every answer before submission");
assert.ok(app.includes('quiz.score = quiz.questions.reduce'), "MCQ test must calculate a score from selected answers");
assert.ok(app.includes('quiz.submitted = true'), "MCQ test must lock answers after submission");



const sendMessageStart = app.indexOf("async function sendMessage(text) {");
const sendMessageEnd = app.indexOf("\n}\n", sendMessageStart);
assert.ok(sendMessageStart >= 0 && sendMessageEnd > sendMessageStart, "message sending flow must exist");
const sendMessageSource = app.slice(sendMessageStart, sendMessageEnd + 3);
assert.ok(sendMessageSource.indexOf("क्या भेजना है?") >= 0, "photo/video understanding must ask before sending selected media");
assert.ok(sendMessageSource.indexOf("क्या भेजना है?") < sendMessageSource.indexOf("requestSarathiMediaUnderstanding(question, frames)"), "photo/video consent must happen before the media request");
assert.ok(sendMessageSource.indexOf("क्या भेजना है?") < sendMessageSource.indexOf("extractVideoFrames(videoFile, 5)"), "video frames must not be processed for upload before consent");
assert.ok(sendMessageSource.indexOf("क्या भेजना है?") < sendMessageSource.indexOf("fileToImageDataUrl(imageFile)"), "photo data must not be prepared for upload before consent");
assert.ok(sendMessageSource.includes("/\\.(png|jpe?g|webp)$/i.test(file.name)"), "image detection must fall back to the filename when Android provides a generic MIME type");
assert.ok(sendMessageSource.includes("mediaFiles.length > 1"), "multiple media files must be rejected clearly instead of silently ignoring attachments");
assert.ok(sendMessageSource.includes("mediaFiles.length === 1 && state.attachments.length > 1"), "a media file mixed with documents must be rejected instead of silently skipping the documents");
assert.ok(sendMessageSource.indexOf("क्या भेजना है?") < sendMessageSource.indexOf("extractAttachmentsText(state.attachments)"), "document text must not be extracted for sending before consent");
const attachmentStart = app.indexOf("function addFiles(fileList) {");
const attachmentEnd = app.indexOf("\n}\n", attachmentStart);
assert.ok(attachmentStart >= 0 && attachmentEnd > attachmentStart, "attachment selection filter must exist");
const attachmentSource = app.slice(attachmentStart, attachmentEnd + 3);
for (const extension of ["pdf", "docx", "txt", "csv", "md", "json"]) {
  assert.ok(attachmentSource.includes(extension), "attachment picker must allow ." + extension);
}
assert.ok(attachmentSource.includes('file.name.toLowerCase().endsWith(".pdf")'), "PDF files with a missing or generic MIME type must still be selectable by extension");
assert.ok(attachmentSource.includes("/\\.(png|jpe?g|webp)$/i.test(file.name)"), "JPG/PNG/WEBP files with generic MIME types must still be selectable by extension");
assert.ok(attachmentSource.includes("20 * 1024 * 1024"), "attachment picker must enforce the 20 MB per-file limit");
const extractorStart = app.indexOf("async function extractOneFile(file) {");
const extractorEnd = app.indexOf("\n}\n", extractorStart);
assert.ok(extractorStart >= 0 && extractorEnd > extractorStart, "file text extraction function must exist");
const extractorSource = app.slice(extractorStart, extractorEnd + 3);
for (const extension of ["txt", "csv", "md", "json", "pdf", "docx"]) {
  assert.ok(extractorSource.includes(extension), "file text extraction must support ." + extension);
}
assert.ok(extractorSource.includes("/\\.(png|jpe?g|webp)$/i.test(name)"), "OCR must recognize image files by extension when MIME type is generic");
assert.ok(worker.includes('zeroCostMode: true'), "disabled media APIs must clearly identify zero-cost mode");
assert.ok(worker.includes('"/api/media/image"') && worker.includes('"/api/media/understand"'), "media API routes must be explicit and auditable");
assert.ok(worker.includes("if (!env.EXA_API_KEY)"), "web search must report a missing configured Exa key rather than silently assuming search is available");

console.log("WEB SMOKE SELF-TEST: " + requiredIds.length + " required IDs, duplicate-ID check, local scripts, voice wiring and core styles passed");
