import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activity = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url), "utf8");

assert.match(activity, /private void scheduleVoiceRecognitionRetry\(boolean online\)[\s\S]*?if \(!voiceConversationActive \|\| nativeListeningPausedForAppPause \|\| isFinishing\(\)\) return;/,
  "voice retries must not be scheduled while the Activity is backgrounded");
assert.match(activity, /voiceRecognitionRetry = \(\) -> \{[\s\S]*?if \(!voiceConversationActive \|\| nativeListeningPausedForAppPause \|\| isFinishing\(\)\) return;[\s\S]*?startRecognition\(online\);/,
  "a queued retry must re-check foreground state before starting recognition");
assert.match(activity, /private void startRecognition\(boolean useOnlineService\) \{[\s\S]*?if \(!voiceConversationActive \|\| nativeListeningPausedForAppPause \|\| isFinishing\(\)\) return;/,
  "every recognition start must be blocked while the Activity is backgrounded");
assert.match(activity, /protected void onPause\(\)[\s\S]*?nativeListeningPausedForAppPause = true;[\s\S]*?pauseNativeListeningForReply\(\);/,
  "leaving the foreground must pause native microphone recognition");
assert.match(activity, /protected void onResume\(\)[\s\S]*?if \(nativeListeningPausedForAppPause && voiceConversationActive\)[\s\S]*?nativeListeningPausedForAppPause = false;/,
  "an explicitly active session may resume only after the Activity returns");

console.log("Android voice foreground-lifecycle self-test passed.");
