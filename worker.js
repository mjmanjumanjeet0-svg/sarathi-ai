// Deploy refresh: use the corrected main-branch source.
const INDIA_TIME_ZONE = "Asia/Kolkata";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const SESSION_SECONDS = 12 * 60 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeText(text) {
  return base64url(new TextEncoder().encode(text));
}

function decodeText(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

async function signToken(payload, password) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const data = encodeText(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );

  return `${data}.${base64url(new Uint8Array(signature))}`;
}

async function verifyToken(token, password) {
  try {
    if (typeof token !== "string" || token.length > 2000) return false;

    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [data, signature] = parts;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const signatureBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(data)
    );

    if (!valid) return false;

    const payload = JSON.parse(decodeText(data));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function isRateLimited(request, env, action) {
  if (!env.SARATHI_RATE_LIMITER) return false;

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `${action}:${ip}`;

  try {
    const result = await env.SARATHI_RATE_LIMITER.limit({ key });
    return !result.success;
  } catch {
    // If the limiter fails, do not accidentally lock out the user.
    return false;
  }
}

function getIndiaDateTime() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const result = {};
  for (const part of parts) result[part.type] = part.value;

  return {
    date: `${result.day}-${result.month}-${result.year}`,
    weekday: new Intl.DateTimeFormat("hi-IN", {
      timeZone: INDIA_TIME_ZONE,
      weekday: "long",
    }).format(now),
    time: `${result.hour}:${result.minute}`,
  };
}

function isDateQuestion(text) {
  return /आज की तारीख|आज कौन.?सा दिन|आज का दिन|आज डेट|आज की डेट|आज तारीख|वर्तमान तारीख|current date|today.?s date|what day is it today/i.test(text);
}

function shouldSearchAutomatically(text) {
  const q = String(text || "").trim();
  if (!q || q.length < 8) return false;
  // Search automatically for facts that commonly change or require authoritative verification.
  return /(आज|अभी|वर्तमान|लेटेस्ट|ताज़ा|ताजा|नवीनतम|इस साल|इस महीने|कल|कब चलेगी|कितने बजे|ट्रेन|रेलवे|प्लेटफॉर्म|मौसम|तापमान|भाव|कीमत|दाम|रेट|की दर|उपलब्धता|खुला है|बंद है|समय सारणी|परीक्षा तिथि|एडमिट कार्ड|रिजल्ट|परिणाम|फॉर्म|आवेदन|फीस|पात्रता|नियम|सरकारी योजना|आधिकारिक|नया अपडेट|समाचार|खबर|न्यूज़|news|latest|today|current|price|rate|schedule|status|result|admit card|official|202[6-9])/i.test(q)
    || /(कौन हैं|किसने कहा|कब हुआ|कहाँ हुआ|कितना है|क्या सही है|सच है या नहीं|जांच करो|जाँच करो|सत्यापित करो|verify|fact.?check)/i.test(q);
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function searchInternet(query, env) {
  const searchQuery = String(query || "").trim().slice(0, 1024);
  if (!searchQuery) return { results: [], warning: "खोज का सवाल खाली है।" };

  // Free-tier-only search: use Exa only. Never fall back to Cloudflare AI Gateway,
  // because that may consume a separate paid credit balance.
  if (!env.EXA_API_KEY) {
    return { results: [], warning: "मुफ़्त Exa सर्च सेटअप उपलब्ध नहीं है। Cloudflare में EXA_API_KEY Secret जोड़ें।" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const isNewsQuery = /(खबर|समाचार|news|breaking|latest|ताज़ा|ताजा)/i.test(searchQuery);
    const requestBody = {
      query: searchQuery,
      type: "instant",
      numResults: 5,
      contents: { highlights: true }
    };
    if (isNewsQuery) {
      requestBody.category = "news";
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      requestBody.startPublishedDate = since.toISOString();
    }
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": env.EXA_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const tag = String(payload?.tag || "").slice(0, 80);
      const detail = String(payload?.error || "").slice(0, 180);
      console.error("Exa search failed", response.status, tag, detail);
      let warning = "Exa सर्च सेवा ने HTTP " + response.status + " लौटाया।";
      if (response.status === 401 || response.status === 403) warning = "Exa API Key स्वीकार नहीं हुई। Cloudflare Secret का नाम EXA_API_KEY और उसकी वैधता जाँचें।";
      else if (response.status === 402) warning = "Exa खाते में मुफ़्त सर्च क्रेडिट या उपलब्ध सीमा पूरी हो गई है। कोई दूसरा सर्च प्रदाता अपने-आप चालू नहीं होगा।";
      else if (response.status === 429) warning = "Exa सर्च की अनुरोध सीमा पूरी हो गई है। थोड़ी देर बाद प्रयास करें।";
      else if (response.status >= 500) warning = "Exa सर्च सेवा अभी उपलब्ध नहीं है। थोड़ी देर बाद प्रयास करें।";
      return { results: [], warning, errorCode: tag, httpStatus: response.status };
    }
    const items = Array.isArray(payload?.results) ? payload.results : [];
    const results = items
      .filter(item => item && typeof item.title === "string" && typeof item.url === "string" && validHttpUrl(item.url))
      .slice(0, 5)
      .map(item => {
        let publisher = "वेबसाइट";
        try { publisher = new URL(item.url).hostname.replace(/^www\\./i, ""); } catch {}
        const highlights = Array.isArray(item.highlights) ? item.highlights.join(" ") : "";
        return {
          title: cleanText(item.title).slice(0, 300),
          url: item.url,
          snippet: cleanText(highlights || item.text || item.summary || "").slice(0, 1800),
          publisher,
          publishedAt: typeof item.publishedDate === "string" ? item.publishedDate : ""
        };
      });
    return {
      results,
      warning: results.length ? "Exa से वास्तविक वेब परिणाम मिले।" : "Exa खोज में इस सवाल के लिए कोई परिणाम नहीं मिला।"
    };
  } catch (error) {
    const code = String(error?.name || error?.code || "").slice(0, 80);
    console.error("Exa search request failed", code, error?.message || error);
    return {
      results: [],
      warning: error?.name === "AbortError" ? "Exa सर्च में समय अधिक लगा। दोबारा प्रयास करें।" : "Exa सर्च सेवा से संपर्क नहीं हो सका।",
      errorCode: code
    };
  } finally {
    clearTimeout(timeout);
  }
}
async function enrichGoldRateResults(results) {
  const candidates = (Array.isArray(results) ? results : []).slice(0, 4);
  return await Promise.all(candidates.map(async item => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(item.url, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; SarathiAI/1.0)"
        },
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) return item;
      const html = (await response.text()).slice(0, 1200000);
      const visible = cleanText(html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&#8377;|&\#x20b9;/gi, "₹"));
      const contexts = [];
      const labelPattern = /(?:22\s*(?:k|karat|carat)|24\s*(?:k|karat|carat)|22 कैरेट|24 कैरेट)/gi;
      let match;
      while ((match = labelPattern.exec(visible)) && contexts.length < 8) {
        const start = Math.max(0, match.index - 100);
        const end = Math.min(visible.length, match.index + 220);
        const context = visible.slice(start, end).replace(/\s+/g, " ").trim();
        if (/(₹|rs\.?|inr|रुपये|रु\.?)/i.test(context) &&
            /[0-9][0-9,]*(?:\.[0-9]+)?/.test(context)) {
          contexts.push(context);
        }
      }
      if (!contexts.length) return item;
      const combined = [item.title || "", item.snippet || "", ...contexts].join(" | ");
      const rateFor = (karat) => {
        const escaped = String(karat);
        const re = new RegExp("(?:\\b" + escaped + "\s*K\\b|" + escaped + "\s*कैरेट|" + escaped + "\s*karat)[^₹]{0,90}(?:₹|Rs\\.?|INR)\s*([0-9,]+(?:\\.[0-9]+)?)", "i");
        const m = combined.match(re);
        return m ? Number(m[1].replace(/,/g, "")) : null;
      };
      const goldRates = {
        perGram22K: rateFor(22),
        perGram24K: rateFor(24)
      };
      return {
        ...item,
        goldRates: (goldRates.perGram22K || goldRates.perGram24K) ? goldRates : null,
        snippet: (item.snippet ? item.snippet + " | " : "") +
          "पेज से मिला मूल्य-संदर्भ: " + [...new Set(contexts)].join(" || ").slice(0, 1800)
      };
    } catch {
      return item;
    } finally {
      clearTimeout(timeout);
    }
  }));
}

function filterRelevantSearchResults(query, results) {
  const q = String(query || "").toLocaleLowerCase("hi-IN");
  const textOf = (item) => `${item.title || ""} ${item.url || ""} ${item.snippet || ""}`.toLocaleLowerCase("hi-IN");
  const list = Array.isArray(results) ? results : [];

  if (/(ताज़ा खबर|ताजा खबर|आज की खबर|आज की न्यूज़|आज की न्यूज|आज कि ताजा खबर|आज की ताज़ा खबर|आज की ताजा खबर|latest news|today.?s news|current news|breaking news|समाचार)/i.test(q)) {
    const trustedNewsHost = /(^|\.)(indianexpress\.com|thehindu\.com|ndtv\.com|hindustantimes\.com|bbc\.com|reuters\.com|apnews\.com|news18\.com|aajtak\.in|abplive\.com|amarujala\.com|jagran\.com|zeenews\.india\.com|indiatoday\.in|theprint\.in|livemint\.com|timesofindia\.indiatimes\.com|pti\.in|aninews\.in)$/;
    return list.filter(item => {
      try {
        const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, "");
        const headline = `${item.title || ""} ${item.snippet || ""}`;
        // Do not treat astrology or calendar pages as current news.
        if (/(राशिफल|राशि फल|पंचांग|मुहूर्त|राहु.?काल|horoscope|zodiac|astrology|panchang)/i.test(headline)) return false;
        return trustedNewsHost.test(host);
      } catch {
        return false;
      }
    });
  }

  let required = null;
  if (/(प्रधानमंत्री|prime minister|president|राष्ट्रपति|मुख्यमंत्री|chief minister)/i.test(q)) {
    required = /(prime minister|प्रधानमंत्री|narendra modi|नरेंद्र मोदी|president|राष्ट्रपति|chief minister|मुख्यमंत्री)/i;
  } else if (/(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(q)) {
    required = /(gold|सोना|सोने|sone|bullion|22\s*k|24\s*k|gold[- ]?rate|gold[- ]?price|sona|ज्वेलरी|jewellery)/i;
  } else if (/(चांदी|चाँदी|silver)/i.test(q)) {
    required = /(silver|चांदी|चाँदी|bullion|silver[- ]?(rate|price)|चांदी[- ]?(भाव|कीमत))/i;
  } else if (/(मौसम|weather|तापमान|temperature)/i.test(q)) {
    required = /(weather|मौसम|temperature|forecast|तापमान)/i;
  } else if (/(ट्रेन|रेल|train|railway|पीएनआर|pnr)/i.test(q)) {
    required = /(train|railway|रेल|ट्रेन|pnr|indianrail)/i;
  }

  return required ? list.filter(item => required.test(textOf(item))) : list;
}

function dedupeNewsResults(results) {
  const seen = new Set();
  return (Array.isArray(results) ? results : []).filter(item => {
    const title = cleanText(item.title || "").toLocaleLowerCase("hi-IN")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    let urlKey = "";
    try {
      const u = new URL(item.url);
      u.hash = "";
      u.search = "";
      urlKey = u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
    } catch {}
    const key = title || urlKey;
    if (!key || seen.has(key) || (urlKey && seen.has("url:" + urlKey))) return false;
    seen.add(key);
    if (urlKey) seen.add("url:" + urlKey);
    return true;
  }).slice(0, 5);
}

function formatNewsPublishedAt(value) {
  if (!value) return "प्रकाशित तारीख उपलब्ध नहीं";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "प्रकाशित तारीख उपलब्ध नहीं";
  return new Intl.DateTimeFormat("hi-IN", {
    timeZone: INDIA_TIME_ZONE, day: "2-digit", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true
  }).format(d) + " (भारतीय समय)";
}

function buildNewsFallback(results, dateTime) {
  const items = dedupeNewsResults(results);
  if (!items.length) return "आज की खबरों के लिए पर्याप्त भरोसेमंद सामग्री नहीं मिली।";
  const lines = items.map((item, i) => {
    const detail = cleanText(item.snippet || "");
    return (i + 1) + ". " + cleanText(item.title) +
      (detail ? "\n" + detail.slice(0, 650) : "\nइस खबर का पर्याप्त विवरण उपलब्ध परिणामों में नहीं मिला।") +
      "\nस्रोत: " + (item.publisher || "उपलब्ध नहीं") +
      " | प्रकाशित: " + formatNewsPublishedAt(item.publishedAt);
  });
  return "आज की प्रमुख खबरें (" + dateTime.date + ")\n\n" +
    lines.join("\n\n") +
    "\n\nनोट: ये उपलब्ध खोज परिणामों के आधार पर संक्षेप हैं। जहाँ स्वतंत्र पुष्टि उपलब्ध नहीं है, वहाँ खबर को अंतिम रूप से सत्यापित न मानें।";
}

function buildSearchContext(results, query = "") {
  if (!results.length) return "";

  const isNewsQuery = /(खबर|समाचार|news|breaking|latest|ताज़ा|ताजा)/i.test(query);
  const newsInstruction = isNewsQuery
    ? "\n\nसमाचार के सख्त निर्देश: एक ही घटना को केवल एक बार बताओ; समान रिपोर्ट को जोड़ो, लेकिन अलग घटनाओं को मत मिलाओ। प्रकाशित तारीख केवल प्रकाशित फ़ील्ड से लो; घटना की तारीख केवल खबर के पाठ से लो। तारीख उपलब्ध न हो तो अनुमान मत लगाओ। आज की खबरों में आज या पिछले 48 घंटों में प्रकाशित खबरों को प्राथमिकता दो। एक ही एजेंसी की कॉपी को स्वतंत्र पुष्टि मत मानो। राजनीतिक आरोपों को आरोप के रूप में ही लिखो। अधिकतम 5 अलग और महत्वपूर्ण खबरें बताओ। हर खबर में 2–4 वाक्य का स्वाभाविक विवरण, प्रकाशक और प्रकाशित तारीख दो। हिंदी सवाल पर पूरा उत्तर सहज देवनागरी हिंदी में दो; अंग्रेज़ी शीर्षक या मेटाडेटा मत छोड़ो। URL मत लिखो और कोई तथ्य मत गढ़ो।"
    : "";

  return "\n\nइंटरनेट खोज के परिणाम:\n" + results.map(
    (item, i) =>
      `${i + 1}. ${item.title}\nप्रकाशक: ${item.publisher || "उपलब्ध नहीं"}\nप्रकाशित: ${item.publishedAt || "तारीख उपलब्ध नहीं"}\nजानकारी: ${item.snippet || "जानकारी उपलब्ध नहीं है।"}`
  ).join("\n\n") +
  "\n\nपरिणाम पर्याप्त न हों तो स्पष्ट बताओ। तथ्य या लिंक मत गढ़ो।" + newsInstruction;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Public health check: opening the Worker root in a browser sends GET.
    // Keep the actual login and chat APIs POST-only below.
    if ((request.method === "GET" || request.method === "HEAD") &&
        (url.pathname === "/" || url.pathname === "")) {
      if (request.method === "HEAD") {
        return new Response(null, { status: 200, headers: CORS_HEADERS });
      }

      return jsonResponse({
        success: true,
        service: "Sarathi AI Worker",
        status: "running",
        endpoints: {
          login: "POST /api/login",
          chat: "POST /api/chat",
          image: "POST /api/media/image (Cloudflare Workers AI binding required)"
        }
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "अनुरोध उपलब्ध नहीं है। API के लिए POST अनुरोध भेजें।" }, 405);
    }

    if (url.pathname !== "/api/login" && url.pathname !== "/api/chat" && url.pathname !== "/api/media/image") {
      return jsonResponse({ success: false, error: "API रास्ता उपलब्ध नहीं है।" }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "अनुरोध सही नहीं है।" }, 400);
    }

    if (url.pathname === "/api/login") {
      if (await isRateLimited(request, env, "login")) {
        return jsonResponse({ success: false, error: "बहुत बार कोशिश हुई। थोड़ी देर बाद प्रयास करो।" }, 429);
      }

      if (!env.SARATHI_LOGIN_PASSWORD) {
        return jsonResponse({ success: false, error: "लॉगिन Secret सेट नहीं है।" }, 500);
      }

      if (
        typeof body.password !== "string" ||
        body.password.length > 200 ||
        body.password !== env.SARATHI_LOGIN_PASSWORD
      ) {
        return jsonResponse({ success: false, error: "पासवर्ड सही नहीं है।" }, 401);
      }

      const now = Math.floor(Date.now() / 1000);
      const token = await signToken(
        { iat: now, exp: now + SESSION_SECONDS },
        env.SARATHI_LOGIN_PASSWORD
      );

      return jsonResponse({
        success: true,
        token,
        expiresIn: SESSION_SECONDS,
      });
    }

    if (url.pathname === "/api/media/image" || url.pathname === "/api/media/understand") {
      const isUnderstand = url.pathname === "/api/media/understand";
      const action = isUnderstand ? "media-understand" : "media-image";
      if (await isRateLimited(request, env, action)) {
        return jsonResponse({ success: false, error: "बहुत अधिक मीडिया अनुरोध हुए। थोड़ी देर बाद प्रयास करें।" }, 429);
      }
      if (!env.SARATHI_LOGIN_PASSWORD ||
          !await verifyToken((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.SARATHI_LOGIN_PASSWORD)) {
        return jsonResponse({ success: false, error: "सत्र समाप्त हो गया है। दोबारा लॉगिन करें।" }, 401);
      }
      if (!env.AI || typeof env.AI.run !== "function") {
        return jsonResponse({ success: false, error: "Cloudflare Workers AI binding उपलब्ध नहीं है।" }, 503);
      }

      if (isUnderstand) {
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "इस मीडिया में क्या दिख रहा है? हिंदी में विस्तार से बताओ।";
        const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
        if (!images.length || images.some(item => typeof item !== "string" ||
            !/^data:image\/(png|jpeg|webp);base64,/i.test(item) || item.length > 1_800_000)) {
          return jsonResponse({ success: false, error: "समझने के लिए 1 से 6 छोटी JPG/PNG/WEBP तस्वीरें भेजें।" }, 400);
        }
        try {
          const content = [{ type: "text", text: prompt.slice(0, 3000) }];
          for (const image of images) content.push({
            type: "image_url",
            image_url: { url: image }
          });
          const result = await env.AI.run("@cf/qwen/qwen3.8-27b", {
            messages: [
              { role: "system", content: "तुम सारथी हो। तस्वीरों में वास्तव में जो दिखता है उसी का वर्णन करो। अनिश्चित बात को अनुमान बताओ। जवाब सरल हिंदी में दो।" },
              { role: "user", content }
            ],
            max_tokens: 900,
            temperature: 0.2
          });
          const reply = typeof result?.response === "string" ? result.response
            : typeof result?.result === "string" ? result.result
            : typeof result?.description === "string" ? result.description : "";
          if (!reply) throw new Error("Vision model returned no text");
          return jsonResponse({ success: true, reply, model: "@cf/qwen/qwen3.8-27b", frames: images.length });
        } catch (error) {
          console.error("Media understanding failed", error?.message || error);
          return jsonResponse({ success: false, error: "फोटो/वीडियो समझने वाली AI सेवा अभी जवाब नहीं दे सकी। मॉडल की अनुमति, Workers AI सीमा और अनुरोध जाँचें।" }, 502);
        }
      }

      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const images = Array.isArray(body.images) ? body.images.slice(0, 1) : [];
      if (!prompt || prompt.length > 1200) {
        return jsonResponse({ success: false, error: "फोटो का निर्देश 1 से 1200 अक्षरों का होना चाहिए।" }, 400);
      }
      if (images.some(item => typeof item !== "string" ||
          !/^data:image\/(png|jpeg|webp);base64,/i.test(item) || item.length > 6_000_000)) {
        return jsonResponse({ success: false, error: "संपादन के लिए PNG, JPG या WEBP फोटो (4 MB तक) चुनें।" }, 400);
      }
      try {
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("width", "1024");
        form.append("height", "1024");
        if (images.length) {
          const match = images[0].match(/^data:image\/(png|jpeg|webp);base64,(.+)$/i);
          const binary = atob(match[2]);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const mime = images[0].slice(5, images[0].indexOf(";"));
          form.append("input_image_0", new Blob([bytes], { type: mime }), "reference-image");
        }
        const formResponse = new Response(form);
        const result = await env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
          multipart: {
            body: formResponse.body,
            contentType: formResponse.headers.get("content-type")
          }
        });
        const image = typeof result?.image === "string" ? result.image
          : typeof result?.result?.image === "string" ? result.result.image : "";
        if (!image) throw new Error("Image model returned no image data");
        return jsonResponse({
          success: true,
          imageUrl: "data:image/png;base64," + image,
          edited: images.length > 0,
          model: "@cf/black-forest-labs/flux-2-klein-4b"
        });
      } catch (error) {
        console.error("Image generation/edit failed", error?.message || error);
        return jsonResponse({ success: false, error: "फोटो नहीं बन सकी। Workers AI में FLUX.2 Klein मॉडल की उपलब्धता, खाता सीमा और मॉडल की अनुमति जाँचें।" }, 502);
      }
    }

    // ZERO-COST MODE: block Cloudflare Workers AI media generation/understanding.
    // These model calls can consume separately billed AI credits.
    if (url.pathname === "/api/media/image" || url.pathname === "/api/media/understand") {
      return jsonResponse({
        success: false,
        zeroCostMode: true,
        error: "Zero-Cost Mode चालू है। फोटो बनाना और फोटो/वीडियो समझना फिलहाल बंद है ताकि Workers AI का अलग खर्च न हो।"
      }, 503);
    }

    // Limit chat requests to reduce accidental usage; this is a per-minute
    // safety limit, not a guarantee of a free provider plan.
    if (await isRateLimited(request, env, "chat")) {
      return jsonResponse({ success: false, zeroCostMode: true, error: "मुफ़्त उपयोग की सुरक्षा सीमा पूरी हुई। एक मिनट बाद फिर प्रयास करें।" }, 429);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userMessage = [...messages].reverse().find(m => m?.role === "user");
    const userText = typeof userMessage?.content === "string"
      ? userMessage.content.trim()
      : "";

    if (!userText || userText.length > 12000) {
      return jsonResponse({ success: false, error: "सवाल खाली है या बहुत लंबा है।" }, 400);
    }

    const dateTime = getIndiaDateTime();

    if (isDateQuestion(userText)) {
      return jsonResponse({
        success: true,
        reply: `आज की तारीख ${dateTime.date} है। आज ${dateTime.weekday} है। भारतीय समय ${dateTime.time} है।`,
        ...dateTime,
        webSearch: false,
        sources: [],
      });
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse({ success: false, error: "AI सेवा का Secret उपलब्ध नहीं है।" }, 500);
    }

    const normalizedGreeting = userText
      .toLocaleLowerCase("hi-IN")
      .replace(/[!！?？.,،؛:;।॥🙏😊🙂🦚👋]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const greetingWords = normalizedGreeting ? normalizedGreeting.split(" ") : [];
    const greetingVocabulary = new Set([
      "नमस्ते", "नमस्कार", "हेलो", "हैलो", "हाय", "सारथी",
      "राम", "प्रणाम", "सुप्रभात", "शुभ", "सुबह", "शाम",
      "hi", "hello", "hey", "good", "morning", "evening"
    ]);
    const isGreetingOnly = normalizedGreeting.length <= 70 &&
      greetingWords.length > 0 &&
      greetingWords.length <= 6 &&
      greetingWords.every(word => greetingVocabulary.has(word));

    // Never search the web for a simple greeting, even if the browser toggle is on.
    const wantsSearch = !isGreetingOnly &&
      (body.webSearch === true || body.internet === true || shouldSearchAutomatically(userText));
    let searchResults = [];
    let searchWarning = "";

    // Keep this block as normal JavaScript lines; never insert literal \\n separators here.
    // Deploy marker: search syntax fix is included in this revision.
    if (wantsSearch) {
      const isCurrentNewsQuestion = /(ताज़ा खबर|ताजा खबर|आज की खबर|आज की न्यूज़|आज की न्यूज|आज कि ताजा खबर|आज की ताज़ा खबर|आज की ताजा खबर|latest news|today.?s news|current news|breaking news|समाचार)/i.test(userText);
      const isGoldRateQuestion = /(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(userText);
      const indiaToday = new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const isOfficialEducationQuestion = /(सिलेबस|पाठ्यक्रम|परीक्षा तिथि|एडमिट कार्ड|प्रवेश पत्र|रिजल्ट|परिणाम|आवेदन|फॉर्म|फीस|पात्रता|नियम|official syllabus|exam date|admit card|result|eligibility|application form)/i.test(userText);
      const searchQuery = isCurrentNewsQuestion
        ? "India latest news when:2d " + indiaToday
        : isGoldRateQuestion
          ? "India 22K 24K gold rate today per gram 10 gram " + indiaToday
          : isOfficialEducationQuestion
            ? userText + " official website government university board site:gov.in OR site:ac.in"
            : userText;
      const search = await searchInternet(searchQuery, env);
      searchResults = filterRelevantSearchResults(userText, search.results);
      if (isCurrentNewsQuestion) searchResults = dedupeNewsResults(searchResults);
      if (isGoldRateQuestion && searchResults.length) {
        searchResults = await enrichGoldRateResults(searchResults);
      }
      searchWarning = searchResults.length
        ? search.warning
        : (search.warning || "खोज में आपके सवाल से मेल खाते भरोसेमंद परिणाम नहीं मिले। गलत या असंबंधित स्रोत नहीं दिखाए गए।");

      // Never let the model pretend it has current web information when every
      // search provider returned no usable results.
      if (searchResults.length === 0) {
        return jsonResponse({
          success: true,
          reply: "मैंने वेब पर खोजने की कोशिश की, लेकिन अभी भरोसेमंद परिणाम नहीं मिले। इसलिए कोई तथ्य या लिंक गढ़कर नहीं बताऊँगा। थोड़ी देर बाद फिर कोशिश करें या सवाल को दूसरे शब्दों में पूछें।",
          ...dateTime,
          webSearch: false,
          searchAttempted: true,
          searchWarning: searchWarning || "इंटरनेट खोज से कोई परिणाम नहीं मिला।",
          sources: [],
        });
      }
    }

    const systemPrompt = `
तुम सारथी AI हो, एक सक्षम, स्पष्ट और भरोसेमंद द्विभाषी सहायक।
पहचान और निर्माता:
- ऐप/वेबसाइट के इंटरफेस, शीर्षक या सामान्य परिचय में निर्माता का नाम अपने-आप मत दिखाओ।
- यदि कोई सीधे पूछे कि सारथी AI किसने बनाया है या इसका निर्माता कौन है, तो ठीक इतना उत्तर दो: manju manjeet ने बनाया है।

भाषा और शैली:
- हर नए संदेश की भाषा पहचानो और उसी भाषा में उत्तर दो। हिंदी में पूछे तो हिंदी, अंग्रेज़ी में पूछे तो अंग्रेज़ी, भोजपुरी में पूछे तो सहज भोजपुरी, और हिंदी-अंग्रेज़ी मिलाकर पूछे तो स्वाभाविक Hinglish में जवाब दो। बातचीत के बीच भाषा बदलने पर तुरंत उसी भाषा में बदल जाओ।
- अगर उपयोगकर्ता बोलकर सवाल पूछे और उसका लिप्यंतरण रोमन अक्षरों में आया हो, तो शब्दों और वाक्य के अर्थ से भाषा पहचानो; केवल अंग्रेज़ी अक्षर देखकर उसे अंग्रेज़ी मत समझो। रोमन में लिखी हिंदी का जवाब हिंदी में दो, जब तक उपयोगकर्ता रोमन हिंदी/Hinglish में जवाब न माँगे।
- हिंदी का जवाब रोज़मर्रा की सहज, साफ़ और व्याकरण-सही हिंदी में दो—ऐसी भाषा जैसे कोई समझदार व्यक्ति आम बातचीत में बोलता है। किताबों जैसी भारी हिंदी, सरकारी/मशीनी अनुवाद, अटपटे शब्द, अनावश्यक अंग्रेज़ी और शब्दशः अनुवाद से बचो। कठिन तकनीकी शब्द आएँ तो पहले आसान अर्थ बताओ।
- Hinglish में जवाब देते समय उपयोगकर्ता की तरह ही भाषा का अनुपात रखो; ज़बरदस्ती हर अंग्रेज़ी शब्द का अनुवाद या हर हिंदी वाक्य में अंग्रेज़ी मत जोड़ो।
- भोजपुरी शब्द हों तो उनका अर्थ समझकर सहज भोजपुरी/हिंदी में उत्तर दो। उपयोगकर्ता की भाषा या लहजे का मज़ाक या अनावश्यक सुधार मत करो।
- भाषा बदलने के लिए उपयोगकर्ता को सेटिंग बदलने को मत कहो।
- सीधे सवाल का सीधा उत्तर पहले दो। फिर जरूरत के अनुसार कारण और कदम समझाओ।\n- यदि उपयोगकर्ता केवल हेलो, नमस्ते, नमस्कार या साधारण अभिवादन करे, तो छोटा स्वाभाविक अभिवादन देकर पूछो कि किस मदद की जरूरत है। ऐसे अभिवादन पर किसी पुराने विषय, खरीदारी, समाचार या वेब खोज के परिणामों का उत्तर मत दो।\n- हमेशा नवीनतम उपयोगकर्ता संदेश को प्राथमिकता दो; पुरानी बातचीत तभी जारी रखो जब संदेश उसी का संदर्भ देता हो।
- केवल एक पंक्ति में जवाब मत समेटो जब सवाल में विस्तार, तुलना या समाधान माँगा गया हो। उपयोगी उदाहरण दो, लेकिन अनावश्यक दोहराव न करो।
- उपयोगकर्ता पहले ही जो जानकारी दे चुका है, वह दोबारा मत पूछो।
- जहाँ अनिश्चितता हो, साफ बताओ; अनुमान को तथ्य मत बनाओ और नकली स्रोत/लिंक मत दो। अस्पष्ट या गोलमोल शब्दों से बचो; आसान और सटीक हिंदी में जवाब दो।
- सामान्य स्थायी ज्ञान के आसान सवालों का उत्तर बिना वेब खोज के दो। यदि सवाल ताज़ा, बदलती, स्थानीय, आधिकारिक या तथ्य-जाँच माँगता हो, तो उपलब्ध इंटरनेट खोज अपने-आप करो; केवल उपयोगकर्ता के वेब बटन पर निर्भर मत रहो।
- यदि खोज के परिणाम पर्याप्त, विश्वसनीय या एक-दूसरे से मेल खाते न हों, तो स्पष्ट कहो कि पुष्टि नहीं हो पाई। खोज न कर पाने पर भी इंटरनेट पर खोज लेने का दावा मत करो।
- वर्तमान सोने/चाँदी के भाव, शेयर, मौसम, ट्रेन स्थिति या अन्य बदलती जानकारी पूछी जाए और इंटरनेट खोज के परिणाम मिले हों, तो केवल उन्हीं परिणामों में स्पष्ट रूप से दिए गए ताज़ा आँकड़े बताओ। स्रोत में तारीख/दर स्पष्ट न हो या परिणाम आपस में न मिलें, तो कोई संख्या या तारीख अनुमान से मत बनाओ; साफ कहो कि उपलब्ध स्रोत से आज का सही भाव सत्यापित नहीं हो पाया।
- खोज परिणामों में पुरानी तारीख वाला भाव हो तो उसे आज का भाव बताकर प्रस्तुत मत करो। भारत के सोने के भाव में 22K और 24K की दर, प्रति ग्राम/10 ग्राम की इकाई और स्रोत की तारीख स्पष्ट करो, केवल जब स्रोत में ये जानकारी उपलब्ध हो।
- समाचार/ताज़ा खबर के लिए विशेष प्रारूप: खबरों का पूरा जवाब उसी भाषा और लहजे में लिखो जिसमें उपयोगकर्ता ने पूछा है। हिंदी में पूछे तो स्वाभाविक बोलचाल की हिंदी में लिखो; अंग्रेज़ी में पूछे तो अंग्रेज़ी में; Hinglish में पूछे तो सहज Hinglish में। शीर्षक, खंडों के नाम, तारीख़ का परिचय और सावधानी-पंक्ति भी उसी भाषा में हों—हिंदी सवाल पर अंग्रेज़ी हेडलाइन या अंग्रेज़ी में मेटाडेटा मत छोड़ो। शुरुआत में आज की तारीख़ और दिन बताओ। खबरों को देश, दुनिया, खेल या संबंधित विषय के छोटे खंडों में बाँटो; केवल वही खंड रखो जिनमें खबरें हों। हर खबर में पहले छोटी, साफ़ और स्वाभाविक हेडलाइन दो, फिर 2–4 छोटे वाक्यों में बताओ कि क्या हुआ, किसने किया/कहा, कहाँ और क्यों यह खबर महत्वपूर्ण है। मूल खबर अंग्रेज़ी में हो तो उसका अर्थ समझकर स्वाभाविक भाषा में अपने शब्दों में लिखो—शब्दशः अनुवाद मत करो। हर खबर के अंत में स्रोत का नाम और प्रकाशित तारीख़/समय भारतीय समय में दो; घटना की तारीख़ अलग और तभी बताओ जब उपलब्ध सामग्री में स्पष्ट हो। आरोप को आरोप, दावे को दावा और पुष्टि को पुष्टि के रूप में ही बताओ। एक ही घटना को दोहराओ मत; अलग घटनाओं को आपस में मत मिलाओ। केवल वेबसाइट का नाम, शीर्षक या तारीख़ देकर खबर पूरी मत मानो। विवरण पर्याप्त न हो तो उस खबर को छोड़ दो या साफ़ बताओ कि जानकारी सीमित है; कोई तथ्य मत गढ़ो। अधिकतम 8 भरोसेमंद और प्रासंगिक खबरें दो; अच्छी खबरें कम हों तो कम ही दो। अंत में उसी भाषा में एक छोटी सावधानी-पंक्ति दो।
- इंटरनेट खोज के परिणामों से तथ्य लेकर अपने शब्दों में सीधा जवाब दो। उपयोगकर्ता ने स्पष्ट रूप से लिंक या स्रोत न माँगे हों तो मुख्य जवाब में URL, वेबसाइट लिंक या लिंक की सूची बिल्कुल मत लिखो। स्रोत का नाम केवल तभी बताओ जब भरोसा जाँचने के लिए जरूरी हो। खोज के URL को आंतरिक संदर्भ समझो, उत्तर का हिस्सा नहीं।
- सोने के भाव के लिए हर स्रोत की दर अलग रखो। दो स्रोतों के भाव अलग हों तो उन्हें मिलाकर एक औसत या एक पक्का राष्ट्रीय भाव मत बनाओ; स्रोत, तारीख और इकाई सहित अलग-अलग बताओ और अंतर का कारण निश्चित न हो तो स्पष्ट कहो कि स्रोतों में अंतर है। जिस स्रोत से 22K/24K की संख्या स्पष्ट न निकली हो, उसके लिए संख्या मत बनाओ। प्रति 10 ग्राम की कीमत केवल प्रति ग्राम × 10 से निकालो और उसे गणना बताओ।
फ़ॉर्मेट:
- जवाब साफ और मोबाइल पर पढ़ने योग्य रखो।
- सामान्य उत्तर में * या ** जैसे Markdown सजावटी चिह्न मत लिखो। बोल्ड करने की जरूरत हो तो शब्दों को साधारण पाठ में रखो।
- सूची जरूरी हो तो हर नई बात अलग पंक्ति में लिखो और पंक्ति की शुरुआत साधारण "1." या "•" से करो। हर वाक्य में चिह्न न लगाओ।
- शीर्षक तभी दो जब जवाब लंबा हो। बहुत ज्यादा शीर्षक, इमोजी और दोहराव से बचो।
- कोड माँगा जाए तो पूरा, चलने योग्य कोड और कहाँ लगाना है, यह स्पष्ट बताओ।
मदद के नियम:
- पढ़ाई के सवालों में आसान भाषा, जरूरी शीर्षक और परीक्षा-उपयोगी व्याख्या दो।
- शिक्षा सहायक के रूप में कक्षा 1 से 12, स्नातक, स्नातकोत्तर, व्यावसायिक शिक्षा और प्रतियोगी परीक्षाओं के विषयों में सहायता करो; लेकिन किसी पाठ्यक्रम, बोर्ड, विश्वविद्यालय या परीक्षा का आधिकारिक पाठ्यक्रम बिना स्रोत के निश्चित बताने का दावा मत करो।
- विद्यार्थी से कक्षा/कोर्स, बोर्ड/विश्वविद्यालय, विषय, पेपर/सेमेस्टर और परीक्षा वर्ष पूछा जा सकता है, पर केवल वही जानकारी पूछो जो सही उत्तर के लिए जरूरी हो। पहले से बताई जानकारी दोबारा मत पूछो।
- अध्याय समझाते समय पहले सीखने का उद्देश्य, फिर सरल व्याख्या, मुख्य शब्द/परिभाषाएँ, उदाहरण, जरूरी तथ्य और अंत में छोटा पुनरावर्तन दो। विद्यार्थी के स्तर के अनुसार भाषा और कठिनाई बदलो।
- परीक्षा उत्तर माँगे जाने पर प्रश्न के अंक और अपेक्षित लंबाई के अनुसार भूमिका, मुख्य शीर्षक/उपशीर्षक, उदाहरण/तथ्य और निष्कर्ष दो। 1 अंक के प्रश्न का उत्तर संक्षिप्त रखो; 5/10/12/15 अंक के उत्तर में उचित विस्तार दो। जहाँ तथ्य या वर्ष संदिग्ध हों, जाँचने की सलाह दो।
- गणित, विज्ञान और लेखांकन में हल चरण-दर-चरण दिखाओ; सूत्र, इकाई और अंतिम उत्तर जाँचो। भाषा विषयों में व्याकरण का नियम और उदाहरण समझाओ। इतिहास/राजनीति/अर्थशास्त्र में तिथियों, अवधारणाओं और कारण-परिणाम में अंतर स्पष्ट रखो।
- परीक्षा तैयारी में अध्यायवार नोट्स, महत्वपूर्ण प्रश्न, वस्तुनिष्ठ प्रश्न, मॉडल पेपर, पुनरावृत्ति योजना और अभ्यास उपलब्ध कराओ। किसी प्रश्न को "पक्का आएगा" या "लीक" बताकर भ्रमित मत करो; महत्वपूर्ण का अर्थ पाठ्यक्रम/पिछले प्रश्नपत्रों के आधार पर संभावित अभ्यास बताओ, गारंटी नहीं।
- किताब या PDF के बारे में पूछे जाने पर केवल वास्तव में उपलब्ध कराई गई/खोज से मिली सामग्री के आधार पर अध्याय और पृष्ठ बताओ। किताब की सामग्री उपलब्ध न हो तो उपयोगकर्ता से PDF/फोटो/अंश माँगो या वैध सार्वजनिक स्रोत खोजो; पुस्तक पढ़ लेने का झूठा दावा मत करो।
- कॉपीराइट वाली किताबों के पूरे अध्याय या लंबे अंश ज्यों-के-त्यों मत दो। उनकी अपनी भाषा में सार, व्याख्या, अध्ययन नोट्स और छोटे उद्धरण तक सीमित रहो; सार्वजनिक डोमेन या खुले लाइसेंस की सामग्री का उपयोग उसकी शर्तों के अनुसार करो।
- किसी परीक्षा की तिथि, फीस, फॉर्म, पात्रता, परिणाम, सिलेबस या नियम बदल सकते हैं। ऐसे सवालों में इंटरनेट खोज उपलब्ध हो तो आधिकारिक बोर्ड/विश्वविद्यालय/सरकारी वेबसाइट को प्राथमिकता दो; स्रोत न मिले तो स्पष्ट कहो कि पुष्टि नहीं हुई।
- उत्तर में तथ्य, अनुमान और सलाह को अलग रखो। गलती पकड़े जाने पर बहाना न बनाओ; सुधार करके सही उत्तर दो। विद्यार्थी को नकल/धोखाधड़ी के बजाय विषय समझने और स्वयं उत्तर लिखने में मदद करो।
- मोबाइल/ऐप/कोड की समस्या में पहले कारण बताओ, फिर एक-एक करके काम करने वाले कदम दो।
- Sarathi AI, GitHub, Cloudflare और इंटरनेट-सर्च की समस्याओं में केवल वास्तविक स्थिति के आधार पर सलाह दो; जो बदलाव लाइव तैनात नहीं हुआ हो उसे तैनात हुआ मत कहो।
- सुरक्षा और निजता का ध्यान रखो। निजी जानकारी या संवेदनशील काम करने से पहले स्पष्ट अनुमति जरूरी हो तो अनुमति लो।
केवल उपलब्ध संदर्भ पर भरोसा करो; दूसरे चैट या निजी जानकारी याद होने का झूठा दावा मत करो।
आज की भारतीय तारीख ${dateTime.date} है।
`;

    const safeMessages = messages
      .filter(m =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string"
      )
      .slice(-10)
      .map(m => ({
        role: m.role,
        content: m.content.slice(0, m.role === "user" ? 11000 : 4000),
      }));

    if (searchResults.length) {
      for (let i = safeMessages.length - 1; i >= 0; i--) {
        if (safeMessages[i].role === "user") {
          safeMessages[i].content += buildSearchContext(searchResults, userText);
          break;
        }
      }
    }

    let groqResponse;

    try {
      groqResponse = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            ...safeMessages,
          ],
          temperature: 0.3,
          max_tokens: 2400,
        }),
      });
    } catch {
      return jsonResponse({ success: false, error: "AI सेवा से संपर्क नहीं हो सका।" }, 502);
    }

    if (!groqResponse.ok) {
      const status = groqResponse.status;
      const message = status === 429
        ? "AI सेवा पर इस समय बहुत अधिक अनुरोध हैं। 30–60 सेकंड बाद फिर कोशिश करें।"
        : status >= 500
          ? "AI सेवा अस्थायी रूप से उपलब्ध नहीं है। थोड़ी देर बाद फिर कोशिश करें।"
          : `AI सेवा अनुरोध स्वीकार नहीं कर सकी (HTTP ${status})।`;
      console.error("Groq request failed", status);
      return jsonResponse({
        success: false,
        error: message,
        retryable: status === 429 || status >= 500,
        providerStatus: status,
      }, status === 429 ? 429 : 502);
    }

    let payload;
    try {
      payload = await groqResponse.json();
    } catch {
      return jsonResponse({ success: false, error: "AI सेवा का उत्तर पढ़ा नहीं जा सका।" }, 502);
    }

    const reply = payload?.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return jsonResponse({ success: false, error: "AI सेवा से खाली उत्तर मिला।" }, 502);
    }

    const isCurrentNewsReply = /(ताज़ा खबर|ताजा खबर|आज की खबर|आज की न्यूज़|आज की न्यूज|आज कि ताजा खबर|आज की ताज़ा खबर|आज की ताजा खबर|latest news|today.?s news|current news|breaking news|समाचार)/i.test(userText);
    const rawReply = reply.trim();
    const metadataOnlyReply = isCurrentNewsReply &&
      /(प्रकाशित|published|event)\s*:/i.test(rawReply) &&
      !/(^|\n)\s*(?:[1-5][.)]|[-•])\s*[^\n]{12,}/m.test(rawReply);
    const finalReply = metadataOnlyReply
      ? buildNewsFallback(searchResults, dateTime)
      : rawReply;

    return jsonResponse({
      success: true,
      reply: finalReply,
      ...dateTime,
      webSearch: searchResults.length > 0,
      searchAttempted: wantsSearch,
      searchWarning,
      sources: searchResults.map(item => ({
        title: item.title,
        url: item.url,
        publisher: item.publisher || "",
        publishedAt: item.publishedAt || "",
      })),
    });
  },
};
