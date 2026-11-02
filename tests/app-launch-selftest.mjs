import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("function detectAppLaunchCommand(prompt, installedApps = []) {");
const end = app.indexOf("\n}\n\n/* ========================================\n   SEND MESSAGE", start);
assert.ok(start >= 0 && end > start, "app launch parser must exist");
const parserSource = app.slice(start, end + 2);
const detect = new Function(parserSource + "\nreturn detectAppLaunchCommand;")();

const cases = [
  ["यूट्यूब खोलो", "youtube"],
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
assert.ok(mainActivity.includes("TYPE_TEXT_VARIATION_PASSWORD"), "Android login prompt must mask password input");
assert.ok(mainActivity.includes("APP_HOST.equalsIgnoreCase(pageUri.getHost())"), "Android login prompt must be restricted to the Sarathi host");
assert.ok(mainActivity.includes("REQUEST_POST_NOTIFICATIONS") && mainActivity.includes("startWakeWordAfterPermissions()"), "Android 13+ wake-word flow must request notification permission");
assert.ok(manifest.includes('android:name="android.permission.POST_NOTIFICATIONS"'), "Manifest must declare notification permission");
console.log("ANDROID LOGIN PROMPT SELF-TEST: password masking and same-origin prompt guard passed");
const manifest = await readFile(new URL("../android-app/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const wakeService = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/WakeWordService.java", import.meta.url), "utf8");
assert.ok(/awaitingCommand = false;\s+conversationMode = false;\s+commandMode = false;/.test(wakeService), "wake notification timeout must reset conversation state");
assert.ok(wakeService.includes("|| conversationMode || recognized == null"), "wake recognizer must ignore late callbacks after activation");
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
assert.ok(manifest.includes('android.intent.category.LAUNCHER'));
console.log("APP LAUNCH SELF-TEST: " + cases.length + " fixed parser cases, 3 dynamic app cases and " + packages.length + " fixed Android mappings passed");
