import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const voice = await readFile(new URL("../voice.js", import.meta.url), "utf8");
assert.ok(html.includes('id="examCenterMenuBtn"') && html.includes("SARATHI LEARNING"), "learning hub must be reachable from the menu");
assert.ok(html.includes('id="educationHub"') && /class="education-hub hidden"/.test(html), "learning hub must stay hidden until opened from the menu");
assert.ok(html.includes('id="studyCloseBtn"') && app.includes('$("studyCloseBtn")?.addEventListener("click"'), "learning hub must provide a working return-to-chat control");
assert.ok(app.includes('studyTopic: "topic"'), "learning topic must be restored with the saved study profile");
assert.ok(app.includes('$("studyTopic")?.addEventListener("input", saveProfile)'), "changing the topic must save the study profile");
assert.ok(app.includes('topic: $("studyTopic")?.value.trim() || ""'), "selected study topic must be persisted before an action runs");
assert.ok(app.includes('$("studyTopic")?.addEventListener("input", saveProfile)'), "study topic must autosave while the user types");
assert.ok(app.includes("function handleNewChat() {\n  $(\"educationHub\")?.classList.add(\"hidden\");"), "new chat must return from the learning hub to chat");
assert.ok(app.includes('$(\"educationHub\")?.classList.add(\"hidden\");\n      state.activeId = chat.id;'), "opening a saved chat must hide the learning hub before switching chats");
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
const sendStart = app.indexOf("async function sendMessage(text) {");
const sendEnd = app.indexOf("\nfunction ", sendStart + 10);
const sendSource = app.slice(sendStart, sendEnd);
assert.ok(sendSource.includes("window.SarathiVoice.stop()") && sendSource.includes("endVoiceConversation"), "quiet voice command must stop the active browser or Android voice session");
assert.doesNotMatch(sendSource, /SarathiNative\.endConversation\(/, "quiet voice command must not call a nonexistent Android bridge method");
assert.ok(sendSource.includes("finishVoiceTurn(message)") && sendSource.includes("if (!workerUrl)"), "missing Worker URL must not leave a voice reply paused");
const voiceCallbackStart = app.indexOf("window.SarathiVoice = {");
const voiceCallbackEnd = app.indexOf("/* ========================================\n   ATTACHMENTS", voiceCallbackStart);
const voiceCallbacks = app.slice(voiceCallbackStart, voiceCallbackEnd);
assert.ok(voiceCallbacks.includes("if (window.SarathiVoice?.isActive?.()) window.SarathiVoice.stop()"), "permanent native voice errors must close the active voice session");
assert.ok(voiceCallbacks.includes("state.voiceReplyPending = false"), "voice errors must clear pending reply state");

assert.doesNotMatch(app, /detectAppLaunchCommand|getInstalledApps|openAppPackage|openPhone|SarathiNative\.openApp/, "chat must not discover or launch installed apps");

const java = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url), "utf8");
assert.doesNotMatch(java, /getInstalledApps\(|openAppPackage\(|openPhone\(|void openApp\(/, "Android bridge must not expose app-launch methods");
assert.ok(java.includes("public boolean onJsPrompt("), "Android WebView must handle login prompts");
assert.ok(java.includes("nativeListeningPausedForAppPause && voiceConversationActive"), "voice recognition must pause when Sarathi leaves foreground and resume only when Sarathi returns");
assert.ok(java.includes("pauseNativeListeningForReply();"), "leaving Sarathi must release the microphone");
assert.ok(!java.includes("WakeWordService") && !java.includes("startBackgroundConversationListening"), "Android app must contain no background microphone service or handoff");
assert.ok(!java.includes("ACTION_WAKE_COMMAND") && !java.includes("pending_command"), "background wake commands must not be queued or delivered");
assert.ok(java.includes('notifyVoice("onError", "ऑनलाइन आवाज़ पहचान रद्द कर दी गई। आपकी आवाज़ नहीं सुनी गई।")'), "declining online speech consent must close the voice session");
assert.ok(java.includes('notifyVoice("onError", "आवाज़ पहचान की अनुमति विंडो बंद कर दी गई। बातचीत बंद है।")'), "dismissing online speech consent must close the voice session");
assert.ok(java.includes("voiceRequestInProgress") && java.includes("setVoiceRequestInProgress"), "voice requests must track reply state while Sarathi is foreground");
assert.ok(java.includes('if (voiceConversationActive) notifyVoice("onSpeechComplete", "")'), "TTS setup/start failures must resume an active foreground voice conversation");
const ttsStopStart = java.indexOf("@Override public void onStop(String utteranceId, boolean interrupted)");
const ttsStopEnd = java.indexOf("\n                        }", ttsStopStart);
assert.ok(ttsStopStart >= 0 && ttsStopEnd > ttsStopStart, "TTS stop callback must exist");
assert.equal(java.slice(ttsStopStart, ttsStopEnd).includes("onSpeechComplete"), false, "stopping an older queued TTS utterance must not restart microphone while a replacement reply is playing");
assert.ok(java.includes("private long speechUtteranceSequence = 0;") && java.includes("private String activeSpeechUtteranceId = null;"), "TTS utterances must have unique active identities");
assert.ok(java.includes('final String currentUtteranceId = "sarathi-local-voice-" + (++speechUtteranceSequence);'), "each TTS reply must receive a unique utterance ID");
assert.ok(java.includes("if (!currentUtteranceId.equals(activeSpeechUtteranceId)) return;"), "stale TTS completion/error callbacks must not resume the microphone for a newer reply");
assert.ok(java.includes("activeSpeechUtteranceId = null;") && java.includes("activeSpeechUtteranceId = null;\n                if (textToSpeech != null) textToSpeech.stop();"), "stopping speech must invalidate any pending completion callback");


assert.ok(java.includes("recognizerForSession") && java.includes("isCurrentRecognizer()"), "stale speech callbacks must not restart or destroy the current microphone session");
const offlineErrorStart = java.indexOf("} else if (!useOnlineService");
const offlineSilenceBranch = java.indexOf("error == SpeechRecognizer.ERROR_NO_MATCH", offlineErrorStart);
const offlineConsentBranch = java.indexOf("// If the offline provider fails", offlineSilenceBranch);
assert.ok(offlineErrorStart >= 0 && offlineSilenceBranch > offlineErrorStart && offlineConsentBranch > offlineSilenceBranch, "offline silence must be handled before offering online recognition");
assert.ok(java.slice(offlineSilenceBranch, offlineConsentBranch).includes("scheduleVoiceRecognitionRetry(false)"), "offline silence must retry offline without switching providers");
assert.ok(java.slice(offlineSilenceBranch, offlineConsentBranch).includes("ERROR_SPEECH_TIMEOUT"), "offline speech timeout must retry without online consent");

assert.ok(java.includes("TYPE_TEXT_VARIATION_PASSWORD"), "Android login prompt must mask password input");
assert.ok(app.includes("function requestLoginPassword()"), "web login must use a dedicated password dialog");
assert.ok(app.includes('input.type = "password"') && app.includes('input.autocomplete = "current-password"'), "web login field must mask and correctly autocomplete passwords");
assert.ok(app.includes("await requestLoginPassword()"), "login must await the masked password dialog");
const loginStart = app.indexOf("async function loginWorker()");
const loginEnd = app.indexOf("/* ========================================\n   SAFE TEXT FORMATTING", loginStart);
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

assert.match(voice, /window\.SarathiVoice\.onError\s*=\s*message\s*=>/, "Android voice errors must have a JavaScript callback");
assert.match(voice, /विंडो बंद कर दी गई|माइक्रोफोन अनुमति नहीं मिली/, "permission cancellation must stop the active voice session");
assert.match(voice, /if \(fatal && active\) \{[\s\S]*?stop\(\);/, "fatal native voice errors must stop the session");
console.log("SAFETY SELF-TEST: no background microphone, app-launch bridge, overlays or broad storage permissions; files require explicit picker selection");
console.log("ANDROID LOGIN PROMPT SELF-TEST: password masking and same-origin prompt guard passed");
console.log("CHAT SELF-TEST: new-chat command and chat-only app access passed");
