import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wakePath = new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url);
const activityPath = new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url);
const [wake, activity, app, worker, wakeService, indexHtml] = await Promise.all([
  readFile(wakePath, "utf8"),
  readFile(activityPath, "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../worker.js", import.meta.url), "utf8"),
  readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

const helperStart = wake.indexOf("private boolean isConversationEndPhrase");
const helperEnd = wake.indexOf("\n    private void endConversationAndResumeWakeWord", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Android stop-phrase helper must exist");
const helper = wake.slice(helperStart, helperEnd);

for (const phrase of [
  "ठीक है सारथी", "अच्छा है सारथी", "ओके सारथी", "बाय सारथी",
  "बस सारथी", "धन्यवाद सारथी", "अलविदा सारथी",
  "ठीक है बाय", "अच्छा है बाय", "बाय", "bye", "अलविदा",
  "ok sarathi", "okay sarathi", "bye sarathi"
]) {
  assert.ok(helper.includes(`"${phrase}"`), `Android must recognize stop phrase: ${phrase}`);
}

const handlerStart = wake.indexOf("private void handleConversationUtterance");
const handlerEnd = wake.indexOf("\n    private void startConversationRecognition", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "Active-conversation handler must exist");
assert.ok(
  wake.slice(handlerStart, handlerEnd).includes("isConversationEndPhrase(text)"),
  "Active conversation must check stop phrases before forwarding speech"
);
const endActionStart = wake.indexOf("if (intent != null && ACTION_END_CONVERSATION.equals(intent.getAction()))");
const endActionEnd = wake.indexOf("\n        if (intent != null && ACTION_CAPTURE_COMMAND", endActionStart);
assert.ok(endActionStart >= 0 && endActionEnd > endActionStart, "Explicit end-conversation action must exist");
assert.ok(
  wake.slice(endActionStart, endActionEnd).includes("endConversationAndResumeWakeWord();"),
  "Ending conversation from the app must tear down the continuous recognizer and restart wake-word listening"
);


const trustedUrlStart = activity.indexOf("private boolean isTrustedAppUrl(Uri uri)");
const trustedUrlEnd = activity.indexOf("\n    private void handleWakeCommandIntent", trustedUrlStart);
assert.ok(trustedUrlStart >= 0 && trustedUrlEnd > trustedUrlStart, "WebView trusted URL policy must exist");
const trustedUrlCode = activity.slice(trustedUrlStart, trustedUrlEnd);
assert.ok(
  trustedUrlCode.includes('"https".equalsIgnoreCase(uri.getScheme())') &&
  trustedUrlCode.includes("APP_HOST.equalsIgnoreCase(uri.getHost())") &&
  trustedUrlCode.includes("uri.getPort() != -1 && uri.getPort() != 443") &&
  trustedUrlCode.includes("uri.getUserInfo() != null") &&
  trustedUrlCode.includes('"/sarathi-ai/"'),
  "WebView bridge must be limited to HTTPS, default port, no user-info and Sarathi app paths"
);
assert.ok(
  activity.includes("if (!isTrustedAppUrl(uri))") &&
  activity.includes("view.stopLoading();") &&
  activity.includes("if (isTrustedAppUrl(uri))"),
  "Top-level navigation and link handling must use the same strict trusted URL policy"
);

assert.ok(
  indexHtml.includes("frame-src 'none'") &&
  indexHtml.includes("child-src 'none'") &&
  indexHtml.includes("object-src 'none'") &&
  indexHtml.includes("base-uri 'self'"),
  "Sarathi web shell must block iframe/child-frame content and embedded objects so third-party frames cannot access the Android JavaScript bridge"
);

assert.ok(activity.includes("public void resumeWakeWord()"), "Android bridge must expose wake-word resume");
assert.ok(activity.includes("setAction(WakeWordService.ACTION_RESUME)"), "Bridge must send the resume action");
assert.ok(
  app.includes("window.SarathiNative?.resumeWakeWord?.()"),
  "Voice-triggered app launching must request wake-word resume"
);
assert.ok(
  app.includes("const finishVoiceEarly = (message) =>") &&
  app.includes("finishVoiceEarly(reply)") &&
  app.includes("finishVoiceEarly(message)"),
  "Early media, image, settings, and file exits must complete the voice reply"
);
assert.ok(
  app.includes("const incomingVoice = state.voiceReplyPending") &&
  app.includes("सारथी अभी पिछले काम में व्यस्त है"),
  "Voice commands received while busy must get feedback and release the listener"
);


assert.ok(
  activity.includes("private boolean activityDestroyed = false;") &&
  activity.includes("if (activityDestroyed) return;"),
  "Late TTS callbacks must not start a Service after Activity teardown"
);
const destroyStart = activity.indexOf("protected void onDestroy()");
const destroyEnd = activity.indexOf("\n    }", destroyStart);
assert.ok(destroyStart >= 0 && destroyEnd > destroyStart, "Activity teardown handler must exist");
assert.ok(
  !activity.slice(destroyStart, destroyEnd).includes("resumeWakeWordAfterCommand();"),
  "Activity teardown must not restart the wake-word service"
);


const loginStart = app.indexOf("async function loginWorker()");
const loginEnd = app.indexOf("\nasync function getAuthToken", loginStart);
assert.ok(loginStart >= 0 && loginEnd > loginStart, "Worker login function must exist");
const loginCode = app.slice(loginStart, loginEnd);
assert.ok(
  loginCode.includes("new AbortController()") &&
  loginCode.includes("setTimeout(() => controller.abort(), 20000)") &&
  loginCode.includes("clearTimeout(timeout)"),
  "Worker login request must have a bounded timeout and always clear its timer"
);
assert.ok(
  loginCode.includes("लॉगिन सर्वर से जवाब आने में 20 सेकंड से अधिक लगे") &&
  loginCode.includes("लॉगिन सर्वर से संपर्क नहीं हो पाया"),
  "Login timeout and network failures must show clear Hindi errors"
);


const searchFilterStart = worker.indexOf("function filterRelevantSearchResults");
const searchFilterEnd = worker.indexOf("\nfunction dedupeNewsResults", searchFilterStart);
assert.ok(searchFilterStart >= 0 && searchFilterEnd > searchFilterStart, "Search result relevance filter must exist");
const searchFilter = worker.slice(searchFilterStart, searchFilterEnd);
assert.ok(
  searchFilter.includes("gov\\.in") &&
  searchFilter.includes("nic\\.in") &&
  searchFilter.includes("ac\\.in") &&
  searchFilter.includes("edu\\.in"),
  "Official education questions must be restricted to government and academic domains"
);
assert.ok(
  searchFilter.includes("परीक्षा तिथि") && searchFilter.includes("return officialHost.test(host)"),
  "Exam and result searches must reject non-official domains"
);


const sendStart = app.indexOf("async function sendMessage(text)");
const sendEnd = app.indexOf("\n/* ========================================\n   SETTINGS", sendStart);
assert.ok(sendStart >= 0 && sendEnd > sendStart, "Send message function must exist");
const sendCode = app.slice(sendStart, sendEnd);
assert.ok(
  sendCode.includes('const isTimeout = /समय अधिक लगा|timed out|timeout/i.test(rawMessage)') &&
  sendCode.includes('45 सेकंड से अधिक लगे'),
  "Chat request timeouts must have a distinct Hindi explanation"
);
assert.ok(
  sendCode.includes('finishVoiceEarly("माफ़ कीजिए, अभी जवाब नहीं मिल पाया। " + message)'),
  "Voice-triggered failures must release the paused wake-word listener"
);
assert.ok(
  sendCode.includes('else window.SarathiNative?.resumeWakeWord?.();'),
  "Successful voice replies must resume wake-word listening when speech playback is unavailable"
);


const stopWakeBridgeStart = activity.indexOf("public void stopWakeWord()");
const stopWakeBridgeEnd = activity.indexOf("\n        @JavascriptInterface", stopWakeBridgeStart);
assert.ok(stopWakeBridgeStart >= 0 && stopWakeBridgeEnd > stopWakeBridgeStart, "Native stop-wake bridge must exist");
const stopWakeBridge = activity.slice(stopWakeBridgeStart, stopWakeBridgeEnd);
assert.ok(
  stopWakeBridge.includes("runOnUiThread") &&
  stopWakeBridge.includes("try {") &&
  stopWakeBridge.includes("catch (Exception error)") &&
  stopWakeBridge.includes("notifyVoice(\"onError\""),
  "Stopping the foreground microphone service must handle Android background/service errors without crashing the bridge"
);

const serviceStart = wakeService.indexOf("public int onStartCommand(Intent intent, int flags, int startId)");
const serviceEnd = wakeService.indexOf("\n    private void createChannel()", serviceStart);
assert.ok(serviceStart >= 0 && serviceEnd > serviceStart, "Wake-word service command handler must exist");
const serviceCommandCode = wakeService.slice(serviceStart, serviceEnd);
assert.ok(
  serviceCommandCode.includes("if (intent == null)") &&
  serviceCommandCode.includes('prefs.edit().putBoolean("enabled", false).apply();') &&
  serviceCommandCode.includes("return START_NOT_STICKY;"),
  "Microphone foreground service must not attempt a sticky background restart after process death"
);


assert.ok(
  wakeService.includes("MAX_MODEL_ARCHIVE_BYTES") &&
  wakeService.includes("MAX_MODEL_EXPANDED_BYTES") &&
  wakeService.includes("MAX_MODEL_ARCHIVE_ENTRIES"),
  "Wake-word model download and extraction must have explicit size and entry-count limits"
);
const downloadStart = wakeService.indexOf("private void downloadModel(File destination)");
const downloadEnd = wakeService.indexOf("\n    private void unzipModel", downloadStart);
assert.ok(downloadStart >= 0 && downloadEnd > downloadStart, "Bounded model download method must exist");
const downloadCode = wakeService.slice(downloadStart, downloadEnd);
assert.ok(
  downloadCode.includes("getContentLengthLong()") &&
  downloadCode.includes("setInstanceFollowRedirects(false)") &&
  downloadCode.includes("downloadedBytes > MAX_MODEL_ARCHIVE_BYTES") &&
  downloadCode.includes("if (!completed && temp.exists()) temp.delete();"),
  "Model download must reject oversized/incomplete files and remove partial downloads"
);
const unzipStart = wakeService.indexOf("private void unzipModel(File zipFile, File destination)");
const unzipEnd = wakeService.indexOf("\n    private Recognizer createWakeRecognizer", unzipStart);
assert.ok(unzipStart >= 0 && unzipEnd > unzipStart, "Model extraction method must exist");
const unzipCode = wakeService.slice(unzipStart, unzipEnd);
assert.ok(
  unzipCode.includes("expandedBytes > MAX_MODEL_EXPANDED_BYTES") &&
  unzipCode.includes("entryCount > MAX_MODEL_ARCHIVE_ENTRIES") &&
  unzipCode.includes("getCanonicalPath().startsWith(root)"),
  "Model extraction must limit expanded size and entry count and prevent ZIP path traversal"
);

console.log("Sarathi Android wake-word self-test: stop phrases, resume and early-exit checks passed.");
