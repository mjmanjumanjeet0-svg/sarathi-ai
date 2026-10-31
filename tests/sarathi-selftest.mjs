import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Load the exact Worker source without changing its Cloudflare module format.
const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { default: worker } = await import(moduleUrl);

const calls = [];
let groqMode = "success";
let exaMode = "success";
let groqReply = "यह सारथी का परीक्षण उत्तर है।";
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.includes("api.exa.ai/search")) {
    if (exaMode === "429") return Response.json({ error: "rate limited" }, { status: 429 });
    return Response.json({
      results: [
        { title: "भारत में सोने का भाव", url: "https://example.com/gold-rate", highlights: ["24K gold rate ₹7800 per gram and 22K gold rate ₹7150 per gram in India."] },
        { title: "भारत में चांदी का भाव", url: "https://example.com/silver-rate", highlights: ["Silver rate ₹95 per gram in India."] }
      ]
    });
  }
  if (url.includes("api.groq.com")) {
    if (groqMode === "429") return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    if (groqMode === "500") return Response.json({ error: { message: "provider down" } }, { status: 500 });
    const body = JSON.parse(init.body || "{}");
    const last = body.messages?.at(-1)?.content || "";
    groqReply = last.includes("इतिहास") ? "1857 का विद्रोह ब्रिटिश शासन के विरुद्ध एक बड़ा विद्रोह था।" :
      last.includes("सोने") || last.includes("चांदी") ? "परीक्षण के लिए खोज परिणाम मिले। आज का भाव स्रोत और शुद्धता के अनुसार बदलता है।" :
      "यह सारथी का परीक्षण उत्तर है।";
    return Response.json({ choices: [{ message: { content: groqReply } }] });
  }
  throw new Error("Unexpected outbound request: " + url);
};

const env = { SARATHI_LOGIN_PASSWORD: "self-test-password", GROQ_API_KEY: "mock-groq-key", EXA_API_KEY: "mock-exa-key" };
async function request(path, method = "GET", body, token) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await worker.fetch(new Request("https://sarathi.test" + path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}

await test("health endpoint", async () => {
  const r = await request("/");
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "running");
});
await test("rejects wrong login password", async () => {
  const r = await request("/api/login", "POST", { password: "wrong" });
  assert.equal(r.status, 401);
});
let token = "";
await test("login issues a session token", async () => {
  const r = await request("/api/login", "POST", { password: env.SARATHI_LOGIN_PASSWORD });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  token = r.data.token;
});
await test("Hindi greeting is answered locally without provider calls", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /नमस्ते/);
  assert.equal(calls.length, before);
});
await test("general knowledge reaches the AI provider", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "इतिहास क्या है?" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /परीक्षण उत्तर|1857/);
  assert.ok(calls.some(x => x.url.includes("api.groq.com")));
});
await test("current price query invokes web search and AI", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने और चांदी का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.ok(r.data.reply);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")));
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
});
await test("Exa rate-limit is handled without crashing the Worker", async () => {
  exaMode = "429";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने का भाव बताओ" }] }, token);
  assert.ok([200, 502, 429].includes(r.status));
  assert.ok(r.data.reply || r.data.error);
  exaMode = "success";
});
await test("Groq 429 is surfaced as a clear retryable error", async () => {
  groqMode = "429";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 429);
  assert.equal(r.data.retryable, true);
  groqMode = "success";
});
await test("Groq 5xx is handled as a provider outage", async () => {
  groqMode = "500";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 502);
  groqMode = "success";
});
await test("empty question is rejected", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: " " }] }, token);
  assert.equal(r.status, 400);
});
await test("media-disabled status is honest and explicit", async () => {
  const r = await request("/api/media/image", "POST", { prompt: "test" }, token);
  assert.equal(r.status, 503);
  assert.equal(r.data.zeroCostMode, true);
});
console.log(`\nSarathi Worker self-test: ${passed}/${passed} passed (mock provider mode; no real API credits used).`);
