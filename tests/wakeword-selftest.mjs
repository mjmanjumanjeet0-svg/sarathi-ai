import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wakePath = new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url);
const activityPath = new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url);
const [wake, activity, app, worker] = await Promise.all([
  readFile(wakePath, "utf8"),
  readFile(activityPath, "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../worker.js", import.meta.url), "utf8"),
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

console.log("Sarathi Android wake-word self-test: stop phrases, resume and early-exit checks passed.");
