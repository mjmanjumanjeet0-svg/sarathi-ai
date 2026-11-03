import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.ok(html.includes('id="examCenterMenuBtn"') && html.includes("SARATHI LEARNING"), "learning hub must be reachable from the menu");
assert.ok(html.includes('id="educationHub"') && /class="education-hub hidden"/.test(html), "learning hub must stay hidden until opened from the menu");
assert.ok(html.includes('id="studyCloseBtn"') && app.includes('$("studyCloseBtn")?.addEventListener("click"'), "learning hub must provide a working return-to-chat control");
assert.ok(app.includes('studyTopic: "topic"'), "learning topic must be restored with the saved study profile");
assert.ok(app.includes('"studyExam", "studyTopic"'), "changing the topic must save the study profile");
assert.ok(app.includes('topic: $("studyTopic")?.value.trim() || ""'), "selected study topic must be persisted before an action runs");
for (const id of ["studyLevel", "studyBoard", "studySubject", "studyExam", "studyTopic", "studyProgressCount", "studyDoneBtn", "studyResetBtn"]) {
  assert.ok(html.includes('id="' + id + '"'), "learning hub control missing: " + id);
}
for (const action of ["explain", "notes", "questions", "quiz", "paper", "plan", "english", "grammar", "writing", "solve", "flashcards", "paperhelp", "career", "book"]) {
  assert.ok(html.includes('data-study="' + action + '"'), "learning action missing: " + action);
}
const newChatStart = app.indexOf("function stripSarathiWakePrefix(prompt) {");
const newChatEnd = app.indexOf("/* ========================================\n   SEND MESSAGE", newChatStart);
assert.ok(newChatStart >= 0 && newChatEnd > newChatStart, "new chat command parser must exist");
const detectNewChat = new Function(app.slice(newChatStart, newChatEnd) + "\nreturn detectNewChatCommand;")();
for (const phrase of ["नई चैट खोलो", "नई चैट ओपन करो", "नई चैट वन करो", "नई बातचीत शुरू करो", "सारथी न्यू चैट ओपन करो", "हेलो सारथी नई चैट खोलो", "new chat", "start new chat", "open new conversation"]) {
  assert.equal(detectNewChat(phrase), true, "new chat command not detected: " + phrase);
}
for (const phrase of ["नई चैट क्या है", "मुझे नई चैट के बारे में बताओ", "आज नई बातचीत की खबर"]) {
  assert.equal(detectNewChat(phrase), false, "ordinary question must not trigger new chat: " + phrase);
}
assert.ok(app.includes('setStatus("नई चैट खोल दी गई है।")'), "new chat action must show a success status");
assert.ok(app.includes("createChat();") && app.includes("closeSidebar();") && app.includes("closeMoreMenu();"), "new chat voice command must create a fresh local chat");
assert.ok(app.includes("stripSarathiWakePrefix(prompt)"), "voice command parser must ignore Sarathi wake-word prefixes");
assert.doesNotMatch(app, /detectAppLaunchCommand|getInstalledApps|openAppPackage|openPhone|SarathiNative\.openApp/, "chat must not discover or launch installed apps");

const java = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url), "utf8");
assert.doesNotMatch(java, /getInstalledApps\(|openAppPackage\(|openPhone\(|void openApp\(/, "Android bridge must not expose app-launch methods");
assert.ok(java.includes("public boolean onJsPrompt("), "Android WebView must handle login prompts");
assert.ok(java.includes("nativeListeningPausedForAppPause && voiceConversationActive"), "voice recognition must pause when Sarathi leaves foreground and resume only when Sarathi returns");
assert.ok(java.includes("pauseNativeListeningForReply();"), "leaving Sarathi must release the microphone");
assert.ok(!java.includes("WakeWordService") && !java.includes("startBackgroundConversationListening"), "Android app must contain no background microphone service or handoff");
assert.ok(!java.includes("ACTION_WAKE_COMMAND") && !java.includes("pending_command"), "background wake commands must not be queued or delivered");
assert.ok(java.includes("voiceRequestInProgress") && java.includes("setVoiceRequestInProgress"), "voice requests must track reply state while Sarathi is foreground");
assert.ok(java.includes('if (voiceConversationActive) notifyVoice("onSpeechComplete", "")'), "TTS setup/start failures must resume an active foreground voice conversation");
assert.ok(java.includes("recognizerForSession") && java.includes("isCurrentRecognizer()"), "stale speech callbacks must not restart or destroy the current microphone session");
assert.ok(java.includes("TYPE_TEXT_VARIATION_PASSWORD"), "Android login prompt must mask password input");
assert.ok(app.includes("function requestLoginPassword()"), "web login must use a dedicated password dialog");
assert.ok(app.includes('input.type = "password"') && app.includes('input.autocomplete = "current-password"'), "web login field must mask and correctly autocomplete passwords");
assert.ok(app.includes("await requestLoginPassword()"), "login must await the masked password dialog");
const loginStart = app.indexOf("async function loginWorker()");
const loginEnd = app.indexOf("/* ========================================\\n   SAFE TEXT FORMATTING", loginStart);
assert.ok(loginStart >= 0 && loginEnd > loginStart, "login function boundaries must be present");
assert.equal(app.slice(loginStart, loginEnd).includes("window.prompt("), false, "web login must not expose passwords in a plain-text browser prompt");
assert.ok(java.includes("APP_HOST.equalsIgnoreCase(pageUri.getHost())"), "Android login prompt must be restricted to the Sarathi host");
const manifest = await readFile(new URL("../android-app/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
assert.ok(!manifest.includes("WakeWordService") && !manifest.includes("FOREGROUND_SERVICE") && !manifest.includes("POST_NOTIFICATIONS"), "manifest must not declare a background microphone service or its notification permissions");
assert.ok(!manifest.includes("SYSTEM_ALERT_WINDOW") && !manifest.includes("READ_EXTERNAL_STORAGE") && !manifest.includes("WRITE_EXTERNAL_STORAGE") && !manifest.includes("MANAGE_EXTERNAL_STORAGE"), "manifest must not request overlays or broad storage access");
assert.doesNotMatch(manifest, /<package android:name="com\.(google|openai)|<package android:name="org\.telegram/, "manifest must not query unrelated installed apps");
assert.ok(!java.includes("TYPE_APPLICATION_OVERLAY") && !java.includes("ACTION_MANAGE_OVERLAY_PERMISSION"), "Android app must not create or request overlay windows");
assert.ok(java.includes("settings.setAllowFileAccess(false)") && java.includes("settings.setAllowContentAccess(false)"), "WebView must not expose unrestricted local file or content access");
assert.ok(java.includes("new Intent(Intent.ACTION_OPEN_DOCUMENT)") && java.includes("onShowFileChooser"), "files may only be selected through the system picker after the user chooses an attachment");
assert.ok(app.includes('$("attachBtn")?.addEventListener("click", openAttachmentDialog)'), "attachment picker must require an explicit user click");
await assert.rejects(readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url), "utf8"), "background wake-word service source must be deleted");
console.log("SAFETY SELF-TEST: no background microphone, app-launch bridge, overlays or broad storage permissions; files require explicit picker selection");
console.log("ANDROID LOGIN PROMPT SELF-TEST: password masking and same-origin prompt guard passed");
console.log("CHAT SELF-TEST: new-chat command and chat-only app access passed");
