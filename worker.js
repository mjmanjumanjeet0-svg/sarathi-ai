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

async function searchInternet(query, env) {
  // Preferred path: Cloudflare Web Search binding. No provider key is exposed
  // to the browser; provider billing/configuration is handled by Cloudflare AI Gateway.
  if (env.AI && typeof env.AI.websearch === "function") {
    try {
      const response = await env.AI.websearch({
        gatewayId: "default",
        query: query.slice(0, 600),
        provider: "ceramic",
        limit: 5,
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

function buildSearchContext(results) {
  if (!results.length) return "";

  return "\n\nइंटरनेट खोज के परिणाम:\n" + results.map(
    (item, i) =>
      `${i + 1}. ${item.title}\nलिंक: ${item.url}\nजानकारी: ${item.snippet || "जानकारी उपलब्ध नहीं है।"}`
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

    if (wantsSearch) {
      const search = await searchInternet(userText, env);
      searchResults = search.results;
      searchWarning = search.warning;

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
तुम सारथी AI हो, एक सक्षम, स्पष्ट और भरोसेमंद हिंदी सहायक।
भाषा और शैली:
- उपयोगकर्ता हिंदी में लिखे तो सरल, स्वाभाविक और व्याकरण-सही हिंदी में जवाब दो। भोजपुरी शब्द हों तो उन्हें समझकर सहज हिंदी/भोजपुरी में उत्तर दे सकते हो।
- सीधे सवाल का सीधा उत्तर पहले दो। फिर जरूरत के अनुसार कारण और कदम समझाओ।\n- यदि उपयोगकर्ता केवल हेलो, नमस्ते, नमस्कार या साधारण अभिवादन करे, तो छोटा स्वाभाविक अभिवादन देकर पूछो कि किस मदद की जरूरत है। ऐसे अभिवादन पर किसी पुराने विषय, खरीदारी, समाचार या वेब खोज के परिणामों का उत्तर मत दो।\n- हमेशा नवीनतम उपयोगकर्ता संदेश को प्राथमिकता दो; पुरानी बातचीत तभी जारी रखो जब संदेश उसी का संदर्भ देता हो।
- केवल एक पंक्ति में जवाब मत समेटो जब सवाल में विस्तार, तुलना या समाधान माँगा गया हो। उपयोगी उदाहरण दो, लेकिन अनावश्यक दोहराव न करो।
- उपयोगकर्ता पहले ही जो जानकारी दे चुका है, वह दोबारा मत पूछो।
- जहाँ अनिश्चितता हो, साफ बताओ; अनुमान को तथ्य मत बनाओ और नकली स्रोत/लिंक मत दो।
फ़ॉर्मेट:
- जवाब साफ और मोबाइल पर पढ़ने योग्य रखो।
- सामान्य उत्तर में * या ** जैसे Markdown सजावटी चिह्न मत लिखो। बोल्ड करने की जरूरत हो तो शब्दों को साधारण पाठ में रखो।
- सूची जरूरी हो तो हर नई बात अलग पंक्ति में लिखो और पंक्ति की शुरुआत साधारण "1." या "•" से करो। हर वाक्य में चिह्न न लगाओ।
- शीर्षक तभी दो जब जवाब लंबा हो। बहुत ज्यादा शीर्षक, इमोजी और दोहराव से बचो।
- कोड माँगा जाए तो पूरा, चलने योग्य कोड और कहाँ लगाना है, यह स्पष्ट बताओ।
मदद के नियम:
- पढ़ाई के सवालों में आसान भाषा, जरूरी शीर्षक और परीक्षा-उपयोगी व्याख्या दो।
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
          max_tokens: 1200,
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
