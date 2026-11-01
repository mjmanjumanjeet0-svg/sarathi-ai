import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wakePath = new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url);
const activityPath = new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url);
const [wake, activity, app] = await Promise.all([
  readFile(wakePath, "utf8"),
  readFile(activityPath, "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
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

console.log("Sarathi Android wake-word self-test: stop phrases and app-launch resume checks passed.");
