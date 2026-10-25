const INDIA_TIME_ZONE = "Asia/Kolkata";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/\s+/g, " ")
    .trim();
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
  for (const part of parts) {
    result[part.type] = part.value;
  }

  const weekday = new Intl.DateTimeFormat("hi-IN", {
    timeZone: INDIA_TIME_ZONE,
    weekday: "long",
  }).format(now);

  return {
    date: `${result.day}-${result.month}-${result.year}`,
    weekday,
    time: `${result.hour}:${result.minute}`,
  };
}

function isDateQuestion(text) {
  return /आज की तारीख|आज कौन.?सा दिन|आज कौन सा दिन|आज का दिन|आज डेट|आज की डेट|आज तारीख|वर्तमान तारीख|current date|today.?s date|what day is it today/i
    .test(text);
}

function isValidHttpUrl(value) {
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

    if (
      url.hostname.endsWith("duckduckgo.com") &&
      url.pathname === "/l/"
    ) {
      const destination = url.searchParams.get("uddg");

      if (destination && isValidHttpUrl(destination)) {
        return destination;
      }
    }

    return isValidHttpUrl(url.href) ? url.href : "";
  } catch {
    return "";
  }
}

async function searchInternet(query) {
  const searchUrl =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query);

  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SarathiAI/1.0)",
        "Accept": "text/html",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        results: [],
        warning: `इंटरनेट खोज सेवा ने HTTP ${response.status} दिया।`,
      };
    }

    const html = await response.text();

    /*
     * प्रत्येक result__a लिंक को अलग से ढूँढ़ते हैं।
     * खोज सेवा का HTML बदलने पर भी असफलता को छिपाते नहीं हैं।
     */
    const anchorRegex =
      /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;

    const anchors = [...html.matchAll(anchorRegex)];
    const results = [];

    for (let i = 0; i < anchors.length && results.length < 5; i++) {
      const match = anchors[i];
      const anchorHtml = match[0];

      const hrefMatch = anchorHtml.match(
        /\bhref=["']([^"']+)["']/i
      );

      const title = cleanText(anchorHtml);

      if (!hrefMatch || !title) continue;

      const link = decodeSearchUrl(
        hrefMatch[1].replace(/&amp;/g, "&")
      );

      if (!link) continue;

      const nextIndex =
        i + 1 < anchors.length
          ? anchors[i + 1].index
          : Math.min(html.length, match.index + 5000);

      const section = html.slice(
        match.index,
        Math.max(match.index + anchorHtml.length, nextIndex)
      );

      const snippetMatch = section.match(
        /<a\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      );

      const snippet = cleanText(
        snippetMatch?.[1] || snippetMatch?.[2] || ""
      );

      results.push({
        title,
        url: link,
        snippet,
      });
    }

    if (results.length === 0) {
      return {
        results: [],
        warning:
          "इंटरनेट खोज का प्रयास हुआ, लेकिन पढ़ने योग्य परिणाम नहीं मिले।",
      };
    }

    return {
      results,
      warning: "",
    };
  } catch (error) {
    return {
      results: [],
      warning:
        error?.name === "AbortError"
          ? "इंटरनेट खोज में समय समाप्त हो गया।"
          : "इंटरनेट खोज अभी उपलब्ध नहीं है।",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSearchContext(results) {
  if (!results.length) return "";

  return (
    "\n\nइंटरनेट खोज से मिले परिणाम:\n" +
    results
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n` +
          `लिंक: ${item.url}\n` +
          `जानकारी: ${item.snippet || "स्निपेट उपलब्ध नहीं है।"}`
      )
      .join("\n\n") +
    "\n\nनियम: परिणामों के आधार पर उत्तर दो। " +
    "अगर परिणाम पर्याप्त नहीं हैं, तो स्पष्ट बताओ। " +
    "अपनी ओर से वर्तमान कीमत, तारीख, समाचार या तथ्य मत गढ़ो।"
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      const dateTime = getIndiaDateTime();

      return jsonResponse({
        success: true,
        message: "Sarathi AI Worker is running",
        ...dateTime,
        groqSecretAvailable: Boolean(env.GROQ_API_KEY),
        searchProvider: "DuckDuckGo HTML",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/api/chat") {
      return jsonResponse(
        {
          success: false,
          error: "यह API रास्ता उपलब्ध नहीं है।",
        },
        404
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "अनुरोध का JSON सही नहीं है।",
        },
        400
      );
    }

    const messages = Array.isArray(body.messages)
      ? body.messages
      : [];

    const userMessage = [...messages]
      .reverse()
      .find((message) => message?.role === "user");

    const userText =
      typeof userMessage?.content === "string"
        ? userMessage.content.trim()
        : "";

    if (!userText) {
      return jsonResponse(
        {
          success: false,
          error: "पहले अपना सवाल लिखें।",
        },
        400
      );
    }

    const dateTime = getIndiaDateTime();

    // तारीख और दिन के सवाल का उत्तर बिना Groq API के भी दे सकते हैं।
    if (isDateQuestion(userText)) {
      return jsonResponse({
        success: true,
        reply:
          `आज की तारीख ${dateTime.date} है। ` +
          `आज ${dateTime.weekday} है। ` +
          `भारतीय समय अभी ${dateTime.time} है।`,
        ...dateTime,
        webSearch: false,
        searchAttempted: false,
        searchWarning: "",
        sources: [],
      });
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse(
        {
          success: false,
          error:
            "Cloudflare Worker में GROQ_API_KEY Secret उपलब्ध नहीं है।",
        },
        500
      );
    }

    const wantsSearch =
      body.webSearch === true || body.internet === true;

    let searchResults = [];
    let searchWarning = "";
    let searchAttempted = false;

    if (wantsSearch) {
      searchAttempted = true;

      const search = await searchInternet(userText);

      searchResults = search.results;
      searchWarning = search.warning;
    }

    const systemPrompt = `
तुम सारथी AI हो, एक मददगार हिंदी AI सहायक।

नियम:
1. उपयोगकर्ता की भाषा में सरल और स्पष्ट उत्तर दो।
2. वर्तमान जानकारी उपलब्ध न हो तो अनुमान को तथ्य की तरह मत बताओ।
3. इंटरनेट खोज के परिणाम मिले हों तो उन्हीं के आधार पर उत्तर दो।
4. स्रोतों से पुष्टि न होने पर स्पष्ट बताओ कि पुष्टि नहीं हो सकी।
5. कीमत, समाचार, सरकारी सूचना और समय-संवेदनशील जानकारी में सावधानी रखो।
6. उपयोगकर्ता को भ्रमित करने वाले नकली लिंक या स्रोत मत बनाओ।
7. सामान्य सवालों का सीधा जवाब दो।
8. यदि खोज परिणाम नहीं मिले, तो यह दावा मत करो कि लाइव जानकारी सत्यापित कर ली गई।
9. वर्तमान तारीख भारतीय समय के अनुसार ${dateTime.date} है।
`;

    const searchContext = buildSearchContext(searchResults);

    const safeMessages = messages
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string"
      )
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 12000),
      }));

    // केवल वर्तमान user message में खोज संदर्भ जोड़ें।
    if (searchContext) {
      for (let i = safeMessages.length - 1; i >= 0; i--) {
        if (safeMessages[i].role === "user") {
          safeMessages[i] = {
            ...safeMessages[i],
            content: safeMessages[i].content + searchContext,
          };
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
            {
              role: "system",
              content: systemPrompt,
            },
            ...safeMessages,
          ],
          temperature: 0.3,
          max_tokens: 1200,
        }),
      });
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "AI सेवा से संपर्क नहीं हो सका।",
          searchAttempted,
          searchWarning,
        },
        502
      );
    }

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();

      return jsonResponse(
        {
          success: false,
          error: `AI सेवा ने HTTP ${groqResponse.status} दिया।`,
          details: errorText.slice(0, 500),
          searchAttempted,
          searchWarning,
        },
        502
      );
    }

    let payload;

    try {
      payload = await groqResponse.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "AI सेवा का उत्तर पढ़ा नहीं जा सका।",
        },
        502
      );
    }

    const reply = payload?.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return jsonResponse(
        {
          success: false,
          error: "AI सेवा से खाली उत्तर मिला।",
        },
        502
      );
    }

    return jsonResponse({
      success: true,
      reply: reply.trim(),
      ...dateTime,
      webSearch: searchResults.length > 0,
      searchAttempted,
      searchWarning,
      sources: searchResults.map((item) => ({
        title: item.title,
        url: item.url,
      })),
    });
  },
};
