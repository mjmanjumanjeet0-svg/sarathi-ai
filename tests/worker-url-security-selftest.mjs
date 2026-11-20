import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const origin = "https://sarathi-ai.mjmanjumanjeet0.workers.dev";

assert.match(app, /const TRUSTED_WORKER_ORIGIN = "https:\/\/sarathi-ai\.mjmanjumanjeet0\.workers\.dev"/,
  "the app must pin its official Worker origin");
assert.match(app, /function isTrustedWorkerUrl\(value\)[\s\S]*?parsed\.protocol === "https:"[\s\S]*?parsed\.origin === TRUSTED_WORKER_ORIGIN[\s\S]*?parsed\.username === ""[\s\S]*?parsed\.password === ""[\s\S]*?parsed\.search === ""[\s\S]*?parsed\.hash === ""/,
  "Worker URL validation must reject other origins, credentials, paths, queries, and fragments");
assert.match(app, /return isTrustedWorkerUrl\\(configured\\) \\? TRUSTED_WORKER_ORIGIN : DEFAULT_SETTINGS\\.workerUrl;/,
  "tampered local settings must fall back to the official Worker");
assert.match(app, /if \(!isTrustedWorkerUrl\(workerUrl\)\)[\s\S]*?केवल सारथी AI का आधिकारिक Worker URL स्वीकार है/,
  "the settings form must reject untrusted Worker URLs");
assert.match(app, /saveSettings\(\{ workerUrl: TRUSTED_WORKER_ORIGIN, assistantName \}\)/,
  "only the pinned Worker URL may be persisted");

console.log("Trusted Worker origin self-test passed for " + origin);
