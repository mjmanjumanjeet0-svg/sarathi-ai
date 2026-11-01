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
    const searchBody = JSON.parse(init.body || "{}");
    if (/(ट्रेन|रेल|train|railway)/i.test(searchBody.query || "")) {
      return Response.json({ results: [
        { title: "Indian Railways train running status and schedule", url: "https://www.indianrail.gov.in/test-train-status", highlights: ["Train running status and scheduled departure information for Indian Railways."] }
      ] });
    }
    if (/India latest news/i.test(searchBody.query || "")) {
      return Response.json({ results: [
        { title: "India announces new national education initiative", url: "https://www.reuters.com/world/india/test-education-update/", highlights: ["Government officials announced a new national education initiative for schools."], publishedDate: new Date().toISOString() },
        { title: "Heavy rainfall alert issued for eastern India", url: "https://indianexpress.com/article/india/test-rainfall-alert/", highlights: ["Weather authorities issued a rainfall alert for parts of eastern India."], publishedDate: new Date().toISOString() }
      ] });
    }
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
await test("chat rejects requests without a login token", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "इतिहास क्या है?" }] });
  assert.equal(r.status, 401);
  assert.equal(calls.length, before, "unauthenticated requests must not reach providers");
});
await test("chat rejects an invalid login token", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "इतिहास क्या है?" }] }, "not-a-valid-token");
  assert.equal(r.status, 401);
  assert.equal(calls.length, before, "invalid-token requests must not reach providers");
});
async function makeSignedToken(payload, password) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return data + "." + Buffer.from(signature).toString("base64url");
}
await test("chat rejects an expired but correctly signed token", async () => {
  const before = calls.length;
  const expired = await makeSignedToken({ iat: 1, exp: 2 }, env.SARATHI_LOGIN_PASSWORD);
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "इतिहास क्या है?" }] }, expired);
  assert.equal(r.status, 401);
  assert.equal(calls.length, before, "expired-token requests must not reach providers");
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
await test("Hindi train timing question automatically searches railway information", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "04007 ट्रेन सीवान से कब चलती है?" }] }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "train timing should automatically trigger web search");
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "relevant railway results should reach Groq");
  const prompt = JSON.parse(groqCall.init.body || "{}").messages?.at(-1)?.content || "";
  assert.match(prompt, /Indian Railways|indianrail\.gov\.in/);
});
await test("Hindi current-news request automatically searches trusted news sources", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज की ताजा खबरें बताओ" }] }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "current-news request should automatically call Exa");
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.category, "news");
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "trusted news results should be sent to Groq");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const enrichedPrompt = groqBody.messages?.at(-1)?.content || "";
  assert.match(enrichedPrompt, /समाचार के सख्त निर्देश/);
  assert.match(enrichedPrompt, /Reuters|reuters\.com/);
  assert.match(enrichedPrompt, /Indian Express|indianexpress\.com/);
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
await test("missing Exa key never fabricates current web results", async () => {
  const previousKey = env.EXA_API_KEY;
  env.EXA_API_KEY = "";
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज की ताजा खबरें बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /भरोसेमंद परिणाम नहीं मिले/);
  assert.equal(calls.length, before, "missing search credentials must not call external providers");
  env.EXA_API_KEY = previousKey;
});
await test("gold-rate page enrichment only fetches public HTTPS URLs without following redirects", async () => {
  const before = calls.length;
  await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने का भाव बताओ" }] }, token);
  const pageFetches = calls.slice(before).filter(x => !x.url.includes("api.exa.ai/search") && !x.url.includes("api.groq.com"));
  assert.ok(pageFetches.length > 0, "gold-rate results should be eligible for page enrichment");
  for (const call of pageFetches) {
    assert.equal(new URL(call.url).protocol, "https:");
    assert.equal(call.init.redirect, "manual", "untrusted redirects must not be followed");
  }
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
