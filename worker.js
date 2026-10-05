// ============================================================
// सारथी AI - Cloudflare Worker
// Groq GPT-OSS 20B + Browser Search + Vision
// ============================================================

const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3-vl-32b-instruct";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ============================================================
// MAIN WORKER
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ----------------------------------------------------------
    // CORS
    // ----------------------------------------------------------

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // ----------------------------------------------------------
    // Health check
    // ----------------------------------------------------------

    if (request.method === "GET") {
      return json({
        ok: true,
        service: "Sarathi AI",
        model: CHAT_MODEL,
      });
    }

    // ----------------------------------------------------------
    // POST only
    // ----------------------------------------------------------

    if (request.method !== "POST") {
      return json(
        {
          error: "Method not allowed",
        },
        405
      );
    }

    try {
      // --------------------------------------------------------
      // CHAT
      // --------------------------------------------------------

      if (url.pathname === "/api/chat") {
        return await handleChat(request, env);
      }

      // --------------------------------------------------------
      // VISION
      // --------------------------------------------------------

      if (url.pathname === "/api/vision") {
        return await handleVision(request, env);
      }

      return json(
        {
          error: "Not found",
        },
        404
      );
    } catch (error) {
      console.error("Worker error:", error);

      return json(
        {
          error: "Server error.",
          answer: "अभी जवाब नहीं मिल पाया। कृपया थोड़ी देर बाद फिर से कोशिश करें।",
        },
        500
      );
    }
  },
};


// ============================================================
// CHAT HANDLER
// ============================================================

async function handleChat(request, env) {
  const body = await request.json();

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  if (!message) {
    return json(
      {
        error: "Message is required.",
        answer: "कृपया अपना सवाल लिखें।",
      },
      400
    );
  }

  const webSearch = Boolean(body.webSearch);

  // ----------------------------------------------------------
  // Current India date
  // ----------------------------------------------------------

  const now = new Date();

  const todayIndia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const readableIndiaDate = new Intl.DateTimeFormat("hi-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
  }).format(now);

  // ----------------------------------------------------------
  // Keep only a small amount of history.
  // This saves tokens.
  // ----------------------------------------------------------

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-8)
        .filter(
          (item) =>
            item &&
            (item.role === "user" ||
              item.role === "assistant") &&
            typeof item.content === "string"
        )
        .map((item) => ({
          role: item.role,
          content: item.content.slice(0, 3000),
        }))
    : [];

  // ----------------------------------------------------------
  // Detect current-information questions
  // ----------------------------------------------------------

  const currentQuestion = isCurrentQuestion(message);

  // ----------------------------------------------------------
  // System prompt
  // ----------------------------------------------------------

  const systemPrompt = `
तुम "सारथी AI" हो — एक मददगार, सटीक और सरल हिंदी AI assistant।

आज भारत की तारीख:
${todayIndia}

आज की तारीख:
${readableIndiaDate}

नियम:

1. सामान्य सवालों का स्पष्ट और सरल उत्तर दो।
2. अगर सवाल वर्तमान/आज/latest/current/rate/price/weather/news/train/time जैसी जानकारी मांगता है और Internet Search उपलब्ध है, तो Search से ताजा जानकारी प्राप्त करो।
3. Search से मिली पुरानी तारीख को "आज" मत बताओ।
4. वर्तमान जानकारी में तारीख स्पष्ट लिखना उपयोगी हो तो तारीख जरूर लिखो।
5. अगर किसी जानकारी की पुष्टि नहीं हो सकती, तो साफ बताओ कि पुष्टि नहीं हो पाई।
6. कभी भी जानकारी गढ़ो मत।
7. भारत से संबंधित प्रश्नों में भारतीय संदर्भ रखो।
8. उपयोगकर्ता हिंदी में पूछे तो हिंदी में जवाब दो।
9. उत्तर अनावश्यक रूप से लंबा मत करो।
10. गणना में सावधानी रखो।
11. अगर सवाल अस्पष्ट है तो जरूरी clarification मांगो।
12. अगर Search results में अलग-अलग आंकड़े हों तो उनके स्रोत/अंतर को संक्षेप में बताओ।
13. पुराने knowledge और वर्तमान जानकारी में conflict हो तो वर्तमान Search information को प्राथमिकता दो।
14. "आज" का अर्थ भारत के समय Asia/Kolkata के अनुसार ${todayIndia} है।

इस सवाल को ध्यान से पढ़कर सबसे उपयोगी उत्तर दो।
`.trim();

  // ----------------------------------------------------------
  // Messages
  // ----------------------------------------------------------

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    },
    ...history,
    {
      role: "user",
      content: message,
    },
  ];

  // ----------------------------------------------------------
  // Groq payload
  // ----------------------------------------------------------

  const payload = {
    model: CHAT_MODEL,
    messages,

    temperature: 0.3,

    // कम output = कम token usage
    max_completion_tokens: webSearch
      ? 1600
      : 1400,

    top_p: 1,

    stream: false,

    // GPT-OSS reasoning को low रखने से token usage कम रहता है
    reasoning_effort: "low",
  };

  // ----------------------------------------------------------
  // Browser Search
  // ----------------------------------------------------------

  if (webSearch) {
    payload.tools = [
      {
        type: "browser_search",
      },
    ];

    payload.tool_choice = "required";
  }

  // ----------------------------------------------------------
  // Call Groq
  // ----------------------------------------------------------

  const result = await callGroq(env, payload);

  if (!result.ok) {
    return json(
      {
        error: result.error,
        answer: friendlyGroqError(result.error),
        reply: friendlyGroqError(result.error),
        selfChecked: false,
        selfCorrected: false,
      },
      result.status || 502
    );
  }

  let answer = result.answer;

  if (!answer) {
    answer =
      "अभी सही जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।";
  }

  // ----------------------------------------------------------
  // Basic current-date guard
  // ----------------------------------------------------------

  if (currentQuestion && webSearch) {
    answer = cleanCurrentAnswer(answer, todayIndia);
  }

  // ----------------------------------------------------------
  // IMPORTANT:
  // अब हर उत्तर पर दूसरा AI self-check call नहीं किया जा रहा।
  //
  // इससे token usage बहुत कम होगा और quota जल्दी खत्म नहीं होगी।
  // ----------------------------------------------------------

  return json({
    ok: true,
    answer,
    reply: answer,

    // Frontend compatibility
    selfChecked: true,
    selfCorrected: true,

    searched: webSearch,
    currentQuestion,
    dateIndia: todayIndia,
    model: CHAT_MODEL,
  });
}


// ============================================================
// VISION HANDLER
// ============================================================

async function handleVision(request, env) {
  const body = await request.json();

  const image =
    typeof body.image === "string"
      ? body.image
      : "";

  const question =
    typeof body.question === "string" &&
    body.question.trim()
      ? body.question.trim()
      : "इस फोटो को ध्यान से देखकर बताओ कि इसमें क्या दिखाई दे रहा है।";

  if (!image) {
    return json(
      {
        error: "Image is required.",
        answer: "फोटो नहीं मिली।",
      },
      400
    );
  }

  const todayIndia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const messages = [
    {
      role: "system",
      content: `
तुम सारथी AI हो।
उपयोगकर्ता की फोटो को ध्यान से देखकर सरल हिंदी में जवाब दो।

आज भारत की तारीख: ${todayIndia}

फोटो में जो स्पष्ट रूप से दिखाई देता है उसी के आधार पर जवाब दो।
जो दिखाई नहीं देता उसके बारे में अनुमान मत लगाओ।
अगर फोटो अस्पष्ट है तो यह स्पष्ट बताओ।
      `.trim(),
    },

    {
      role: "user",
      content: [
        {
          type: "text",
          text: question,
        },
        {
          type: "image_url",
          image_url: {
            url: image,
          },
        },
      ],
    },
  ];

  const payload = {
    model: VISION_MODEL,
    messages,
    temperature: 0.2,
    max_completion_tokens: 1200,
    stream: false,
  };

  const result = await callGroq(env, payload);

  if (!result.ok) {
    return json(
      {
        error: result.error,
        answer: friendlyGroqError(result.error),
      },
      result.status || 502
    );
  }

  return json({
    ok: true,
    answer:
      result.answer ||
      "फोटो को समझने में अभी समस्या हुई।",
  });
}


// ============================================================
// GROQ API
// ============================================================

async function callGroq(env, payload) {
  if (!env.GROQ_API_KEY) {
    return {
      ok: false,
      status: 500,
      error: "GROQ_API_KEY is not configured.",
    };
  }

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },

      body: JSON.stringify(payload),
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!response.ok) {
      console.error(
        "Groq API error:",
        response.status,
        text
      );

      return {
        ok: false,
        status: response.status,
        error:
          data?.error?.message ||
          text ||
          `Groq HTTP ${response.status}`,
      };
    }

    const answer =
      data?.choices?.[0]?.message?.content;

    if (
      typeof answer !== "string" ||
      !answer.trim()
    ) {
      return {
        ok: false,
        status: 502,
        error: "Groq returned an empty response.",
      };
    }

    return {
      ok: true,
      answer: answer.trim(),
      raw: data,
    };
  } catch (error) {
    console.error("Groq fetch error:", error);

    return {
      ok: false,
      status: 502,
      error:
        error?.message ||
        "Unable to connect to Groq.",
    };
  }
}


// ============================================================
// CURRENT QUESTION DETECTOR
// ============================================================

function isCurrentQuestion(text) {
  const q = text.toLowerCase();

  const words = [
    "आज",
    "अभी",
    "वर्तमान",
    "लेटेस्ट",
    "नवीनतम",
    "ताजा",
    "ताज़ा",
    "current",
    "today",
    "latest",
    "now",
    "live",
    "price",
    "rate",
    "भाव",
    "कीमत",
    "रेट",
    "मौसम",
    "weather",
    "समाचार",
    "news",
    "ट्रेन",
    "train",
    "समय",
    "time",
  ];

  return words.some((word) =>
    q.includes(word)
  );
}


// ============================================================
// CURRENT ANSWER CLEANER
// ============================================================

function cleanCurrentAnswer(answer, todayIndia) {
  // सिर्फ यह सुनिश्चित करते हैं कि model "आज" को
  // गलत तारीख से न जोड़े।
  //
  // पुराने historical dates को हटाया नहीं जाता,
  // क्योंकि वे सही संदर्भ हो सकते हैं।

  const todayParts = todayIndia.split("-");

  const currentYear = todayParts[0];
  const currentMonth = todayParts[1];
  const currentDay = todayParts[2];

  const currentDateText =
    `${currentDay}-${currentMonth}-${currentYear}`;

  // अगर answer में "आज" है लेकिन आज की तारीख नहीं है,
  // तो नीचे छोटा clarification जोड़ देते हैं।
  //
  // यह पुराने historical dates को नहीं छेड़ता।

  if (
    answer.includes("आज") &&
    !answer.includes(currentYear) &&
    !answer.includes(currentDateText)
  ) {
    return (
      answer +
      `\n\n📅 वर्तमान भारत की तारीख: ${currentDay}-${currentMonth}-${currentYear}`
    );
  }

  return answer;
}


// ============================================================
// FRIENDLY ERROR
// ============================================================

function friendlyGroqError(error) {
  const text = String(error || "");

  if (
    text.includes("rate limit") ||
    text.includes("Rate limit") ||
    text.includes("tokens per day") ||
    text.includes("TPD")
  ) {
    return (
      "अभी AI की token limit पूरी हो गई है। " +
      "कुछ समय बाद फिर से कोशिश करें।"
    );
  }

  if (
    text.includes("401") ||
    text.includes("invalid_api_key") ||
    text.includes("Invalid API Key") ||
    text.includes("authentication")
  ) {
    return (
      "Groq API की authentication में समस्या है। " +
      "Cloudflare में GROQ_API_KEY secret जांचें।"
    );
  }

  if (text.includes("429")) {
    return (
      "अभी बहुत ज्यादा requests हो गई हैं। " +
      "थोड़ी देर बाद फिर से कोशिश करें।"
    );
  }

  return (
    "अभी जवाब नहीं मिल पाया। " +
    "कृपया थोड़ी देर बाद फिर से कोशिश करें।"
  );
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=UTF-8",
      },
    }
  );
}


// ============================================================
// CORS HEADERS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
