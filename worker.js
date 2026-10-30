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

function decodeSearchUrl(value) {
  try {
    const url = new URL(value, "https://html.duckduckgo.com");

    if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") {
      const destination = url.searchParams.get("uddg");
      return destination && validHttpUrl(destination) ? destination : "";
    }

    return validHttpUrl(url.href) ? url.href : "";
  } catch {
    return "";
  }
}

async function searchDuckDuckGoHtml(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const endpoint = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query.slice(0, 600));
    const response = await fetch(endpoint, {
      headers: {
        "Accept": "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; SarathiAI/1.0)",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { results: [], warning: "वैकल्पिक वेब खोज अभी उपलब्ध नहीं है।" };
    }

    const html = await response.text();
    const blocks = html.match(/<div[^>]+class=["'][^"']*\bresult\b[^"']*["'][\s\S]*?(?=<div[^>]+class=["'][^"']*\bresult\b|$)/gi) || [];
    const results = [];
    const seen = new Set();

    for (const block of blocks) {
      if (results.length >= 5) break;
      const linkMatch = block.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
        || block.match(/<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      const url = decodeSearchUrl(linkMatch[1].replace(/&amp;/g, "&"));
      const title = cleanText(linkMatch[2].replace(/<[^>]*>/g, " "));
      if (!url || !title || seen.has(url)) continue;

      const snippetMatch = block.match(/<[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
      const snippet = snippetMatch ? cleanText(snippetMatch[1].replace(/<[^>]*>/g, " ")) : "";
      seen.add(url);
      results.push({ title: title.slice(0, 300), url, snippet: snippet.slice(0, 1800) });
    }

    return results.length
      ? { results, warning: "वैकल्पिक DuckDuckGo HTML खोज इस्तेमाल हुई है; कुछ ताज़ा या विशेष जानकारी अधूरी हो सकती है।" }
      : { results: [], warning: "वैकल्पिक खोज से परिणाम नहीं मिले। प्रश्न को अलग शब्दों में पूछें या बाद में कोशिश करें।" };
  } catch {
    return { results: [], warning: "वैकल्पिक इंटरनेट खोज उपलब्ध नहीं है।" };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchBingRss(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const endpoint = "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(query.slice(0, 600));
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
    });
    if (!response.ok) return { results: [], warning: "वैकल्पिक खोज सेवा उपलब्ध नहीं है।" };
    const xml = await response.text();
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    const results = [];
    for (const item of items) {
      if (results.length >= 5) break;
      const getTag = (tag) => {
        const m = item.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
        return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
      };
      const title = cleanText(getTag("title"));
      const url = getTag("link");
      const snippet = cleanText(getTag("description"));
      if (title && validHttpUrl(url)) results.push({ title: title.slice(0, 300), url, snippet: snippet.slice(0, 1800) });
    }
    return results.length
      ? { results, warning: "वैकल्पिक Bing खोज इस्तेमाल हुई है; कुछ परिणाम अधूरे हो सकते हैं।" }
      : { results: [], warning: "वैकल्पिक खोज से परिणाम नहीं मिले।" };
  } catch {
    return { results: [], warning: "वैकल्पिक इंटरनेट खोज उपलब्ध नहीं है।" };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchGoogleNewsRss(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const freshQuery = query + " when:2d";
    const endpoint = "https://news.google.com/rss/search?q=" +
      encodeURIComponent(freshQuery.slice(0, 400)) + "&hl=hi&gl=IN&ceid=IN:hi";
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
    });
    if (!response.ok) return { results: [], warning: "Google News RSS खोज उपलब्ध नहीं है।" };
    const xml = await response.text();
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    const results = [];
    for (const item of items) {
      if (results.length >= 5) break;
      const tag = (name) => {
        const match = item.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i"));
        return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
      };
      const title = cleanText(tag("title"));
      const url = tag("link");
      const snippet = cleanText(tag("description"));
      const publishedText = tag("pubDate");
      const publishedAt = publishedText ? Date.parse(publishedText) : NaN;
      // Exclude dated stories older than 48 hours from a current-news feed.
      if (title && validHttpUrl(url) && Number.isFinite(publishedAt) &&
          Date.now() - publishedAt <= 48 * 60 * 60 * 1000 &&
          publishedAt <= Date.now() + 60 * 60 * 1000) {
        results.push({ title: title.slice(0, 300), url, snippet: snippet.slice(0, 1800), publishedAt: new Date(publishedAt).toISOString() });
      }
    }
    return { results, warning: results.length ? "Google News RSS से पिछले 48 घंटों के परिणाम मिले।" : "पिछले 48 घंटों की तारीख वाले परिणाम नहीं मिले।" };
  } catch {
    return { results: [], warning: "Google News RSS खोज अभी उपलब्ध नहीं है।" };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchInternet(query, env) {
  // Preferred path: Cloudflare Web Search binding. No provider key is exposed
  // to the browser; provider billing/configuration is handled by Cloudflare AI Gateway.
  if (env.AI && typeof env.AI.websearch === "function") {
    try {
      const response = await env.AI.websearch({
        gatewayId: "default",
        query: query.slice(0, 600),
        provider: "exa",
        limit: 8,
      });

      if (!response.ok) {
        throw new Error("Cloudflare Web Search returned HTTP " + response.status);
      }

      const data = await response.json();
      // Cloudflare Web Search API returns its results in data.items.
      const raw = Array.isArray(data.items) ? data.items
        : Array.isArray(data.results) ? data.results
        : Array.isArray(data.web) ? data.web
        : Array.isArray(data.data) ? data.data
        : [];

      const results = raw.slice(0, 5).map(item => {
        const url = item.url || item.link || item.href;
        const title = item.title || item.name || "";
        const snippet = item.description || item.snippet || item.text || item.content || "";
        if (!validHttpUrl(url) || !title) return null;
        return {
          title: cleanText(title).slice(0, 300),
          url,
          snippet: cleanText(snippet).slice(0, 1800),
        };
      }).filter(Boolean);

      if (results.length) return { results, warning: "" };
      // An empty result is not final: continue to public search fallbacks below.
    } catch {
      // The primary binding may be unavailable or require paid credits.
      // Continue to public search fallbacks below.
    }
  }

  // Google News RSS is useful for headlines, but not a reliable gold-price source.
  const isGoldRateSearch = /(सोने|सोना|gold|bullion|22\\s*k|24\\s*k)/i.test(query);
  if (!isGoldRateSearch && /(खबर|समाचार|news|breaking|latest)/i.test(query)) {
    const newsFallback = await searchGoogleNewsRss(query);
    if (newsFallback.results.length) return newsFallback;
  }

  // Full-search fallbacks must also run when the Cloudflare AI binding is absent.
  // DuckDuckGo Instant Answer is only the last resort because it often misses news.
  const htmlFallback = await searchDuckDuckGoHtml(query);
  if (htmlFallback.results.length) return htmlFallback;

  const bingFallback = await searchBingRss(query);
  if (bingFallback.results.length) return bingFallback;

  // Explicitly mark the legacy fallback as limited; DuckDuckGo Instant Answer
  // is not a full web-search API and often has no results for current prices/news.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const endpoint = "https://api.duckduckgo.com/?q=" +
      encodeURIComponent(query.slice(0, 600)) + "&format=json&no_html=1&skip_disambig=1";
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { results: [], warning: "इंटरनेट खोज सेवा उपलब्ध नहीं है।" };
    }
    const data = await response.json();
    const results = [];
    if (data.AbstractText && validHttpUrl(data.AbstractURL)) {
      results.push({
        title: cleanText(data.Heading || query),
        url: data.AbstractURL,
        snippet: cleanText(data.AbstractText),
      });
    }
    function addTopics(items) {
      for (const item of items || []) {
        if (results.length >= 5) return;
        if (item.Topics) {
          addTopics(item.Topics);
        } else if (item.FirstURL && item.Text && validHttpUrl(item.FirstURL)) {
          results.push({
            title: cleanText(item.Text.split(" - ")[0]),
            url: item.FirstURL,
            snippet: cleanText(item.Text),
          });
        }
      }
    }
    addTopics(data.RelatedTopics);
    return results.length
      ? { results, warning: "सीमित खोज स्रोत इस्तेमाल हुआ; ताज़ा खबर/भाव के लिए परिणाम अधूरे हो सकते हैं।" }
      : { results: [], warning: "सीमित खोज स्रोत से उपयोगी परिणाम नहीं मिले। Cloudflare Web Search binding सेट करें।" };
  } catch {
    return { results: [], warning: "इंटरनेट खोज अभी उपलब्ध नहीं है।" };
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
        const re = new RegExp("(?:\\b" + escaped + "\\s*K\\b|" + escaped + "\\s*कैरेट|" + escaped + "\\s*karat)[^₹]{0,90}(?:₹|Rs\\.?|INR)\\s*([0-9,]+(?:\\.[0-9]+)?)", "i");
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
        // Google News RSS links are wrappers around publisher stories.
        return trustedNewsHost.test(host) || host === "news.google.com";
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

function buildSearchContext(results) {
  if (!results.length) return "";

  return "\n\nइंटरनेट खोज के परिणाम:\n" + results.map(
    (item, i) =>
`${i + 1}. ${item.title}\nलिंक: ${item.url}\nनिकाली गई दर (यदि उपलब्ध): ${item.goldRates ? JSON.stringify(item.goldRates) : "पेज से स्पष्ट दर नहीं निकली"}\nजानकारी: ${item.snippet || "जानकारी उपलब्ध नहीं है।"}`
  ).join("\n\n") +
  "\n\nपरिणाम पर्याप्त न हों तो स्पष्ट बताओ। तथ्य या लिंक मत गढ़ो।";
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
          chat: "POST /api/chat"
        }
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "अनुरोध उपलब्ध नहीं है। API के लिए POST अनुरोध भेजें।" }, 405);
    }

    if (url.pathname !== "/api/login" && url.pathname !== "/api/chat") {
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

    if (await isRateLimited(request, env, "chat")) {
      return jsonResponse({ success: false, error: "बहुत अधिक अनुरोध हुए। थोड़ी देर बाद प्रयास करो।" }, 429);
    }

    if (!env.SARATHI_LOGIN_PASSWORD) {
      return jsonResponse({ success: false, error: "लॉगिन Secret सेट नहीं है।" }, 500);
    }

    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!await verifyToken(token, env.SARATHI_LOGIN_PASSWORD)) {
      return jsonResponse({ success: false, error: "पहले सही पासवर्ड से लॉगिन करो।" }, 401);
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
      (body.webSearch === true || body.internet === true);
    let searchResults = [];
    let searchWarning = "";

    // Keep this block as normal JavaScript lines; never insert literal \\n separators here.
    // Deploy marker: search syntax fix is included in this revision.
    if (wantsSearch) {
      const isCurrentNewsQuestion = /(ताज़ा खबर|ताजा खबर|आज की खबर|आज की न्यूज़|आज की न्यूज|आज कि ताजा खबर|आज की ताज़ा खबर|आज की ताजा खबर|latest news|today.?s news|current news|breaking news|समाचार)/i.test(userText);
      const isGoldRateQuestion = /(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(userText);
      const indiaToday = new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const searchQuery = isCurrentNewsQuestion
        ? "India latest news when:2d " + indiaToday
        : isGoldRateQuestion
          ? "India 22K 24K gold rate today per gram 10 gram " + indiaToday
          : userText;
      const search = await searchInternet(searchQuery, env);
      searchResults = filterRelevantSearchResults(userText, search.results);
      if (isGoldRateQuestion && searchResults.length) {
        searchResults = await enrichGoldRateResults(searchResults);
      }
      searchWarning = searchResults.length
        ? search.warning
        : "खोज में आपके सवाल से मेल खाते भरोसेमंद परिणाम नहीं मिले। गलत या असंबंधित स्रोत नहीं दिखाए गए।";

      // Never let the model pretend it has current web information when every
      // search provider returned no usable results.
      if (searchResults.length === 0) {
        return jsonResponse({
          success: true,
          reply: "मैंने इंटरनेट पर खोजने की कोशिश की, लेकिन अभी भरोसेमंद परिणाम नहीं मिले। इसलिए ताज़ा खबर या वर्तमान जानकारी का अनुमान लगाकर नहीं बताऊँगा। थोड़ी देर बाद फिर कोशिश करें या सवाल को दूसरे शब्दों में पूछें।",
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
भाषा और शैली:
- उपयोगकर्ता जिस भाषा में लिखे या बोले, उसी भाषा में जवाब दो: हिंदी में पूछे तो हिंदी, English में पूछे तो English। यदि उपयोगकर्ता हिंदी और English मिलाकर बोले/लिखे, तो उसी सहज Hinglish शैली में जवाब दो। भाषा बदलने के लिए उपयोगकर्ता को सेटिंग बदलने को मत कहो।
- उपयोगकर्ता हिंदी में लिखे तो सरल, स्वाभाविक और व्याकरण-सही हिंदी में जवाब दो। भोजपुरी शब्द हों तो उन्हें समझकर सहज हिंदी/भोजपुरी में उत्तर दे सकते हो।
- सीधे सवाल का सीधा उत्तर पहले दो। फिर जरूरत के अनुसार कारण और कदम समझाओ।\n- यदि उपयोगकर्ता केवल हेलो, नमस्ते, नमस्कार या साधारण अभिवादन करे, तो छोटा स्वाभाविक अभिवादन देकर पूछो कि किस मदद की जरूरत है। ऐसे अभिवादन पर किसी पुराने विषय, खरीदारी, समाचार या वेब खोज के परिणामों का उत्तर मत दो।\n- हमेशा नवीनतम उपयोगकर्ता संदेश को प्राथमिकता दो; पुरानी बातचीत तभी जारी रखो जब संदेश उसी का संदर्भ देता हो।
- केवल एक पंक्ति में जवाब मत समेटो जब सवाल में विस्तार, तुलना या समाधान माँगा गया हो। उपयोगी उदाहरण दो, लेकिन अनावश्यक दोहराव न करो।
- उपयोगकर्ता पहले ही जो जानकारी दे चुका है, वह दोबारा मत पूछो।
- जहाँ अनिश्चितता हो, साफ बताओ; अनुमान को तथ्य मत बनाओ और नकली स्रोत/लिंक मत दो।
- वर्तमान सोने/चाँदी के भाव, शेयर, मौसम, ट्रेन स्थिति या अन्य बदलती जानकारी पूछी जाए और इंटरनेट खोज के परिणाम मिले हों, तो केवल उन्हीं परिणामों में स्पष्ट रूप से दिए गए ताज़ा आँकड़े बताओ। स्रोत में तारीख/दर स्पष्ट न हो या परिणाम आपस में न मिलें, तो कोई संख्या या तारीख अनुमान से मत बनाओ; साफ कहो कि उपलब्ध स्रोत से आज का सही भाव सत्यापित नहीं हो पाया।
- खोज परिणामों में पुरानी तारीख वाला भाव हो तो उसे आज का भाव बताकर प्रस्तुत मत करो। भारत के सोने के भाव में 22K और 24K की दर, प्रति ग्राम/10 ग्राम की इकाई और स्रोत की तारीख स्पष्ट करो, केवल जब स्रोत में ये जानकारी उपलब्ध हो।
- खोज परिणाम उपलब्ध हों तो जवाब में उनकी जानकारी का उपयोग करो, लेकिन अलग से स्रोत-सूची UI में दिखाई जा सकती है; जवाब के भीतर मनगढ़ंत स्रोतों के नाम मत जोड़ो।
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
        content: m.content.slice(0, 6000),
      }));

    if (searchResults.length) {
      for (let i = safeMessages.length - 1; i >= 0; i--) {
        if (safeMessages[i].role === "user") {
          safeMessages[i].content += buildSearchContext(searchResults);
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
      return jsonResponse({
        success: false,
        error: `AI सेवा ने HTTP ${groqResponse.status} दिया।`,
      }, 502);
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

    return jsonResponse({
      success: true,
      reply: reply.trim(),
      ...dateTime,
      webSearch: searchResults.length > 0,
      searchAttempted: wantsSearch,
      searchWarning,
      sources: searchResults.map(item => ({
        title: item.title,
        url: item.url,
      })),
    });
  },
};
