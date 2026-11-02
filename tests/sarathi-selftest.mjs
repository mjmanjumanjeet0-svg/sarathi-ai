import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Load the exact Worker source without changing its Cloudflare module format.
const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { default: worker } = await import(moduleUrl);

const calls = [];
let groqMode = "success";
let groq413Count = 0;
let exaMode = "success";
let groqReply = "यह सारथी का परीक्षण उत्तर है।";
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.includes("api.exa.ai/search")) {
    if (exaMode === "429") return Response.json({ error: "rate limited" }, { status: 429 });
    const exaRequest = JSON.parse(init.body || "{}");
    if (exaRequest.category === "news") {
      return Response.json({
        results: [
          { title: "IMD issues warning for Cyclone Murasu", url: "https://example.com/murasu", highlights: ["IMD says Severe Cyclonic Storm Murasu is over the westcentral Bay of Bengal and is forecast to cross the south Andhra Pradesh coast late on 2 November."] },
          { title: "Supreme Court permits certified green crackers in Delhi-NCR", url: "https://example.com/green-crackers", highlights: ["The Supreme Court allowed certified green crackers in Delhi-NCR during specified hours on 7 and 8 November."] }
        ]
      });
    }
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
    if (groqMode === "413-once" && groq413Count++ === 0) return Response.json({ error: { message: "payload too large" } }, { status: 413 });
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

await test("Sarathi identity question is answered locally without web search even when toggle is on", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: true,
    messages: [{ role: "user", content: "नमस्ते सारथी, तुम कौन हो?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /मैं सारथी AI हूँ/);
  assert.equal(r.data.webSearch, false);
  assert.equal(calls.length, before, "identity questions must not consume Exa or Groq requests");
});

await test("हेलो सर्दी is not treated as a Sarathi greeting alias", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सर्दी" }] }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")),
    "the removed wake-word alias must not receive the local greeting response");
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
    "removing the wake-word alias must not itself trigger a web search");
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
await test("Android app-launch capability is distinguished from website limitations", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "क्या तुम Android में इंस्टॉल ऐप खोल सकते हो?" }]
  }, token);
  assert.equal(r.status, 200);
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "request should reach the assistant provider");
  const body = JSON.parse(groqCall.init.body || "{}");
  const system = body.messages?.find(message => message.role === "system")?.content || "";
  assert.match(system, /Android सारथी ऐप/);
  assert.match(system, /केवल वेबसाइट\/ब्राउज़र/);
  assert.match(system, /खुलना सत्यापित नहीं हुआ/);
});
await test("stable general-knowledge questions do not trigger unnecessary web search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "गौतम बुद्ध कौन थे?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
    "stable biography/general knowledge should not spend search requests");
});
await test("regulated career pathways trigger current education search and strict official-source rules", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "भारत में डॉक्टर बनने के लिए वर्तमान योग्यता और सही प्रवेश परीक्षा क्या है?" }]
  }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "regulated career pathways must trigger current web verification");
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.numResults, 8, "education searches should compare a wider source pool");
  assert.ok(exaBody.includeDomains.includes("*.gov.in"));
  assert.ok(exaBody.includeDomains.includes("*.ac.in"));
  assert.ok(exaBody.includeDomains.includes("nmc.org.in"));
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "the searched education question should reach the assistant");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const system = groqBody.messages?.find(message => message.role === "system")?.content || "";
  assert.match(system, /शिक्षा और करियर में उच्च-सटीकता नियम/);
  assert.match(system, /आधिकारिक पुष्टि नहीं मिली/);
  assert.match(system, /NEET-UG/);
  assert.match(system, /Doctorate of Medicine \(DM\)/);
  assert.match(system, /Magister Chirurgiae \(MCh\)/);
  assert.match(system, /सभी कोर्स में 60% या Maths अनिवार्य मत कहो/);
});

await test("scholarship deadlines and eligibility trigger official education-source search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "बिहार छात्रवृत्ति 2026 की आवेदन अंतिम तिथि और पात्रता क्या है?" }]
  }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "current scholarship rules must trigger official-source search");
  const body = JSON.parse(exaCall.init.body || "{}");
  assert.equal(body.numResults, 8);
  assert.ok(body.includeDomains.includes("*.gov.in"), "scholarship search must be scoped to official government sources");
  assert.ok(body.query.includes("official website"), "scholarship search query should request official sources");
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
});

await test("Indian course catalog questions trigger official-source search even with web toggle off", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "भारत में ITI के कौन-कौन से कोर्स उपलब्ध हैं?" }]
  }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "Indian course catalog questions must trigger current verification");
  const body = JSON.parse(exaCall.init.body || "{}");
  assert.equal(body.numResults, 8);
  assert.ok(body.includeDomains.includes("*.gov.in"));
  assert.ok(body.includeDomains.includes("ncvet.gov.in"));
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
});

await test("medical super-specialty degree abbreviations use verified local definitions", async () => {
  for (const [question, expected] of [
    ["MCh का मतलब क्या है?", "Magister Chirurgiae"],
    ["DM का मतलब क्या है?", "Doctorate of Medicine"]
  ]) {
    const before = calls.length;
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: question }]
    }, token);
    assert.equal(r.status, 200);
    assert.match(r.data.reply, new RegExp(expected));
    assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false);
    assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), false,
      "verified degree names should not depend on an uncertain generated answer");
  }
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
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const userContext = groqBody.messages?.at(-1)?.content || "";
  assert.match(userContext, /पूर्वानुमानित है तो उसे हो चुकी घटना की तरह मत लिखो/);
  assert.match(userContext, /कोई अतिरिक्त घटना, स्थान, संख्या, नुकसान, उड़ान रद्द होने या असर का दावा मत जोड़ो/);
});

await test("a casual sentence containing आज does not automatically trigger Exa", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज मैं क्या करूँ?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
    "a generic use of आज must not start a web search");
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")),
    "normal conversation should still reach the AI provider");
});

await test("failed web search is explicitly marked as attempted and unavailable", async () => {
  exaMode = "429";
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "इंटरनेट पर आज की ताजा खबरें खोजो" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchAttempted, true);
  assert.equal(r.data.webSearch, true);
  assert.ok(r.data.searchWarning);
  assert.equal(r.data.sources.length, 0);
  exaMode = "success";
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
await test("Groq HTTP 413 retries once with compact context and preserves the complete latest question", async () => {
  groqMode = "413-once";
  groq413Count = 0;
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [
      { role: "user", content: "तीन सवालों के उत्तर दो: ग्रामीण विकास की चुनौतियाँ क्या हैं, औद्योगीकरण का सामाजिक प्रभाव क्या है, और आधुनिक शिक्षा की भूमिका क्या है?" },
      { role: "assistant", content: "मैं तीनों सवालों का उत्तर दूँगा।" },
      { role: "user", content: "सबका उत्तर दो।" }
    ]
  }, token);
  assert.equal(r.status, 200);
  const groqCalls = calls.slice(before).filter(x => x.url.includes("api.groq.com"));
  assert.equal(groqCalls.length, 2, "provider should be retried exactly once");
  const retryBody = JSON.parse(groqCalls[1].init.body || "{}");
  const retryPrompt = retryBody.messages?.at(-1)?.content || "";
  assert.match(retryPrompt, /पिछला सवाल\/संदर्भ/);
  assert.match(retryPrompt, /ग्रामीण विकास की चुनौतियाँ/);
  assert.match(retryPrompt, /आधुनिक शिक्षा की भूमिका/);
  assert.match(retryPrompt, /अभी का पूरा सवाल/);
  assert.match(retryPrompt, /सबका उत्तर दो/);
  assert.equal(retryBody.messages.length, 2, "compact retry should combine context into one user message");
  assert.equal(retryBody.max_tokens, 1800);
  const retrySystem = retryBody.messages?.[0]?.content || "";
  assert.match(retrySystem, /समाचार में केवल शीर्षक और स्रोत-अंश से पुष्ट तथ्य लिखो/);
  assert.ok(retrySystem.length < 1000, "413 retry must also compact the oversized system prompt");
  groqMode = "success";
});
await test("Groq 429 preserves available web results with an honest fallback", async () => {
  groqMode = "429";
  exaMode = "success";
  const r = await request("/api/chat", "POST", {
    webSearch: true,
    messages: [{ role: "user", content: "आज सोने का भाव इंटरनेट पर खोजो" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.success, true);
  assert.equal(r.data.providerBusy, true);
  assert.match(r.data.reply, /AI सेवा इस समय व्यस्त है/);
  assert.match(r.data.reply, /भारत में सोने का भाव/);
  assert.ok(r.data.sources.length >= 1, "at least one verified source should be preserved");
  assert.match(r.data.searchWarning, /AI सेवा व्यस्त थी/);
  groqMode = "success";
});
await test("Groq 429 without search results remains a clear retryable error", async () => {
  groqMode = "429";
  exaMode = "429";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 429);
  assert.equal(r.data.retryable, true);
  groqMode = "success";
  exaMode = "success";
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
