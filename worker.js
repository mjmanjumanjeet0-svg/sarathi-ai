export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // =========================
    // CHAT
    // =========================
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      return handleChat(request, env);
    }

    // =========================
    // VISION
    // =========================
    if (url.pathname === "/api/vision") {
      if (request.method !== "POST") {
        return json({ error: "Method Not Allowed" }, 405);
      }

      return handleVision(request, env);
    }

    // =========================
    // WEBSITE
    // =========================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Sarathi AI is running.", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...corsHeaders(),
      },
    });
  },
};


// ======================================================
// CHAT
// ======================================================

async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY is not configured.",
        code: "MISSING_API_KEY",
      },
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        error: "Invalid JSON request.",
        code: "INVALID_JSON",
      },
      400
    );
  }

  const rawMessages = Array.isArray(body?.messages)
    ? body.messages
    : [];

  if (!rawMessages.length) {
    return json(
      {
        error: "No messages provided.",
        code: "NO_MESSAGES",
      },
      400
    );
  }

  // कम history = कम tokens
  const messages = rawMessages
    .slice(-10)
    .map((m) => {
      const role =
        m?.role === "assistant"
          ? "assistant"
          : "user";

      let content = "";

      if (typeof m?.content === "string") {
        content = m.content;
      } else if (m?.content != null) {
        try {
          content = JSON.stringify(m.content);
        } catch {
          content = String(m.content);
        }
      }

      return {
        role,
        content: String(content).slice(0, 3500),
      };
    })
    .filter((m) => m.content.trim());

  const latestQuestion =
    [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.content || "";

  const marks = detectMarks(latestQuestion);

  const useSearch = body.webSearch === true;

  // Search के लिए छोटा model
  // Normal chat के लिए बड़ा model
  const model = useSearch
    ? "openai/gpt-oss-20b"
    : "openai/gpt-oss-120b";

  const maxTokens = getMaxTokens(
    marks,
    latestQuestion,
    useSearch
  );

  const systemPrompt =
    buildSystemPrompt(marks, useSearch);

  const payload = {
    model,

    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      ...messages,
    ],

    max_completion_tokens: maxTokens,

    temperature: 0.2,

    reasoning_effort: "low",

    stream: false,
  };

  // ==================================================
  // INTERNET SEARCH
  // ==================================================

  if (useSearch) {
    payload.tools = [
      {
        type: "browser_search",
      },
    ];

    // Search ON होने पर search अनिवार्य
    payload.tool_choice = "required";
  }

  const requestId = crypto.randomUUID();

  const result = await callGroq(
    env.GROQ_API_KEY,
    payload,
    useSearch ? 60000 : 40000
  );

  // ==================================================
  // SEARCH ERROR
  // ==================================================

  if (!result.ok) {
    return json(
      {
        error: useSearch
          ? getSearchError(result)
          : getFriendlyError(result),

        code:
          result.code ||
          (useSearch
            ? "SEARCH_ERROR"
            : "GROQ_ERROR"),

        status: result.status || 500,

        requestId,
      },
      result.status >= 400 &&
      result.status < 600
        ? result.status
        : 502
    );
  }

  // ==================================================
  // ANSWER
  // ==================================================

  let reply = extractReply(result.data);

  if (!reply) {
    return json(
      {
        error: useSearch
          ? "Internet Search से कोई उत्तर नहीं मिला।"
          : "अभी जवाब नहीं मिल पाया।",

        code: "EMPTY_RESPONSE",

        requestId,
      },
      502
    );
  }

  // ==================================================
  // SELF CHECK
  // ==================================================

  reply = finalSelfCheck(
    latestQuestion,
    reply,
    marks
  );

  return json({
    reply,

    model:
      result.data?.model || model,

    webSearch: useSearch,

    selfCheck: true,

    requestId,
  });
}


// ======================================================
// SYSTEM PROMPT
// ======================================================

function buildSystemPrompt(marks, useSearch) {
  let marksRule = "";

  if (marks === 1) {
    marksRule =
      "1 अंक: केवल छोटा और सीधा उत्तर।";
  } else if (marks === 2) {
    marksRule =
      "2 अंक: 2-4 छोटे वाक्य या बिंदु।";
  } else if (marks === 5) {
    marksRule =
      "5 अंक: सरल भाषा, लगभग 5-7 मुख्य बिंदु और छोटा निष्कर्ष।";
  } else if (marks === 10) {
    marksRule =
      "10 अंक: परिचय, headings, मुख्य बिंदु और निष्कर्ष।";
  } else if (marks === 12) {
    marksRule =
      "12 अंक: विस्तृत परीक्षा-योग्य उत्तर, headings और निष्कर्ष सहित।";
  } else {
    marksRule =
      "प्रश्न के अनुसार उचित लंबाई में उत्तर दो।";
  }

  const searchRule = useSearch
    ? `
Internet Search ON है।
Current जानकारी के लिए browser search का उपयोग करो।
जैसे आज की कीमत, आज का भाव, मौसम, समाचार या वर्तमान जानकारी।
Search से मिली जानकारी के आधार पर उत्तर दो।
यदि स्रोत की जानकारी मिले तो स्रोत/citation भी रखो।
`
    : `
Internet Search OFF है।
सामान्य ज्ञान के आधार पर उत्तर दो।
`;

  return `
तुम "सारथी AI" हो।

- उपयोगकर्ता हिंदी में पूछे तो आसान हिंदी में उत्तर दो।
- सीधे प्रश्न का उत्तर दो।
- अनावश्यक technical शब्दों से बचो।
- परीक्षा के उत्तर में साफ headings और numbering रखो।

${marksRule}

Self-check:
उत्तर भेजने से पहले तथ्य, प्रश्न से संबंधितता, भाषा और marks के अनुसार लंबाई जांचो।
गलती हो तो खुद सुधारो।

विशेष:
यदि "प्रकाश संश्लेषण क्या है? 5 अंक" पूछा जाए,
तो school-level सरल उत्तर दो।
Photosystem, ATP, NADPH, Calvin cycle जैसी advanced बातें बिना मांगे मत लिखो।

${searchRule}
`.trim();
}


// ======================================================
// TOKEN CONTROL
// ======================================================

function getMaxTokens(
  marks,
  question,
  useSearch
) {
  if (useSearch) {
    // Search के लिए जानबूझकर छोटा output
    return 768;
  }

  if (marks === 1) return 256;

  if (marks === 2) return 384;

  if (marks === 5) return 768;

  if (marks === 10) return 1280;

  if (marks === 12) return 1536;

  if (question.length < 100) {
    return 768;
  }

  return 1024;
}


// ======================================================
// MARK DETECTION
// ======================================================

function detectMarks(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (/12\s*(अंक|marks?|मार्क)/i.test(t)) {
    return 12;
  }

  if (/10\s*(अंक|marks?|मार्क)/i.test(t)) {
    return 10;
  }

  if (/5\s*(अंक|marks?|मार्क)/i.test(t)) {
    return 5;
  }

  if (/2\s*(अंक|marks?|मार्क)/i.test(t)) {
    return 2;
  }

  if (/1\s*(अंक|marks?|मार्क)/i.test(t)) {
    return 1;
  }

  return null;
}


// ======================================================
// SELF CHECK
// ======================================================

function finalSelfCheck(
  question,
  answer,
  marks
) {
  let result = String(answer || "").trim();

  result = deterministicFactCheck(result);

  // 5 marks photosynthesis protection
  if (
    marks === 5 &&
    isSimplePhotosynthesisQuestion(question)
  ) {
    return buildSimplePhotosynthesisAnswer();
  }

  result = result
    .replace(
      /^Here is the answer[:：]?\s*/i,
      ""
    )
    .replace(
      /^उत्तर[:：]\s*/i,
      ""
    )
    .replace(/\n{4,}/g, "\n\n")
    .trim();

  return result;
}


// ======================================================
// PHOTOSYNTHESIS
// ======================================================

function isSimplePhotosynthesisQuestion(text) {
  const t = String(text || "").toLowerCase();

  const photosynthesis =
    t.includes("प्रकाश संश्लेषण") ||
    t.includes("photosynthesis");

  const simple =
    t.includes("क्या है") ||
    t.includes("परिभाषा") ||
    t.includes("define") ||
    t.includes("what is");

  return photosynthesis && simple;
}


function buildSimplePhotosynthesisAnswer() {
  return `प्रकाश संश्लेषण

प्रकाश संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे सूर्य के प्रकाश की ऊर्जा की सहायता से जल और कार्बन डाइऑक्साइड से अपना भोजन बनाते हैं और ऑक्सीजन वातावरण में छोड़ते हैं।

मुख्य बिंदु

1. यह प्रक्रिया हरे पौधों में होती है।
2. पत्तियाँ वायु से कार्बन डाइऑक्साइड लेती हैं।
3. पौधे जड़ों द्वारा मिट्टी से जल प्राप्त करते हैं।
4. क्लोरोफिल सूर्य के प्रकाश को ग्रहण करता है।
5. पौधे प्रकाश की सहायता से अपना भोजन बनाते हैं।
6. इस प्रक्रिया में ऑक्सीजन वातावरण में निकलती है।

महत्व

प्रकाश संश्लेषण पौधों के लिए भोजन बनाने की मुख्य प्रक्रिया है और इससे वातावरण में ऑक्सीजन मिलती है।

निष्कर्ष

इस प्रकार प्रकाश संश्लेषण पौधों और पृथ्वी पर जीवन के लिए बहुत महत्वपूर्ण है।`;
}


// ======================================================
// FACT CHECK
// ======================================================

function deterministicFactCheck(text) {
  let result = String(text || "");

  result = result.replace(
    /रात में पौधे ऑक्सीजन छोड़ते हैं/gi,
    "पौधे प्रकाश संश्लेषण के दौरान ऑक्सीजन छोड़ते हैं"
  );

  result = result.replace(
    /रात में ऑक्सीजन छोड़ता है/gi,
    "प्रकाश संश्लेषण के दौरान ऑक्सीजन छोड़ता है"
  );

  result = result.replace(
    /प्रकाश संश्लेषण रात में होता है/gi,
    "प्रकाश संश्लेषण के लिए प्रकाश आवश्यक होता है"
  );

  return result.trim();
}


// ======================================================
// GROQ REQUEST
// ======================================================

async function callGroq(
  apiKey,
  payload,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify(payload),

        signal: controller.signal,
      }
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text,
      };
    }

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        text ||
        "Groq request failed.";

      return {
        ok: false,
        status: response.status,
        code: detectErrorCode(
          response.status,
          message
        ),
        message,
        data,
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        code: "TIMEOUT",
        message: "Groq request timed out.",
      };
    }

    return {
      ok: false,
      status: 502,
      code: "NETWORK_ERROR",
      message:
        error?.message ||
        "Network error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}


// ======================================================
// ERROR CODE
// ======================================================

function detectErrorCode(
  status,
  message
) {
  const t =
    String(message || "").toLowerCase();

  if (
    status === 429 ||
    t.includes("rate limit") ||
    t.includes("tokens per day") ||
    t.includes("tpd")
  ) {
    return "RATE_LIMIT";
  }

  if (
    status === 401 ||
    t.includes("invalid api key") ||
    t.includes("authentication")
  ) {
    return "AUTH_ERROR";
  }

  if (status === 403) {
    return "FORBIDDEN";
  }

  if (
    status === 400 &&
    t.includes("model")
  ) {
    return "MODEL_ERROR";
  }

  return "GROQ_ERROR";
}


// ======================================================
// SEARCH ERROR
// ======================================================

function getSearchError(result) {
  if (result.code === "RATE_LIMIT") {
    return "Internet Search की Groq token/rate limit पूरी हो गई है। कुछ समय बाद फिर कोशिश करें।";
  }

  if (result.code === "AUTH_ERROR") {
    return "Groq API key की authentication में समस्या है।";
  }

  if (result.code === "MODEL_ERROR") {
    return "Internet Search वाले model में समस्या है।";
  }

  if (result.code === "TIMEOUT") {
    return "Internet Search में समय समाप्त हो गया। फिर कोशिश करें।";
  }

  return "Internet Search अभी काम नहीं कर पाया।";
}


// ======================================================
// NORMAL ERROR
// ======================================================

function getFriendlyError(result) {
  if (result.code === "RATE_LIMIT") {
    return "Groq की token/rate limit अभी पूरी हो गई है। कुछ समय बाद फिर कोशिश करें।";
  }

  if (result.code === "AUTH_ERROR") {
    return "Groq API authentication में समस्या है।";
  }

  if (result.code === "TIMEOUT") {
    return "Groq से जवाब आने में बहुत समय लग गया।";
  }

  if (result.code === "NETWORK_ERROR") {
    return "Internet या Groq connection में समस्या आई है।";
  }

  return "अभी जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।";
}


// ======================================================
// EXTRACT RESPONSE
// ======================================================

function extractReply(data) {
  const content =
    data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}


// ======================================================
// VISION
// ======================================================

async function handleVision(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY is not configured.",
        code: "MISSING_API_KEY",
      },
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        error: "Invalid JSON request.",
        code: "INVALID_JSON",
      },
      400
    );
  }

  const imageData = body?.imageData;

  if (
    typeof imageData !== "string" ||
    !imageData.startsWith("data:image/")
  ) {
    return json(
      {
        error: "Valid imageData is required.",
        code: "INVALID_IMAGE",
      },
      400
    );
  }

  if (imageData.length > 20_000_000) {
    return json(
      {
        error: "Image is too large.",
        code: "IMAGE_TOO_LARGE",
      },
      413
    );
  }

  const question =
    typeof body?.question === "string"
      ? body.question.slice(0, 1500)
      : "इस फोटो को देखकर बताओ कि इसमें क्या है।";

  const payload = {
    model: "qwen/qwen3.6-27b",

    messages: [
      {
        role: "system",
        content:
          "फोटो को ध्यान से देखकर आसान हिंदी में सीधा उत्तर दो। जो साफ दिखाई दे केवल उसी के आधार पर जवाब दो।",
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
              url: imageData,
            },
          },
        ],
      },
    ],

    max_completion_tokens: 768,

    temperature: 0.2,

    stream: false,
  };

  const requestId =
    crypto.randomUUID();

  const result = await callGroq(
    env.GROQ_API_KEY,
    payload,
    60000
  );

  if (!result.ok) {
    return json(
      {
        error: getFriendlyError(result),
        code:
          result.code ||
          "VISION_ERROR",
        status:
          result.status || 500,
        requestId,
      },
      result.status >= 400 &&
      result.status < 600
        ? result.status
        : 502
    );
  }

  let reply = extractReply(
    result.data
  );

  if (!reply) {
    return json(
      {
        error:
          "Photo से कोई जवाब नहीं मिला।",
        code:
          "EMPTY_VISION_RESPONSE",
        requestId,
      },
      502
    );
  }

  reply = deterministicFactCheck(reply);

  return json({
    reply,

    model:
      result.data?.model ||
      "qwen/qwen3.6-27b",

    selfCheck: true,

    requestId,
  });
}


// ======================================================
// CORS
// ======================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
  };
}


// ======================================================
// JSON
// ======================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        ...corsHeaders(),
      },
    }
  );
}
