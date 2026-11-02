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
    if (groqMode === "timeout") throw new DOMException("The operation was aborted.", "AbortError");
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
  return { status: response.status, data, headers: response.headers };
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
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://mjmanjumanjeet0-svg.github.io");
  assert.notEqual(r.headers.get("Access-Control-Allow-Origin"), "*");
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
await test("chat rejects requests without a bearer token", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] });
  assert.equal(r.status, 401);
});
await test("chat rejects a malformed or forged bearer token", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] }, "forged.token");
  assert.equal(r.status, 401);
});
await test("Hindi greeting is answered locally without provider calls", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /नमस्ते/);
  assert.equal(calls.length, before);
});
await test("India capital is answered locally without Groq quota", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत की राजधानी कहाँ है?" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /नई दिल्ली/);
  assert.equal(calls.length, before);
});
await test("general knowledge reaches the AI provider", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "इतिहास क्या है?" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /परीक्षण उत्तर|1857/);
  assert.ok(calls.some(x => x.url.includes("api.groq.com")));
});
await test("explicit Hindi command इंटरनेट खोजो triggers Exa even when webSearch toggle is off", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "इंटरनेट खोजो भारत की नई शिक्षा नीति के बारे में" }]
  }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")),
    "explicit Hindi search command must invoke Exa");
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.type, "auto");
  assert.deepEqual(exaBody.contents, { highlights: true });
});

await test("latest news query uses Exa news category and publication freshness filter", async () => {
  const before = calls.length;
  await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज की ताजा खबरें बताओ" }]
  }, token);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "latest news must invoke Exa");
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.type, "auto");
  assert.equal(exaBody.category, "news");
  assert.equal(exaBody.numResults, 8);
  assert.ok(exaBody.startPublishedDate, "news search must constrain publication date");
  assert.deepEqual(exaBody.contents, { highlights: true });
});

await test("current price query invokes web search and AI", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने और चांदी का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.ok(r.data.reply);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")));
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "Groq should receive the searched price question");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const enrichedUserPrompt = groqBody.messages?.at(-1)?.content || "";
  assert.match(enrichedUserPrompt, /सोना-चाँदी भाव उत्तर का अनिवार्य प्रारूप/);
  assert.match(enrichedUserPrompt, /24 कैरेट और 22 कैरेट/);
  assert.match(enrichedUserPrompt, /999 शुद्धता/);
  assert.match(enrichedUserPrompt, /13,888 × 10 = 1,38,880/);
  assert.match(enrichedUserPrompt, /179 × 1000 = 1,79,000/);
  assert.match(enrichedUserPrompt, /विसंगति बताओ/);
});
await test("long numbered prompts reach Groq without losing their beginning or ending", async () => {
  const longPrompt = Array.from({ length: 50 }, (_, i) => `${i + 1}. सवाल ${i + 1}: सामान्य ज्ञान का छोटा परीक्षण`).join("\n");
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: longPrompt }] }, token);
  assert.equal(r.status, 200);
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "Groq request should be made");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const sentPrompt = groqBody.messages?.at(-1)?.content || "";
  assert.ok(sentPrompt.startsWith("1. सवाल 1:"), "first question must be preserved");
  assert.ok(sentPrompt.includes("50. सवाल 50:"), "last question must be preserved");
  assert.equal(groqBody.max_tokens, 6000, "output budget should support longer answer lists");
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
await test("Groq timeout returns a clear retryable gateway timeout", async () => {
  groqMode = "timeout";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 504);
  assert.equal(r.data.retryable, true);
  assert.equal(r.data.providerStatus, 504);
  assert.match(r.data.error, /समय अधिक लगा/);
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
