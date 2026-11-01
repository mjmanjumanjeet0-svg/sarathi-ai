import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../voice.js", import.meta.url), "utf8");
const calls = { start: 0, stop: 0, stopWakeWord: 0, stopSpeaking: 0 };
const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      textContent: "",
      classList: { toggle() {} },
      setAttribute() {},
    });
  }
  return elements.get(id);
}
const window = {
  SarathiNative: {
    startListening() { calls.start++; },
    stopListening() { calls.stop++; },
    stopWakeWord() { calls.stopWakeWord++; },
    stopSpeaking() { calls.stopSpeaking++; },
  },
};
const document = {
  getElementById: element,
  addEventListener() {},
  querySelectorAll() { return []; },
};
vm.runInNewContext(source, { window, document, setTimeout, console });

window.SarathiVoice.start();
assert.equal(calls.start, 1, "Android mic button must call native startListening");
assert.equal(window.SarathiVoice.isActive(), true, "native listening state should become active");

window.SarathiVoice.onNativeRecognitionDone();
assert.equal(window.SarathiVoice.isActive(), false, "native result must clear active mic state");

window.SarathiVoice.start();
window.SarathiVoice.stop();
assert.equal(calls.stop, 1, "stopping native mic must cancel native recognition");
assert.equal(calls.stopWakeWord, 0, "cancelling manual mic must not disable wake-word service");
assert.equal(window.SarathiVoice.isActive(), false);

console.log("Sarathi voice self-test: 4/4 passed.");
