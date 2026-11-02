import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

const newChatStart = app.indexOf("function stripSarathiWakePrefix(prompt) {");
const newChatEnd = app.indexOf("\n}\n\nfunction detectAppLaunchCommand", newChatStart);
assert.ok(newChatStart >= 0 && newChatEnd > newChatStart, "new chat command parser must exist");
const detectNewChat = new Function(app.slice(newChatStart, newChatEnd + 2) + "\nreturn detectNewChatCommand;")();
for (const phrase of ["नई चैट खोलो", "नई चैट ओपन करो", "नई चैट वन करो", "नई बातचीत शुरू करो", "सारथी न्यू चैट ओपन करो", "हेलो सारथी नई चैट खोलो", "new chat", "start new chat", "open new conversation"]) {
  assert.equal(detectNewChat(phrase), true, "new chat command not detected: " + phrase);
}
for (const phrase of ["नई चैट क्या है", "मुझे नई चैट के बारे में बताओ", "आज नई बातचीत की खबर"]) {
  assert.equal(detectNewChat(phrase), false, "ordinary question must not trigger new chat: " + phrase);
}
assert.ok(app.includes('setStatus("नई चैट खोल दी गई है।")'), "new chat action must show a success status");
assert.ok(app.includes("createChat();") && app.includes("closeSidebar();") && app.includes("closeMoreMenu();"), "new chat voice command must create a fresh local chat");
assert.ok(app.includes("stripSarathiWakePrefix(prompt)"), "voice command parser must ignore Sarathi wake-word prefixes");
assert.ok(app.includes("window.SarathiNative.openPhone()"), "phone command must use the safe Android dialer action");
const start = app.indexOf("function stripSarathiWakePrefix(prompt) {");
const end = app.indexOf("\n}\n\n/* ========================================\n   SEND MESSAGE", start);
assert.ok(start >= 0 && end > start, "app launch parser must exist");
const parserSource = app.slice(start, end + 2);
const detect = new Function(parserSource + "\nreturn detectAppLaunchCommand;")();

const cases = [
  ["यूट्यूब खोलो", "youtube"],
  ["सारथी यूट्यूब ओपन करो", "youtube"],
  ["हेलो सर जी यूट्यूब ओपन करो", "youtube"],
  ["हेलो सर्दी यूट्यूब ओपन करो", null],
  ["युटुब खोलो", "youtube"],
  ["फोन ओपन करो", "phone"],
  ["सारथी फोन खोलो", "phone"],
  ["youtube open", "youtube"],
  ["चैट जीपीटी खोलो", "chatgpt"],
  ["व्हाट्सऐप खोलो", "whatsapp"],
  ["क्रोम खोलो", "chrome"],
  ["गूगल मैप्स खोलो", "maps"],
  ["जीमेल खोलो", "gmail"],
  ["इंस्टाग्राम खोलो", "instagram"],
  ["टेलीग्राम खोलो", "telegram"],
  ["आज यूट्यूब पर क्या है", null],
  ["कोई ऐप खोलो", null],
  ["", null]
];
for (const [input, expected] of cases) {
  const actual = detect(input);
  assert.equal(actual?.key || null, expected, "parser mismatch for: " + input);
}

const java = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url), "utf8");
const mainActivity = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url), "utf8");
assert.ok(mainActivity.includes("public boolean onJsPrompt("), "Android WebView must handle login prompts");
assert.ok(mainActivity.includes("nativeListeningPausedForBackground && voiceConversationActive"), "active voice session must resume when Sarathi returns from another app");
assert.ok(mainActivity.includes("startBackgroundConversationListening()") && mainActivity.includes("ACTION_START_CONVERSATION"), "active voice session must hand off to the foreground microphone service while another app is open");
assert.ok(mainActivity.includes("voiceRequestInProgress") && mainActivity.includes("setVoiceRequestInProgress"), "background listening must wait while an AI request or spoken reply is in progress");
assert.ok(mainActivity.includes("if (!appInForeground || !pageLoaded) return;"), "background wake commands must remain queued until Sarathi returns");
assert.ok(mainActivity.includes("if (voiceConversationActive && !speechActivityFallbackLaunched)"), "background pause must release the microphone without interrupting the system speech fallback");
assert.ok(mainActivity.includes("pauseNativeListeningForReply();"), "background transition must release the current native microphone recognizer");
assert.ok(mainActivity.includes("recognizerForSession") && mainActivity.includes("isCurrentRecognizer()"), "stale speech callbacks must not restart or destroy the current microphone session");
assert.ok(mainActivity.includes("TYPE_TEXT_VARIATION_PASSWORD"), "Android login prompt must mask password input");
assert.ok(mainActivity.includes("APP_HOST.equalsIgnoreCase(pageUri.getHost())"), "Android login prompt must be restricted to the Sarathi host");
const manifest = await readFile(new URL("../android-app/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
assert.ok(mainActivity.includes("REQUEST_POST_NOTIFICATIONS") && mainActivity.includes("startWakeWordAfterPermissions()"), "Android 13+ wake-word flow must request notification permission");
assert.ok(manifest.includes('android:name="android.permission.POST_NOTIFICATIONS"'), "Manifest must declare notification permission");
console.log("ANDROID LOGIN PROMPT SELF-TEST: password masking, same-origin prompt guard and Android 13+ notification permission passed");
const wakeService = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url), "utf8");
assert.ok(/awaitingCommand = false;\s+conversationMode = false;\s+commandMode = false;/.test(wakeService), "wake notification timeout must reset conversation state");
assert.ok(wakeService.includes("|| conversationMode || recognized == null"), "wake recognizer must ignore late callbacks after activation");
assert.ok(wakeService.includes("ACTION_START_CONVERSATION") && wakeService.includes("ACTION_PREPARE_CONVERSATION") && wakeService.includes("if (conversationMode) startConversationRecognition();"), "foreground service must prepare paused and resume continuous background conversation listening");
assert.ok(wakeService.includes("A captured conversation request must release the microphone"), "captured requests must stop the service recognizer before the Activity processes them");
assert.ok(wakeService.includes("notifications.cancel(NOTIFICATION_ID + 1)"), "wake notifications must be cleared after timeout/stop");
console.log("WAKE SERVICE SELF-TEST: timeout reset, duplicate callback guard and notification cleanup passed");

const packages = [
  "com.google.android.youtube",
  "com.openai.chatgpt",
  "com.whatsapp",
  "com.android.chrome",
  "com.google.android.apps.maps",
  "com.google.android.gm",
  "com.instagram.android",
  "org.telegram.messenger"
];
for (const name of packages) {
  assert.ok(java.includes('"' + name + '"'), "Android launch allowlist missing " + name);
  assert.ok(manifest.includes('android:name="' + name + '"'), "Manifest package query missing " + name);
}
const dynamicApps = [
  {label:"Calculator", packageName:"com.android.calculator2"},
  {label:"Files", packageName:"com.google.android.documentsui"}
];
assert.deepEqual(detect("calculator खोलो", dynamicApps), {type:"package", packageName:"com.android.calculator2", label:"Calculator"});
assert.deepEqual(detect("Files खोलो", dynamicApps), {type:"package", packageName:"com.google.android.documentsui", label:"Files"});
assert.equal(detect("unknown app खोलो", dynamicApps), null);
assert.ok(java.includes("getInstalledApps()") && java.includes("openAppPackage(String requestedPackage)"));
assert.ok(java.includes("public void openPhone()") && java.includes("Intent.ACTION_DIAL"), "phone command must open the dialer without placing a call");
assert.ok(manifest.includes('android.intent.category.LAUNCHER'));
console.log("APP LAUNCH SELF-TEST: " + cases.length + " fixed parser cases, 3 dynamic app cases and " + packages.length + " fixed Android mappings passed");
