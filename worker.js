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
    // CHAT API
    // =========================
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json(
          { error: "Method Not Allowed" },
          405
        );
      }

      return handleChat(request, env);
    }

    // =========================
    // VISION API
    // =========================
    if (url.pathname === "/api/vision") {
      if (request.method !== "POST") {
        return json(
          { error: "Method Not Allowed" },
          405
        );
      }

      return handleVision(request, env);
    }

    // =========================
    // WEBSITE / ASSETS
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

  if (!body || typeof body !== "object") {
    return json(
      {
        error: "Invalid request body.",
        code: "INVALID_BODY",
      },
      400
    );
  }

  // --------------------------------------------------
  // Messages
  // --------------------------------------------------

  const rawMessages = Array.isArray(body.messages)
    ? body.messages
    : [];

  if (rawMessages.length === 0) {
    return json(
      {
        error: "No messages provided.",
        code: "NO_MESSAGES",
      },
      400
    );
  }

  // Keep history small to save tokens.
  const messages = rawMessages
    .slice(-12)
    .map((message) => {
      const role =
        message?.role === "assistant"
          ? "assistant"
          : "user";

      let content = "";

      if (typeof message?.content === "string") {
        content = message.content;
      } else if (message?.content != null) {
        try {
          content = JSON.stringify(message.content);
        } catch {
          content = String(message.content);
        }
      }

      return {
        role,
        content: String(content).slice(0, 4500),
      };
    })
    .filter((m) => m.content.trim());

  if (messages.length === 0) {
    return json(
      {
        error: "No usable messages found.",
        code: "EMPTY_MESSAGES",
      },
      400
    );
  }

  const latestUserMessage =
    [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.content || "";

  const marks = detectMarks(latestUserMessage);

  const useSearch = body.webSearch === true;

  // --------------------------------------------------
  // System prompt
  // --------------------------------------------------

  const systemPrompt = buildSystemPrompt(marks, useSearch);

  // --------------------------------------------------
  // Token budget
  // --------------------------------------------------

  const maxTokens = getMaxCompletionTokens(
    marks,
    latestUserMessage
  );

  // --------------------------------------------------
  // Main Groq payload
  // --------------------------------------------------

  const payload = {
    model: "openai/gpt-oss-120b",

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

  // --------------------------------------------------
  // Internet Search
  // --------------------------------------------------

  if (useSearch) {
    payload.tools = [
      {
        type: "browser_search",
      },
    ];

    payload.tool_choice = "required";
  }

  const requestId = crypto.randomUUID();

  let result = await callGroq(
    env.GROQ_API_KEY,
    payload,
    useSearch ? 50000 : 35000
  );

  // --------------------------------------------------
  // Search fallback
  // --------------------------------------------------

  // If search failed, try once without search.
  // This prevents wasting repeated tokens on 429/TDP.
  if (
    !result.ok &&
    useSearch &&
    result.status !== 429 &&
    result.retryable
  ) {
    const fallbackPayload = {
      ...payload,
      tools: undefined,
      tool_choice: undefined,
      max_completion_tokens: Math.min(
        maxTokens,
        1024
      ),
    };

    delete fallbackPayload.tools;
    delete fallbackPayload.tool_choice;

    result = await callGroq(
      env.GROQ_API_KEY,
      fallbackPayload,
      35000
    );
  }

  // --------------------------------------------------
  // Error
  // --------------------------------------------------

  if (!result.ok) {
    return json(
      {
        error: getFriendlyGroqError(result),
        code: result.code || "GROQ_ERROR",
        status: result.status || 500,
        requestId,
      },
      result.status >= 400 && result.status < 600
        ? result.status
        : 502
    );
  }

  // --------------------------------------------------
  // Extract answer
  // --------------------------------------------------

  let reply = extractGroqReply(result.data);

  if (!reply) {
    return json(
      {
        error: "Groq returned an empty response.",
        code: "EMPTY_GROQ_RESPONSE",
        requestId,
      },
      502
    );
  }

  // --------------------------------------------------
  // SELF-CHECK + SELF-CORRECTION
  // --------------------------------------------------

  reply = finalSelfCheck(
    latestUserMessage,
    reply,
    marks
  );

  return json({
    reply,
    model: result.data?.model || "openai/gpt-oss-120b",
    webSearch: useSearch,
    selfCheck: true,
    requestId,
  });
}


// ======================================================
// SYSTEM PROMPT
// ======================================================

function buildSystemPrompt(marks, useSearch) {
  let markInstruction = "";

  if (marks === 1) {
    markInstruction =
      "1 अंक: केवल सीधा, बहुत छोटा उत्तर दो।";
  } else if (marks === 2) {
    markInstruction =
      "2 अंक: 2-4 छोटे वाक्य या मुख्य बिंदु दो।";
  } else if (marks === 5) {
    markInstruction =
      "5 अंक: सरल भाषा में लगभग 6 मुख्य बिंदु, छोटा निष्कर्ष। अनावश्यक advanced details मत दो।";
  } else if (marks === 10) {
    markInstruction =
      "10 अंक: परिचय, headings, मुख्य बिंदु और निष्कर्ष के साथ परीक्षा-योग्य उत्तर दो।";
  } else if (marks === 12) {
    markInstruction =
      "12 अंक: विस्तृत लेकिन आसान परीक्षा-योग्य उत्तर दो। परिचय, headings, मुख्य बिंदु और निष्कर्ष रखो।";
  } else {
    markInstruction =
      "प्रश्न के अनुसार उत्तर की लंबाई रखो। अनावश्यक लंबा उत्तर मत दो।";
  }

  const searchInstruction = useSearch
    ? `
Internet Search ON है।
जरूरत पड़ने पर उपलब्ध web search का उपयोग करो।
Current information जैसे आज का भाव, मौसम, समाचार, तारीख, कीमत आदि में ताजा जानकारी को प्राथमिकता दो।
उत्तर में स्रोत/citation उपलब्ध हो तो शामिल करो।
`
    : `
Internet Search OFF है।
बिना web search के सामान्य ज्ञान के आधार पर उत्तर दो।
`;

  return `
तुम "सारथी AI" हो।

भाषा:
- उपयोगकर्ता हिंदी में पूछे तो आसान हिंदी में उत्तर दो।
- कठिन अंग्रेजी शब्दों और अनावश्यक technical terms से बचो।
- परीक्षा के उत्तर में साफ headings और numbering इस्तेमाल करो।
- प्रश्न का सीधा उत्तर पहले दो।

${markInstruction}

Self-check:
उत्तर देने से पहले internally जांचो:
1. तथ्य सही हैं?
2. प्रश्न का वही उत्तर दिया है?
3. भाषा प्रश्न के स्तर के अनुसार आसान है?
4. marks के अनुसार उत्तर की लंबाई सही है?
5. कोई अनावश्यक advanced detail तो नहीं?
गलती हो तो final answer देने से पहले खुद सुधारो।

विशेष नियम:
अगर प्रश्न "प्रकाश संश्लेषण क्या है?" और 5 अंक का है, तो उत्तर school-level सरल होना चाहिए।
Photosystem, ATP, NADPH, Calvin cycle, electron transport जैसी advanced बातें बिना मांगे मत लिखो।

${searchInstruction}

Quiz mode में:
- प्रश्न के अनुसार साफ विकल्प और सही उत्तर दो।
- उपयोगकर्ता अगर केवल उत्तर मांगे तो अनावश्यक explanation मत दो।
`.trim();
}


// ======================================================
// TOKEN CONTROL
// ======================================================

function getMaxCompletionTokens(marks, question) {
  if (marks === 1) return 256;
  if (marks === 2) return 384;
  if (marks === 5) return 768;
  if (marks === 10) return 1280;
  if (marks === 12) return 1536;

  // Very short questions
  if (question.length < 100) {
    return 768;
  }

  return 1024;
}


// ======================================================
// MARK DETECTION
// ======================================================

function detectMarks(text) {
  if (!text) return null;

  const normalized = String(text)
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (
    /12\s*(अंक|marks?|मार्क)/i.test(normalized)
  ) {
    return 12;
  }

  if (
    /10\s*(अंक|marks?|मार्क)/i.test(normalized)
  ) {
    return 10;
  }

  if (
    /5\s*(अंक|marks?|मार्क)/i.test(normalized)
  ) {
    return 5;
  }

  if (
    /2\s*(अंक|marks?|मार्क)/i.test(normalized)
  ) {
    return 2;
  }

  if (
    /1\s*(अंक|marks?|मार्क)/i.test(normalized)
  ) {
    return 1;
  }

  return null;
}


// ======================================================
// FINAL SELF CHECK
// ======================================================

function finalSelfCheck(
  question,
  answer,
  marks
) {
  let result = String(answer || "").trim();

  // -----------------------------------------------
  // Deterministic corrections
  // -----------------------------------------------

  result = deterministicFactCheck(result);

  // -----------------------------------------------
  // Special 5-mark photosynthesis protection
  // -----------------------------------------------

  if (
    marks === 5 &&
    isSimplePhotosynthesisQuestion(question)
  ) {
    return buildSimplePhotosynthesisAnswer();
  }

  // -----------------------------------------------
  // Remove accidental meta-talk
  // -----------------------------------------------

  result = result
    .replace(/^Here is the answer[:：]?\s*/i, "")
    .replace(/^उत्तर[:：]\s*/i, "")
    .trim();

  // -----------------------------------------------
  // Basic cleanup
  // -----------------------------------------------

  result = result
    .replace(/\n{4,}/g, "\n\n")
    .trim();

  return result;
}


// ======================================================
// PHOTOSYNTHESIS DETECTOR
// ======================================================

function isSimplePhotosynthesisQuestion(text) {
  const t = String(text || "").toLowerCase();

  const hasPhotosynthesis =
    t.includes("प्रकाश संश्लेषण") ||
    t.includes("photosynthesis");

  const hasSimpleQuestion =
    t.includes("क्या है") ||
    t.includes("परिभाषा") ||
    t.includes("define") ||
    t.includes("what is");

  return hasPhotosynthesis && hasSimpleQuestion;
}


// ======================================================
// SIMPLE PHOTOSYNTHESIS ANSWER
// ======================================================

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

  // Common incorrect claim
  result = result.replace(
    /रात में पौधे ऑक्सीजन छोड़ते हैं/gi,
    "पौधे सामान्यतः प्रकाश संश्लेषण के दौरान ऑक्सीजन छोड़ते हैं"
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
// GROQ CALL
// ======================================================

async function callGroq(
  apiKey,
  payload,
  timeoutMs = 35000
) {
  const controller = new AbortController();

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
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify(payload),

        signal: controller.signal,
      }
    );

    const text = await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text,
      };
    }

    if (!response.ok) {
      const errorText =
        data?.error?.message ||
        data?.message ||
        text ||
        "Groq request failed.";

      return {
        ok: false,
        status: response.status,
        code: detectGroqErrorCode(
          response.status,
          errorText
        ),
        retryable: isRetryableStatus(
          response.status
        ),
        message: errorText,
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
        retryable: true,
        message: "Groq request timed out.",
      };
    }

    return {
      ok: false,
      status: 502,
      code: "NETWORK_ERROR",
      retryable: true,
      message:
        error?.message || "Network error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}


// ======================================================
// ERROR HELPERS
// ======================================================

function isRetryableStatus(status) {
  // IMPORTANT:
  // Do NOT retry 429.
  // Repeating a TPD/rate-limit request wastes tokens
  // and usually cannot succeed immediately.

  if (status === 429) {
    return false;
  }

  return (
    status === 408 ||
    status === 409 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}


function detectGroqErrorCode(
  status,
  message
) {
  const text = String(message || "")
    .toLowerCase();

  if (
    status === 429 ||
    text.includes("rate limit") ||
    text.includes("tokens per day") ||
    text.includes("tpd")
  ) {
    return "RATE_LIMIT";
  }

  if (
    status === 401 ||
    text.includes("invalid api key") ||
    text.includes("authentication")
  ) {
    return "AUTH_ERROR";
  }

  if (status === 403) {
    return "FORBIDDEN";
  }

  if (
    status === 400 &&
    text.includes("model")
  ) {
    return "MODEL_ERROR";
  }

  return "GROQ_ERROR";
}


function getFriendlyGroqError(result) {
  if (result.code === "RATE_LIMIT") {
    return "Groq की token/rate limit अभी पूरी हो गई है। कुछ समय बाद फिर कोशिश करें।";
  }

  if (result.code === "AUTH_ERROR") {
    return "Groq API authentication में समस्या है। Cloudflare में GROQ_API_KEY secret जांचें।";
  }

  if (result.code === "MODEL_ERROR") {
    return "Groq model से संबंधित समस्या आई है।";
  }

  if (result.code === "TIMEOUT") {
    return "Groq से जवाब आने में बहुत समय लग गया। फिर कोशिश करें।";
  }

  if (result.code === "NETWORK_ERROR") {
    return "Internet या Groq connection में समस्या आई है।";
  }

  return "अभी जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।";
}


// ======================================================
// RESPONSE EXTRACTION
// ======================================================

function extractGroqReply(data) {
  try {
    const choice = data?.choices?.[0];

    if (!choice) {
      return "";
    }

    const content =
      choice?.message?.content;

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
  } catch {
    return "";
  }
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

  // Prevent extremely large requests.
  if (imageData.length > 20_000_000) {
    return json(
      {
        error: "Image is too large.",
        code: "IMAGE_TOO_LARGE",
      },
      413
    );
  }

  const userQuestion =
    typeof body?.question === "string"
      ? body.question.slice(0, 2000)
      : "इस फोटो को देखकर बताओ कि इसमें क्या है।";

  const visionPayload = {
    model: "qwen/qwen3.6-27b",

    messages: [
      {
        role: "system",
        content: `
तुम सारथी AI के vision assistant हो।

फोटो को ध्यान से देखो और आसान हिंदी में उत्तर दो।
जो साफ दिखाई दे केवल उसी के आधार पर जवाब दो।
अगर फोटो में लिखा हुआ प्रश्न है तो उसे हल करो।
अगर फोटो धुंधली है या जानकारी साफ नहीं दिखती तो साफ बताओ।
अनावश्यक लंबा उत्तर मत दो।
        `.trim(),
      },

      {
        role: "user",

        content: [
          {
            type: "text",
            text: userQuestion,
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

    max_completion_tokens: 1024,

    temperature: 0.2,

    stream: false,
  };

  const requestId = crypto.randomUUID();

  const result = await callGroq(
    env.GROQ_API_KEY,
    visionPayload,
    50000
  );

  if (!result.ok) {
    return json(
      {
        error: getFriendlyGroqError(result),
        code: result.code || "VISION_ERROR",
        status: result.status || 500,
        requestId,
      },
      result.status >= 400 && result.status < 600
        ? result.status
        : 502
    );
  }

  let reply = extractGroqReply(
    result.data
  );

  if (!reply) {
    return json(
      {
        error: "Vision returned an empty response.",
        code: "EMPTY_VISION_RESPONSE",
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
// JSON RESPONSE
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
