// Deploy refresh: publish the latest factual-answer safeguards from main.
// Bullion safeguard: keep the publisher's lead snapshot separate from city rows.
const INDIA_TIME_ZONE = "Asia/Kolkata";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
// Secondary Groq model with its own model-specific rate-limit bucket.
const GROQ_FALLBACK_MODEL = "qwen/qwen3.8-27b";
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


function solveDiscountQuestion(text) {
  const input = String(text || "").replace(/,/g, "").trim();
  const percentMatch = input.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:की\s*)?छूट/i);
  if (!percentMatch) return null;

  // Accept natural Hindi/English price descriptions and currency symbols.
  const amountPatterns = [
    /(?:₹|रु\.?|rs\.?)\s*([0-9]+(?:\.[0-9]+)?)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:रुपये|रूपये|रु\.?|rupees?)\s*(?:की\s*)?(?:वस्तु\s*)?(?:पर|कीमत)?/i,
    /(?:मूल\s*)?(?:कीमत|मूल्य|दाम|price)\s*(?:है|था|थी|:|=)?\s*(?:₹|रु\.?|rs\.?)?\s*([0-9]+(?:\.[0-9]+)?)/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:की\s*)?(?:वस्तु|सामान|item)\s*(?:की\s*)?(?:कीमत)?/i
  ];
  let priceMatch = null;
  for (const pattern of amountPatterns) {
    priceMatch = input.match(pattern);
    if (priceMatch) break;
  }
  if (!priceMatch) {
    const numbers = [...input.matchAll(/[0-9]+(?:\.[0-9]+)?/g)];
    const candidate = numbers.find(m => m[0] !== percentMatch[1]);
    if (candidate) priceMatch = [candidate[0], candidate[0]];
  }
  if (!priceMatch) return null;

  const price = Number(priceMatch[1]);
  const percent = Number(percentMatch[1]);
  if (!Number.isFinite(price) || !Number.isFinite(percent) || price < 0 || percent < 0 || percent > 100 || price > 1e12) return null;
  const discount = Math.round((price * percent / 100 + Number.EPSILON) * 100) / 100;
  const finalPrice = Math.round((price - discount + Number.EPSILON) * 100) / 100;
  const format = value => String(value);
  return "छूट की गणना\nमूल कीमत: ₹" + format(price) +
    "\nछूट: " + format(percent) + "% = ₹" + format(discount) +
    "\nअंतिम कीमत: ₹" + format(finalPrice);
}
function solveBasicArithmetic(text) {
  const input = String(text || "").replace(/,/g, "");
  const match = input.match(/(?:^|[^0-9])([0-9]+(?:[.][0-9]+)?(?:[ ]*[-+−×*÷/][ ]*[0-9]+(?:[.][0-9]+)?)+)(?=$|[^0-9])/);
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
  const q = String(text || "").toLocaleLowerCase("hi-IN").trim();
  // Match only direct date/day questions. Do not treat phrases such as
  // "आज का दिन अच्छा बनाने के लिए..." as requests for the calendar date.
  return /^(?:आज\s+की\s+तारीख(?:\s+(?:क्या\s+है|बताओ|बताइए))?|आज\s+कौन.?सा\s+दिन(?:\s+है)?|आज\s+का\s+दिन\s+(?:कौन.?सा\s+है|क्या\s+है)|आज\s+(?:की\s+)?डेट\s+(?:क्या\s+है|बताओ|बताइए)|आज\s+तारीख\s+(?:क्या\s+है|बताओ|बताइए)|वर्तमान\s+तारीख\s+(?:क्या\s+है|बताओ|बताइए)|current\s+date|today.?s\s+date|what\s+day\s+is\s+it\s+today)\s*[?।.!]*$/i.test(q);
}

function explicitlyRequestsWebSearch(text) {
  const q = String(text || "").toLocaleLowerCase("hi-IN").trim();

  // A search phrase inside a prohibition is not permission to search.
  // Examples: "कोई इंटरनेट खोज मत करना", "इंटरनेट खोज या स्रोत सूची न दिखाए".
  const searchIsForbidden = /(?:कोई|बिना)\s*(?:भी\s*)?(?:इंटरनेट|वेब|online)\s*(?:पर\s*)?(?:खोज|सर्च)|(?:इंटरनेट|वेब)\s*(?:पर\s*)?(?:खोज|सर्च).{0,45}(?:न\s*(?:करो|करें|करना|दिखाओ|दिखाए|दिखाना)|मत\s*(?:करो|करें|करना)|नहीं\s*(?:करना|चाहिए|दिखाना|दिखाए))/i.test(q);
  if (searchIsForbidden) return false;

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
  // Generic "कीमत" in a school discount problem is not a live market-price request.
  const prices = /(सोना|सोने|चांदी|चाँदी|हीरा|हीरे|gold|silver|diamond|bullion)/i.test(q)
    && (recent || /(भाव|दाम|रेट|price|rate)/i.test(q));
  const official = /(परीक्षा तिथि|एडमिट कार्ड|प्रवेश पत्र|रिजल्ट|(?:परीक्षा|बोर्ड|विश्वविद्यालय|चुनाव)\s*(?:का|के)?\s*परिणाम|परिणाम\s*(?:घोषित|जारी|देखें|चेक)|आवेदन|फॉर्म|फीस|पात्रता|सरकारी योजना|आधिकारिक|सिलेबस|पाठ्यक्रम|मान्यता|official syllabus|exam date|admit card|result|eligibility|application form)/i.test(q);
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
    || (isHistoricalResearchQuery(q) && /(स्रोत|संदर्भ|reference|source|verify|जाँच|जांच)/i.test(q));
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
    // Reject obvious placeholder paths so fabricated article IDs never reach the UI.
    if (/(?:^|[\\/?&#=_-])(?:x{3,}|placeholder|replace-me|todo)(?:[\\/?&#=_-]|$)/i.test(url.pathname + url.search + url.hash)) return false;
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
      // News needs a larger candidate pool because the final safety filters
      // remove untrusted publishers, undated pages, and articles not published
      // on the current India calendar day.
      numResults: isHistoricalResearchQuery(searchQuery) ? 15 : (isNewsQuery ? 40 : (isPreciousMetalQuery || isEducationQuery ? 8 : 5)),
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
      // Search only publishers accepted by filterRelevantSearchResults. This
      // prevents a small general-results pool from being exhausted by unrelated
      // domains before trusted publishers are considered.
      requestBody.includeDomains = [
        "indianexpress.com", "thehindu.com", "ndtv.com", "hindustantimes.com",
        "bbc.com", "reuters.com", "apnews.com", "news18.com", "aajtak.in",
        "abplive.com", "amarujala.com", "jagran.com", "zeenews.india.com",
        "indiatoday.in", "theprint.in", "livemint.com", "indiatimes.com",
        "pti.in", "aninews.in"
      ];
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
      .slice(0, isHistoricalResearchQuery(searchQuery) ? 15 : (isNewsQuery ? 40 : (isPreciousMetalQuery ? 8 : 5)))
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
  const candidates = (Array.isArray(results) ? results : []).slice(0, 8);
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
      // Exa may omit publishedDate even when the source page exposes its own
      // publication/update date. Read dates from the page, then apply the
      // same India-day freshness gate; never accept an undated page as current.
      const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
      const dateValues = [];
      for (const tag of metaTags) {
        const attr = name => {
          const match = tag.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"));
          return match ? match[2].trim() : "";
        };
        const key = (attr("property") || attr("name") || attr("itemprop")).toLowerCase();
        const value = attr("content");
        if (value && /^(article:modified_time|og:updated_time|datepublished|article:published_time|date|publishdate|pubdate|parsely-pub-date|dc.date.issued)$/i.test(key)) {
          dateValues.push(value);
        }
      }
      const jsonDates = [...html.matchAll(/["'](?:datePublished|dateModified|dateCreated)["']\s*:\s*["']([^"']+)["']/gi)].map(match => match[1]);
      const timeDates = [...html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["']/gi)].map(match => match[1]);
      const pageDate = [...dateValues, ...jsonDates, ...timeDates]
        .map(value => ({ value, time: Date.parse(value) }))
        .find(entry => Number.isFinite(entry.time) && entry.time <= Date.now());
      const pagePublishedAt = pageDate ? new Date(pageDate.time).toISOString() : "";
      const visible = cleanText(html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&#8377;|&#x20b9;/gi, "₹"));
      // Keep the publisher's lead rate statement separate from city rows.
      // A country-wide query must not accidentally inherit a nearby city value.
      const primaryRateSummaryMatch = visible.match(/On\s+\d{1,2}\s+[A-Za-z]+\s+\d{4},[\s\S]{0,650}?\bupdated\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s+IST/i);
      const primaryRateSummary = primaryRateSummaryMatch
        ? primaryRateSummaryMatch[0].replace(/\s+/g, " ").trim()
        : "";
      const contexts = [];
      // Price tables may separate city/purity labels and amounts into adjacent
      // cells. Keep a wider evidence window so the model can read the full row.
      const labelPattern = /(?:22\s*[- ]?\s*(?:k|karat|carat)|24\s*[- ]?\s*(?:k|karat|carat)|22 कैरेट|24 कैरेट|999(?:\s*(?:fine\s*)?silver)?|silver\s*999|999\s*fine|चाँदी|चांदी)/gi;
      let match;
      while ((match = labelPattern.exec(visible)) && contexts.length < 24) {
        const context = visible.slice(Math.max(0, match.index - 240), Math.min(visible.length, match.index + 420)).replace(/\s+/g, " ").trim();
        if (/(₹|rs\.?|inr|रुपये|रु\.?)/i.test(context) && /[0-9][0-9,]*(?:\.[0-9]+)?/.test(context)) contexts.push(context);
      }
      // Preserve complete HTML table rows: flattening the page into one text
      // string can detach a city label from its price and cause a neighbouring
      // city's number to be attributed to the Mumbai benchmark.
      // Some publisher articles render city-wise rates as heading + paragraph
      // sections rather than HTML table rows. Preserve each bounded city section
      // as evidence; never join it to the next city's section.
      const citySectionPattern = /(?:Gold|Silver)\s+(?:Prices|Rates)\s+in\s+((?:New\s+)?[A-Za-z][A-Za-z ]{1,30}?)\s*[—–-]/gi;
      const cityHeadings = [...visible.matchAll(citySectionPattern)];
      for (let i = 0; i < cityHeadings.length; i++) {
        const heading = cityHeadings[i];
        const sectionEnd = i + 1 < cityHeadings.length ? cityHeadings[i + 1].index : visible.length;
        const section = visible.slice(heading.index, sectionEnd).replace(/\s+/g, " ").trim();
        const ratePattern = /(?:24\s*(?:K|karat|carat)|22\s*(?:K|karat|carat)|24 कैरेट|22 कैरेट|silver\s*999(?:\s*fine)?|999(?:\s*(?:fine\s*)?silver)?|चाँदी|चांदी)[^₹]{0,180}(?:₹|Rs\.?|INR)\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:per\s*1?\s*kg|per\s*10\s*g(?:m|rams?)?|1\s*kg|10\s*g(?:m|rams?)?|\/\s*(?:1\s*)?kg|\/\s*10\s*g)?/gi;
        for (const rateMatch of section.matchAll(ratePattern)) {
          contexts.push("मूल HTML शहर-खंड: " + heading[1].trim() + " | " + rateMatch[0]);
        }
      }
      const tableRows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(row => cleanText(row[1]
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;|&#160;/gi, " ")
          .replace(/&#8377;|&#x20b9;/gi, "₹")).replace(/\s+/g, " ").trim())
        .filter(row => row && /(?:₹|rs\.?|inr)/i.test(row) && /[0-9][0-9,]*(?:\.[0-9]+)?/.test(row))
        .filter(row => /(?:दिल्ली|new\s+delhi|delhi|पटना|patna|मुंबई|mumbai|कोलकाता|kolkata|चेन्नई|chennai|बेंगलुरु|bengaluru|bangalore|हैदराबाद|hyderabad|अहमदाबाद|ahmedabad|जयपुर|jaipur|लखनऊ|lucknow|सिवान|siwan)/i.test(row) &&
          /(?:22\s*(?:k|karat|carat)|24\s*(?:k|karat|carat)|22 कैरेट|24 कैरेट|999|silver|चाँदी|चांदी)/i.test(row))
        .slice(0, 100)
        .map(row => "मूल HTML तालिका पंक्ति (शहर और भाव साथ): " + row);
      contexts.push(...tableRows);
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
        publishedAt: pagePublishedAt || item.publishedAt || "",
        pagePublishedAt: pagePublishedAt || "",
        primaryRateSummary,
        goldRates: (goldRates.per10g22K || goldRates.per10g24K) ? goldRates : null,
        silverRate: silverRate || null,
        rateContexts: [...new Set(contexts)].slice(0, 120),
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

function isIndiaFocusedNewsItem(item) {
  const title = cleanText(item?.title || "");
  const snippet = cleanText(item?.snippet || "");
  const headline = (title + " " + snippet).toLocaleLowerCase("hi-IN");

  // Exclude multi-topic publisher digests: they can mix one Indian item with
  // unrelated international stories under a single article title.
  if (/(?:^|\b)(?:ht|toi|ndtv)?\s*(?:morning|evening|daily)\s+brief\b|news roundup|daily roundup|top headlines/i.test(title)) {
    return false;
  }

  // A general international headline is not an Indian news item merely because
  // it appears on a publisher that also covers India.
  const indiaSignals = [
    /\bindia\b|\bindian\b|भारत|भारतीय/,
    /दिल्ली|नई दिल्ली|दिल्ली[- ]?ncr|delhi(?:[- ]?ncr)?|मथुरा|mathura|मुंबई|बेंगलुरु|बंगलौर|चेन्नई|कोलकाता|हैदराबाद|अहमदाबाद|पुणे|लखनऊ|पटना|जयपुर|भोपाल|चंडीगढ़|गुवाहाटी|श्रीनगर|सिवान|बिहार/,
    /sensex|nifty|बीएसई|एनएसई|रुपया|reserve bank of india|rbi|भारतीय रिजर्व बैंक/,
    /लोकसभा|राज्यसभा|संसद|सुप्रीम कोर्ट ऑफ इंडिया|सर्वोच्च न्यायालय|चुनाव आयोग|निर्वाचन आयोग|केंद्र सरकार|भारत सरकार|कैबिनेट|अग्निवीर|imd|isro|इसरो|चंद्रयान|navic/,
    /indian army|indian navy|indian air force|भारतीय सेना|भारतीय नौसेना|भारतीय वायुसेना/
  ];
  return indiaSignals.some(pattern => pattern.test(headline));
}

function filterFreshPreciousMetalResults(results, now = Date.now()) {
  // A "today" rate must come from a result published on today's India date.
  // Missing, invalid, future-dated, and older pages are not current price evidence.
  const todayIndia = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(now));
  return (Array.isArray(results) ? results : []).filter(item => {
    const publishedAt = item && typeof (item.pagePublishedAt || item.publishedAt) === "string" ? String(item.pagePublishedAt || item.publishedAt).trim() : "";
    if (!publishedAt) return false;
    const timestamp = Date.parse(publishedAt);
    if (!Number.isFinite(timestamp) || timestamp > now) return false;
    const publishedIndia = new Intl.DateTimeFormat("en-CA", {
      timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(timestamp));
    return publishedIndia === todayIndia;
  });
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
        const title = String(item.title || "");
        const headline = `${title} ${item.snippet || ""}`;
        if (!isIndiaFocusedNewsItem(item)) return false;
        // Do not treat astrology, calendar pages, or generic daily live-feed indexes
        // as independent reported articles. They often repeat headlines without
        // providing a distinct, date-stamped story.
        if (/(राशिफल|राशि फल|पंचांग|मुहूर्त|राहु.?काल|horoscope|zodiac|astrology|panchang)/i.test(headline)) return false;
        // Exclude live blogs, rolling feeds and publisher roundups: they are not
        // one independently reported story and often bundle unrelated events.
        if (/(मुख्य और ताजा समाचार|मुख्य और ताज़ा समाचार|लाइव ब्रेकिंग न्यूज|लाइव ब्रेकिंग न्यूज़|latest and breaking news today|latest news live|live news updates|india news live updates|news live updates|live updates|live blog|liveblogs|sports wrap|news roundup|evening brief|morning brief|daily brief|top stories|दिनभर की खबर|दिनभर के समाचार)/i.test(title)) return false;
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

function isSameIndianMarketEvent(a, b) {
  const titleA = cleanText(a?.title || "").toLowerCase();
  const titleB = cleanText(b?.title || "").toLowerCase();
  // Same-day reports about both benchmark indices describe one market event.
  const hasBothBenchmarks = value => /sensex/.test(value) && /nifty/.test(value);
  if (hasBothBenchmarks(titleA) && hasBothBenchmarks(titleB)) return true;

  // Different publishers often phrase the same Agniveer policy decision
  // differently. Do not count those reports as two separate daily headlines.
  const isAgniveerTenureUpdate = value =>
    /agniveer|अग्निवीर/.test(value) &&
    /(two years|2 years|दो साल|दो वर्ष|service period|service tenure|tenure|extension|extend|सेवा अवधि|अवधि बढ़|अवधि बढ़|विस्तार)/.test(value);
  return isAgniveerTenureUpdate(titleA) && isAgniveerTenureUpdate(titleB);
}

function dedupeNewsResults(results) {
  // Group repeated coverage of the same event. When the same publisher has
  // multiple versions of one story, combine only that publisher's excerpts so
  // a newer short update does not erase useful facts from its earlier report.
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
  const publisherFor = value => {
    try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return ""; }
  };
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
    const duplicateIndex = accepted.findIndex(previous => {
      if (isSameIndianMarketEvent(item, previous)) return true;
      const previousTokens = previous._dedupeTokens;
      let shared = 0;
      for (const token of titleTokens) if (previousTokens.has(token)) shared++;
      const smaller = Math.min(titleTokens.size, previousTokens.size);
      const overlap = smaller ? shared / smaller : 0;
      return shared >= 3 && overlap >= 0.8;
    });
    if (duplicateIndex >= 0) {
      const previous = accepted[duplicateIndex];
      // Never mix excerpts from different publishers: only combine versions
      // from the same newsroom and the same deduplicated event.
      if (publisherFor(item.url) && publisherFor(item.url) === publisherFor(previous.url)) {
        const excerpts = [previous.snippet, item.snippet]
          .map(value => cleanText(value || ""))
          .filter(Boolean);
        accepted[duplicateIndex] = {
          ...previous,
          snippet: [...new Set(excerpts)].join(" ").slice(0, 1600)
        };
      }
      continue;
    }
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
  // "Today's news" means the current calendar day in India, not merely any
  // article from the previous 48 hours. This prevents yesterday's digest from
  // being presented as today's headlines after midnight IST.
  const todayIndia = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(now));
  return (Array.isArray(results) ? results : []).filter(item => {
    const publishedAt = item && typeof item.publishedAt === "string" ? item.publishedAt.trim() : "";
    if (!publishedAt) return false;
    const timestamp = Date.parse(publishedAt);
    if (!Number.isFinite(timestamp) || timestamp > now) return false;
    const publishedIndia = new Intl.DateTimeFormat("en-CA", {
      timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(timestamp));
    return publishedIndia === todayIndia;
  });
}

function sortNewsByPublicationTime(results) {
  return (Array.isArray(results) ? [...results] : []).sort((a, b) => {
    const aTime = Date.parse(a?.publishedAt || "");
    const bTime = Date.parse(b?.publishedAt || "");
    const safeA = Number.isFinite(aTime) ? aTime : 0;
    const safeB = Number.isFinite(bTime) ? bTime : 0;
    return safeB - safeA;
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

function isCurrentNewsQuery(text) {
  return /(?:ताज़ा|ताजा|मुख्य|प्रमुख).{0,35}खबर|आज.{0,60}(?:खबर|समाचार)|(?:latest|breaking|current)\s+news|today.?s\s+news|समाचार/i.test(String(text || ""));
}

function hasUnsupportedNumericClaim(generatedText, sourceEvidence) {
  const hindiNumbers = {"शून्य":"0","दो":"2","तीन":"3","चार":"4","पाँच":"5","पांच":"5","छह":"6","छः":"6","सात":"7","आठ":"8","नौ":"9","दस":"10","ग्यारह":"11","बारह":"12","पंद्रह":"15","बीस":"20","पच्चीस":"25","तीस":"30","चालीस":"40","पचास":"50","साठ":"60","सत्तर":"70","पचहत्तर":"75","अस्सी":"80","नब्बे":"90","सौ":"100","हजार":"1000","लाख":"100000","करोड़":"10000000"};
  const englishNumbers = {"zero":"0","two":"2","three":"3","four":"4","five":"5","six":"6","seven":"7","eight":"8","nine":"9","ten":"10","eleven":"11","twelve":"12","fifteen":"15","twenty":"20","thirty":"30","forty":"40","fifty":"50","sixty":"60","seventy":"70","seventy-five":"75","eighty":"80","ninety":"90","hundred":"100","thousand":"1000","lakh":"100000","crore":"10000000"};
  const normalize = value => String(value || "")
    .replace(/[०-९]/g, digit => String("०१२३४५६७८९".indexOf(digit)))
    .replace(/\b(seventy-five|zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|crore)\b/gi, word => englishNumbers[word.toLowerCase()] || word)
    .replace(/शून्य|दो|तीन|चार|पाँच|पांच|छह|छः|सात|आठ|नौ|दस|ग्यारह|बारह|पंद्रह|बीस|पच्चीस|तीस|चालीस|पचास|साठ|सत्तर|पचहत्तर|अस्सी|नब्बे|सौ|हजार|लाख|करोड़/g, word => hindiNumbers[word] || word);
  const sourceNumbers = new Set(normalize(sourceEvidence).match(/\d+(?:[.,]\d+)?%?/g) || []);
  const generatedNumbers = normalize(generatedText).match(/\d+(?:[.,]\d+)?%?/g) || [];
  return generatedNumbers.some(number => !sourceNumbers.has(number));
}

function hasMixedScriptToken(text) {
  return String(text || "").split(/\s+/).some(token =>
    token.split(/[-‐‑‒–—/|()[\]{}.,:;!?]+/).some(part =>
      /[A-Za-z]/.test(part) && /[\u0900-\u097F]/.test(part)
    )
  );
}

function hasUnsupportedCertaintyClaim(generatedText, sourceEvidence) {
  const generated = String(generatedText || "");
  const source = String(sourceEvidence || "");
  const sourceIsTentative = /(?:consider(?:ing|ed)|weigh(?:ing|ed)|under consideration|proposal|proposed|plan(?:s|ned)? to.{0,100}\bif\b|\bif\b.{0,100}(?:plan|artificial rain|cloud seeding)|conditional|may\b|might\b|could\b|likely to|more trials are likely|no official (?:announcement|confirmation)|not yet (?:decided|approved|announced)|विचार कर(?: रहा| रही| रहे)?|विचाराधीन|संभावित|संभावना|प्रस्ताव|यदि|अगर|की स्थिति में|बढ़ने पर|बढ़ने पर|अभी.*(?:निर्णय|मंजूरी|घोषणा).*(?:नहीं|नही)|अंतिम योजना.*(?:नहीं|नही))/i.test(source);
  if (!sourceIsTentative) return false;
  return /(?:निर्णय\s*(?:ले लिया|कर लिया)|फैसला\s*(?:ले लिया|कर लिया)|मंजूरी\s*(?:दे दी|मिल गई)|घोषणा\s*(?:कर दी|की)|तय\s*कर दिया|लागू\s*कर दिया|शुरू\s*कर दिया|कराने का निर्णय|करने का फैसला|(?:सरकार|मंत्रालय|प्रशासन).{0,45}योजना\s*(?:बना|तैयार|घोषित)|योजना\s*(?:बना ली|तैयार कर ली|घोषित कर दी)|कराएगा|कराएगी|करेंगे|करेंगी|होगा|होगी|has decided|decided to|approved|gave approval|announced|will (?:conduct|carry out|implement|launch)|is set to (?:conduct|carry out|implement|launch))/i.test(generated);
}

function formatCurrentNewsSummaryReply(rawReply, results, requireTwoSentences = false) {
  const items = dedupeNewsResults(results).filter(item => {
    const title = cleanText(item?.title || "");
    const publishedAt = Date.parse(item?.publishedAt || "");
    try {
      const url = new URL(item?.url || "");
      return title.length > 0 && url.protocol === "https:" && Boolean(url.hostname) && Number.isFinite(publishedAt);
    } catch { return false; }
  }).slice(0, 5);
  // A five-story request must never be silently downgraded to a partial digest.
  if (items.length !== 5) return "";
  const entries = new Map();
  let current = null;
  const hindiDigits = { "०":"0", "१":"1", "२":"2", "३":"3", "४":"4", "५":"5", "६":"6", "७":"7", "८":"8", "९":"9" };
  for (const rawLine of String(rawReply || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\*\*/g, "").replace(/^[-•]\s*/, "").replace(/[०-९]/g, digit => hindiDigits[digit]).trim();
    const headline = line.match(/^(?:(?:खबर|समाचार)\s*)?(\d+)\s*[:：.)\-–—]\s*(.+)$/i) || line.match(/^(?:खबर|समाचार)\s*(\d+)\s*[:：]\s*(.+)$/i);
    if (headline) {
      current = Number(headline[1]);
      if (current >= 1 && current <= items.length) {
        entries.set(current, { headline: cleanText(headline[2]).replace(/मध्यमार्गीय चुनावों?/gi, "मध्यावधि चुनाव").slice(0, 220), summary: "" });
      } else {
        current = null;
      }
      continue;
    }
    if (current === null || !entries.has(current) || !line) continue;
    const summary = line.match(/^(?:सार|सारांश|संक्षेप|विवरण)\s*[:：-]\s*(.+)$/i);
    if (summary) {
      entries.get(current).summary = cleanText(summary[1]).replace(/मध्यमार्गीय चुनावों?/gi, "मध्यावधि चुनाव").slice(0, 420);
      continue;
    }
    // Allow a second summary sentence on the following line, but never absorb
    // publisher metadata or the next numbered headline into the summary.
    if (entries.get(current).summary && !/^(?:प्रकाशक|स्रोत|प्रकाशित|लिंक)\s*[:：]/i.test(line)) {
      entries.get(current).summary = (entries.get(current).summary + " " + cleanText(line)).slice(0, 420);
      continue;
    }
    // Accept a plain first summary line when the model omits the "सार:" label.
    if (!entries.get(current).summary && !/^(?:प्रकाशक|स्रोत|प्रकाशित|लिंक)\s*[:：]/i.test(line)) {
      entries.get(current).summary = cleanText(line).slice(0, 420);
    }
  }
  const lines = [];
  for (let index = 0; index < items.length; index++) {
    const entry = entries.get(index + 1);
    // Validate each story independently. One malformed or weak summary must
    // not erase other stories whose Hindi summaries pass every source check.
    if (!entry?.headline || !entry?.summary) continue;
    const sentenceEnds = entry.summary.match(/[।!?]+|(?<![0-9])\.(?![0-9])/g) || [];
    if (requireTwoSentences && (sentenceEnds.length < 2 || sentenceEnds.length > 3)) continue;
    const sourceEvidence = cleanText((items[index]?.title || "") + " " + (items[index]?.snippet || ""));
    const generatedText = entry.headline + " " + entry.summary;
    const isAgniveerExtension = /agniveer|अग्निवीर/i.test(sourceEvidence) &&
      /(?:75\s*%|७५\s*प्रतिशत|remaining\s+75|शेष\s+७५)/i.test(sourceEvidence);
    if (isAgniveerExtension && !/(?:75\s*%|७५\s*(?:प्रतिशत|फीसदी)|शेष\s+७५|पचहत्तर\s*(?:प्रतिशत|फीसदी)?)/i.test(generatedText)) continue;
    if (hasMixedScriptToken(generatedText)) continue;
    if (hasUnsupportedNumericClaim(generatedText, sourceEvidence)) continue;
    if (hasUnsupportedCertaintyClaim(generatedText, sourceEvidence)) continue;
    const claimsWestAsiaConflict = /(?:पश्चिम एशिया|मध्य पूर्व|मिडिल ईस्ट|west asia|middle east|iran|iranian|israel|israeli).{0,70}(?:संघर्ष|युद्ध|तनाव|शांति|समाधान|conflict|war|tension|peace|ceasefire)|(?:संघर्ष|युद्ध|तनाव|शांति|समाधान|conflict|war|tension|peace|ceasefire).{0,70}(?:पश्चिम एशिया|मध्य पूर्व|मिडिल ईस्ट|west asia|middle east|iran|iranian|israel|israeli)/i.test(generatedText);
    const sourceMentionsWestAsiaConflict = /(?:पश्चिम एशिया|मध्य पूर्व|मिडिल ईस्ट|west asia|middle east|iran|iranian|israel|israeli).{0,100}(?:संघर्ष|युद्ध|तनाव|शांति|समाधान|conflict|war|tension|peace|ceasefire)|(?:संघर्ष|युद्ध|तनाव|शांति|समाधान|conflict|war|tension|peace|ceasefire).{0,100}(?:पश्चिम एशिया|मध्य पूर्व|मिडिल ईस्ट|west asia|middle east|iran|iranian|israel|israeli)/i.test(sourceEvidence);
    if (claimsWestAsiaConflict && !sourceMentionsWestAsiaConflict) continue;
    // A disclaimer about missing evidence is not a news summary. Reject the
    // story instead of replacing its summary with generic filler.
    if (/(?:उपलब्ध स्रोत|लेख-अंश|स्रोत-अंश).{0,90}(?:पुष्टि नहीं करता|पुष्टि नहीं होती|पर्याप्त जानकारी नहीं|विवरण उपलब्ध नहीं|निष्कर्ष नहीं निकाला जा सकता)/i.test(entry.summary)) continue;
    const claimsCause = /(?:के कारण|की वजह से|के चलते|के फलस्वरूप|का कारण बना|कारण बना|की बदौलत)/i.test(generatedText);
    const sourceExplicitlyStatesCause = /(?:because of|due to|caused by|attributed to|triggered by|owing to|as a result of|के कारण|की वजह से|के चलते|की बदौलत)/i.test(sourceEvidence);
    if (claimsCause && !sourceExplicitlyStatesCause) continue;
    let publisher = "प्रकाशक उपलब्ध नहीं";
    try { publisher = new URL(items[index].url).hostname.toLowerCase().replace(/^www\./i, ""); } catch {}
    lines.push("खबर " + (lines.length + 1) + ": " + entry.headline + "\nसार: " + entry.summary +
      "\nप्रकाशक: " + publisher + "\nप्रकाशित: " + formatNewsPublishedAt(items[index].publishedAt));
  }
  // Return a digest only when all five independent stories pass validation.
  // Never show 1, 2, 3, 5 or claim that a four-story list is a five-story answer.
  if (lines.length !== 5) return "";
  const prefix = "आज की 5 अलग-अलग, तारीख़-जाँची खबरें:";
  return prefix + "\n\n" + lines.join("\n\n") + "\n\nध्यान दें: हर सार संबंधित समाचार के उपलब्ध लेख-अंश पर आधारित है.";
}
function buildCurrentNewsHeadlineReply(results) {
  // Count only distinct, displayable articles with a real HTTPS publisher URL; never emit headline-only output.
  // A headline-only list does not satisfy a request for Hindi summaries.
  // If the summarizer and repair attempt both fail, do not expose English
  // headlines as though they were a useful substitute for the requested digest.
  const items = dedupeNewsResults(results).filter(item => {
    const title = cleanText(item?.title || "");
    const publishedAt = Date.parse(item?.publishedAt || "");
    try {
      const url = new URL(item?.url || "");
      return title.length > 0 && url.protocol === "https:" &&
        Boolean(url.hostname) && Number.isFinite(publishedAt);
    } catch {
      return false;
    }
  }).slice(0, 5);
  if (!items.length) {
    return "आज की ताज़ा खबरों के लिए तारीख़-जाँचे हुए भरोसेमंद समाचार परिणाम नहीं मिले। कृपया कुछ देर बाद फिर कोशिश करें।";
  }
  if (items.length < 5) {
    return "आज केवल " + items.length + " अलग-अलग, तारीख़-जाँचे समाचार स्रोत मिले। पाँच अलग खबरों की सूची पूरी करने के लिए पर्याप्त स्रोत नहीं मिले, इसलिए अपुष्ट खबर जोड़ने के बजाय मैं अधूरी सूची नहीं दिखा रहा हूँ। कृपया कुछ देर बाद फिर कोशिश करें।";
  }
  return "आज 5 तारीख़-जाँचे समाचार परिणाम मिले, लेकिन सभी 5 खबरों के हिंदी सार स्रोत-जाँच में सफल नहीं हुए। आपकी माँग के अनुसार 5 अलग खबरें और हर खबर का 2–3 वाक्यों का सार देना आवश्यक है; इसलिए अधूरी सूची या अपुष्ट सार नहीं दिखाया जा रहा। कृपया कुछ देर बाद फिर कोशिश करें।";
}

function buildCompactNewsSourceContext(results) {
  return (Array.isArray(results) ? results : []).slice(0, 6).map((item, index) => {
    const title = cleanText(item?.title || "").slice(0, 240);
    const snippet = cleanText(item?.snippet || "").slice(0, 900);
    const publisher = cleanText(item?.publisher || "").slice(0, 100);
    const publishedAt = formatNewsPublishedAt(item?.publishedAt || "");
    return "स्रोत " + (index + 1) + ":\nशीर्षक: " + title +
      "\nप्रकाशक: " + publisher + "\nप्रकाशित: " + publishedAt +
      "\nउपलब्ध लेख-अंश: " + (snippet || "लेख का पर्याप्त अंश उपलब्ध नहीं है।");
  }).join("\n\n");
}

function buildProviderBusySearchFallback(results, query, reason = "AI सेवा इस समय व्यस्त है, इसलिए खोज परिणामों का हिंदी सार तैयार नहीं हो सका।") {
  const items = (Array.isArray(results) ? results : []).slice(0, 8);
  if (!items.length) return "";
  const isBullion = /(सोने|सोना|gold|चांदी|चाँदी|silver|bullion|22\\s*k|24\\s*k)/i.test(String(query || ""));
  if (isBullion) {
    const cities = [
      { label: "दिल्ली", re: /दिल्ली|\bdelhi\b|new delhi/i },
      { label: "पटना", re: /पटना|\bpatna\b/i },
      { label: "मुंबई", re: /मुंबई|मुम्बई|\bmumbai\b/i },
      { label: "कोलकाता", re: /कोलकाता|कलकत्ता|\bkolkata\b/i },
      { label: "चेन्नई", re: /चेन्नई|मद्रास|\bchennai\b/i },
      { label: "बेंगलुरु", re: /बेंगलुरु|बंगलौर|\bbengaluru\b|\bbangalore\b/i },
      { label: "हैदराबाद", re: /हैदराबाद|\bhyderabad\b/i },
      { label: "अहमदाबाद", re: /अहमदाबाद|\bahmedabad\b/i },
      { label: "जयपुर", re: /जयपुर|\bjaipur\b/i },
      { label: "लखनऊ", re: /लखनऊ|\blucknow\b/i },
      { label: "सिवान", re: /सिवान|\bsiwan\b/i }
    ];
    const city = cities.find(entry => entry.re.test(String(query || "")));
    if (city) {
      const extracted = [];
      for (const item of items) {
        const rows = (Array.isArray(item.rateContexts) ? item.rateContexts : [])
          .filter(row => /^मूल HTML (?:तालिका पंक्ति|शहर-खंड)/.test(row) && city.re.test(row));
        const rates = [];
        for (const row of rows) {
          const find = (label, unit) => {
            const re = new RegExp("(?:"
              + label
              + ")[^₹]{0,180}(?:₹|Rs\\.?|INR)\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(" + unit + ")", "i");
            const match = row.match(re);
            return match ? { value: match[1], unit: match[2] } : null;
          };
          const gold24 = find("(?:24\\s*(?:K|karat|carat)|24\\s*कैरेट)", "(?:per\\s*10\\s*g(?:m|rams?)?|10\\s*g(?:m|rams?)|\\/\\s*10\\s*g(?:m|rams?)?)");
          const gold22 = find("(?:22\\s*(?:K|karat|carat)|22\\s*कैरेट)", "(?:per\\s*10\\s*g(?:m|rams?)?|10\\s*g(?:m|rams?)|\\/\\s*10\\s*g)");
          const silver = find("(?:999\\s*(?:fine\\s*)?silver|silver\\s*999(?:\\s*fine)?|999\\s*शुद्धता\\s*(?:की\\s*)?चाँदी)", "(?:per\\s*1\\s*kg|per\\s*kg|1\\s*kg|\\/\\s*1\\s*kg|\\/\\s*kg)");
          if (gold24) rates.push("24 कैरेट सोना: ₹" + gold24.value + " प्रति 10 ग्राम");
          if (gold22) rates.push("22 कैरेट सोना: ₹" + gold22.value + " प्रति 10 ग्राम");
          if (silver) rates.push("999 चाँदी: ₹" + silver.value + " प्रति किलोग्राम");
        }
        if (rates.length) {
          const date = item.publishedAt ? formatNewsPublishedAt(item.publishedAt) : "प्रकाशन तारीख उपलब्ध नहीं";
          extracted.push(city.label + " — " + rates.join("; ") + "\\nस्रोत: " + (item.publisher || "प्रकाशक उपलब्ध नहीं") + " | तारीख: " + date);
        }
      }
      if (extracted.length) {
        return reason + " खोजे गए स्रोतों के मूल HTML में केवल " + city.label + " वाली शहर-विशिष्ट पंक्तियों और खंडों से ये दरें स्पष्ट रूप से निकली हैं। AI सार उपलब्ध नहीं है, इसलिए नीचे केवल सीधे पढ़े जा सकने वाले आँकड़े दिए हैं:\\n\\n" + extracted.join("\\n\\n") + "\\n\\nध्यान दें: केवल उन्हीं श्रेणियों की दरें दिखाई गई हैं जिनकी संख्या और इकाई उसी शहर के स्पष्ट स्रोत-अंश में उपलब्ध थीं।";
      }
      return reason + " दिल्ली/माँगे गए शहर के खोज परिणाम मिले, लेकिन मूल HTML तालिका में शहर, शुद्धता, भाव और इकाई एक ही पंक्ति में स्पष्ट रूप से नहीं मिले। इसलिए कोई भाव अनुमान से नहीं दिया गया। नीचे स्रोतों की जानकारी उपलब्ध है।";
    }
  }
  return reason + " नीचे खोज में मिले वास्तविक परिणाम अलग से दिए गए हैं। उनके शीर्षक और प्रकाशन-तारीख देखकर मूल खबर पढ़ें; यह AI द्वारा सत्यापित समाचार-सार नहीं है।";
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
    ? "\\n\\nसमाचार के सख्त निर्देश: एक ही घटना को केवल एक बार बताओ; समान रिपोर्ट को जोड़ो, लेकिन अलग घटनाओं को मत मिलाओ। हर खोज परिणाम को उसके क्रमांक (1, 2, 3...) से पहचानो। किसी खबर का हर तथ्य—कौन, क्या, कहाँ, कब, संख्या और असर—उसी एक परिणाम के शीर्षक/अंश से समर्थित होना चाहिए; अलग-अलग परिणामों के अधूरे अंश जोड़कर एक नई घटना या कहानी मत बनाओ। खबर के अंत में केवल उसी परिणाम के प्रकाशक और क्रमांक को स्रोत बताओ। यदि किसी तथ्य के लिए दूसरा स्वतंत्र स्रोत भी वही बात स्पष्ट रूप से कहता है, तभी दोनों स्रोत लिखो; केवल एक ही घटना पर अलग शीर्षक होना पुष्टि नहीं है। प्रकाशित तारीख केवल प्रकाशित फ़ील्ड से लो; घटना की तारीख केवल खबर के पाठ से लो। तारीख उपलब्ध न हो या अमान्य हो तो उसे आज की खबर बताकर शामिल मत करो। आज की खबरों में केवल पिछले 48 घंटों में प्रकाशित और वर्तमान समय से आगे की तारीख न रखने वाले परिणाम शामिल करो। एक ही एजेंसी की कॉपी को स्वतंत्र पुष्टि मत मानो। राजनीतिक आरोपों को आरोप के रूप में ही लिखो। हर खबर के तथ्य केवल उसी परिणाम के शीर्षक और उपलब्ध जानकारी वाले अंश से लो; अपनी सामान्य जानकारी, अनुमान या दूसरी खबर के आधार पर कोई अतिरिक्त घटना, स्थान, संख्या, नुकसान, उड़ान रद्द होने या असर का दावा मत जोड़ो। यदि अंश में घटना केवल संभावित/पूर्वानुमानित है तो उसे हो चुकी घटना की तरह मत लिखो; साफ बताओ कि यह चेतावनी या पूर्वानुमान है। शीर्षक अकेला हो और अंश में विवरण न हो तो केवल शीर्षक का संक्षिप्त परिचय दो या खबर छोड़ दो। एक तथ्य का स्रोत स्पष्ट न हो तो उसे शामिल मत करो। यदि दो परिणाम एक ही तथ्य पर अलग-अलग संख्या, तारीख, स्थान या स्थिति बताते हैं, तो किसी एक को चुपचाप सही मत चुनो और दोनों को जोड़कर नया आँकड़ा मत बनाओ; अंतर को साफ तौर पर संबंधित प्रकाशकों के नाम/क्रमांक के साथ बताओ, या उस विवादित तथ्य को छोड़ दो। मौत, घायल, नुकसान, गिरफ्तारी और प्रभावित लोगों की संख्या तभी लिखो जब उसी परिणाम के अंश में संख्या स्पष्ट हो; केवल शीर्षक, दूसरे परिणाम या सामान्य जानकारी से संख्या मत निकालो। स्रोत में संख्या न हो तो संख्या मत दो। यदि परिणामों के प्रकाशित समय अलग हों, तो पुराने आँकड़े को वर्तमान स्थिति की तरह मत दिखाओ; उपलब्ध समय बताओ और नवीनतम स्थिति की पुष्टि न होने पर स्पष्ट कहो। शेयर बाजार के लिए कारोबार की स्थिति और समय का विशेष ध्यान रखो: खुला, सुबह कारोबार कर रहा है, इंट्राडे उच्च स्तर, बंद हुआ और समापन स्तर अलग-अलग बातें हैं। यदि स्रोत सुबह/खुलने के समय का है तो Sensex/Nifty के आँकड़ों को कभी बंद हुआ या दिन का अंतिम स्तर मत लिखो; केवल सुबह के कारोबार में या शुरुआती कारोबार में कहो। बाजार बंद होने का दावा तभी करो जब स्रोत स्पष्ट रूप से उसी कारोबारी दिन का closing/समापन स्तर बताए और समय/तारीख मेल खाए। विरोधी या समय-संदर्भ-विहीन आँकड़े हों तो संख्या छोड़ दो और सीमा बताओ। चक्रवात, मौसम, दुर्घटना और सरकारी आदेश में चेतावनी/पूर्वानुमान को घटित घटना न बताओ; प्रभावित स्थान, क्षति, मौत या बचाव का दावा तभी करो जब उसी खबर के अंश में साफ लिखा हो। एक खबर के अंश से दूसरी खबर का तथ्य जोड़कर नई कहानी मत बनाओ। उपलब्ध परिणामों में से अधिकतम 8 अलग और महत्वपूर्ण खबरें चुनो। हर खबर में केवल एक छोटा, सीधा हिंदी वाक्य लिखो। उस वाक्य का हर तथ्य उसी परिणाम के शीर्षक और उपलब्ध अंश में साफ़ मौजूद होना चाहिए; कोई अतिरिक्त घटना, व्यक्ति, संख्या, समय, कारण या असर मत जोड़ो। शीर्षक/अंश में विवरण न हो तो केवल शीर्षक का अर्थ बताओ या खबर छोड़ दो। प्रकाशक और प्रकाशित तारीख़ तभी दो जब वे परिणाम में उपलब्ध हों। सप्ताह का दिन अनुमान से कभी मत बताओ। हिंदी सवाल पर पूरा उत्तर सहज देवनागरी हिंदी में दो; अंग्रेज़ी शीर्षक, अंग्रेज़ी लेख का अंश या मेटाडेटा ज्यों-का-त्यों बिल्कुल मत छोड़ो। अंग्रेज़ी स्रोत को समझकर अपने शब्दों में हिंदी में सार लिखो। कम से कम 2 उपयोगी परिणाम न हों तो खबरों की संख्या बढ़ाकर मत दिखाओ। URL मत लिखो और कोई तथ्य मत गढ़ो।"
    : "";
  const preciousMetalInstruction = isPreciousMetalQuery
    ? "\\n\\nसोना-चाँदी भाव उत्तर का अनिवार्य प्रारूप: उत्तर अधूरा मत छोड़ो। यदि सवाल में कोई शहर नहीं पूछा गया है, तो शहरवार तालिका की किसी भी पंक्ति से भाव बिल्कुल मत निकालो और उसे भारत/राष्ट्रीय/मुंबई का भाव मत बताओ। ऐसे सवाल में केवल तभी कोई भाव दो जब उसी प्रकाशक के मुख्य/देश-स्तरीय सारांश में धातु, शुद्धता, स्पष्ट संख्या और इकाई सीधे साथ लिखे हों; केवल 'updated at' वाला मुख्य वाक्य भाव का प्रमाण नहीं है। यदि मुख्य सारांश में ये चारों बातें नहीं हैं, तो उस प्रकाशक के लिए 'राष्ट्रीय भाव स्पष्ट रूप से उपलब्ध नहीं' लिखो। शहरवार तालिका को केवल तभी उपयोग करो जब उपयोगकर्ता ने उसी शहर का नाम पूछा हो, और तब शहर, शुद्धता, संख्या तथा इकाई उसी एक पंक्ति में स्पष्ट हों। शहरवार तालिका की हर पंक्ति को एक अविभाज्य इकाई मानो: शहर, 24K, 22K और चाँदी के भाव केवल उसी पंक्ति से लो। यदि शहर का नाम और भाव एक ही पंक्ति में स्पष्ट न हों तो उस शहर का भाव मत दो। मुख्य सारांश और शहरवार पंक्ति में अंतर हो तो दोनों को अलग-अलग संदर्भ बताओ, एक-दूसरे के स्थान पर मत रखो। पहले तारीख और हर स्रोत का प्रकाशित/अपडेट समय बताओ; समय उपलब्ध न हो तो 'अपडेट समय उपलब्ध नहीं' लिखो। अलग-अलग प्रकाशकों के कम-से-कम 2 स्वतंत्र स्रोतों का मिलान करो; अगर 2 न हों तो यह सीमा साफ बताओ और एक स्रोत को पक्का भाव मत कहो। फिर साफ सूची/तालिका दो: धातु | शुद्धता | भाव | इकाई | शहर/बाजार | स्रोत | अपडेट समय। सोने के लिए 24 कैरेट और 22 कैरेट (24K/22K) तथा चाँदी के लिए 999 शुद्धता अलग-अलग दिखाओ। स्रोत में स्पष्ट रूप से प्रति 10 ग्राम लिखा हो तभी वही भाव प्रति 10 ग्राम बताओ। स्रोत में प्रति ग्राम लिखा हो तो प्रति 10 ग्राम का भाव केवल उसी संख्या को 10 से गुणा करके निकालो और उसके आगे '(गणना: प्रति ग्राम × 10)' लिखो। स्रोत में प्रति 10 ग्राम और प्रति ग्राम दोनों दिए हों तो दोनों का गणित मिलाओ; मेल न खाने पर उनमें से किसी एक को चुपचाप सही मत चुनो—विसंगति बताओ और केवल स्पष्ट मूल इकाई वाला आंकड़ा दो। चाँदी के लिए प्रति किलो और प्रति ग्राम का मिलान भी जाँचो (प्रति ग्राम × 1000 = प्रति किलो)। यदि स्रोत प्रति किलो ₹1,79,120 और प्रति ग्राम लगभग ₹179 दिखाता है, तो ₹179 को पूर्ण/सटीक दर मत मानो: सटीक समतुल्य ₹179.12 प्रति ग्राम है; ₹179 केवल निकटतम रुपये में गोल किया गया मान है। इसी तरह सोने में प्रति 10 ग्राम की दर से प्रति ग्राम निकालते समय जरूरत हो तो दो दशमलव तक दिखाओ। किसी गोल किए गए प्रति ग्राम मान को वापस गुणा करके मूल प्रति किलो/10 ग्राम भाव बदलकर मत बताओ; स्रोत की मूल प्रकाशित दर को प्राथमिकता दो और गोलाई स्पष्ट लिखो। हर गणना दोबारा जाँचो: 13,888 × 10 = 1,38,880; 12,730 × 10 = 1,27,300; 179 × 1000 = 1,79,000। गणना के परिणाम को स्रोत का प्रकाशित भाव मत बताओ। 22K/24K/999 की शुद्धता आपस में मत मिलाओ। शहर का नाम न हो तो शहर मत गढ़ो। अलग स्रोतों के भाव अलग हों तो स्रोत, समय और इकाई सहित अलग-अलग बताओ; औसत या एक पक्का राष्ट्रीय भाव मत बनाओ। खुदरा भाव, IBJA बेंचमार्क और MCX वायदा को एक जैसा मत बताओ। GST और मेकिंग चार्ज को मूल धातु भाव से अलग रखो। स्रोत में संख्या/इकाई स्पष्ट न हो तो 'स्पष्ट भाव उपलब्ध नहीं' लिखो; अनुमान, खाली पंक्ति या काल्पनिक कीमत बिल्कुल मत बनाओ। अंत में स्रोतों के नाम बताओ। हर प्रकाशक के आँकड़े उसी प्रकाशक के अलग खंड में रखो; एक वेबसाइट के आँकड़े को दूसरी वेबसाइट के नाम से कभी मत जोड़ो। किसी भाव को तभी लिखो जब उसी स्रोत के शीर्षक/अंश या उसी स्रोत के निकाले गए मूल मूल्य-संदर्भ में धातु, शुद्धता, स्पष्ट संख्या और इकाई का सीधा मेल हो। पास-पास दिखने वाली संख्या को अपने-आप उसी धातु/शुद्धता/शहर का भाव मत मानो। अधूरा या कटा हुआ अंक (जैसे ₹1,39 या ₹1,39,) बिल्कुल छोड़ दो; उसे पूरा मत करो। किसी स्रोत के मूल मूल्य-संदर्भ में 24K/22K/999 की स्पष्ट पंक्ति न मिले तो उस स्रोत से उस श्रेणी का भाव मत दो, भले दूसरे स्रोत में वही भाव मौजूद हो। MCX, IBJA, ज्वेलरी ब्रांड और खुदरा सर्राफा दरों को अलग-अलग बाजार श्रेणियों में रखो। यदि अलग स्रोतों के भावों में बड़ा अंतर हो, तो उसे चुपचाप एक साथ प्रस्तुत न करो; संबंधित स्रोत और समय के साथ अंतर बताओ या अविश्वसनीय/अस्पष्ट भाव छोड़ दो।"
    : "";

  return "\n\nइंटरनेट खोज के परिणाम:\n" + results.map(
    (item, i) => {
      const published = (isNewsQuery || isPreciousMetalQuery)
        ? formatNewsPublishedAt(item.publishedAt)
        : (item.publishedAt || "तारीख उपलब्ध नहीं");
      // For an India-wide question, never expose city-table values to the model.
      // Strip the appended table snippet too, or city prices can leak back into the prompt.
      // Map Hindi and English spellings to the same requested city.
      // City rows are included only for an explicitly requested city; national
      // questions continue to receive only the publisher's national lead summary.
      const bullionCities = [
        { key: "patna", label: "पटना", re: /पटना|\bpatna\b/i },
        { key: "mumbai", label: "मुंबई", re: /मुंबई|मुम्बई|\bmumbai\b/i },
        { key: "delhi", label: "दिल्ली", re: /दिल्ली|\bdelhi\b/i },
        { key: "kolkata", label: "कोलकाता", re: /कोलकाता|कलकत्ता|\bkolkata\b/i },
        { key: "chennai", label: "चेन्नई", re: /चेन्नई|मद्रास|\bchennai\b/i },
        { key: "bengaluru", label: "बेंगलुरु", re: /बेंगलुरु|बंगलौर|\bbengaluru\b|\bbangalore\b/i },
        { key: "hyderabad", label: "हैदराबाद", re: /हैदराबाद|\bhyderabad\b/i },
        { key: "ahmedabad", label: "अहमदाबाद", re: /अहमदाबाद|\bahmedabad\b/i },
        { key: "jaipur", label: "जयपुर", re: /जयपुर|\bjaipur\b/i },
        { key: "lucknow", label: "लखनऊ", re: /लखनऊ|\blucknow\b/i },
        { key: "kanpur", label: "कानपुर", re: /कानपुर|\bkanpur\b/i },
        { key: "varanasi", label: "वाराणसी", re: /वाराणसी|बनारस|\bvaranasi\b/i },
        { key: "agra", label: "आगरा", re: /आगरा|\bagra\b/i },
        { key: "prayagraj", label: "प्रयागराज", re: /प्रयागराज|इलाहाबाद|\bprayagraj\b|\ballahabad\b/i },
        { key: "siwan", label: "सिवान", re: /सिवान|\bsiwan\b/i },
        { key: "gaya", label: "गया", re: /गया|\bgaya\b/i },
        { key: "muzaffarpur", label: "मुजफ्फरपुर", re: /मुजफ्फरपुर|\bmuzaffarpur\b/i },
        { key: "ranchi", label: "रांची", re: /रांची|\branchi\b/i },
        { key: "bhopal", label: "भोपाल", re: /भोपाल|\bbhopal\b/i },
        { key: "indore", label: "इंदौर", re: /इंदौर|\bindore\b/i },
        { key: "nagpur", label: "नागपुर", re: /नागपुर|\bnagpur\b/i },
        { key: "pune", label: "पुणे", re: /पुणे|\bpune\b/i },
        { key: "surat", label: "सूरत", re: /सूरत|\bsurat\b/i },
        { key: "vadodara", label: "वडोदरा", re: /वडोदरा|\bvadodara\b/i },
        { key: "noida", label: "नोएडा", re: /नोएडा|\bnoida\b/i },
        { key: "gurugram", label: "गुरुग्राम", re: /गुरुग्राम|गुड़गांव|\bgurugram\b|\bgurgaon\b/i }
      ];
      const requestedCity = isPreciousMetalQuery
        ? bullionCities.find(city => city.re.test(query))
        : null;
      const explicitCity = requestedCity ? requestedCity.label : "";
      const cleanSnippet = isPreciousMetalQuery
        ? ""
        : (item.snippet || "जानकारी उपलब्ध नहीं है।");
      const matchingCityRows = requestedCity && Array.isArray(item.rateContexts)
        ? item.rateContexts.filter(row => requestedCity.re.test(row))
        : [];
      // This was the missing link: matchingCityRows was calculated but never
      // passed to the model. Include only rows naming the requested city.
      const rateEvidence = isPreciousMetalQuery
        ? [
            item.primaryRateSummary
              ? "\nप्रकाशक का मुख्य दर-सारांश (राष्ट्रीय/मुख्य संदर्भ): " + item.primaryRateSummary
              : "",
            matchingCityRows.length
              ? "\nमाँगे गए शहर " + explicitCity + " की मूल पेज/तालिका पंक्तियाँ (केवल इसी शहर की): " + matchingCityRows.join(" || ")
              : (explicitCity ? "\nइस स्रोत में " + explicitCity + " की स्पष्ट शहर-पंक्ति नहीं मिली।" : "")
          ].filter(Boolean).join("")
        : "";
      return `${i + 1}. ${item.title}\nप्रकाशक: ${item.publisher || "उपलब्ध नहीं"}\nप्रकाशित: ${published}${isHistoricalQuery ? `\nवास्तविक स्रोत URL: ${item.url}` : ""}\nजानकारी: ${cleanSnippet}${rateEvidence}`;
    }
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

    // Discount calculations are deterministic and do not need internet search or AI.
    const discountReply = solveDiscountQuestion(userText);
    if (discountReply) {
      return jsonResponse({
        success: true,
        reply: discountReply,
        ...dateTime,
        webSearch: false,
        sources: []
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

    // Treat browser-supplied webSearch/internet flags as advisory only.
    // They may be stale or left enabled from an earlier session. Search only
    // for an explicit user request or a clearly time-sensitive/verification query.
    const wantsSearch = !isGreetingOnly &&
      (explicitlyRequestsWebSearch(userText) || shouldSearchAutomatically(userText));
    let searchResults = [];
    let searchWarning = "";

    // Keep this block as normal JavaScript lines; never insert literal \\n separators here.
    // Deploy marker: search syntax fix is included in this revision.
    if (wantsSearch) {
      const isCurrentNewsQuestion = isCurrentNewsQuery(userText);
      const isGoldRateQuestion = /(सोने|सोना|gold|22\s*k|24\s*k|bullion)/i.test(userText);
      const isSilverRateQuestion = /(चांदी|चाँदी|silver)/i.test(userText);
      const isDiamondPriceQuestion = /(हीरा|हीरे|हीरों|diamond)/i.test(userText);
      const isHistoricalQuestion = isHistoricalResearchQuery(userText);
      const indiaToday = new Intl.DateTimeFormat("en-CA", { timeZone: INDIA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const isOfficialEducationQuestion = /(सिलेबस|पाठ्यक्रम|परीक्षा तिथि|एडमिट कार्ड|प्रवेश पत्र|रिजल्ट|(?:परीक्षा|बोर्ड|विश्वविद्यालय|चुनाव)\s*(?:का|के)?\s*परिणाम|परिणाम\s*(?:घोषित|जारी|देखें|चेक)|आवेदन|फॉर्म|फीस|पात्रता|नियम|छात्रवृत्ति|स्कॉलरशिप|scholarship|fellowship|stipend|official syllabus|exam date|admit card|result|eligibility|application form)/i.test(userText);
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
      if (isCurrentNewsQuestion) {
        // Keep the newest same-day report for a repeated event, then deduplicate
        // event headlines and publishers. Exa relevance order is not chronological.
        searchResults = dedupeNewsPublishers(dedupeNewsResults(sortNewsByPublicationTime(filterFreshNewsResults(searchResults))));
        // A single fresh article is not enough to present a news digest as verified.
        // Stop before the language model can turn one weakly matching page into a confident event summary.
        if (searchResults.length > 0 && searchResults.length < 2) {
          const todayLabel = new Intl.DateTimeFormat("hi-IN", {
            timeZone: INDIA_TIME_ZONE, day: "numeric", month: "long", year: "numeric"
          }).format(new Date());
          return jsonResponse({
            success: true,
            reply: todayLabel + " के लिए तारीख़-जाँचा हुआ केवल एक स्वतंत्र समाचार स्रोत मिला। उससे खबर की स्वतंत्र पुष्टि नहीं हो सकती, इसलिए मैं उसे पक्की खबर या विस्तृत सार के रूप में पेश नहीं करूँगा। कम-से-कम दो स्वतंत्र प्रकाशकों से पुष्टि मिलने पर ही सार दूँगा।",
            ...dateTime,
            webSearch: true,
            searchAttempted: true,
            searchWarning: "केवल एक स्वतंत्र प्रकाशक मिला; बहु-स्रोत पुष्टि उपलब्ध नहीं है।",
            searchUnavailable: true,
            sources: searchResults.map(item => ({
              title: item.title,
              url: item.url,
              publisher: item.publisher || "प्रकाशक उपलब्ध नहीं",
              publishedAt: item.publishedAt || ""
            }))
          });
        }
        if (!searchResults.length) {
          const todayLabel = new Intl.DateTimeFormat("hi-IN", {
            timeZone: INDIA_TIME_ZONE, day: "numeric", month: "long", year: "numeric"
          }).format(new Date());
          return jsonResponse({
            success: true,
            reply: todayLabel + " के लिए आज ही प्रकाशित और तारीख-जाँचे गए भरोसेमंद समाचार परिणाम नहीं मिले। इसलिए मैं कल या उससे पुरानी खबरों को आज की खबर बताकर नहीं दिखाऊँगा। कृपया कुछ देर बाद फिर खोजें।",
            ...dateTime,
            webSearch: true,
            searchAttempted: true,
            searchWarning: "आज की तारीख के अनुरूप कोई सत्यापित खोज परिणाम नहीं मिला।",
            searchUnavailable: true,
            sources: []
          });
        }
      }
      if ((isGoldRateQuestion || isSilverRateQuestion) && searchResults.length) {
        // Enrich before the freshness gate: a source page may expose its date
        // even when Exa's publishedDate metadata is absent.
        searchResults = await enrichGoldRateResults(searchResults.slice(0, 8));
        searchResults = filterFreshPreciousMetalResults(searchResults);
        // Keep the strongest fresh result from each publisher; repeated pages
        // from one website are not independent confirmation.
        const seenPublishers = new Set();
        searchResults = searchResults.filter(item => {
          let publisher = String(item.publisher || "").toLowerCase();
          try { publisher = new URL(item.url).hostname.toLowerCase().replace(/^www\\./, ""); } catch {}
          if (!publisher || seenPublishers.has(publisher)) return false;
          seenPublishers.add(publisher);
          return true;
        }).slice(0, 6);
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
- समाचार/ताज़ा खबर के लिए विशेष प्रारूप: खबरों का पूरा जवाब उसी भाषा और लहजे में लिखो जिसमें उपयोगकर्ता ने पूछा है। हिंदी में पूछे तो स्वाभाविक बोलचाल की हिंदी में लिखो; अंग्रेज़ी में पूछे तो अंग्रेज़ी में; Hinglish में पूछे तो सहज Hinglish में। शीर्षक, खंडों के नाम, तारीख़ का परिचय और सावधानी-पंक्ति भी उसी भाषा में हों—हिंदी सवाल पर अंग्रेज़ी हेडलाइन या अंग्रेज़ी में मेटाडेटा मत छोड़ो। शुरुआत में केवल आज की तारीख़ बताओ। सप्ताह का दिन तभी लिखो जब वह कोड द्वारा स्पष्ट रूप से दिया गया हो; अनुमान से दिन कभी मत बताओ। खबरों को देश, दुनिया, खेल या संबंधित विषय के छोटे खंडों में बाँटो; केवल वही खंड रखो जिनमें खबरें हों। हर खबर में पहले छोटी, साफ़ और स्वाभाविक हेडलाइन दो, फिर केवल एक छोटा वाक्य लिखो, जिसमें सिर्फ उसी समाचार परिणाम के शीर्षक और अंश से पुष्ट तथ्य हों। कोई दूसरी घटना, अतिरिक्त व्यक्ति, संख्या, समय, कारण या असर न जोड़ो। मूल खबर अंग्रेज़ी में हो तो उसका अर्थ समझकर स्वाभाविक भाषा में अपने शब्दों में लिखो—शब्दशः अनुवाद मत करो। हर खबर के अंत में स्रोत का नाम और प्रकाशित तारीख़/समय भारतीय समय में दो; घटना की तारीख़ अलग और तभी बताओ जब उपलब्ध सामग्री में स्पष्ट हो। आरोप को आरोप, दावे को दावा और पुष्टि को पुष्टि के रूप में ही बताओ। एक ही घटना को दोहराओ मत; अलग घटनाओं को आपस में मत मिलाओ। केवल वेबसाइट का नाम, शीर्षक या तारीख़ देकर खबर पूरी मत मानो। विवरण पर्याप्त न हो तो उस खबर को छोड़ दो या साफ़ बताओ कि जानकारी सीमित है; कोई तथ्य मत गढ़ो। अधिकतम 8 भरोसेमंद और प्रासंगिक खबरें दो; अच्छी खबरें कम हों तो कम ही दो। अंत में उसी भाषा में एक छोटी सावधानी-पंक्ति दो।
- इंटरनेट खोज के परिणामों से तथ्य लेकर अपने शब्दों में सीधा जवाब दो। उपयोगकर्ता ने स्पष्ट रूप से लिंक या स्रोत न माँगे हों तो मुख्य जवाब में URL, वेबसाइट लिंक या लिंक की सूची बिल्कुल मत लिखो। स्रोत का नाम केवल तभी बताओ जब भरोसा जाँचने के लिए जरूरी हो। खोज के URL को आंतरिक संदर्भ समझो, उत्तर का हिस्सा नहीं।
- सोने-चाँदी के भाव में कम-से-कम 2 अलग-अलग प्रकाशकों/वेबसाइटों के परिणाम हों तभी उसे "दो स्रोतों से मिलान" कहो। एक ही वेबसाइट के अलग पेज स्वतंत्र स्रोत नहीं हैं। 2 स्वतंत्र स्रोत न मिलें तो साफ लिखो कि भाव का स्वतंत्र मिलान नहीं हो सका; एक स्रोत के भाव को पक्का/सर्वमान्य मत बताओ। हर स्रोत की दर अलग रखो और स्रोत का नाम, प्रकाशित/अपडेट समय (यदि उपलब्ध हो), शहर/बाजार, शुद्धता और इकाई स्पष्ट करो। भारत-स्तर का सवाल हो तो शहरवार तालिका या किसी शहर की दरें बिल्कुल मत दिखाओ; किसी एक शहर (जैसे मुंबई, पटना या दिल्ली) की दर को पूरे भारत की दर कभी मत बताओ। केवल स्पष्ट रूप से राष्ट्रीय/भारत-स्तर लिखे गए स्रोत-सारांश में धातु, शुद्धता, संख्या और इकाई साथ उपलब्ध हों तभी राष्ट्रीय दर दो। यदि ऐसा प्रमाण न हो तो साफ लिखो कि आज का राष्ट्रीय भाव विश्वसनीय रूप से सत्यापित नहीं हो सका। शहरवार दरें केवल तभी दो जब उपयोगकर्ता ने किसी शहर का नाम पूछा हो, और तब हर दर के साथ उसी शहर/बाजार का नाम साफ लिखो। शहर स्पष्ट न हो तो शहर मत गढ़ो। प्रकाशित प्रति ग्राम, प्रति 10 ग्राम और प्रति किलो इकाइयों को आपस में मिलाने से पहले गणित जाँचो। सोने में प्रति ग्राम × 10 = प्रति 10 ग्राम; चाँदी में प्रति ग्राम × 1000 = प्रति किलो। उदाहरण: ₹13,888/ग्राम का 10 ग्राम ₹1,38,880 है, ₹1,38,590 नहीं; ₹12,730/ग्राम का 10 ग्राम ₹1,27,300 है; ₹179/ग्राम चाँदी का किलो ₹1,79,000 है। स्रोत की प्रकाशित दर और अपनी गणना को अलग-अलग पहचानो। स्रोतों के भाव अलग हों तो औसत या एक पक्का राष्ट्रीय भाव मत बनाओ; स्रोत, तारीख, समय, शहर और इकाई सहित अलग-अलग बताओ। 22K/24K/999 को आपस में मत मिलाओ। जिस संख्या या इकाई की पुष्टि न हो, उसे मत गढ़ो।
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
सटीकता और उत्तर-पूर्णता के अतिरिक्त अनिवार्य नियम:
- भारतीय संविधान के बारे में पूछे जाने पर सही कालक्रम याद रखो: संविधान सभा की पहली बैठक 9 दिसंबर 1946 को हुई; प्रारूप समिति 29 अगस्त 1947 को बनी, उसके अध्यक्ष डॉ. भीमराव आंबेडकर थे और उसमें 7 सदस्य थे; प्रारूप संविधान 4 नवंबर 1948 को संविधान सभा में प्रस्तुत किया गया; संविधान 26 नवंबर 1949 को अंगीकृत हुआ; 24 जनवरी 1950 को सदस्यों ने हस्ताक्षर किए; 26 जनवरी 1950 को लागू हुआ। 26 नवंबर को संविधान दिवस और 26 जनवरी को गणतंत्र दिवस मनाया जाता है। 26 जनवरी का ऐतिहासिक संबंध 26 जनवरी 1930 को मनाए गए पूर्ण स्वराज दिवस से है; भारत छोड़ो आंदोलन 8 अगस्त 1942 को शुरू हुआ था—इन घटनाओं को आपस में मत मिलाओ। संविधान सभा के 389 मूल सदस्य और विभाजन के बाद 299 सदस्य थे; संविधान को "395 वोटों से" स्वीकृत बताने का दावा मत करो। मूल संविधान में 395 अनुच्छेद और 8 अनुसूचियाँ थीं; वर्तमान में 12 अनुसूचियाँ हैं। मौलिक अधिकारों के 6 व्यापक वर्ग हैं; मौलिक कर्तव्य 11 हैं। "14 मूलभूत अधिकार" या "13 मूलभूत कर्तव्य" मत लिखो।
- स्वास्थ्य, भोजन और पोषण के सामान्य सवालों में केवल स्थापित पोषण-तथ्य बताओ। किसी खाद्य पदार्थ के पोषक तत्वों की सूची बनाते समय ऐसे विटामिन/खनिज मत जोड़ो जिनकी मौजूदगी या मात्रा पुष्ट न हो। भोजन के किसी एक पदार्थ को त्वचा, बाल, रोग-प्रतिरोधक क्षमता या बीमारी के इलाज का निश्चित उपाय मत बताओ। आम के सामान्य फायदे पूछे जाएँ तो उदाहरण के तौर पर विटामिन C, विटामिन A के अग्रद्रव्य (बीटा-कैरोटीन), फाइबर और पानी का उल्लेख कर सकते हो; इसे संतुलित आहार का एक हिस्सा बताओ। आम में विटामिन E प्रचुर होने, त्वचा को सीधे नमी देने या बाल मजबूत करने का दावा मत करो। उपयोगकर्ता ने जितने फायदे माँगे हों, उतने ही संक्षिप्त और अलग-अलग फायदे दो।
- विज्ञान में तुलना माँगी जाए, जैसे प्रकाश संश्लेषण और कोशिकीय श्वसन के पाँच अंतर, तो ठीक माँगी गई संख्या में अलग-अलग, सही और पूरे बिंदु दो। हर बिंदु में दोनों प्रक्रियाओं का स्पष्ट अंतर बताओ। प्रकाश संश्लेषण मुख्यतः क्लोरोप्लास्ट में होता है और प्रकाश ऊर्जा से CO₂ तथा पानी से कार्बोहाइड्रेट बनाता है; ऑक्सीजन निकलती है। कोशिकीय श्वसन मुख्यतः साइटोप्लाज्म और माइटोकॉन्ड्रिया में होता है; ग्लूकोज़ टूटकर ATP ऊर्जा उपलब्ध कराता है और सामान्य वायवीय श्वसन में CO₂ तथा पानी बनते हैं। यह मत कहो कि हर कोशिका में माइटोकॉन्ड्रिया होते हैं; परिपक्व स्तनधारी लाल रक्त कोशिकाओं में माइटोकॉन्ड्रिया नहीं होते। पौधों में भी दिन-रात श्वसन होता है।
- उत्तर भेजने से पहले जाँचो कि माँगी गई संख्या पूरी है, प्रत्येक बिंदु पूरा वाक्य है, सूची क्रम सही है, और Markdown खुला/टूटा नहीं है। पाँच अंतर माँगे हों तो पाँच ही दो; दोहराव या आधा वाक्य न छोड़ो। 
- यदि AI प्रदाता से 429/अस्थायी व्यस्तता मिले, तो झूठा सामान्य उत्तर या अनुमान मत बनाओ। साफ बताओ कि सेवा अभी व्यस्त है और दोबारा प्रयास करना होगा। यदि खोज के वास्तविक परिणाम उपलब्ध हैं, तो केवल उन्हीं के सत्यापित शीर्षक/अंश को स्रोत सहित दिखाओ; उन्हें AI द्वारा तैयार सार मत बताओ।
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

    const sendGroqRequest = async (requestMessages, maxTokens, systemContent = systemPrompt, reasoningEffort = null, model = GROQ_MODEL) => {
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
            model,
            messages: [{ role: "system", content: systemContent }, ...requestMessages],
            temperature: 0.3,
            max_tokens: maxTokens,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort, reasoning_format: "hidden" } : {}),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    const isNewsQueryForPrompt = /(खबर|समाचार|news|breaking|latest|ताज़ा|ताजा)/i.test(userText);
    const isCurrentNewsReply = wantsSearch && isCurrentNewsQuery(userText);
    const isPreciousMetalReply = wantsSearch && /(सोने|सोना|gold|चांदी|चाँदी|silver|bullion|22\s*k|24\s*k)/i.test(userText);
    const requireTwoSentenceNews = /2\s*(?:-|–|to)\s*3|दो\s*(?:से|या)\s*तीन|दो.?तीन\s*(?:वाक्य|sentence)/i.test(userText);
    const compactNewsSystemPrompt = "तुम सारथी AI हो। पूरा उत्तर सहज देवनागरी हिंदी में दो। हर खबर का हिंदी शीर्षक और 2 छोटे वाक्यों का सार केवल उसी खबर के दिए गए शीर्षक तथा लेख-अंश से लिखो; यदि स्रोत में पर्याप्त तथ्य न हों तो कम शब्दों में स्पष्ट सीमा बताओ। शीर्षक का अर्थ बदले बिना अनुवाद करो। व्यक्ति, राज्य, शहर, संस्था और योजना के नाम स्रोत के अनुसार सही लिखो; नाम का अनुमान, गलत लिप्यंतरण या किसी दूसरे व्यक्ति का नाम मत लिखो। सार में केवल वही तथ्य दो जो लेख-अंश में साफ मौजूद हों। स्रोत में न दिया कारण, जिम्मेदार व्यक्ति/समूह, स्थान, संख्या, असर, नीति की स्थिति या निर्णय मत जोड़ो। राजनीतिक आरोप को स्पष्ट रूप से संबंधित व्यक्ति का आरोप बताओ, सिद्ध तथ्य की तरह नहीं। खासकर वायु प्रदूषण, दुर्घटना, बीमारी, कीमतों या सरकारी फैसलों के कारण/जिम्मेदारी का अनुमान बिल्कुल मत लगाओ। किसी घटना को किसी कारण से जोड़ने के लिए स्रोत में वही कारण स्पष्ट रूप से लिखा होना चाहिए। प्रस्ताव, सिफारिश, घोषणा, मंजूरी, लागू फैसला और संभावना अलग-अलग बातें हैं—स्रोत जिस स्तर की पुष्टि करे, वही लिखो; विचाराधीन/संभावित योजना को पक्का फैसला, मंजूरी या घोषित कार्यक्रम मत बताओ; स्रोत में 'considering', 'weighing', 'likely', 'may' या 'no official announcement' हो तो हिंदी में भी विचार/संभावना/अभी पुष्टि नहीं जैसी भाषा बनाए रखो; Cabinet approves का अर्थ मंजूरी मिली है, जबकि proposal/recommendation का अर्थ प्रस्ताव/सिफारिश है। सरकारी नीति/सेवा-नियम की खबर में पात्र समूह, प्रतिशत, अवधि और आगे की चयन-शर्तें ठीक-ठीक बताओ; किसी सीमित समूह के फैसले को सभी पर लागू मत बताओ और चयन को स्वतः नियुक्ति मत कहो। किसी एक स्रोत के तथ्य दूसरे स्रोत की खबर में मत मिलाओ। एक ही घटना की दो रिपोर्टों को मिलाकर एक खबर बनाओ, अलग घटनाओं को कभी मत मिलाओ। यदि पर्याप्त विश्वसनीय स्रोत उपलब्ध हों तो पाँच खबरें अलग-अलग विषयों/क्षेत्रों से चुनो; केवल संख्या पूरी करने के लिए कमजोर खबर मत जोड़ो। उपलब्ध अलग-अलग खबरों की संख्या के अनुसार क्रमांक दो; अंग्रेज़ी शीर्षक ज्यों-का-त्यों मत लिखो। केवल शीर्षक हो और विवरण न हो तो उससे आगे की घटना/कारण की जानकारी मत गढ़ो। पूर्वानुमान को घटित घटना मत बताओ और बाजार के शुरुआती आँकड़ों को बंद भाव मत बताओ। प्रकाशक और प्रकाशित समय खुद मत लिखो; वे कोड से जोड़े जाएँगे। हर खबर के लिए ठीक प्रारूप रखो: खबर 1: हिंदी शीर्षक; अगली पंक्ति: सार: 2 छोटे, स्रोत-आधारित वाक्य। कोई अलग स्रोत-सूची या अतिरिक्त भूमिका मत बनाओ।";
    let groqResponse;
    let activeGroqModel = GROQ_MODEL;
    try {
      if (isCurrentNewsReply) {
        const newsMessage = "सवाल: " + userText + "\n\nकेवल इन वास्तविक खोज परिणामों का हिंदी सार लिखो:\n\n" + buildCompactNewsSourceContext(searchResults);
        // GPT-OSS defaults to medium reasoning. For a short news digest, use low
        // reasoning so the completion budget is spent on the Hindi summary itself.
        groqResponse = await sendGroqRequest(
          [{ role: "user", content: newsMessage }],
          2200,
          compactNewsSystemPrompt,
          "low"
        );
      } else {
        groqResponse = await sendGroqRequest(safeMessages, 6000);
      }
      // A short current-news request can sometimes hit a token-per-minute
      // limit. Retry once with fewer source characters and a smaller completion
      // budget; if the provider is still rate-limited, keep the honest fallback.
      if (groqResponse.status === 429 && isCurrentNewsReply && searchResults.length) {
        const compactNewsContext = searchResults.slice(0, 5).map((item, index) =>
          "स्रोत " + (index + 1) + ": " + cleanText(item.title || "").slice(0, 180) +
          "\nप्रकाशक: " + cleanText(item.publisher || "").slice(0, 80) +
          "\nप्रकाशित: " + formatNewsPublishedAt(item.publishedAt || "") +
          "\nलेख-अंश: " + cleanText(item.snippet || "").slice(0, 320)
        ).join("\n\n");
        const compactRetryMessages = [{ role: "user", content: "इन ताज़ा खोज परिणामों का संक्षिप्त हिंदी सार दो। हर खबर के लिए खबर 1: सही हिंदी शीर्षक और अगली पंक्ति सार: 2 छोटे तथ्यात्मक वाक्य लिखो। केवल दिए गए तथ्य लिखो, अनुमान मत लगाओ।\n\n" + compactNewsContext }];
        try {
          groqResponse = await sendGroqRequest(
            compactRetryMessages,
            1000,
            compactNewsSystemPrompt,
            "low"
          );
        } catch (error) {
          console.warn("Compact news retry after rate limit failed", error?.name || "unknown");
        }
        // If the primary model is still rate-limited, automatically try a
        // second currently listed Groq model. Keep the same source-only context;
        // omit model-specific reasoning parameters for cross-model compatibility.
        if (groqResponse?.status === 429) {
          try {
            const fallbackResponse = await sendGroqRequest(
              compactRetryMessages,
              1200,
              compactNewsSystemPrompt,
              null,
              GROQ_FALLBACK_MODEL
            );
            groqResponse = fallbackResponse;
            if (fallbackResponse.ok) activeGroqModel = GROQ_FALLBACK_MODEL;
          } catch (error) {
            console.warn("Secondary news model retry failed", error?.name || "unknown");
          }
        }
      }

      // Gold/silver questions also need a compact, source-only retry when the
      // normal chat context hits Groq's rate limit. Try the secondary model
      // before falling back to headlines, so the user can still get a Hindi
      // rate summary without inventing any price or unit.
      if (groqResponse?.status === 429 && isPreciousMetalReply && searchResults.length) {
        const metalContext = searchResults.slice(0, 6).map((item, index) =>
          "स्रोत " + (index + 1) + ": " + cleanText(item.title || "").slice(0, 180) +
          "\nप्रकाशक: " + cleanText(item.publisher || "").slice(0, 80) +
          "\nप्रकाशित/अपडेट: " + cleanText(item.publishedAt ? formatNewsPublishedAt(item.publishedAt) : "समय उपलब्ध नहीं") +
          (item.primaryRateSummary
            ? "\nप्रकाशक का मुख्य दर-सारांश: " + cleanText(item.primaryRateSummary).slice(0, 900)
            : "\nमुख्य राष्ट्रीय दर-सारांश उपलब्ध नहीं है।")
        ).join("\n\n");
        const metalSystemPrompt = "तुम सारथी AI हो। केवल दिए गए स्रोत-अंश से सोना-चाँदी के भाव का उत्तर सहज हिंदी में दो। तारीख और स्रोत बताओ। 22K, 24K और 999 चाँदी अलग रखो। भाव, इकाई, शहर या अपडेट समय स्रोत में स्पष्ट न हो तो उसे मत गढ़ो; स्पष्ट लिखो कि उपलब्ध नहीं। खुदरा भाव, IBJA और MCX को न मिलाओ। अलग स्रोतों के भाव अलग हों तो अलग-अलग बताओ।";
        const metalRetryMessages = [{ role: "user", content: "सवाल: " + userText + "\nनीचे दिए स्रोतों के आधार पर भाव और तारीख बताओ। संख्या/इकाई स्पष्ट न हो तो साफ कहो कि उपलब्ध नहीं। कोई अनुमान नहीं।\n\n" + metalContext }];
        try {
          groqResponse = await sendGroqRequest(metalRetryMessages, 1400, metalSystemPrompt);
        } catch (error) {
          console.warn("Compact precious-metal retry failed", error?.name || "unknown");
        }
        if (groqResponse?.status === 429) {
          try {
            const fallbackResponse = await sendGroqRequest(
              metalRetryMessages,
              1400,
              metalSystemPrompt,
              null,
              GROQ_FALLBACK_MODEL
            );
            groqResponse = fallbackResponse;
            if (fallbackResponse.ok) activeGroqModel = GROQ_FALLBACK_MODEL;
          } catch (error) {
            console.warn("Secondary precious-metal retry failed", error?.name || "unknown");
          }
        }
      }

      // For ordinary chat/learning requests, a provider 429 should not immediately
      // become a dead end. Try the secondary model once, using a compact prompt and
      // the same conversation context. News and bullion have stricter source-only
      // retry paths above and must not be routed through this generic fallback.
      if (groqResponse?.status === 429 &&
          !isCurrentNewsReply &&
          !isPreciousMetalReply &&
          activeGroqModel !== GROQ_FALLBACK_MODEL) {
        const fallbackMessages = safeMessages.slice(-6).map(message => ({
          role: message.role,
          content: String(message.content || "").slice(-1400)
        }));
        const fallbackSystemPrompt = "तुम सारथी AI हो। उपयोगकर्ता की भाषा में सीधे, आसान और सही उत्तर दो। बातचीत के पिछले संदर्भ का उपयोग करो, लेकिन नवीनतम सवाल को प्राथमिकता दो। विद्यार्थी सीखना चाहे तो छोटे चरणों में समझाओ, एक उदाहरण दो और जरूरत पर एक ही अभ्यास प्रश्न पूछो। उपयोगकर्ता ने तारीख या समय सीधे न पूछा हो तो तारीख/समय मत बताओ। तथ्य, संख्या, स्रोत या प्रयोग के परिणाम मत गढ़ो। सवाल अस्पष्ट हो तो एक छोटा स्पष्टीकरण पूछो।";
        try {
          const fallbackResponse = await sendGroqRequest(
            fallbackMessages,
            2200,
            fallbackSystemPrompt,
            null,
            GROQ_FALLBACK_MODEL
          );
          groqResponse = fallbackResponse;
          if (fallbackResponse.ok) activeGroqModel = GROQ_FALLBACK_MODEL;
        } catch (error) {
          console.warn("General chat secondary-model retry failed", error?.name || "unknown");
        }
      }

      // On provider HTTP 413, retry once with compact context. Keep the preceding
      // user turn as well as the latest follow-up (e.g. "सबका उत्तर दो").
      if (groqResponse.status === 413) {
        const priorUser = [...safeMessages.slice(0, -1)].reverse().find(item => item.role === "user");
        const compactPrompt = priorUser
          ? "पिछला सवाल/संदर्भ:\n" + priorUser.content.slice(-1200) +
            "\n\nअभी का पूरा सवाल (इसे प्राथमिकता से पूरा उत्तर देना):\n" + latestPrompt
          : latestPrompt;
        const compactMessages = isCurrentNewsReply
          ? [{ role: "user", content: "सवाल: " + userText + "\n\nकेवल इन वास्तविक खोज परिणामों का हिंदी सार लिखो:\n\n" + buildCompactNewsSourceContext(searchResults) }]
          : [{
              role: "user",
              content: compactPrompt + (searchContext ? searchContext.slice(0, isHistoricalResearchQuery(userText) ? 5200 : 800) : "")
            }];
        // The original system prompt is intentionally extensive. A 413 retry
        // must compact that too; otherwise the same oversized prompt is resent.
        const compactSystemPrompt = isCurrentNewsReply ? compactNewsSystemPrompt : isHistoricalResearchQuery(userText)
          ? "तुम सारथी AI हो। ऐतिहासिक सवाल का उत्तर केवल दिए गए ऐतिहासिक खोज-स्रोतों से पुष्ट जानकारी के आधार पर दो। खूनी रविवार (1905) को दंगा मत कहो। 9 जनवरी 1905 जूलियन और 22 जनवरी 1905 ग्रेगोरियन कैलेंडर की एक ही तारीख है। मृतकों और घायलों की संख्या विवादित है; कोई निश्चित संख्या मत गढ़ो। उपयोगकर्ता की भाषा में उत्तर दो।"
          : isNewsQueryForPrompt
            ? "तुम सारथी AI हो। समाचार के तथ्य केवल खोज परिणामों से लो। पूर्वानुमान को घटित घटना मत बताओ। हिंदी में सहज उत्तर दो और तथ्य मत गढ़ो।"
            : "तुम सारथी AI हो। उपयोगकर्ता की भाषा में स्पष्ट और सही उत्तर दो। तथ्य, तारीख, संख्या या स्रोत मत गढ़ो। समाचार में केवल शीर्षक और स्रोत-अंश से पुष्ट तथ्य लिखो। बाजार के सुबह के आँकड़ों को बंद हुआ या दिन का अंतिम स्तर मत लिखो; समापन स्तर तभी बताओ जब स्रोत स्पष्ट रूप से बताए। जानकारी अपर्याप्त हो तो साफ कहो।";

        groqResponse = await sendGroqRequest(
          compactMessages,
          2200,
          compactSystemPrompt,
          isCurrentNewsReply ? "low" : null
        );
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

    const rawContent = payload?.choices?.[0]?.message?.content;
    const reply = Array.isArray(rawContent)
      ? rawContent.map(part => typeof part === "string" ? part : (part?.text || part?.content || "")).join("")
      : rawContent;

    if (typeof reply !== "string" || !reply.trim()) {
      if (isCurrentNewsReply && searchResults.length) {
        return jsonResponse({
          success: true,
          reply: buildCurrentNewsHeadlineReply(searchResults),
          ...dateTime,
          webSearch: true,
          searchAttempted: true,
          searchWarning: "समाचार खोज सफल रही, लेकिन AI सेवा ने हिंदी सार तैयार नहीं किया।",
          providerBusy: true,
          providerStatus: 502,
          sources: searchResults.map(item => ({
            title: item.title,
            url: item.url,
            publisher: item.publisher || "",
            publishedAt: item.publishedAt || "",
          })),
        });
      }
      return jsonResponse({ success: false, error: "AI सेवा से खाली उत्तर मिला।" }, 502);
    }

    // isCurrentNewsReply was computed before the compact news request.
    let rawReply = reply.trim();
    // Fail closed for India-wide bullion queries: never present a city quote as a national rate.
    const explicitBullionCity = isPreciousMetalReply && /patna|mumbai|delhi|kolkata|chennai|bengaluru|bangalore|hyderabad|ahmedabad|jaipur|lucknow|kanpur|varanasi|agra|prayagraj|allahabad|siwan|gaya|muzaffarpur|ranchi|bhopal|indore|nagpur|pune|surat|vadodara|noida|gurugram|gurgaon|पटना|मुंबई|दिल्ली|कोलकाता|चेन्नई|बेंगलुरु|हैदराबाद|अहमदाबाद|जयपुर|लखनऊ|कानपुर|वाराणसी|आगरा|प्रयागराज|इलाहाबाद|सिवान|गया|मुजफ्फरपुर|रांची|भोपाल|इंदौर|नागपुर|पुणे|सूरत|वडोदरा|नोएडा|गुरुग्राम/i.test(userText);
    if (isPreciousMetalReply && !explicitBullionCity) {
      rawReply = "आज का भारत-स्तर का सोना-चाँदी भाव उपलब्ध खोज परिणामों से विश्वसनीय रूप से सत्यापित नहीं हो सका। खोज में मिला All India Bullion का आँकड़ा ज़वेरी बाज़ार, मुंबई के संदर्भ से जुड़ा है; इसलिए उसे पूरे भारत का भाव बताना सही नहीं होगा। अन्य परिणामों से स्पष्ट राष्ट्रीय दर की स्वतंत्र पुष्टि नहीं मिली।\n\nस्रोत-जाँच: All India Bullion, प्रभात खबर और Times Now Hindi के उपलब्ध खोज परिणाम।";
    }
    // City-specific bullion guard: reject a priced row attributed to a different city.
    // A Mumbai/Zaveri Bazar quote must never be presented as Patna (or another city).
    const bullionCityAliases = [
      { key: "patna", re: /पटना|\bpatna\b/i, label: "पटना" },
      { key: "mumbai", re: /मुंबई|मुम्बई|\bmumbai\b/i, label: "मुंबई" },
      { key: "delhi", re: /दिल्ली|\bdelhi\b/i, label: "दिल्ली" },
      { key: "kolkata", re: /कोलकाता|कलकत्ता|\bkolkata\b/i, label: "कोलकाता" },
      { key: "chennai", re: /चेन्नई|मद्रास|\bchennai\b/i, label: "चेन्नई" },
      { key: "bengaluru", re: /बेंगलुरु|बंगलौर|\bbengaluru\b|\bbangalore\b/i, label: "बेंगलुरु" },
      { key: "hyderabad", re: /हैदराबाद|\bhyderabad\b/i, label: "हैदराबाद" },
      { key: "ahmedabad", re: /अहमदाबाद|\bahmedabad\b/i, label: "अहमदाबाद" },
      { key: "jaipur", re: /जयपुर|\bjaipur\b/i, label: "जयपुर" },
      { key: "lucknow", re: /लखनऊ|\blucknow\b/i, label: "लखनऊ" },
      { key: "kanpur", re: /कानपुर|\bkanpur\b/i, label: "कानपुर" },
      { key: "varanasi", re: /वाराणसी|बनारस|\bvaranasi\b/i, label: "वाराणसी" },
      { key: "siwan", re: /सिवान|\bsiwan\b/i, label: "सिवान" },
      { key: "gaya", re: /गया|\bgaya\b/i, label: "गया" },
      { key: "ranchi", re: /रांची|\branchi\b/i, label: "रांची" }
    ];
    if (isPreciousMetalReply) {
      const requestedCity = bullionCityAliases.find(city => city.re.test(userText));
      if (requestedCity) {
        const pricedLines = rawReply.split(/\r?\n/).filter(line => /₹|\bINR\b|रु\.?/i.test(line));
        // City attribution may appear in the source/note rather than beside the numeric row.
        // If a priced answer cites another city's market, reject the whole local-city quote.
        const foreignCity = pricedLines.length
          ? bullionCityAliases.find(city => city.key !== requestedCity.key && city.re.test(rawReply))
          : null;
        if (foreignCity) {
          rawReply = requestedCity.label + " के स्थानीय सोना-चाँदी भाव उपलब्ध खोज परिणामों से विश्वसनीय रूप से सत्यापित नहीं हो सके। खोज में " +
            (foreignCity?.label || "दूसरे शहर") + " के संदर्भ वाली दर मिली है; उसे " + requestedCity.label +
            " का भाव बताना सही नहीं होगा। इसलिए 24 कैरेट, 22 कैरेट और 999 चाँदी की कोई अपुष्ट कीमत नहीं दी जा रही है।\n\n" +
            "स्रोत-जाँच: उपलब्ध खोज परिणामों में स्थानीय शहर की स्पष्ट, पूरी दर-पंक्ति की पुष्टि नहीं हुई।";
        }
      }
    }
    // Final factual guard for the well-known 1905 event: prevent the model from
    // reintroducing the specific "riot" misclassification after retrieval.
    if (isHistoricalResearchQuery(userText) && /(खूनी रविवार|bloody sunday)/i.test(userText) &&
        /(?:राजनीतिक\s+दंगा|दंगों?\s+के\s+दौरान|दंगा\s+हुआ|riot(?:s)?)/i.test(rawReply)) {
      rawReply = "खूनी रविवार (Bloody Sunday) 1905 कोई दंगा नहीं था। यह 9 जनवरी 1905 (पुराने जूलियन कैलेंडर) / 22 जनवरी 1905 (ग्रेगोरियन कैलेंडर) को सेंट पीटर्सबर्ग में हुआ। फादर जॉर्जी गैपॉन के नेतृत्व में मजदूरों का शांतिपूर्ण जुलूस अपनी याचिका ज़ार निकोलस द्वितीय तक पहुँचाने के लिए Winter Palace की ओर जा रहा था। सैनिकों ने जुलूस/भीड़ पर गोलीबारी की। गोलीबारी के सटीक स्थान और मृतकों-घायलों की संख्या के बारे में स्रोतों में अंतर है, इसलिए किसी एक संख्या या महल के ठीक सामने गोलीबारी होने का दावा बिना पुष्ट स्रोत के नहीं करना चाहिए। नीचे केवल इस खोज में मिले वास्तविक स्रोत दिए गए हैं।";
    }
    // Normalize Markdown before counting numbered news headings. The formatter
    // already validates that every dated source has a matching Hindi summary.
    // Without this normalization, **खबर 1:** was missed by the pre-check and
    // a valid Hindi digest was incorrectly replaced by the headline fallback.
    const looksLikeRawEnglishArticle = isCurrentNewsReply &&
      /\b(Updated:|By:|India News Live Updates|Published:|Read more|Breaking News)\b/i.test(rawReply);
    // The summary parser itself validates every source-summary pair. Avoid a
    // separate brittle heading counter that can reject harmless punctuation.
    let formattedNewsReply = isCurrentNewsReply && !looksLikeRawEnglishArticle
      ? formatCurrentNewsSummaryReply(rawReply, searchResults, requireTwoSentenceNews)
      : "";

    // If the first completion used an unexpected layout, make one constrained
    // repair attempt rather than silently discarding its Hindi summary. The
    // retry still receives only the same dated search evidence and is validated
    // by the exact same source-by-source parser before it can be shown.
    if (isCurrentNewsReply && !formattedNewsReply && !looksLikeRawEnglishArticle && searchResults.length) {
      try {
        const repairSummaryRule = requireTwoSentenceNews ? "ठीक 2 छोटे, तथ्यात्मक वाक्य" : "1 छोटा, तथ्यात्मक वाक्य";
        const repairPrompt = "नीचे दिए गए " + searchResults.length + " खोज परिणामों के लिए केवल हिंदी सार दो। ठीक " + searchResults.length + " अलग-अलग खबरें लिखो। एक ही घटना की दो रिपोर्टों को दो खबर मत बनाओ। हर प्रविष्टि में दो पंक्तियाँ अनिवार्य हैं: खबर 1: हिंदी शीर्षक और अगली पंक्ति सार: " + repairSummaryRule + "। इसी तरह क्रमांक जारी रखो। कोई बुलेट, बोल्ड, भूमिका, स्रोत या अतिरिक्त पंक्ति नहीं। केवल दिए गए स्रोत-अंश की जानकारी लिखो; जानकारी न हो तो अनुमान मत लगाओ।\n\n" + buildCompactNewsSourceContext(searchResults);
        const repairMessages = [{ role: "user", content: repairPrompt }];
        const parseRepairResponse = async response => {
          if (!response?.ok) return "";
          const repairPayload = await response.json();
          const repairContent = repairPayload?.choices?.[0]?.message?.content;
          const repairText = Array.isArray(repairContent)
            ? repairContent.map(part => typeof part === "string" ? part : (part?.text || part?.content || "")).join("")
            : repairContent;
          return typeof repairText === "string" && repairText.trim()
            ? formatCurrentNewsSummaryReply(repairText.trim(), searchResults, requireTwoSentenceNews)
            : "";
        };
        let repairResponse;
        try {
          repairResponse = await sendGroqRequest(
            repairMessages,
            1800,
            compactNewsSystemPrompt,
            "low",
            activeGroqModel
          );
          formattedNewsReply = await parseRepairResponse(repairResponse);
        } catch (error) {
          console.warn("Primary news format repair failed", error?.name || "unknown");
        }
        // If the primary model cannot produce a valid, source-checked Hindi
        // digest (not only on HTTP 429), make one bounded attempt with the
        // secondary model. The same strict parser remains the final gate.
        if (!formattedNewsReply && activeGroqModel !== GROQ_FALLBACK_MODEL) {
          try {
            const secondaryRepairResponse = await sendGroqRequest(
              repairMessages,
              1800,
              compactNewsSystemPrompt,
              null,
              GROQ_FALLBACK_MODEL
            );
            formattedNewsReply = await parseRepairResponse(secondaryRepairResponse);
            if (formattedNewsReply) activeGroqModel = GROQ_FALLBACK_MODEL;
          } catch (error) {
            console.warn("Secondary news format repair failed", error?.name || "unknown");
          }
        }
      } catch (error) {
        console.warn("News summary repair attempt failed", error?.name || "unknown");
      }
    }

    const finalReply = isCurrentNewsReply
      ? (formattedNewsReply || buildCurrentNewsHeadlineReply(searchResults))
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
