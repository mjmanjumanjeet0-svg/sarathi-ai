const INDIA_TIME_ZONE = "Asia/Kolkata";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS: वेबसाइट को Worker से जुड़ने दें
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // भारत की तारीख, दिन और समय
    const getIndiaDateTime = () => {
      const now = new Date();

      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: INDIA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);

      const values = {};
      for (const part of parts) {
        if (part.type !== "literal") values[part.type] = part.value;
      }

      const dateISO =
        `${values.year}-${values.month}-${values.day}`;

      const dateHindi = new Intl.DateTimeFormat("hi-IN", {
        timeZone: INDIA_TIME_ZONE,
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now);

      const weekdayHindi = new Intl.DateTimeFormat("hi-IN", {
        timeZone: INDIA_TIME_ZONE,
        weekday: "long",
      }).format(now);

      const timeHindi = new Intl.DateTimeFormat("hi-IN", {
        timeZone: INDIA_TIME_ZONE,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now);

      return {
        dateISO,
        dateHindi,
        weekdayHindi,
        timeHindi,
      };
    };

    const india = getIndiaDateTime();

    // Worker की स्थिति जाँचने के लिए
    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        success: true,
        name: "Sarathi AI",
        status: "running",
        date: india.dateHindi,
        weekday: india.weekdayHindi,
        time: india.timeHindi,
        timezone: INDIA_TIME_ZONE,
        groqSecretAvailable: Boolean(env.GROQ_API_KEY),
        searchProvider: "DuckDuckGo HTML",
        message: "Sarathi AI Worker is running",
      });
    }

    if (url.pathname !== "/api/chat") {
      return jsonResponse({
        success: false,
        error: "यह API रास्ता उपलब्ध नहीं है।",
      }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({
        success: false,
        error: "इस API के लिए POST अनुरोध भेजें।",
      }, 405);
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse({
        success: false,
        error: "Cloudflare में GROQ_API_KEY Secret सेट नहीं है।",
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse({
        success: false,
        error: "अनुरोध का JSON सही नहीं है।",
      }, 400);
    }

    const messages = Array.isArray(body.messages)
      ? body.messages
      : [];

    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message && message.role === "user");

    const question =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content.trim()
        : "";

    if (!question) {
      return jsonResponse({
        success: false,
        error: "कृपया अपना सवाल लिखें।",
      }, 400);
    }

    // तारीख और दिन वाले सवालों का उत्तर सीधे दें।
    const dateQuestion =
      /(आज.*(कौन|कवन|क्या).*(दिन|तारीख|डेट)|आज.*(तारीख|डेट)|आज कौन सा दिन|आज कवन सा दिन|आज की तारीख|what day is it|what is today's date|today's date)/i
        .test(question);

    if (dateQuestion) {
      const reply =
        `भारत में आज ${india.dateHindi} है और दिन ${india.weekdayHindi} है। ` +
        `अभी भारतीय समय ${india.timeHindi} है।`;

      return jsonResponse({
        success: true,
        reply,
        date: india.dateHindi,
        weekday: india.weekdayHindi,
        time: india.timeHindi,
        webSearch: false,
        searchAttempted: false,
        searchWarning: "",
        sources: [],
      });
    }

    // इंटरनेट सर्च का प्रयास
    const webSearchRequested =
      body.webSearch === true || body.internet === true;

    let searchResults = [];
    let searchWarning = "";
    let searchAttempted = false;

    const cleanText = (value) =>
      String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
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

    if (webSearchRequested) {
      searchAttempted = true;

      try {
        const searchUrl =
          "https://html.duckduckgo.com/html/?q=" +
          encodeURIComponent(question);

        const searchResponse = await fetch(searchUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; SarathiAI/1.0)",
            "Accept": "text/html",
          },
          signal: AbortSignal.timeout(8000),
        });

        if (!searchResponse.ok) {
          throw new Error(
            `सर्च सेवा ने HTTP ${searchResponse.status} दिया।`
          );
        }

        const html = await searchResponse.text();

        // DuckDuckGo के अलग-अलग result blocks निकालने की कोशिश
        const blocks = html.match(
          /<div[^>]*class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*result[^"]*"|<\/body>)/gi
        ) || [];

        for (const block of blocks) {
          const linkMatch = block.match(
            /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
          );

          const snippetMatch = block.match(
            /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i
          );

          if (!linkMatch) continue;

          let resultUrl = linkMatch[1]
            .replace(/&amp;/g, "&");

          // DuckDuckGo redirect URL को मूल URL में बदलने की कोशिश
          try {
            const parsedUrl = new URL(resultUrl, "https://duckduckgo.com");
            const redirectedUrl = parsedUrl.searchParams.get("uddg");
            if (redirectedUrl) {
              resultUrl = decodeURIComponent(redirectedUrl);
            }
          } catch {
            continue;
          }

          if (!/^https?:\/\//i.test(resultUrl)) continue;

          const title = cleanText(linkMatch[2]);
          const snippet = cleanText(
            snippetMatch?.[1] || snippetMatch?.[2] || ""
          );

          if (title) {
            searchResults.push({
              title,
              url: resultUrl,
              snippet,
            });
          }

          if (searchResults.length >= 5) break;
        }

        if (searchResults.length === 0) {
          searchWarning =
            "इंटरनेट सर्च का प्रयास हुआ, लेकिन पढ़ने योग्य परिणाम नहीं मिले।";
        }
      } catch (error) {
        searchWarning =
          "इंटरनेट सर्च अभी सफल नहीं हुई। नेटवर्क या सर्च सेवा की समस्या हो सकती है।";
      }
    }

    // AI को वर्तमान तारीख और उपलब्ध खोज परिणाम दें
    const searchContext = searchResults.length
      ? "\n\nइंटरनेट खोज से मिले परिणाम (केवल उपलब्ध सामग्री पर भरोसा करें):\n" +
        searchResults.map((result, index) =>
          `${index + 1}. ${result.title}\nURL: ${result.url}\nविवरण: ${result.snippet}`
        ).join("\n\n")
      : "";

    const systemPrompt = `
तुम सारथी AI हो, एक सहायक जो उपयोगकर्ता से सरल, विनम्र हिंदी में बात करता है।

आज भारत में तारीख: ${india.dateHindi}
आज सप्ताह का दिन: ${india.weekdayHindi}
भारतीय समय: ${india.timeHindi}
समय क्षेत्र: Asia/Kolkata

नियम:
1. उपयोगकर्ता की भाषा में जवाब दो। यदि वह हिंदी में पूछे तो सरल हिंदी में जवाब दो।
2. तथ्य न गढ़ो। जानकारी निश्चित न हो तो साफ बताओ।
3. यदि इंटरनेट खोज के परिणाम दिए गए हैं, तो उन्हीं से संबंधित निष्कर्ष निकालो।
4. खोज परिणामों में उत्तर न हो तो स्पष्ट कहो कि उपलब्ध परिणामों से पुष्टि नहीं हो सकी।
5. किसी लिंक को खोले बिना यह दावा मत करो कि उसका पूरा पेज पढ़ लिया है।
6. तारीख या सप्ताह के दिन के लिए ऊपर दी गई तारीख और दिन का ही उपयोग करो।
7. वर्तमान कीमत, मौसम या ताज़ा खबर की जानकारी उपलब्ध न हो तो उसे वर्तमान सत्य बताकर पेश मत करो।
8. जवाब स्पष्ट, उपयोगी और जरूरत के अनुसार संक्षिप्त रखो।
${searchContext}
`;

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
            ...messages.filter((message) =>
              message &&
              ["user", "assistant"].includes(message.role) &&
              typeof message.content === "string"
            ).slice(-20),
          ],
          temperature: 0.3,
          max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      return jsonResponse({
        success: false,
        error: "AI सेवा से संपर्क नहीं हो सका। थोड़ी देर बाद फिर कोशिश करें।",
        date: india.dateHindi,
        weekday: india.weekdayHindi,
        time: india.timeHindi,
      }, 502);
    }

    if (!groqResponse.ok) {
      const status = groqResponse.status;

      return jsonResponse({
        success: false,
        error:
          status === 401 || status === 403
            ? "Groq API key सही नहीं है या स्वीकार नहीं की गई।"
            : status === 429
            ? "Groq की अनुरोध सीमा पूरी हो गई है। कुछ देर बाद फिर कोशिश करें।"
            : `AI सेवा में समस्या है (HTTP ${status})।`,
        date: india.dateHindi,
        weekday: india.weekdayHindi,
        time: india.timeHindi,
      }, 502);
    }

    let groqData;

    try {
      groqData = await groqResponse.json();
    } catch {
      return jsonResponse({
        success: false,
        error: "AI सेवा से सही जवाब नहीं मिला।",
      }, 502);
    }

    const reply =
      groqData?.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return jsonResponse({
        success: false,
        error: "AI सेवा ने खाली जवाब दिया।",
      }, 502);
    }

    return jsonResponse({
      success: true,
      reply: reply.trim(),
      date: india.dateHindi,
      weekday: india.weekdayHindi,
      time: india.timeHindi,
      webSearch: searchResults.length > 0,
      searchAttempted,
      searchWarning,
      sources: searchResults.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
      })),
    });
  },
};
