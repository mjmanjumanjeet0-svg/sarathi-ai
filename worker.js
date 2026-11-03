// Deploy refresh: use the corrected main-branch source.
const INDIA_TIME_ZONE = "Asia/Kolkata";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const SESSION_SECONDS = 12 * 60 * 60;

// The web app and Android WebView both load from this GitHub Pages origin.
const APP_ORIGIN = "https://mjmanjumanjeet0-svg.github.io";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
  "Vary": "Origin",
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


function solveBasicArithmetic(text) {
  const input = String(text || "").replace(/,/g, "");
  const match = input.match(/(?:^|[^0-9])(([0-9]+(?:[.][0-9]+)?(?:[ ]*[+−×*÷/\\-][ ]*[0-9]+(?:[.][0-9]+)?)+)(?=$|[^0-9])/);
  if (!match) return null;
  const expression = match[1].replace(/[ ]+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  const tokens = expression.match(/[0-9]+(?:[.][0-9]+)?|[()+*/-]/g) || [];
  if (tokens.join("") !== expression) return null;
  let index = 0;
  function factor() {
    const token = tokens[index++];
    if (token === "+" || token === "-") {
      const value = factor();
      return token === "-" ? -value : value;
    }
    if (!token || !/^[0-9]/.test(token)) throw new Error("number");
    return Number(token);
  }
  function product() {
    let value = factor();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = factor();
      if (operator === "/" && right === 0) throw new Error("zero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  try {
    const result = sum();
    if (index !== tokens.length || !Number.isFinite(result) || Math.abs(result) > 1e15) return null;
    const rounded = Math.round((result + Number.EPSILON) * 1e8) / 1e8;
    return { expression, result: String(rounded) };
  } catch {
    return null;
  }
}


function isDateQuestion(text) {
  return /आज की तारीख|आज कौन.?सा दिन|आज का दिन|आज डेट|आज की डेट|आज तारीख|वर्तमान तारीख|current date|today.?s date|what day is it today/i.test(text);
}

function explicitlyRequestsWebSearch(text) {
  const q = String(text || "").toLocaleLowerCase("hi-IN").trim();
  return /(?:इंटरनेट|वेब|online)\s*(?:पर\s*)?(?:खोज(?:ो|ें|ना)?|सर्च(?:ो| करें| करना)?|search(?:\s+for)?|ढूँढ(?:ो|ें)?|देख(?:ो|ें)?)/i.test(q)
    || /(?:google|गूगल)\s*(?:पर\s*)?(?:खोज(?:ो|ें)?|सर्च(?:ो| करें)?|करो|करें)/i.test(q)
    || /(?:search|खोज|सर्च|ढूँढो|ढूंढो)\s+(?:the\s+)?(?:internet|web|online|इंटरनेट|वेब)/i.test(q);
}

function shouldSearchAutomatically(text) {
  const q = String(text || "").trim();
  if (!q || q.length < 8) return false;
  if (explicitlyRequestsWebSearch(q)) return true;

  // A time word alone (for example, "आज मैं क्या करूँ?") is not a search request.
  // Require a matching changing-information topic as well.
  const recent = /(आज|अभी|वर्तमान|लेटेस्ट|ताज़ा|ताजा|नवीनतम|इस साल|इस महीने|कल|today|latest|current|202[6-9])/i.test(q);
  const news = /(खबर|समाचार|न्यूज़|न्यूज|news|breaking)/i.test(q);
  const weather = /(मौसम|तापमान|बारिश|वर्षा|weather|temperature|rain|forecast)/i.test(q);
  const travel = /(ट्रेन|रेलवे|गाड़ी|बस|फ्लाइट|प्लेटफॉर्म|train|railway|flight)/i.test(q)
    && /(कब|कितने बजे|समय|स्थिति|स्टेटस|प्लेटफॉर्म|चलेगी|आएगी|पहुंचेगी|रद्द|देरी|delay|status|schedule|when|time)/i.test(q);
  const prices = /(सोना|सोने|चांदी|चाँदी|हीरा|हीरे|भाव|कीमत|दाम|रेट|price|rate)/i.test(q)
    && (recent || /(भाव|कीमत|दाम|रेट|price|rate)/i.test(q));
  const official = /(परीक्षा तिथि|एडमिट कार्ड|प्रवेश पत्र|रिजल्ट|परिणाम|आवेदन|फॉर्म|फीस|पात्रता|सरकारी योजना|आधिकारिक|सिलेबस|पाठ्यक्रम|मान्यता|official syllabus|exam date|admit card|result|eligibility|application form)/i.test(q);
  const verification = /(किसने कहा|क्या सही है|सच है या नहीं|जांच करो|जाँच करो|सत्यापित करो|verify|fact.?check)/i.test(q);
  // Education and career pathways can change by academic session and regulator.
  const educationUpdate = /(प्रवेश|एडमिशन|admission|पात्रता|योग्यता|eligibility|फीस|शुल्क|आवेदन|फॉर्म|सिलेबस|पाठ्यक्रम|कट.?ऑफ|काउंसलिंग|मान्यता|recognition|recognized|नया कोर्स|नए कोर्स|आगामी|आने वाला|अगले सत्र|शैक्षणिक सत्र|academic session|course list|courses in india|छात्रवृत्ति|स्कॉलरशिप|scholarship|fellowship|stipend|छात्रवृत्ति योजना)/i.test(q);
  const courseCatalogQuestion = /(भारत|इंडिया|india|बिहार|राज्य|राज्यों|देश|देशभर|कौन.?कौन|कितने|सूची|list|all|available)/i.test(q)
    && /(कोर्स|courses?|डिग्री|degrees?|डिप्लोमा|diplomas?|आईटीआई|iti|पॉलिटेक्निक|polytechnic|vocational|व्यावसायिक|कौशल पाठ्यक्रम|skill courses?)/i.test(q);
  const regulatedCareerPath = /(डॉक्टर|चिकित्सक|इंजीनियर|वकील|अधिवक्ता|नर्स|शिक्षक|फार्मासिस्ट|आर्किटेक्ट|पायलट|वेटरिनरी|पशु.?चिकित्सक|दंत.?चिकित्सक|फिजियोथेरेपिस्ट|सीए|चार्टर्ड अकाउंटेंट|doctor|physician|engineer|lawyer|advocate|nurse|teacher|pharmacist|architect|pilot|veterinarian|dentist|physiotherapist|chartered accountant)/i.test(q)
    && /(बनने|बनना|कैसे बने|कैसे बनें|क्या पढ़ें|कौन.?सा विषय|कोर्स|परीक्षा|योग्यता|पात्रता|career|become|pathway|study|admission)/i.test(q);
  const education = educationUpdate || courseCatalogQuestion || regulatedCareerPath;

  return (recent && (news || weather || travel || prices))
    || weather
    || travel
    || prices
    || official
    || verification
    || education
    || isHistoricalResearchQuery(q);
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
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || !hostname || url.username || url.password) return false;
    // Reject local names and all IP literals. Search enrichment should fetch
    // public DNS hostnames only, never loopback, private, link-local or metadata IPs.
    if (hostname === "localhost" || hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") || hostname.endsWith(".internal") ||
        hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
async function searchInternet(query, env) {
  const searchQuery = String(query || "").trim().slice(0, 1024);
  if (!searchQuery) return { results: [], warning: "खोज का सवाल खाली है।" };

  // Use only the explicitly configured Exa provider. Exa usage may be metered
  // by its account plan; never silently fall back to Cloudflare AI Gateway or
  // another provider that could create separate charges.
  if (!env.EXA_API_KEY) {
    return {
      results: [],
      warning: "Exa सर्च की API Key उपलब्ध नहीं है। Cloudflare में EXA_API_KEY Secret की जाँच आवश्यक है।",
      errorCode: "MISSING_API_KEY",
      retryable: false
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const isNewsQuery = /(खबर|समाचार|news|breaking|latest|ताज़ा|ताजा)/i.test(searchQuery);
    const isPreciousMetalQuery = /(gold|सोना|सोने|silver|चांदी|चाँदी|bullion|22K|24K)/i.test(searchQuery);
    const isEducationQuery = /(कोर्स|पाठ्यक्रम|डिग्री|डिप्लोमा|प्रवेश|admission|पात्रता|योग्यता|eligibility|सिलेबस|मान्यता|शैक्षणिक सत्र|academic session|डॉक्टर|इंजीनियर|नर्स|शिक्षक|फार्मासिस्ट|doctor|engineer|nurse|teacher|pharmacist|course|career pathway|छात्रवृत्ति|स्कॉलरशिप|scholarship|fellowship|stipend)/i.test(searchQuery);
    const requestBody = {
      query: searchQuery,
      type: "auto",
      // Education queries need a broader candidate pool to compare official notices.
      numResults: isHistoricalResearchQuery(searchQuery) ? 15 : (isNewsQuery || isPreciousMetalQuery || isEducationQuery ? 8 : 5),
      contents: { highlights: true }
    };
    if (isHistoricalResearchQuery(searchQuery)) {
      // Prefer primary archives and scholarly publishers for historical research.
      requestBody.includeDomains = [
        "history.state.gov", "loc.gov", "archives.gov", "iupress.indiana.edu",
        "cambridge.org", "oxfordreference.com", "oup.com", "jstor.org",
        "tandfonline.com", "worldhistory.org", "britannica.com",
        "history.com", "miami.edu", "preslib.ru"
      ];
    }
    if (isEducationQuery) {
      // Hard-scope current education facts to official government, regulator,
      // board, university, and recognized professional-body domains.
      requestBody.includeDomains = [
        "*.gov.in", "*.nic.in", "*.ac.in", "*.edu.in",
        "ugc.gov.in", "aicte-india.org", "nmc.org.in", "nta.ac.in",
        "ncvet.gov.in", "nqr.gov.in", "ncte.gov.in", "icar.gov.in",
        "pci.nic.in", "indiannursingcouncil.org", "barcouncilofindia.org",
        "coa.gov.in", "rehabcouncil.nic.in", "dciindia.gov.in",
        "ncismindia.org", "nch.org.in", "vci.dadf.gov.in",
        "cisce.org", "upsc.gov.in", "ssc.gov.in", "ibps.in"
      ];
    }
    if (isNewsQuery) {
      requestBody.category = "news";
      const now = new Date();
      const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      requestBody.startPublishedDate = since.toISOString();
      requestBody.endPublishedDate = now.toISOString();
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
      else if (response.status === 402) warning = "Exa खाते के क्रेडिट या प्लान की उपलब्ध सीमा पूरी हो गई है। कोई दूसरा सर्च प्रदाता अपने-आप चालू नहीं होगा। Exa के उपयोग पर आपके खाते के प्लान के अनुसार शुल्क लग सकता है।";
      else if (response.status === 429) warning = "Exa सर्च की अनुरोध सीमा पूरी हो गई है। थोड़ी देर बाद प्रयास करें।";
      else if (response.status >= 500) warning = "Exa सर्च सेवा अभी उपलब्ध नहीं है। थोड़ी देर बाद प्रयास करें।";
      return {
        results: [],
        warning,
        errorCode: tag || (response.status === 401 || response.status === 403 ? "INVALID_API_KEY" : response.status === 402 ? "NO_MORE_CREDITS" : response.status === 429 ? "RATE_LIMIT_EXCEEDED" : "HTTP_ERROR"),
        httpStatus: response.status,
        retryable: response.status === 429 || response.status >= 500
      };
    }
    const items = Array.isArray(payload?.results) ? payload.results : [];
    const results = items
      .filter(item => item && typeof item.title === "string" && typeof item.url === "string" && validHttpUrl(item.url))
      .slice(0, isHistoricalResearchQuery(searchQuery) ? 15 : (isNewsQuery ? 8 : 5))
      .map(item => {
        let publisher = "वेबसाइट";
        try { publisher = new URL(item.url).hostname.replace(/^www\./i, ""); } catch {}
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
    const timedOut = error?.name === "AbortError";
    return {
      results: [],
      warning: timedOut ? "Exa सर्च में समय अधिक लगा। थोड़ी देर बाद फिर प्रयास करें।" : "Exa सर्च सेवा से संपर्क नहीं हो सका। नेटवर्क कनेक्शन जाँचकर फिर प्रयास करें।",
      errorCode: code || (timedOut ? "TIMEOUT" : "NETWORK_ERROR"),
      httpStatus: timedOut ? 504 : 502,
      retryable: true
    };
  } finally {
    clearTimeout(timeout);
  }
}
async function enrichGoldRateResults(results) {
  const candidates = (Array.isArray(results) ? results : []).slice(0, 6);
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
        // Do not follow provider-supplied redirects while fetching third-party pages.
        redirect: "manual"
      });
      if (!response.ok) return item;
      const html = (await response.text()).slice(0, 1200000);
      const visible = cleanText(html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&#8377;|&#x20b9;/gi, "₹"));
      const contexts = [];
      const labelPattern = /(?:22\s*(?:k|karat|carat)|24\s*(?:k|karat|carat)|22 कैरेट|24 कैरेट|999(?:\s*(?:fine\s*)?silver)?|silver\s*999|चाँदी|चांदी)/gi;
      let match;
      while ((match = labelPattern.exec(visible)) && contexts.length < 14) {
        const context = visible.slice(Math.max(0, match.index - 120), Math.min(visible.length, match.index + 260)).replace(/\s+/g, " ").trim();
        if (/(₹|rs\.?|inr|रुपये|रु\.?)/i.test(context) && /[0-9][0-9,]*(?:\.[0-9]+)?/.test(context)) contexts.push(context);
      }
      if (!contexts.length) return item;
      const combined = [item.title || "", item.snippet || "", ...contexts].join(" | ");
      const rateFor = (karat) => {
        const re = new RegExp("(?:\\b" + karat + "\\s*(?:K|karat|carat)|" + karat + "\\s*कैरेट)[^₹]{0,120}(?:₹|Rs\\.?|INR)\\s*([0-9,]+(?:\\.[0-9]+)?)", "i");
        const m = combined.match(re);
        return m ? Number(m[1].replace(/,/g, "")) : null;
      };
      const goldRates = { per10g22K: rateFor(22), per10g24K: rateFor(24) };
      const silverMatch = combined.match(/(?:999(?:\s*(?:fine\s*)?silver)?|silver\s*999|चाँदी|चांदी)[^₹]{0,120}(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]+)?)/i);
      const silverRate = silverMatch ? Number(silverMatch[1].replace(/,/g, "")) : null;
      return {
        ...item,
        goldRates: (goldRates.per10g22K || goldRates.per10g24K) ? goldRates : null,
        silverRate: silverRate || null,
        rateContexts: [...new Set(contexts)].slice(0, 10),
        snippet: (item.snippet ? item.snippet + " | " : "") +
          "पेज से मिला मूल्य-संदर्भ: " + [...new Set(contexts)].join(" || ").slice(0, 2400)
      };
    } catch {
      return item;
    } finally {
      clearTimeout(timeout);
    }
  }));
}

function isHistoricalResearchQuery(query) {
  return /(खूनी रविवार|bloody sunday|रूसी क्रांति|रूस की क्रांति|1905 की क्रांति|रूसी इतिहास|ऐतिहासिक घटना|ऐतिहासिक महत्व|russian revolution|1905 revolution)/i.test(String(query || ""));
}

function historicalSourceRank(item) {
  try {
    const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, "");
    // Primary repositories, national archives, libraries, and university domains.
    if (/\.(gov|gov\.in|nic\.in|edu|ac\.in|ac\.uk)$/.test(host) ||
        /(^|\.)(loc\.gov|archives\.gov|nationalarchives\.gov\.uk|encspb\.ru|preslib\.ru|prlib\.ru)$/.test(host)) return 4;
    // Established academic publishers, reference works, and scholarly databases.
    if (/(^|\.)(oup\.com|oxfordreference\.com|cambridge\.org|jstor\.org|iupress\.indiana\.edu|press\.princeton\.edu|ebsco\.com|worldhistory\.org|britannica\.com|encyclopedia\.com|history\.com)$/.test(host)) return 3;
    // Reputable reporting and museum/science institutions for contextual coverage.
    if (/(^|\.)(reuters\.com|apnews\.com|bbc\.com|theguardian\.com|nytimes\.com|indianexpress\.com|thehindu\.com|smithsonianmag\.com|nationalgeographic\.com|historytoday\.com|tandfonline\.com)$/.test(host)) return 2;
    return 0;
  } catch {
    return 0;
  }
}

function filterHistoricalSources(query, results) {
  const list = Array.isArray(results) ? results : [];
  const isBloodySunday = /(खूनी रविवार|bloody sunday)/i.test(String(query || ""));
  const topicPattern = isBloodySunday
    ? /(bloody sunday|खूनी रविवार|1905|st\.? ?petersburg|saint petersburg|russia|रूस|петербург)/i
    : null;
  const ranked = list
    .map(item => ({ item, rank: historicalSourceRank(item) }))
    .filter(({ item, rank }) => {
      if (rank < 2) return false;
      const searchable = `${item.title || ""} ${item.snippet || ""}`;
      return !topicPattern || topicPattern.test(searchable);
    })
    .sort((a, b) => b.rank - a.rank);
  const seenUrls = new Set();
  const seenPublishers = new Set();
  const accepted = [];
  for (const { item } of ranked) {
    try {
      const url = new URL(item.url);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const publisherKey = host.endsWith(".iupress.indiana.edu") || host === "iupress.indiana.edu"
        ? "iupress.indiana.edu"
        : host.endsWith(".ebsco.com") || host === "ebsco.com"
          ? "ebsco.com"
          : host.endsWith(".worldhistory.org") || host === "worldhistory.org"
            ? "worldhistory.org"
            : host.endsWith(".britannica.com") || host === "britannica.com"
              ? "britannica.com"
              : host;
      url.hash = "";
      url.search = "";
      const canonicalUrl = url.toString().replace(/\/$/, "");
      if (!host || seenUrls.has(canonicalUrl) || seenPublishers.has(publisherKey)) continue;
      seenUrls.add(canonicalUrl);
      seenPublishers.add(publisherKey);
      accepted.push(item);
      if (accepted.length >= 6) break;
    } catch {
      // Invalid URLs are never presented as historical sources.
    }
  }
  return accepted;
}

function historicalPublisherName(item) {
  let host = "";
  try { host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
  const names = {
    "publish.iupress.indiana.edu": "Indiana University Press",
    "iupress.indiana.edu": "Indiana University Press",
    "www.ebsco.com": "EBSCO",
    "ebsco.com": "EBSCO",
    "www.worldhistory.org": "World History Encyclopedia",
    "worldhistory.org": "World History Encyclopedia",
    "guides.loc.gov": "Library of Congress",
    "loc.gov": "Library of Congress",
    "history.state.gov": "U.S. Department of State, Office of the Historian",
    "www.britannica.com": "Encyclopaedia Britannica",
    "britannica.com": "Encyclopaedia Britannica"
  };
  return names[host] || item.publisher || host || "प्रकाशक उपलब्ध नहीं";
}

function buildBloodySundayVerifiedReply(results) {
  const items = (Array.isArray(results) ? results : []).slice(0, 6);
  const casualtyNotes = [];
  for (const item of items) {
    const evidence = `${item.title || ""} ${item.snippet || ""}`;
    if (/at least 130|130 demonstrators|130 killed/i.test(evidence)) {
      casualtyNotes.push(`${historicalPublisherName(item)} के उपलब्ध विवरण में कम-से-कम 130 मृतकों का उल्लेख है`);
    }
    if (/1,000|1000|over 1,000/i.test(evidence)) {
      casualtyNotes.push(`${historicalPublisherName(item)} के उपलब्ध अंश में लगभग 1,000 या उससे अधिक मौतों का अनुमान मिलता है`);
    }
  }
  const uniqueCasualtyNotes = [...new Set(casualtyNotes)];
  const casualtyText = uniqueCasualtyNotes.length
    ? "मृतकों की संख्या पर स्रोतों में बड़ा अंतर है: " + uniqueCasualtyNotes.join("; ") + "। ये अलग-अलग स्रोतों के अनुमान हैं, किसी एक सर्वमान्य आधिकारिक कुल संख्या का प्रमाण नहीं। इसलिए 90–100 जैसी निश्चित संख्या बताना उचित नहीं होगा।"
    : "मृतकों की सटीक संख्या पर उपलब्ध स्वतंत्र स्रोतों से एक सर्वमान्य आँकड़ा प्रमाणित नहीं होता। इसलिए कोई निश्चित संख्या बताना उचित नहीं होगा।";
  const publisherCount = new Set(items.map(historicalPublisherName)).size;
  const sourceNote = publisherCount >= 3
    ? `नीचे ${publisherCount} अलग-अलग प्रकाशकों के स्रोत दिए गए हैं।`
    : `चेतावनी: इस खोज में केवल ${publisherCount} अलग-अलग प्रकाशक मिले। कम-से-कम तीन स्वतंत्र प्रकाशकों से पुष्टि नहीं हो सकी; इसलिए इसे तीन-स्रोत सत्यापन न मानें।`;

  return "खूनी रविवार (Bloody Sunday) 1905 रूस के सेंट पीटर्सबर्ग में हुई एक ऐतिहासिक गोलीबारी थी। इसकी तारीख 22 जनवरी 1905 ग्रेगोरियन कैलेंडर के अनुसार थी; रूस में उस समय लागू जूलियन कैलेंडर के अनुसार यही तारीख 9 जनवरी 1905 थी।\n\n" +
    "फादर जॉर्जी गैपोन के नेतृत्व में मजदूरों और उनके परिवारों का शांतिपूर्ण जुलूस अपनी शिकायतों और सुधारों की याचिका ज़ार निकोलस द्वितीय तक पहुँचाने के लिए Winter Palace की ओर बढ़ा। सैनिकों ने प्रदर्शनकारियों पर गोलीबारी की। इसे दंगा कहना गलत है; यह शांतिपूर्ण याचिका-जुलूस पर की गई गोलीबारी थी।\n\n" +
    "परिणाम: गोलीबारी से रूस में व्यापक आक्रोश और हड़तालें फैलीं तथा 1905 की रूसी क्रांति को गति मिली।\n\n" +
    "मृतकों की संख्या: " + casualtyText + "\n\n" +
    sourceNote;
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

  // Combined gold + silver queries must retain results for both metals.
  if (/(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(q) && /(चांदी|चाँदी|silver)/i.test(q)) {
    const preciousMetal = /(gold|सोना|सोने|sone|bullion|22\s*k|24\s*k|gold[- ]?rate|gold[- ]?price|sona|silver|चांदी|चाँदी|silver[- ]?(rate|price)|चांदी[- ]?(भाव|कीमत))/i;
    return list.filter(item => preciousMetal.test(textOf(item)));
  }

  let required = null;
  if (/(प्रधानमंत्री|prime minister|president|राष्ट्रपति|मुख्यमंत्री|chief minister)/i.test(q)) {
    required = /(prime minister|प्रधानमंत्री|narendra modi|नरेंद्र मोदी|president|राष्ट्रपति|chief minister|मुख्यमंत्री)/i;
  } else if (/(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(q)) {
    required = /(gold|सोना|सोने|sone|bullion|22\s*k|24\s*k|gold[- ]?rate|gold[- ]?price|sona|ज्वेलरी|jewellery)/i;
  } else if (/(चांदी|चाँदी|silver)/i.test(q)) {
    required = /(silver|चांदी|चाँदी|bullion|silver[- ]?(rate|price)|चांदी[- ]?(भाव|कीमत))/i;
  } else if (/(हीरा|हीरे|हीरों|diamond)/i.test(q)) {
    required = /(diamond|हीरा|हीरे|carat|4cs|clarity|cut|color)/i;
  } else if (/(मौसम|weather|तापमान|temperature)/i.test(q)) {
    required = /(weather|मौसम|temperature|forecast|तापमान)/i;
  } else if (/(ट्रेन|रेल|train|railway|पीएनआर|pnr)/i.test(q)) {
    required = /(train|railway|रेल|ट्रेन|pnr|indianrail)/i;
  }

  return required ? list.filter(item => required.test(textOf(item))) : list;
}

function dedupeNewsResults(results) {
  // Apply deterministic, conservative headline-level event grouping before the model sees results.
  const seenUrls = new Set();
  const accepted = [];
  const stopWords = new Set([
    "आज", "कल", "अब", "यह", "इस", "की", "का", "के", "से", "को", "पर", "में",
    "और", "एक", "लिए", "बाद", "साथ", "द्वारा", "बारे", "बड़ा", "बड़ी", "बड़ी",
    "latest", "news", "live", "update", "updates", "breaking", "india", "today",
    "says", "said", "after", "over", "for", "the", "a", "an", "to", "of", "in",
    "on", "at", "as", "with", "from", "by", "all", "new", "what", "how"
  ]);
  const tokensFor = value => new Set(
    cleanText(value || "").toLocaleLowerCase("hi-IN")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter(token => token.length > 1 && !stopWords.has(token))
  );
  for (const item of (Array.isArray(results) ? results : [])) {
    let urlKey = "";
    try {
      const u = new URL(item.url);
      u.hash = "";
      u.search = "";
      urlKey = u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/$/, "");
    } catch {}
    if (urlKey && seenUrls.has(urlKey)) continue;
    const titleTokens = tokensFor(item.title);
    if (!titleTokens.size) continue;
    const duplicateEvent = accepted.some(previous => {
      const previousTokens = previous._dedupeTokens;
      let shared = 0;
      for (const token of titleTokens) if (previousTokens.has(token)) shared++;
      const smaller = Math.min(titleTokens.size, previousTokens.size);
      const overlap = smaller ? shared / smaller : 0;
      // Conservative event-level match: require at least three meaningful shared
      // terms and near-complete coverage of the shorter headline to avoid
      // collapsing unrelated stories that merely mention the same institution.
      return shared >= 3 && overlap >= 0.8;
    });
    if (duplicateEvent) continue;
    if (urlKey) seenUrls.add(urlKey);
    accepted.push({ ...item, _dedupeTokens: titleTokens });
    if (accepted.length >= 8) break;
  }
  return accepted.map(({ _dedupeTokens, ...item }) => item);
}
function dedupeNewsPublishers(results) {
  // Keep at most one article per publisher in the compact daily-news source set.
  // Collapse subdomains (for example, hindi.news18.com and news18.com) so
  // repeated coverage from one newsroom is not presented as independent news.
  const multiPartSuffixes = new Set([
    "co.in", "com.in", "net.in", "org.in", "gov.in", "ac.in",
    "co.uk", "org.uk", "com.au", "net.au", "co.nz", "com.sg",
    "com.br", "com.cn", "com.hk", "co.za"
  ]);
  const seenPublishers = new Set();
  const accepted = [];
  for (const item of (Array.isArray(results) ? results : [])) {
    try {
      const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, "");
      const labels = host.split(".").filter(Boolean);
      if (labels.length < 2) continue;
      const suffix2 = labels.slice(-2).join(".");
      const publisherKey = multiPartSuffixes.has(suffix2)
        ? labels.slice(-3).join(".")
        : suffix2;
      if (seenPublishers.has(publisherKey)) continue;
      seenPublishers.add(publisherKey);
      accepted.push(item);
      if (accepted.length >= 6) break;
    } catch {
      // Invalid URLs are excluded from the displayed news source set.
    }
  }
  return accepted;
}

function filterFreshNewsResults(results, now = Date.now()) {
  const oldestAllowed = now - 48 * 60 * 60 * 1000;
  return (Array.isArray(results) ? results : []).filter(item => {
    const publishedAt = item && typeof item.publishedAt === "string" ? item.publishedAt.trim() : "";
    // Current-news lists must have a parseable publication date; unknown dates
    // cannot be safely presented as fresh, and future dates are excluded.
    if (!publishedAt) return false;
    const timestamp = Date.parse(publishedAt);
    if (!Number.isFinite(timestamp)) return false;
    return timestamp >= oldestAllowed && timestamp <= now;
  });
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
  return "आज की खबरों की खोज में " + items.length + " स्रोत मिले, लेकिन उनका भरोसेमंद हिंदी सार तैयार नहीं हो पाया। इसलिए अंग्रेज़ी लेखों को ज्यों-का-त्यों दिखाने या अधूरी जानकारी को खबर बताने के बजाय मैं इस बार अपुष्ट सार नहीं दे रहा हूँ। कृपया थोड़ी देर बाद फिर पूछें।";
}

function buildProviderBusySearchFallback(results, query, reason = "AI सेवा इस समय व्यस्त है, इसलिए खोज परिणामों का विस्तृत सार तैयार नहीं हो सका।") {
  const items = (Array.isArray(results) ? results : []).slice(0, 5);
  if (!items.length) return "";
  const lines = items.map((item, index) => {
    const snippet = cleanText(item.snippet || "").slice(0, 500);
    const publisher = item.publisher || "प्रकाशक उपलब्ध नहीं";
    const published = item.publishedAt || "प्रकाशित तारीख उपलब्ध नहीं";
    return (index + 1) + ". " + item.title + "\nप्रकाशक: " + publisher +
      "\nप्रकाशित: " + published +
      (snippet ? "\nउपलब्ध जानकारी: " + snippet : "\nविस्तृत जानकारी स्रोत पर देखें।");
  });
  return reason + " नीचे इंटरनेट खोज में मिले वास्तविक परिणाम दिए जा रहे हैं। इन्हें पढ़ते समय स्रोत और तारीख जाँचें; अधूरी जानकारी को अंतिम पुष्टि न मानें।\n\n" +
    lines.join("\n\n");
}

function buildSearchContext(results, query = "") {
  if (!results.length) return "";

  const isNewsQuery = /(खबर|समाचार|news|breaking|latest|ताज़ा|ताजा)/i.test(query);
  const isPreciousMetalQuery = /(सोने|सोना|gold|चांदी|चाँदी|silver|bullion|22\s*k|24\s*k)/i.test(query);
  const isHistoricalQuery = isHistoricalResearchQuery(query);
  const historyInstruction = isHistoricalQuery
    ? "\\n\\nइतिहास और स्रोत-जाँच के सख्त निर्देश: केवल दिए गए खोज परिणामों के शीर्षक और उपलब्ध अंश से पुष्ट तथ्य लिखो। किसी एक स्रोत के अनुमान को सर्वमान्य तथ्य मत बताओ। तारीख, स्थान, व्यक्तियों और घटनाक्रम में स्रोतों का मेल जाँचो। खूनी रविवार (1905) पर 22 जनवरी 1905 ग्रेगोरियन और 9 जनवरी 1905 जूलियन कैलेंडर का अंतर स्पष्ट करो, यदि स्रोत इसकी पुष्टि करते हों। प्रदर्शनकारियों का लक्ष्य Winter Palace था; गोलीबारी कहाँ हुई, यह स्रोत के अनुसार सावधानी से लिखो और महल के ठीक सामने ही हुई ऐसा बिना प्रमाण मत कहो। मृतकों/घायलों की संख्या को विवादित बताओ; तत्कालीन सरकारी/राजनयिक रिपोर्ट, समकालीन समाचार और बाद के इतिहासकारों के अनुमान अलग-अलग रखो। लगभग 1,000 या 1,200 को निश्चित संख्या मत बताओ। कम-से-कम दो स्वतंत्र, विषय-संबंधित भरोसेमंद स्रोत उपलब्ध हों तभी बहु-स्रोत पुष्टि का दावा करो। हर स्रोत का वास्तविक शीर्षक, प्रकाशक/संस्था और उपलब्ध तारीख बताओ; लिंक केवल खोज परिणाम के वास्तविक URL से लो। Wikipedia, सामान्य ब्लॉग, SEO/परीक्षा-क्विज़ एग्रीगेटर या असंबंधित पेज को प्रामाणिक ऐतिहासिक प्रमाण मत मानो। स्रोत में जानकारी न हो तो सामान्य ज्ञान से खाली जगह मत भरो।"
    : "";
  const newsInstruction = isNewsQuery
    ? "\\n\\nसमाचार के सख्त निर्देश: एक ही घटना को केवल एक बार बताओ; समान रिपोर्ट को जोड़ो, लेकिन अलग घटनाओं को मत मिलाओ। हर खोज परिणाम को उसके क्रमांक (1, 2, 3...) से पहचानो। किसी खबर का हर तथ्य—कौन, क्या, कहाँ, कब, संख्या और असर—उसी एक परिणाम के शीर्षक/अंश से समर्थित होना चाहिए; अलग-अलग परिणामों के अधूरे अंश जोड़कर एक नई घटना या कहानी मत बनाओ। खबर के अंत में केवल उसी परिणाम के प्रकाशक और क्रमांक को स्रोत बताओ। यदि किसी तथ्य के लिए दूसरा स्वतंत्र स्रोत भी वही बात स्पष्ट रूप से कहता है, तभी दोनों स्रोत लिखो; केवल एक ही घटना पर अलग शीर्षक होना पुष्टि नहीं है। प्रकाशित तारीख केवल प्रकाशित फ़ील्ड से लो; घटना की तारीख केवल खबर के पाठ से लो। तारीख उपलब्ध न हो या अमान्य हो तो उसे आज की खबर बताकर शामिल मत करो। आज की खबरों में केवल पिछले 48 घंटों में प्रकाशित और वर्तमान समय से आगे की तारीख न रखने वाले परिणाम शामिल करो। एक ही एजेंसी की कॉपी को स्वतंत्र पुष्टि मत मानो। राजनीतिक आरोपों को आरोप के रूप में ही लिखो। हर खबर के तथ्य केवल उसी परिणाम के शीर्षक और उपलब्ध जानकारी वाले अंश से लो; अपनी सामान्य जानकारी, अनुमान या दूसरी खबर के आधार पर कोई अतिरिक्त घटना, स्थान, संख्या, नुकसान, उड़ान रद्द होने या असर का दावा मत जोड़ो। यदि अंश में घटना केवल संभावित/पूर्वानुमानित है तो उसे हो चुकी घटना की तरह मत लिखो; साफ बताओ कि यह चेतावनी या पूर्वानुमान है। शीर्षक अकेला हो और अंश में विवरण न हो तो केवल शीर्षक का संक्षिप्त परिचय दो या खबर छोड़ दो। एक तथ्य का स्रोत स्पष्ट न हो तो उसे शामिल मत करो। यदि दो परिणाम एक ही तथ्य पर अलग-अलग संख्या, तारीख, स्थान या स्थिति बताते हैं, तो किसी एक को चुपचाप सही मत चुनो और दोनों को जोड़कर नया आँकड़ा मत बनाओ; अंतर को साफ तौर पर संबंधित प्रकाशकों के नाम/क्रमांक के साथ बताओ, या उस विवादित तथ्य को छोड़ दो। मौत, घायल, नुकसान, गिरफ्तारी और प्रभावित लोगों की संख्या तभी लिखो जब उसी परिणाम के अंश में संख्या स्पष्ट हो; केवल शीर्षक, दूसरे परिणाम या सामान्य जानकारी से संख्या मत निकालो। स्रोत में संख्या न हो तो संख्या मत दो। यदि परिणामों के प्रकाशित समय अलग हों, तो पुराने आँकड़े को वर्तमान स्थिति की तरह मत दिखाओ; उपलब्ध समय बताओ और नवीनतम स्थिति की पुष्टि न होने पर स्पष्ट कहो। शेयर बाजार के लिए कारोबार की स्थिति और समय का विशेष ध्यान रखो: खुला, सुबह कारोबार कर रहा है, इंट्राडे उच्च स्तर, बंद हुआ और समापन स्तर अलग-अलग बातें हैं। यदि स्रोत सुबह/खुलने के समय का है तो Sensex/Nifty के आँकड़ों को कभी बंद हुआ या दिन का अंतिम स्तर मत लिखो; केवल सुबह के कारोबार में या शुरुआती कारोबार में कहो। बाजार बंद होने का दावा तभी करो जब स्रोत स्पष्ट रूप से उसी कारोबारी दिन का closing/समापन स्तर बताए और समय/तारीख मेल खाए। विरोधी या समय-संदर्भ-विहीन आँकड़े हों तो संख्या छोड़ दो और सीमा बताओ। चक्रवात, मौसम, दुर्घटना और सरकारी आदेश में चेतावनी/पूर्वानुमान को घटित घटना न बताओ; प्रभावित स्थान, क्षति, मौत या बचाव का दावा तभी करो जब उसी खबर के अंश में साफ लिखा हो। एक खबर के अंश से दूसरी खबर का तथ्य जोड़कर नई कहानी मत बनाओ। उपलब्ध परिणामों में से अधिकतम 8 अलग और महत्वपूर्ण खबरें चुनो। हर खबर में 2–4 छोटे वाक्यों का स्वाभाविक हिंदी विवरण, प्रकाशक और प्रकाशित तारीख दो। हिंदी सवाल पर पूरा उत्तर सहज देवनागरी हिंदी में दो; अंग्रेज़ी शीर्षक, अंग्रेज़ी लेख का अंश या मेटाडेटा ज्यों-का-त्यों बिल्कुल मत छोड़ो। अंग्रेज़ी स्रोत को समझकर अपने शब्दों में हिंदी में सार लिखो। कम से कम 2 उपयोगी परिणाम न हों तो खबरों की संख्या बढ़ाकर मत दिखाओ। URL मत लिखो और कोई तथ्य मत गढ़ो।"
    : "";
  const preciousMetalInstruction = isPreciousMetalQuery
    ? "\\n\\nसोना-चाँदी भाव उत्तर का अनिवार्य प्रारूप: उत्तर अधूरा मत छोड़ो। पहले तारीख और हर स्रोत का प्रकाशित/अपडेट समय बताओ; समय उपलब्ध न हो तो 'अपडेट समय उपलब्ध नहीं' लिखो। अलग-अलग प्रकाशकों के कम-से-कम 2 स्वतंत्र स्रोतों का मिलान करो; अगर 2 न हों तो यह सीमा साफ बताओ और एक स्रोत को पक्का भाव मत कहो। फिर साफ सूची/तालिका दो: धातु | शुद्धता | भाव | इकाई | शहर/बाजार | स्रोत | अपडेट समय। सोने के लिए 24 कैरेट और 22 कैरेट (24K/22K) तथा चाँदी के लिए 999 शुद्धता अलग-अलग दिखाओ। स्रोत में स्पष्ट रूप से प्रति 10 ग्राम लिखा हो तभी वही भाव प्रति 10 ग्राम बताओ। स्रोत में प्रति ग्राम लिखा हो तो प्रति 10 ग्राम का भाव केवल उसी संख्या को 10 से गुणा करके निकालो और उसके आगे '(गणना: प्रति ग्राम × 10)' लिखो। स्रोत में प्रति 10 ग्राम और प्रति ग्राम दोनों दिए हों तो दोनों का गणित मिलाओ; मेल न खाने पर उनमें से किसी एक को चुपचाप सही मत चुनो—विसंगति बताओ और केवल स्पष्ट मूल इकाई वाला आंकड़ा दो। चाँदी के लिए प्रति किलो और प्रति ग्राम का मिलान भी जाँचो (प्रति ग्राम × 1000 = प्रति किलो)। यदि स्रोत प्रति किलो ₹1,79,120 और प्रति ग्राम लगभग ₹179 दिखाता है, तो ₹179 को पूर्ण/सटीक दर मत मानो: सटीक समतुल्य ₹179.12 प्रति ग्राम है; ₹179 केवल निकटतम रुपये में गोल किया गया मान है। इसी तरह सोने में प्रति 10 ग्राम की दर से प्रति ग्राम निकालते समय जरूरत हो तो दो दशमलव तक दिखाओ। किसी गोल किए गए प्रति ग्राम मान को वापस गुणा करके मूल प्रति किलो/10 ग्राम भाव बदलकर मत बताओ; स्रोत की मूल प्रकाशित दर को प्राथमिकता दो और गोलाई स्पष्ट लिखो। हर गणना दोबारा जाँचो: 13,888 × 10 = 1,38,880; 12,730 × 10 = 1,27,300; 179 × 1000 = 1,79,000। गणना के परिणाम को स्रोत का प्रकाशित भाव मत बताओ। 22K/24K/999 की शुद्धता आपस में मत मिलाओ। शहर का नाम न हो तो शहर मत गढ़ो। अलग स्रोतों के भाव अलग हों तो स्रोत, समय और इकाई सहित अलग-अलग बताओ; औसत या एक पक्का राष्ट्रीय भाव मत बनाओ। खुदरा भाव, IBJA बेंचमार्क और MCX वायदा को एक जैसा मत बताओ। GST और मेकिंग चार्ज को मूल धातु भाव से अलग रखो। स्रोत में संख्या/इकाई स्पष्ट न हो तो 'स्पष्ट भाव उपलब्ध नहीं' लिखो; अनुमान, खाली पंक्ति या काल्पनिक कीमत बिल्कुल मत बनाओ। अंत में स्रोतों के नाम बताओ।"
    : "";

  return "\n\nइंटरनेट खोज के परिणाम:\n" + results.map(
    (item, i) =>
      `${i + 1}. ${item.title}\nप्रकाशक: ${item.publisher || "उपलब्ध नहीं"}\nप्रकाशित: ${isNewsQuery ? formatNewsPublishedAt(item.publishedAt) : (item.publishedAt || "तारीख उपलब्ध नहीं")}${isHistoricalQuery ? `\nवास्तविक स्रोत URL: ${item.url}` : ""}\nजानकारी: ${item.snippet || "जानकारी उपलब्ध नहीं है।"}`
  ).join("\n\n") +
  "\n\nपरिणाम पर्याप्त न हों तो स्पष्ट बताओ। तथ्य या लिंक मत गढ़ो।" + newsInstruction + preciousMetalInstruction + historyInstruction;
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
          image: "POST /api/media/image (disabled in zero-cost mode)",
          understand: "POST /api/media/understand (disabled in zero-cost mode)",
          zeroCostMode: true
        }
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "अनुरोध उपलब्ध नहीं है। API के लिए POST अनुरोध भेजें।" }, 405);
    }

    if (url.pathname !== "/api/login" && url.pathname !== "/api/chat" && url.pathname !== "/api/media/image" && url.pathname !== "/api/media/understand") {
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

    // ZERO-COST MODE: media generation/understanding are deliberately disabled.
    // Return the true feature status before authentication so the UI never
    // mislabels this as an expired login session.
    if (url.pathname === "/api/media/image" || url.pathname === "/api/media/understand") {
      return jsonResponse({
        success: false,
        zeroCostMode: true,
        error: "AI फोटो बनाना और फोटो/वीडियो समझना फिलहाल बंद है। यह लॉगिन की समस्या नहीं है।"
      }, 503);
    }

    // Protect chat requests with the signed 12-hour login token.
    // The media endpoints above intentionally return their disabled status before auth.
    if (!env.SARATHI_LOGIN_PASSWORD) {
      return jsonResponse({ success: false, error: "लॉगिन Secret सेट नहीं है।" }, 500);
    }

    const authorization = request.headers.get("Authorization") || "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    if (!bearer || !(await verifyToken(bearer[1], env.SARATHI_LOGIN_PASSWORD))) {
      return jsonResponse({
        success: false,
        error: "लॉगिन सत्र समाप्त या अमान्य है। कृपया दोबारा लॉगिन करें।"
      }, 401);
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

    if (/^(?:बुध|बूध|बुद्ध|budh|buddha)(?:\s+(?:के बारे में|की जानकारी|बताओ|बताइए|कौन हैं?|क्या है))?\s*[?।.!]*$/i.test(userText)) {
      return jsonResponse({
        success: true,
        reply: "आप किसके बारे में जानना चाहते हैं?\n1. गौतम बुद्ध — बौद्ध धर्म के प्रवर्तक।\n2. बुध ग्रह — सूर्य के सबसे निकट ग्रह।\n3. बुधवार — सप्ताह का एक दिन।\nइनमें से कौन-सा विषय बताऊँ?",
        ...dateTime,
        webSearch: false,
        sources: []
      });
    }

    if (isDateQuestion(userText)) {
      return jsonResponse({
        success: true,
        reply: `आज की तारीख ${dateTime.date} है। आज ${dateTime.weekday} है। भारतीय समय ${dateTime.time} है।`,
        ...dateTime,
        webSearch: false,
        sources: [],
      });
    }

    // Basic arithmetic is deterministic: solve locally and never spend search/AI requests.
    const arithmetic = solveBasicArithmetic(userText);
    if (arithmetic) {
      return jsonResponse({
        success: true,
        reply: arithmetic.expression + " = " + arithmetic.result,
        ...dateTime,
        webSearch: false,
        sources: []
      });
    }

    // Stable, unambiguous general knowledge should not depend on Groq availability.
    if (/(भारत|इंडिया|india).{0,35}(राजधानी|capital)|(राजधानी|capital).{0,35}(भारत|इंडिया|india)/i.test(userText)) {
      return jsonResponse({
        success: true,
        reply: "भारत की राजधानी नई दिल्ली है।",
        ...dateTime,
        webSearch: false,
        sources: []
      });
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
      "सरथी", "सरजी", "सर", "जी", "सारथीजी",
      "hi", "hello", "hey", "good", "morning", "evening"
    ]);
    const isGreetingOnly = normalizedGreeting.length <= 70 &&
      greetingWords.length > 0 &&
      greetingWords.length <= 6 &&
      greetingWords.every(word => greetingVocabulary.has(word));

    // Greetings are answered locally: they must not consume AI quota or fail
    // when Groq is rate-limited/unavailable.
    if (isGreetingOnly) {
      return jsonResponse({
        success: true,
        reply: "नमस्ते! 🦚 मैं सारथी हूँ। बताइए, आज मैं आपकी क्या मदद करूँ?",
        ...dateTime,
        webSearch: false,
        sources: [],
      });
    }

    // Identity questions about Sarathi are stable and should never trigger
    // Exa/Groq, even when the browser's web-search switch is enabled.
    const isSarathiIdentityQuestion = /(?:तुम|आप|तू)\s*(?:कौन\s*हो|कौन\s*हैं|कौन\s*है)|(?:तुम्हारा|आपका)\s*नाम\s*(?:क्या\s*है|बताओ|बताइए)|अपने\s*बारे\s*में\s*बताओ|सारथी\s*AI\s*क्या\s*है/i.test(userText);
    if (isSarathiIdentityQuestion) {
      return jsonResponse({
        success: true,
        reply: "मैं सारथी AI हूँ—आपका हिंदी और अंग्रेज़ी में मदद करने वाला डिजिटल सहायक। मैं पढ़ाई, सामान्य ज्ञान, लेखन, तकनीकी सवाल और इंटरनेट पर उपलब्ध ताज़ा जानकारी खोजने में मदद कर सकता हूँ। ताज़ा जानकारी के लिए इंटरनेट चालू होना और खोज सेवा उपलब्ध होना जरूरी है।",
        ...dateTime,
        webSearch: false,
        sources: [],
      });
    }

    // Explain the actual voice workflow locally; avoid false denials and web search.
    const isVoiceCapabilityQuestion = /(?:आवाज|आवाज़|वॉइस|voice|माइक्रोफोन|माइक्रोफ़ोन|mic).{0,55}(?:सुन|बोल|जवाब|बात|बातचीत|पहचान|काम|कर|सकते|सकती|सकता)|(?:सुन|बोल).{0,35}(?:आवाज|आवाज़|वॉइस|voice|माइक्रोफोन|माइक्रोफ़ोन|mic)/i.test(userText);
    if (isVoiceCapabilityQuestion) {
      return jsonResponse({
        success: true,
        reply: "हाँ, सारथी ऐप में आवाज़ से बातचीत की सुविधा है। माइक्रोफ़ोन बटन दबाकर अनुमति दें और बोलें। फ़ोन आपकी आवाज़ को टेक्स्ट में बदलकर सवाल भेजता है, फिर सारथी जवाब देता है; आवाज़ में जवाब भी उपलब्ध है। यह सीधे कच्चे ऑडियो को AI तक भेजने वाली सुविधा नहीं है। अगर हिंदी आवाज़ पहचान उपलब्ध न हो, तो फ़ोन ऑनलाइन स्पीच सेवा की अनुमति माँग सकता है। सुविधा न चले तो बताइए कि माइक्रोफ़ोन दबाने पर क्या संदेश आता है।",
        ...dateTime,
        webSearch: false,
        sources: [],
      });
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse({ success: false, error: "AI सेवा का Secret उपलब्ध नहीं है।" }, 500);
    }

    // Apply the per-minute chat limit only to requests that actually need AI.
    if (await isRateLimited(request, env, "chat")) {
      return jsonResponse({
        success: false,
        zeroCostMode: true,
        error: "सारथी की उपयोग सीमा अभी पूरी हुई है। लगभग एक मिनट बाद फिर प्रयास करें।"
      }, 429);
    }

    // Never search the web for a simple greeting, even if the browser toggle is on.
    const wantsSearch = !isGreetingOnly &&
      (body.webSearch === true || body.internet === true ||
       explicitlyRequestsWebSearch(userText) || shouldSearchAutomatically(userText));
    let searchResults = [];
    let searchWarning = "";

    // Keep this block as normal JavaScript lines; never insert literal \\n separators here.
    // Deploy marker: search syntax fix is included in this revision.
    if (wantsSearch) {
      const isCurrentNewsQuestion = /(ताज़ा खबर|ताजा खबर|आज की खबर|आज की न्यूज़|आज की न्यूज|आज कि ताजा खबर|आज की ताज़ा खबर|आज की ताजा खबर|latest news|today.?s news|current news|breaking news|समाचार)/i.test(userText);
      const isGoldRateQuestion = /(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(userText);
      const isSilverRateQuestion = /(चांदी|चाँदी|silver)/i.test(userText);
      const isDiamondPriceQuestion = /(हीरा|हीरे|हीरों|diamond)/i.test(userText);
      const isHistoricalQuestion = isHistoricalResearchQuery(userText);
      const indiaToday = new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const isOfficialEducationQuestion = /(सिलेबस|पाठ्यक्रम|परीक्षा तिथि|एडमिट कार्ड|प्रवेश पत्र|रिजल्ट|परिणाम|आवेदन|फॉर्म|फीस|पात्रता|नियम|छात्रवृत्ति|स्कॉलरशिप|scholarship|fellowship|stipend|official syllabus|exam date|admit card|result|eligibility|application form)/i.test(userText);
      const searchQuery = isCurrentNewsQuestion
        ? "India latest news when:2d " + indiaToday
        : isGoldRateQuestion || isSilverRateQuestion
          ? "India city-wise retail rate today 22K 24K gold 999 silver per gram per 10 gram per kilogram source updated time " + indiaToday
          : isDiamondPriceQuestion
            ? "India diamond price today per carat natural diamond 4Cs price range " + indiaToday
            : isOfficialEducationQuestion
            ? userText + " official website government university board site:gov.in OR site:ac.in"
            : isHistoricalQuestion
              ? (/(खूनी रविवार|bloody sunday)/i.test(userText)
                  ? "Bloody Sunday 1905 St Petersburg 9 January 22 January historical academic archive casualty figures Nicholas II absent"
                  : userText + " historical encyclopedia academic university press sources")
              : userText;
      const search = await searchInternet(searchQuery, env);
      searchResults = filterRelevantSearchResults(userText, search.results);
      if (isHistoricalQuestion) searchResults = filterHistoricalSources(userText, searchResults);
      if (isCurrentNewsQuestion) searchResults = dedupeNewsPublishers(filterFreshNewsResults(dedupeNewsResults(searchResults)));
      if ((isGoldRateQuestion || isSilverRateQuestion) && searchResults.length) {
        // Keep the strongest result from each publisher; repeated pages from one
        // website must not be presented as independent confirmation.
        const seenPublishers = new Set();
        searchResults = searchResults.filter(item => {
          let publisher = String(item.publisher || "").toLowerCase();
          try { publisher = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
          if (!publisher || seenPublishers.has(publisher)) return false;
          seenPublishers.add(publisher);
          return true;
        }).slice(0, 6);
        searchResults = await enrichGoldRateResults(searchResults);
      }
      if (searchResults.length) {
        searchWarning = search.warning || "इंटरनेट खोज से परिणाम मिले।";
      } else if (search.httpStatus) {
        searchWarning = search.warning || "इंटरनेट खोज सेवा ने परिणाम नहीं दिए।";
      } else if (isCurrentNewsQuestion && Array.isArray(search.results) && search.results.length) {
        searchWarning = "खोज में कुछ समाचार मिले, लेकिन उनकी प्रकाशित तारीख पिछले 48 घंटों के भीतर और वर्तमान समय से पहले होने की पुष्टि नहीं हुई। इसलिए उन्हें ताज़ा खबर के रूप में शामिल नहीं किया गया।";
      } else if (Array.isArray(search.results) && search.results.length) {
        searchWarning = "खोज में परिणाम मिले, लेकिन वे सवाल से मेल खाते भरोसेमंद स्रोतों की जाँच में पास नहीं हुए।";
      } else {
        searchWarning = search.warning || "खोज में आपके सवाल से मेल खाते भरोसेमंद परिणाम नहीं मिले।";
      }

      // Never let the model pretend it has current web information when every
      // search provider returned no usable results. Explain the actual failure.
      if (searchResults.length === 0) {
        const retryableSearchFailure = search.retryable === true;
        return jsonResponse({
          success: true,
          reply: "मैंने वेब पर खोजने की कोशिश की, लेकिन अभी उपयोग करने योग्य परिणाम नहीं मिले। " + searchWarning + " इसलिए कोई तथ्य या लिंक गढ़कर नहीं बताऊँगा। " +
            (retryableSearchFailure ? "थोड़ी देर बाद फिर कोशिश करें।" : "आप चाहें तो सवाल को दूसरे शब्दों में पूछ सकते हैं।"),
          ...dateTime,
          webSearch: true,
          searchAttempted: true,
          searchUnavailable: true,
          searchWarning,
          retryable: retryableSearchFailure,
          providerStatus: search.httpStatus || null,
          searchErrorCode: search.errorCode || null,
          sources: [],
        });
      }
    }

    // This well-documented event has recurring date and casualty-count errors.
    // Use a deterministic, source-grounded response instead of relying on a
    // generated paragraph to preserve the calendar conversion and uncertainty.
    if (isHistoricalResearchQuery(userText) && /(खूनी रविवार|bloody sunday)/i.test(userText) && searchResults.length) {
      return jsonResponse({
        success: true,
        reply: buildBloodySundayVerifiedReply(searchResults),
        ...dateTime,
        webSearch: true,
        searchAttempted: true,
        searchWarning,
        sources: searchResults.map(item => ({
          title: item.title,
          url: item.url,
          publisher: historicalPublisherName(item),
          publishedAt: item.publishedAt || "",
        })),
      });
    }

    const medicalDegreeQuestion = userText.trim();
    if (/^(?:DM|डीएम)(?:\s*(?:(?:का\s*)?(?:मतलब|full form|पूरा नाम)(?:\s*(?:क्या है|बताओ|बताइए))?|क्या है))?[?।.!\s]*$/i.test(medicalDegreeQuestion)) {
      return jsonResponse({
        success: true,
        reply: "चिकित्सा शिक्षा के संदर्भ में DM का पूरा नाम Doctorate of Medicine है। यह MD/MS के बाद की सुपर-स्पेशलिटी डिग्री है। भारत में इसकी अवधि और प्रवेश-नियम संबंधित विषय तथा वर्तमान NMC/प्रवेश नियमों के अनुसार जाँचने चाहिए।",
        ...dateTime,
        webSearch: false,
        sources: []
      });
    }
    if (/^(?:M\s*Ch|MCh|एम\s*सीएच)(?:\s*(?:(?:का\s*)?(?:मतलब|full form|पूरा नाम)(?:\s*(?:क्या है|बताओ|बताइए))?|क्या है))?[?।.!\s]*$/i.test(medicalDegreeQuestion)) {
      return jsonResponse({
        success: true,
        reply: "चिकित्सा शिक्षा के संदर्भ में MCh का पूरा नाम Magister Chirurgiae है। यह सर्जरी की सुपर-स्पेशलिटी डिग्री है। भारत में इसकी अवधि और प्रवेश-नियम संबंधित विषय तथा वर्तमान NMC/प्रवेश नियमों के अनुसार जाँचने चाहिए।",
        ...dateTime,
        webSearch: false,
        sources: []
      });
    }

    const broadExamQuestion = /(कौन.?कौन.?सी? परीक्षा|कौन.?कौन.?सा परीक्षा|कवन.?कवन.?सा परीक्षा|किन.?किन.?परीक्षा|किस.?किस.?परीक्षा|कौन.?सी.?परीक्षा.*तैयारी|परीक्षा.*तैयारी.*करा सकते)/i.test(userText);
    if (broadExamQuestion) {
      return jsonResponse({
        success: true,
        reply: "हाँ, मैं कई तरह की परीक्षाओं की तैयारी में मदद कर सकता हूँ—सिर्फ RTO की नहीं।\n\n1. स्कूल: कक्षा 1–12 और बोर्ड परीक्षाएँ।\n2. कॉलेज: BA, BSc, BCom और अन्य स्नातक/स्नातकोत्तर विषय।\n3. सरकारी नौकरी: UPSC, BPSC, SSC, रेलवे, बैंकिंग और पुलिस भर्ती।\n4. प्रवेश परीक्षाएँ: JEE, NEET, CUET और राज्य स्तरीय प्रवेश परीक्षाएँ।\n5. शिक्षक भर्ती: CTET, STET और संबंधित परीक्षाएँ।\n6. कौशल/लाइसेंस: कंप्यूटर, ड्राइविंग लाइसेंस और अन्य व्यावसायिक परीक्षाएँ।\n\nमैं नोट्स, आसान व्याख्या, महत्वपूर्ण अभ्यास प्रश्न, मॉक टेस्ट और पढ़ाई की योजना बना सकता हूँ। परीक्षा का आधिकारिक सिलेबस, तारीख, फीस और पात्रता बदल सकती है—उन्हें आधिकारिक वेबसाइट से जाँचना होगा।",
        ...dateTime,
        webSearch: false,
        sources: []
      });
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
- बोलकर बातचीत में जवाब ऐसे दो जैसे सामने बैठे व्यक्ति से सहज बातचीत कर रहे हो: पहले सीधे और गर्मजोशी से जवाब दो, फिर जरूरत पर विस्तार करो। हर बार "जी बिल्कुल", "आपका सवाल बहुत अच्छा है" जैसे बनावटी शुरुआती वाक्य मत दो।
- आवाज़ में पढ़े जाने वाले जवाब स्वाभाविक बोलचाल के हों। छोटे सवाल पर 1–3 छोटे वाक्य पर्याप्त हैं; जटिल सवाल पर क्रम से समझाओ। बिना जरूरत लंबी सूची, Markdown चिह्न, इमोजी या शीर्षक न दो, क्योंकि इन्हें आवाज़ में पढ़ना अस्वाभाविक लगता है।
- बातचीत का संदर्भ बनाए रखो। उपयोगकर्ता "हाँ", "अच्छा", "फिर?" या "आगे बताओ" कहे तो पिछली बात से अर्थ समझो; वही जानकारी बार-बार न दोहराओ। जहाँ उपयुक्त हो, एक समय में एक छोटा स्वाभाविक अगला सवाल पूछो।
- उपयोगकर्ता बोलते समय गलती से रुके या वाक्य अधूरा हो तो जल्दबाजी में निष्कर्ष मत निकालो। बात अस्पष्ट हो तो संक्षेप में पूछो कि उनका मतलब क्या है।
- Hinglish में जवाब देते समय उपयोगकर्ता की तरह ही भाषा का अनुपात रखो; ज़बरदस्ती हर अंग्रेज़ी शब्द का अनुवाद या हर हिंदी वाक्य में अंग्रेज़ी मत जोड़ो।
- भोजपुरी शब्द हों तो उनका अर्थ समझकर सहज भोजपुरी/हिंदी में उत्तर दो। उपयोगकर्ता की भाषा या लहजे का मज़ाक या अनावश्यक सुधार मत करो।
- भाषा बदलने के लिए उपयोगकर्ता को सेटिंग बदलने को मत कहो।
- सीधे सवाल का सीधा उत्तर पहले दो। फिर जरूरत के अनुसार कारण और कदम समझाओ।\n- यदि उपयोगकर्ता केवल हेलो, नमस्ते, नमस्कार या साधारण अभिवादन करे, तो छोटा स्वाभाविक अभिवादन देकर पूछो कि किस मदद की जरूरत है। ऐसे अभिवादन पर किसी पुराने विषय, खरीदारी, समाचार या वेब खोज के परिणामों का उत्तर मत दो।\n- हमेशा नवीनतम उपयोगकर्ता संदेश को प्राथमिकता दो; पुरानी बातचीत तभी जारी रखो जब संदेश उसी का संदर्भ देता हो।
- केवल एक पंक्ति में जवाब मत समेटो जब सवाल में विस्तार, तुलना या समाधान माँगा गया हो। उपयोगी उदाहरण दो, लेकिन अनावश्यक दोहराव न करो।
- उपयोगकर्ता पहले ही जो जानकारी दे चुका है, वह दोबारा मत पूछो।
- जहाँ अनिश्चितता हो, साफ बताओ; अनुमान को तथ्य मत बनाओ और नकली स्रोत/लिंक मत दो। अस्पष्ट या गोलमोल शब्दों से बचो; आसान और सटीक हिंदी में जवाब दो।\n- किसी व्यक्ति का पूरा नाम, जन्म-मृत्यु तिथि, पद, घटना या ऐतिहासिक वर्ष लिखने से पहले संदर्भ जाँचो; नाम/तिथि याद न हो तो गढ़ो मत। उदाहरण: महात्मा गांधी का नाम मोहनदास करमचंद गांधी है, मोहम्मद करमचंद नहीं।\n- शिक्षा/परीक्षा की सहायता केवल RTO तक सीमित नहीं है। स्कूल, कॉलेज, स्नातक, स्नातकोत्तर और प्रतियोगी परीक्षाओं के विषयों में भी मदद करो।\n- उत्तर अधूरा, केवल शीर्षक, खाली सूची, टूटे Markdown या असंबंधित सामग्री के रूप में कभी मत भेजो। सवाल समझ न आए तो एक छोटा स्पष्टीकरण पूछो।
- यदि एक संदेश में कई सवाल, सूची या अलग-अलग काम दिए हों, तो उत्तर देने से पहले मन में उनकी संख्या और क्रम पहचानो। हर सवाल का अलग उत्तर उसी क्रम में दो; किसी सवाल को छोड़ो, दो सवालों को मिलाओ या एक ही उत्तर बार-बार मत दो। सूची के अंत तक पहुँचकर जाँचो कि हर बिंदु का उत्तर दिया है। उत्तर सीमा के कारण सब पूरा न हो सके तो साफ बताओ कि कौन-से बिंदु पूरे हुए और कौन-से बाकी हैं; बाकी को पूरा करने के लिए अगला भाग जारी रखो। किसी तथ्य का भरोसा न हो तो साफ कहो, लेकिन प्रश्न को चुपचाप छोड़ो मत।
- सामान्य स्थायी ज्ञान के आसान सवालों का उत्तर बिना वेब खोज के दो। यदि सवाल ताज़ा, बदलती, स्थानीय, आधिकारिक या तथ्य-जाँच माँगता हो, तो उपलब्ध इंटरनेट खोज अपने-आप करो; केवल उपयोगकर्ता के वेब बटन पर निर्भर मत रहो।
- यदि खोज के परिणाम पर्याप्त, विश्वसनीय या एक-दूसरे से मेल खाते न हों, तो स्पष्ट कहो कि पुष्टि नहीं हो पाई। खोज न कर पाने पर भी इंटरनेट पर खोज लेने का दावा मत करो।
- वर्तमान सोने/चाँदी के भाव, शेयर, मौसम, ट्रेन स्थिति या अन्य बदलती जानकारी पूछी जाए और इंटरनेट खोज के परिणाम मिले हों, तो केवल उन्हीं परिणामों में स्पष्ट रूप से दिए गए ताज़ा आँकड़े बताओ। स्रोत में तारीख/दर स्पष्ट न हो या परिणाम आपस में न मिलें, तो कोई संख्या या तारीख अनुमान से मत बनाओ; साफ कहो कि उपलब्ध स्रोत से आज का सही भाव सत्यापित नहीं हो पाया।
- खोज परिणामों में पुरानी तारीख वाला भाव हो तो उसे आज का भाव बताकर प्रस्तुत मत करो। भारत के सोने के भाव में 22K और 24K की दर, प्रति ग्राम/10 ग्राम की इकाई और स्रोत की तारीख स्पष्ट करो, केवल जब स्रोत में ये जानकारी उपलब्ध हो।
- समाचार/ताज़ा खबर के लिए विशेष प्रारूप: खबरों का पूरा जवाब उसी भाषा और लहजे में लिखो जिसमें उपयोगकर्ता ने पूछा है। हिंदी में पूछे तो स्वाभाविक बोलचाल की हिंदी में लिखो; अंग्रेज़ी में पूछे तो अंग्रेज़ी में; Hinglish में पूछे तो सहज Hinglish में। शीर्षक, खंडों के नाम, तारीख़ का परिचय और सावधानी-पंक्ति भी उसी भाषा में हों—हिंदी सवाल पर अंग्रेज़ी हेडलाइन या अंग्रेज़ी में मेटाडेटा मत छोड़ो। शुरुआत में आज की तारीख़ और दिन बताओ। खबरों को देश, दुनिया, खेल या संबंधित विषय के छोटे खंडों में बाँटो; केवल वही खंड रखो जिनमें खबरें हों। हर खबर में पहले छोटी, साफ़ और स्वाभाविक हेडलाइन दो, फिर 2–4 छोटे वाक्यों में बताओ कि क्या हुआ, किसने किया/कहा, कहाँ और क्यों यह खबर महत्वपूर्ण है। मूल खबर अंग्रेज़ी में हो तो उसका अर्थ समझकर स्वाभाविक भाषा में अपने शब्दों में लिखो—शब्दशः अनुवाद मत करो। हर खबर के अंत में स्रोत का नाम और प्रकाशित तारीख़/समय भारतीय समय में दो; घटना की तारीख़ अलग और तभी बताओ जब उपलब्ध सामग्री में स्पष्ट हो। आरोप को आरोप, दावे को दावा और पुष्टि को पुष्टि के रूप में ही बताओ। एक ही घटना को दोहराओ मत; अलग घटनाओं को आपस में मत मिलाओ। केवल वेबसाइट का नाम, शीर्षक या तारीख़ देकर खबर पूरी मत मानो। विवरण पर्याप्त न हो तो उस खबर को छोड़ दो या साफ़ बताओ कि जानकारी सीमित है; कोई तथ्य मत गढ़ो। अधिकतम 8 भरोसेमंद और प्रासंगिक खबरें दो; अच्छी खबरें कम हों तो कम ही दो। अंत में उसी भाषा में एक छोटी सावधानी-पंक्ति दो।
- इंटरनेट खोज के परिणामों से तथ्य लेकर अपने शब्दों में सीधा जवाब दो। उपयोगकर्ता ने स्पष्ट रूप से लिंक या स्रोत न माँगे हों तो मुख्य जवाब में URL, वेबसाइट लिंक या लिंक की सूची बिल्कुल मत लिखो। स्रोत का नाम केवल तभी बताओ जब भरोसा जाँचने के लिए जरूरी हो। खोज के URL को आंतरिक संदर्भ समझो, उत्तर का हिस्सा नहीं।
- सोने-चाँदी के भाव में कम-से-कम 2 अलग-अलग प्रकाशकों/वेबसाइटों के परिणाम हों तभी उसे "दो स्रोतों से मिलान" कहो। एक ही वेबसाइट के अलग पेज स्वतंत्र स्रोत नहीं हैं। 2 स्वतंत्र स्रोत न मिलें तो साफ लिखो कि भाव का स्वतंत्र मिलान नहीं हो सका; एक स्रोत के भाव को पक्का/सर्वमान्य मत बताओ। हर स्रोत की दर अलग रखो और स्रोत का नाम, प्रकाशित/अपडेट समय (यदि उपलब्ध हो), शहर/बाजार, शुद्धता और इकाई स्पष्ट करो। भारत-स्तर का सवाल हो तो शहरवार उपलब्ध दरें دکھाओ; किसी एक शहर (जैसे मुंबई) की दर को पूरे भारत या उपयोगकर्ता के शहर की दर मत बताओ। शहर स्पष्ट न हो तो शहर मत गढ़ो। प्रकाशित प्रति ग्राम, प्रति 10 ग्राम और प्रति किलो इकाइयों को आपस में मिलाने से पहले गणित जाँचो। सोने में प्रति ग्राम × 10 = प्रति 10 ग्राम; चाँदी में प्रति ग्राम × 1000 = प्रति किलो। उदाहरण: ₹13,888/ग्राम का 10 ग्राम ₹1,38,880 है, ₹1,38,590 नहीं; ₹12,730/ग्राम का 10 ग्राम ₹1,27,300 है; ₹179/ग्राम चाँदी का किलो ₹1,79,000 है। स्रोत की प्रकाशित दर और अपनी गणना को अलग-अलग पहचानो। स्रोतों के भाव अलग हों तो औसत या एक पक्का राष्ट्रीय भाव मत बनाओ; स्रोत, तारीख, समय, शहर और इकाई सहित अलग-अलग बताओ। 22K/24K/999 को आपस में मत मिलाओ। जिस संख्या या इकाई की पुष्टि न हो, उसे मत गढ़ो।
फ़ॉर्मेट:
- जवाब साफ और मोबाइल पर पढ़ने योग्य रखो।
- सामान्य उत्तर में * या ** जैसे Markdown सजावटी चिह्न मत लिखो। बोल्ड करने की जरूरत हो तो शब्दों को साधारण पाठ में रखो।
- सूची जरूरी हो तो हर नई बात अलग पंक्ति में लिखो और पंक्ति की शुरुआत साधारण "1." या "•" से करो। हर वाक्य में चिह्न न लगाओ।
- शीर्षक तभी दो जब जवाब लंबा हो। बहुत ज्यादा शीर्षक, इमोजी और दोहराव से बचो।
- कोड माँगा जाए तो पूरा, चलने योग्य कोड और कहाँ लगाना है, यह स्पष्ट बताओ।
मदद के नियम:
- यदि विद्यार्थी "शुरुआत से", "A to Z", "पूरा कोर्स" या "मुझे सिखाओ" कहे, तो विषय का क्रमबद्ध रोडमैप दो और पहला छोटा पाठ शुरू करो। पूरा पाठ्यक्रम एक ही उत्तर में मत ठूँसो।
- शिक्षक की तरह पढ़ाओ: लक्ष्य, सरल व्याख्या, उदाहरण, जरूरी शब्द/नियम, छोटा अभ्यास और पुनरावृत्ति। विद्यार्थी का उत्तर जाँचो, सही/गलत का कारण समझाओ और फिर अगला कदम दो। एक समय में एक छोटा अभ्यास पर्याप्त है।
- अंग्रेज़ी शून्य से सिखाने का क्रम रखो: अक्षर/ध्वनि, रोज़मर्रा के शब्द, सर्वनाम, am/is/are, छोटे वाक्य, प्रश्न/नकार, काल, सुनना-बोलना, पढ़ना-लिखना और बातचीत। शुरुआती विद्यार्थी को IPA न दो; हिंदी अर्थ और देवनागरी में सरल उच्चारण दो। एक पाठ में 3–5 नए शब्द रखो।
- शुरुआती अंग्रेज़ी में अक्षर का नाम और शब्द में उसकी ध्वनि अलग-अलग बताओ।
- एक पाठ में अधिकतम 5–6 अक्षर या 3–5 नए शब्द सिखाओ; पहले उनका अभ्यास कराओ।
- पाठ के अंत में केवल एक छोटा अभ्यास प्रश्न दो और विद्यार्थी के उत्तर की प्रतीक्षा करो; उत्तर पहले मत बताओ।
- गणित, विज्ञान, भाषा, इतिहास, भूगोल, सामाजिक विज्ञान, वाणिज्य, कंप्यूटर, प्रोग्रामिंग, व्यावसायिक कौशल और प्रतियोगी परीक्षाओं में विद्यार्थी के स्तर के अनुसार सहायता दो। किसी अज्ञात कोर्स का पूरा या आधिकारिक ज्ञान होने का दावा मत करो।
- पूरा कोर्स माँगे जाने पर इकाई/अध्यायवार योजना, सीखने के लक्ष्य, नोट्स, उदाहरण, अभ्यास, टेस्ट और पुनरावृत्ति दो। सिलेबस/फीस/प्रवेश/नियम जैसे बदलते तथ्यों को उपलब्ध इंटरनेट खोज से आधिकारिक स्रोत पर जाँचो; पुष्टि न हो तो साफ बताओ।
- तथ्य, अनुमान और सलाह अलग रखो। गणना जाँचो; विज्ञान में तथ्य और परिकल्पना, इतिहास में प्रमाण और मत अलग करो। परीक्षा में महत्वपूर्ण प्रश्न अभ्यास के लिए दो, पक्का आने की गारंटी मत दो।
- विद्यार्थी की प्रगति का दावा तभी करो जब उसके अभ्यास के उत्तर बातचीत में उपलब्ध हों। एक ही उत्तर में बहुत अधिक पाठ या प्रश्नों की बौछार मत करो।
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
- ऐप खोलने के अनुरोध पर प्लेटफ़ॉर्म का अंतर साफ़ रखो: Android सारथी ऐप में उपलब्ध native सुविधा से समर्थित या फ़ोन में इंस्टॉल और सूची में पहचाने गए ऐप खोले जा सकते हैं; केवल वेबसाइट/ब्राउज़र में फ़ोन के दूसरे ऐप सीधे नहीं खोले जा सकते। किसी ऐप के खुलने की पुष्टि तभी करो जब Android से सफलता का संकेत मिले; अन्यथा कहो कि कोशिश की गई लेकिन खुलना सत्यापित नहीं हुआ। अज्ञात ऐप को खुला हुआ मत बताओ।
- Sarathi AI, GitHub, Cloudflare और इंटरनेट-सर्च की समस्याओं में केवल वास्तविक स्थिति के आधार पर सलाह दो; जो बदलाव लाइव तैनात नहीं हुआ हो उसे तैनात हुआ मत कहो।
- सुरक्षा और निजता का ध्यान रखो। निजी जानकारी या संवेदनशील काम करने से पहले स्पष्ट अनुमति जरूरी हो तो अनुमति लो।
केवल उपलब्ध संदर्भ पर भरोसा करो; दूसरे चैट या निजी जानकारी याद होने का झूठा दावा मत करो।
शिक्षा और करियर में उच्च-सटीकता नियम (इनका सख्ती से पालन करो):
- विद्यार्थी के भविष्य, प्रवेश, फीस, पात्रता, पाठ्यक्रम, मान्यता और परीक्षा से जुड़े उत्तरों में अनुमान को तथ्य की तरह कभी मत बताओ।
- स्थायी अवधारणा और बदलने वाली आधिकारिक जानकारी में अंतर रखो। प्रवेश, पात्रता, आयु-सीमा, विषय संयोजन, न्यूनतम अंक, आरक्षण, फीस, सीट, अवधि, परीक्षा तिथि, आवेदन, काउंसलिंग, सिलेबस, मान्यता, लाइसेंस और चालू/आगामी सत्र के लिए ताज़ा खोज करो।
- पहले संबंधित सरकारी/नियामक/परीक्षा प्राधिकरण/बोर्ड/विश्वविद्यालय की आधिकारिक वेबसाइट और उसी शैक्षणिक सत्र का नवीनतम सूचना-पत्र देखो। विषय के अनुसार UGC, AICTE, NMC, NTA, NCTE, NCVET/NQR, NCISM, NCH, DCI, PCI, INC, BCI, ICAR, CoA, RCI, VCI, शिक्षा मंत्रालय, राज्य विभाग, बोर्ड या विश्वविद्यालय में सही प्राधिकरण चुनो।
- किसी डिग्री/कोर्स की वैधता केवल नाम देखकर तय मत करो। विश्वविद्यालय/संस्थान की मान्यता, उस विशेष कार्यक्रम की आवश्यक स्वीकृति, परिसर/मोड और संबंधित सत्र की स्थिति जाँचो। UGC मान्यता, पेशेवर परिषद की स्वीकृति और नौकरी की पात्रता अलग बातें हो सकती हैं।
- निजी ब्लॉग, कोचिंग वेबसाइट, सोशल मीडिया या पुराने लेख को अकेले आधिकारिक प्रमाण मत मानो। आधिकारिक स्रोत न मिले, स्रोत टकराएँ या सत्र स्पष्ट न हो तो साफ कहो: आधिकारिक पुष्टि नहीं मिली। निश्चित उत्तर मत गढ़ो।
- बदलने वाले उत्तर में सत्र/वर्ष, प्रकाशित/अपडेट तारीख (यदि उपलब्ध), लागू राज्य/संस्था, आधिकारिक लिंक और स्रोत का नाम दो। प्रस्तावित, मसौदा, घोषित और अधिसूचित नियमों को अलग-अलग पहचानो।
- भारत के सभी कोर्स की सूची को पूर्ण और अंतिम बताने का दावा मत करो। पाठ्यक्रमों के नाम/उपलब्धता संस्था, राज्य, नियामक और सत्र के अनुसार बदलते हैं। क्षेत्रवार नक्शा दो—स्कूल, कला/मानविकी, वाणिज्य, विज्ञान, इंजीनियरिंग/तकनीक, चिकित्सा/स्वास्थ्य, कृषि/पशु चिकित्सा, कानून, शिक्षा, प्रबंधन, डिजाइन/वास्तुकला, मीडिया, खेल, कौशल/ITI/पॉलिटेक्निक, व्यावसायिक और शोध—फिर जरूरत के अनुसार आधिकारिक संस्थान/राज्य/कोर्स से विस्तार करो।
- पेशे के रास्ते में 10वीं/12वीं के विषय, न्यूनतम अंक, प्रवेश परीक्षा, अवधि, इंटर्नशिप, पंजीकरण/लाइसेंस और विशेषज्ञता अलग-अलग बताओ। लागू न होने वाली शर्तें सार्वभौमिक मत बनाओ। सभी कोर्स में 60% या Maths अनिवार्य मत कहो।
- MBBS में प्रवेश के लिए NEET-UG और स्नातकोत्तर चिकित्सा प्रवेश के नियम अलग रखो; NEET-PG को MBBS प्रवेश परीक्षा मत बताओ। वर्तमान नियामक के रूप में MCI का पुराना नाम मत लिखो; NMC की वर्तमान स्थिति जाँचो।
- NMC के प्रकाशित मानक में सुपर-स्पेशलिटी डिग्रियों के नाम Doctorate of Medicine (DM) और Magister Chirurgiae (MCh) दिए गए हैं। DM को Doctor of Medicine और MCh को Master of Chirurgiae कहकर गलत विस्तार मत करो। MD/MS और DM/MCh की श्रेणियाँ मत मिलाओ।
- कौन-सा विषय लेना है, यह पूछे जाने पर पहले संबंधित कोर्स और लागू बोर्ड/विश्वविद्यालय/सत्र पहचानो। उत्तर बदलता हो तो केवल जरूरी स्पष्टीकरण पूछो; विद्यार्थी की स्ट्रीम का अनुमान मत लगाओ।
- करियर, नौकरी, प्रवेश या चयन की गारंटी मत दो। महत्वपूर्ण प्रश्न अभ्यास के लिए हैं, भविष्यवाणी नहीं। एक संस्था का उदाहरण पूरे भारत का नियम मत बताओ।
- उत्तर से पहले जाँचो कि सवाल के अनुसार सही कोर्स नाम, योग्यता, प्रवेश परीक्षा, अवधि, फीस/छात्रवृत्ति, मान्यता, लागू सत्र और आधिकारिक स्रोत छूटे तो नहीं।
आज की भारतीय तारीख ${dateTime.date} है।
`;

    // Preserve the complete latest user request. Older history is budgeted separately:
    // truncating the START of the latest message silently drops numbered questions.
    const validMessages = messages
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .slice(-8);
    const latestUserIndex = validMessages.map(m => m.role).lastIndexOf("user");
    const safeMessages = [];
    if (latestUserIndex >= 0) {
      const latestUserText = validMessages[latestUserIndex].content.trim();
      // userText is already validated against the 12,000-character request limit above.
      const history = validMessages.slice(0, latestUserIndex);
      let historyBudget = 4500;
      const safeHistory = [];
      for (let i = history.length - 1; i >= 0 && historyBudget > 0; i--) {
        const m = history[i];
        const content = m.content.trim().slice(-Math.min(700, historyBudget));
        if (!content) continue;
        safeHistory.unshift({ role: m.role, content });
        historyBudget -= content.length;
      }
      safeMessages.push(...safeHistory, { role: "user", content: latestUserText });
    }

    const latestPrompt = safeMessages.at(-1)?.content || userText;
    const searchContext = searchResults.length
      ? buildSearchContext(searchResults, userText)
      : "";
    if (searchContext && safeMessages.length) {
      safeMessages[safeMessages.length - 1].content += searchContext.slice(0, 6500);
    }

    const sendGroqRequest = async (requestMessages, maxTokens, systemContent = systemPrompt) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        return await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: "system", content: systemContent }, ...requestMessages],
            temperature: 0.3,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    const isNewsQueryForPrompt = /(खबर|समाचार|news|breaking|latest|ताज़ा|ताजा)/i.test(userText);
    let groqResponse;
    try {
      groqResponse = await sendGroqRequest(safeMessages, 6000);
      // On provider HTTP 413, retry once with compact context. Keep the preceding
      // user turn as well as the latest follow-up (e.g. "सबका उत्तर दो").
      if (groqResponse.status === 413) {
        const priorUser = [...safeMessages.slice(0, -1)].reverse().find(item => item.role === "user");
        const compactPrompt = priorUser
          ? "पिछला सवाल/संदर्भ:\n" + priorUser.content.slice(-1200) +
            "\n\nअभी का पूरा सवाल (इसे प्राथमिकता से पूरा उत्तर देना):\n" + latestPrompt
          : latestPrompt;
        const compactMessages = [{
          role: "user",
          content: compactPrompt + (searchContext ? searchContext.slice(0, isHistoricalResearchQuery(userText) ? 5200 : 800) : "")
        }];
        // The original system prompt is intentionally extensive. A 413 retry
        // must compact that too; otherwise the same oversized prompt is resent.
        const compactSystemPrompt = isHistoricalResearchQuery(userText)
          ? "तुम सारथी AI हो। ऐतिहासिक सवाल का उत्तर केवल दिए गए ऐतिहासिक खोज-स्रोतों से पुष्ट जानकारी के आधार पर दो। खूनी रविवार (1905) को दंगा या हिंसक प्रदर्शन मत कहो: यह फादर जॉर्जी गैपॉन के नेतृत्व में मजदूरों का शांतिपूर्ण जुलूस था, जो अपनी याचिका ज़ार निकोलस द्वितीय तक पहुँचाने के लिए Winter Palace की ओर जा रहा था; सैनिकों ने जुलूस/भीड़ पर गोलीबारी की। 9 जनवरी 1905 जूलियन कैलेंडर और 22 जनवरी 1905 ग्रेगोरियन कैलेंडर की एक ही तारीख है। गोलीबारी का सटीक स्थान स्रोत से पुष्ट किए बिना Winter Palace के ठीक सामने मत बताओ। मृतकों और घायलों की संख्या विवादित है; कोई एक निश्चित संख्या मत गढ़ो। कम-से-कम दो स्वतंत्र भरोसेमंद स्रोत हों तभी ऐसा दावा करो। हर स्रोत का वास्तविक शीर्षक, प्रकाशक और वास्तविक URL दो; स्रोत न हो तो साफ कहो। उपयोगकर्ता की भाषा में उत्तर दो।"
          : isNewsQueryForPrompt
            ? "तुम सारथी AI हो। समाचार के तथ्य केवल खोज परिणामों से लो। पूर्वानुमान को घटित घटना मत बताओ। बाजार के सुबह के आँकड़ों को बंद हुआ या दिन का अंतिम स्तर मत लिखो; समापन तभी बताओ जब स्रोत उसी दिन का closing स्तर स्पष्ट करे। हिंदी में सहज उत्तर दो और तथ्य मत गढ़ो।"
            : "तुम सारथी AI हो। उपयोगकर्ता की भाषा में स्पष्ट, सही और उपयोगी उत्तर दो। सवाल का पूरा उत्तर दो; तथ्य, तारीख, संख्या, स्रोत या लिंक मत गढ़ो। इंटरनेट खोज के परिणाम दिए हों तो हर बदलती/ताज़ा जानकारी केवल उन्हीं परिणामों से लो। समाचार में केवल शीर्षक और स्रोत-अंश से पुष्ट तथ्य लिखो; पूर्वानुमान को घटित घटना मत बताओ। बाजार के सुबह के आँकड़ों को बंद हुआ या दिन का अंतिम स्तर मत लिखो; समापन स्तर तभी बताओ जब स्रोत उसी दिन का closing स्तर स्पष्ट करे। जानकारी अपर्याप्त हो तो साफ कहो। हिंदी में सहज देवनागरी हिंदी लिखो।";
        groqResponse = await sendGroqRequest(compactMessages, 1800, compactSystemPrompt);
      }
      // If the compact retry is still rejected, preserve retrieved sources.
      if (groqResponse.status === 413 && searchResults.length) {
        const fallbackReply = buildProviderBusySearchFallback(
          searchResults,
          userText,
          "AI सेवा ने संक्षिप्त अनुरोध भी स्वीकार नहीं किया (HTTP 413), इसलिए उसका सार नहीं बन सका।"
        );
        return jsonResponse({
          success: true,
          reply: fallbackReply,
          ...dateTime,
          webSearch: true,
          searchAttempted: true,
          searchWarning: "AI सेवा ने दो बार HTTP 413 लौटाया; केवल वास्तविक खोज परिणाम दिखाए गए हैं।",
          providerBusy: true,
          providerStatus: 413,
          sources: searchResults.map(item => ({
            title: item.title,
            url: item.url,
            publisher: item.publisher || "",
            publishedAt: item.publishedAt || "",
          })),
        });
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        return jsonResponse({
          success: false,
          error: "AI सेवा से जवाब आने में समय अधिक लगा। थोड़ी देर बाद फिर कोशिश करें।",
          retryable: true,
          providerStatus: 504,
        }, 504);
      }
      return jsonResponse({ success: false, error: "AI सेवा से संपर्क नहीं हो सका।" }, 502);
    }

    if (!groqResponse.ok) {
      const status = groqResponse.status;
      // If search succeeded but Groq is rate-limited, preserve useful source
      // results instead of discarding them. Never invent a generated summary.
      if (status === 429 && searchResults.length) {
        const fallbackReply = buildProviderBusySearchFallback(searchResults, userText);
        if (fallbackReply) {
          return jsonResponse({
            success: true,
            reply: fallbackReply,
            ...dateTime,
            webSearch: true,
            searchAttempted: true,
            searchWarning: "AI सेवा व्यस्त थी; इसलिए खोज परिणामों का स्रोत-आधारित संक्षिप्त प्रदर्शन दिया गया है, AI सार नहीं।",
            providerBusy: true,
            sources: searchResults.map(item => ({
              title: item.title,
              url: item.url,
              publisher: item.publisher || "",
              publishedAt: item.publishedAt || "",
            })),
          });
        }
      }
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
    let rawReply = reply.trim();
    // Final factual guard for the well-known 1905 event: prevent the model from
    // reintroducing the specific "riot" misclassification after retrieval.
    if (isHistoricalResearchQuery(userText) && /(खूनी रविवार|bloody sunday)/i.test(userText) &&
        /(?:राजनीतिक\s+दंगा|दंगों?\s+के\s+दौरान|दंगा\s+हुआ|riot(?:s)?)/i.test(rawReply)) {
      rawReply = "खूनी रविवार (Bloody Sunday) 1905 कोई दंगा नहीं था। यह 9 जनवरी 1905 (पुराने जूलियन कैलेंडर) / 22 जनवरी 1905 (ग्रेगोरियन कैलेंडर) को सेंट पीटर्सबर्ग में हुआ। फादर जॉर्जी गैपॉन के नेतृत्व में मजदूरों का शांतिपूर्ण जुलूस अपनी याचिका ज़ार निकोलस द्वितीय तक पहुँचाने के लिए Winter Palace की ओर जा रहा था। सैनिकों ने जुलूस/भीड़ पर गोलीबारी की। गोलीबारी के सटीक स्थान और मृतकों-घायलों की संख्या के बारे में स्रोतों में अंतर है, इसलिए किसी एक संख्या या महल के ठीक सामने गोलीबारी होने का दावा बिना पुष्ट स्रोत के नहीं करना चाहिए। नीचे केवल इस खोज में मिले वास्तविक स्रोत दिए गए हैं।";
    }
    const newsListCount = (rawReply.match(/(^|\n)\s*(?:[1-8][.)]|[-•])\s*[^\n]{12,}/gm) || []).length;
    const looksLikeRawEnglishArticle = isCurrentNewsReply &&
      /\b(Updated:|By:|India News Live Updates|Published:|Read more|Breaking News)\b/i.test(rawReply);
    const malformedNewsReply = isCurrentNewsReply && searchResults.length > 0 &&
      (newsListCount < Math.min(2, searchResults.length) || looksLikeRawEnglishArticle);
    const finalReply = malformedNewsReply
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
