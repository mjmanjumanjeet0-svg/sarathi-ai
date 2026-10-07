const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3.8-27b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

// =========================
// SYSTEM PROMPT
// =========================

const SYSTEM_PROMPT = `तुम "सारथी AI" हो — एक भरोसेमंद हिंदी AI सहायक।

मुख्य उत्तर आसान, स्वाभाविक हिंदी में दो।
प्रश्न में जो पूछा है उसी पर केंद्रित रहो।
तथ्य मत गढ़ो।

जब User आज, अभी, latest, current, live, ताजा, अभी का भाव,
आज का मौसम, आज की कीमत, ट्रेन, समाचार या किसी वर्तमान जानकारी के बारे में पूछे
और Internet Search उपलब्ध हो, तो Internet Search का उपयोग करो।

Search से मिले ताजा परिणामों को प्राथमिकता दो।
पुराने परिणाम को आज की जानकारी की तरह मत बताओ।
यदि Search result में तारीख दी गई हो तो उसे ध्यान में रखो।

मौसम, सोने का भाव, ट्रेन, समाचार, कीमत और अन्य बदलने वाली जानकारी में
बिना Search के वर्तमान जानकारी मत गढ़ो।

Search ON होने पर User के सवाल का उत्तर देने से पहले browser search का उपयोग करो।
Search result से मिली जानकारी को समझकर सरल हिंदी में उत्तर दो।
जहाँ संभव हो स्रोत और तारीख बताओ।

बहुत महत्वपूर्ण तारीख नियम:
जिस तारीख के बारे में User पूछ रहा है, केवल उसी तारीख या उससे पहले
प्रकाशित/अपडेट हुए Search result को उस तारीख का प्रमाण मानो।

भविष्य की तारीख वाले स्रोत को कभी भी वर्तमान या पिछली तारीख की
जानकारी का स्रोत मत बताओ।

स्रोत की तारीख और डेटा की तारीख को आपस में मत मिलाओ।

यदि मांगी गई तारीख का ताजा डेटा उपलब्ध नहीं है,
तो साफ बताओ कि उपलब्ध स्रोत पिछली तारीख का है।

यदि User "आज" पूछे और Search का सबसे नया विश्वसनीय डेटा कल का हो,
तो "आज" का पक्का आंकड़ा मत गढ़ो।
बताओ कि सबसे हाल उपलब्ध डेटा कल का है।

यदि User मौसम पूछता है लेकिन शहर/स्थान नहीं बताता,
तो पहले स्थान पूछो।
User की exact location का अनुमान मत लगाओ।

यदि Search result और User के प्रश्न की तारीख में अंतर हो,
तो तारीख का अंतर साफ बताओ।

परीक्षा के उत्तर में अंक के अनुसार लंबाई रखो।
2 अंक में छोटा उत्तर।
5 अंक में भूमिका + 4–6 बिंदु + निष्कर्ष।
10/12 अंक में भूमिका + headings + पर्याप्त बिंदु + उदाहरण + निष्कर्ष।

बिना आवश्यकता advanced technical terms मत जोड़ो।
गणित में steps और अंतिम उत्तर स्पष्ट दो।
कारण, घटना और परिणाम को आपस में मत मिलाओ।
फोटो में जो दिखाई देता है उसी के आधार पर उत्तर दो।

अनावश्यक **bold** या *italic* formatting मत लगाओ।`;

// =========================
// WORKER
// =========================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS
    // =========================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // =========================
    // CHAT
    // =========================

    if (url.pathname === "/api/chat") {
      return request.method === "POST"
        ? handleChat(request, env)
        : json({ error: "Only POST is allowed." }, 405);
    }

    // =========================
    // TRANSCRIBE
    // =========================

    if (url.pathname === "/api/transcribe") {
      return request.method === "POST"
        ? handleTranscribe(request, env)
        : json({ error: "Only POST is allowed." }, 405);
    }

    // =========================
    // VISION
    // =========================

    if (url.pathname === "/api/vision") {
      return request.method === "POST"
        ? handleVision(request, env)
        : json({ error: "Only POST is allowed." }, 405);
    }

    // =========================
    // ROOT
    // =========================

    if (url.pathname === "/") {
      return new Response("Sarathi AI Worker is running.", {
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Sarathi AI is running.", {
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  },
};

// ============================================================
// CHAT
// ============================================================

async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY Cloudflare Secret में configured नहीं है।",
        code: "MISSING_API_KEY",
      },
      500
    );
  }

  try {
    const body = await request.json();

    const history = Array.isArray(body?.history)
      ? body.history
      : [];

    const message = String(body?.message ?? "").trim();

    const useSearch = body?.webSearch === true;

    if (!message) {
      return json(
        {
          error: "कृपया पहले अपना सवाल लिखें।",
          code: "EMPTY_QUESTION",
        },
        400
      );
    }

    // ========================================================
    // HISTORY LIMIT
    // ========================================================

    let messages = history
      .slice(-8)
      .map((m) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: String(m?.content ?? "")
          .trim()
          .slice(0, 3500),
      }))
      .filter((m) => m.content);

    // Current user message हमेशा भेजें
    if (
      !(
        messages.length &&
        messages[messages.length - 1].role === "user" &&
        messages[messages.length - 1].content === message
      )
    ) {
      messages.push({
        role: "user",
        content: message.slice(0, 6000),
      });
    }

    // ========================================================
    // INDIA CURRENT TIME
    // ========================================================

    const indiaNow = new Intl.DateTimeFormat("hi-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());

    const systemContent =
      SYSTEM_PROMPT +
      `\n\nभारत में अभी का समय: ${indiaNow}।
जब User आज/अभी/latest/current पूछे, तो इस समय को संदर्भ मानो।`;

    // ========================================================
    // GROQ CHAT PAYLOAD
    // ========================================================

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: systemContent,
        },
        ...messages,
      ],

      max_completion_tokens: 2048,

      temperature: 0.2,

      reasoning_effort: "low",

      stream: false,
    };

    // ========================================================
    // BROWSER SEARCH
    // ========================================================

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search",
        },
      ];

      // Search ON होने पर Browser Search अनिवार्य
      payload.tool_choice = "required";
    }

    // ========================================================
    // FIRST REQUEST
    // ========================================================

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    // ========================================================
    // RATE LIMIT / TEMPORARY ERROR RETRY
    // ========================================================

    if (!result.ok && result.retryable) {
      const waitMs = result.retryAfterMs || 9000;

      await sleep(waitMs);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );
    }

    // ========================================================
    // ERROR
    // ========================================================

    if (!result.ok) {
      return json(
        {
          error: result.error,
          code: result.code,
          requestId: result.requestId || null,
        },
        result.status || 502
      );
    }

    if (!result.reply) {
      return json(
        {
          error: "AI ने खाली उत्तर दिया। फिर से कोशिश करें।",
          code: "EMPTY_RESPONSE",
        },
        502
      );
    }

    // ========================================================
    // SELF CHECK
    // ========================================================

    const checked = await selfCheckAndCorrect(
      messages,
      result.reply,
      env.GROQ_API_KEY,
      useSearch
    );

    return json({
      answer: checked.reply,
      selfChecked: checked.selfChecked,
      selfCorrected: checked.selfCorrected,
      searchUsed: useSearch,
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        code: "WORKER_ERROR",
      },
      500
    );
  }
}

// ============================================================
// SELF CHECK
// ============================================================

async function selfCheckAndCorrect(
  messages,
  answer,
  apiKey,
  wasSearchUsed
) {
  try {
    const questionText = messages
      .slice(-4)
      .map(
        (m) =>
          `${m.role}: ${m.content.slice(0, 2500)}`
      )
      .join("\n\n");

    const answerText = String(answer)
      .trim()
      .slice(0, 6000);

    const searchInstruction = wasSearchUsed
      ? `
यह उत्तर Browser Search के बाद आया है।

यदि Search से वर्तमान जानकारी मिली है और उत्तर उस जानकारी पर आधारित है,
तो उसे केवल इसलिए गलत मत मानो कि तुम्हारे पास स्वयं live internet access नहीं है।

Search से मिली तारीख और स्रोत को ध्यान में रखो।
Future-dated source को current/past proof मत मानो।
`
      : `
यदि सवाल current/latest/live जानकारी मांगता है और Search का उपयोग नहीं हुआ,
तो बिना प्रमाण current fact को सही मत मानो।
`;

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: `तुम "सारथी AI Quality Checker" हो।

User के सवाल और AI answer की जाँच करो।

जाँच:
1. तथ्य सही हैं या नहीं।
2. सवाल का सीधा उत्तर दिया गया है या नहीं।
3. अनावश्यक जानकारी तो नहीं है।
4. उत्तर में मनगढ़ंत जानकारी तो नहीं है।
5. Current/Search वाले उत्तर में बिना आधार के वर्तमान दावा तो नहीं है।
6. तारीख और स्रोत आपस में सही तरीके से जुड़े हैं या नहीं।

${searchInstruction}

महत्वपूर्ण:
सिर्फ शैली पसंद न आने पर उत्तर को मत बदलो।
सही Search-based उत्तर को "मैं real-time जानकारी नहीं दे सकता"
जैसे सामान्य refusal में मत बदलो।

अगर उत्तर सही है:
needs_correction=false

अगर गलती है:
needs_correction=true और पूरा सुधरा हुआ उत्तर दो।

मनगढ़ंत जानकारी मत जोड़ो।`,
        },

        {
          role: "user",
          content:
            `USER:\n${questionText}\n\nAI ANSWER:\n${answerText}`,
        },
      ],

      max_completion_tokens: 1024,

      temperature: 0,

      reasoning_effort: "low",

      stream: false,

      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sarathi_quality_check",
          strict: true,

          schema: {
            type: "object",

            properties: {
              needs_correction: {
                type: "boolean",
              },

              corrected_answer: {
                type: "string",
              },
            },

            required: [
              "needs_correction",
              "corrected_answer",
            ],

            additionalProperties: false,
          },
        },
      },
    };

    const result = await callGroq(
      payload,
      apiKey,
      30000
    );

    // Self-check fail होने पर original answer रखें
    if (!result.ok) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    if (!result.raw) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    let report;

    try {
      report = JSON.parse(result.raw);
    } catch {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    const corrected = String(
      report?.corrected_answer ?? ""
    ).trim();

    if (!corrected) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    if (report?.needs_correction !== true) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    // बहुत बड़ा अनावश्यक correction रोकें
    if (
      corrected.length >
      Math.max(answer.length * 3, 12000)
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    return {
      reply: corrected,
      selfChecked: true,
      selfCorrected: true,
    };

  } catch {
    return {
      reply: answer,
      selfChecked: false,
      selfCorrected: false,
    };
  }
}

// ============================================================
// VISION
// ============================================================

async function handleVision(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY configured नहीं है।",
        code: "MISSING_API_KEY",
      },
      500
    );
  }

  try {
    const body = await request.json();

    const image = String(
      body?.image ??
      body?.imageData ??
      body?.imageBase64 ??
      ""
    ).trim();

    const question = String(
      body?.question ??
      body?.prompt ??
      "इस फोटो को ध्यान से देखकर सरल हिंदी में समझाओ।"
    ).trim();

    if (!image) {
      return json(
        {
          error: "फोटो उपलब्ध नहीं है।",
          code: "MISSING_IMAGE",
        },
        400
      );
    }

    if (!image.startsWith("data:image/")) {
      return json(
        {
          error: "फोटो का format सही नहीं है।",
          code: "INVALID_IMAGE_FORMAT",
        },
        400
      );
    }

    const payload = {
      model: VISION_MODEL,

      messages: [
        {
          role: "system",
          content:
            "तुम सारथी AI हो। फोटो को ध्यान से देखो। फोटो में प्रश्न, किताब, नोट्स, diagram, chart या handwriting हो तो उसे पढ़कर सरल और सही हिंदी में समझाओ। जो दिखाई नहीं देता उसे मत गढ़ो।",
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
      ],

      max_completion_tokens: 2048,

      temperature: 0.4,

      reasoning_effort: "low",

      stream: false,
    };

    const result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    if (!result.ok) {
      return json(
        {
          error: result.error,
          code: result.code,
          requestId: result.requestId || null,
        },
        result.status || 502
      );
    }

    return json({
      answer:
        result.reply ||
        "फोटो से कोई उत्तर नहीं मिला।",
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        code: "VISION_ERROR",
      },
      500
    );
  }
}

// ============================================================
// TRANSCRIBE
// ============================================================

async function handleTranscribe(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY configured नहीं है।",
        code: "MISSING_API_KEY",
      },
      500
    );
  }

  try {
    let audioFile = null;

    const contentType =
      request.headers.get("content-type") || "";

    // ========================================================
    // MULTIPART
    // ========================================================

    if (
      contentType.includes(
        "multipart/form-data"
      )
    ) {
      const form = await request.formData();

      const file = form.get("file");

      if (file instanceof File) {
        audioFile = file;
      }

    } else {
      // ======================================================
      // BASE64 AUDIO
      // ======================================================

      const body = await request.json();

      const base64 = String(
        body?.audio ?? ""
      ).trim();

      const mimeType = String(
        body?.mimeType ?? "audio/webm"
      ).trim();

      if (!base64) {
        return json(
          {
            error: "Audio उपलब्ध नहीं है।",
            code: "MISSING_AUDIO",
          },
          400
        );
      }

      const cleanBase64 =
        base64.includes(",")
          ? base64.split(",").pop()
          : base64;

      let binary;

      try {
        binary = atob(cleanBase64);
      } catch {
        return json(
          {
            error: "Audio Base64 सही नहीं है।",
            code: "INVALID_BASE64",
          },
          400
        );
      }

      const bytes =
        new Uint8Array(binary.length);

      for (
        let i = 0;
        i < binary.length;
        i++
      ) {
        bytes[i] =
          binary.charCodeAt(i);
      }

      const safeMime =
        mimeType.split(";")[0] ||
        "audio/webm";

      const extension =
        safeMime.includes("mp4")
          ? "mp4"
          : safeMime.includes("ogg")
          ? "ogg"
          : safeMime.includes("wav")
          ? "wav"
          : safeMime.includes("mpeg") ||
            safeMime.includes("mp3")
          ? "mp3"
          : "webm";

      audioFile = new File(
        [bytes],
        `sarathi-voice.${extension}`,
        {
          type: safeMime,
        }
      );
    }

    if (!audioFile) {
      return json(
        {
          error: "Audio file नहीं मिला।",
          code: "MISSING_AUDIO",
        },
        400
      );
    }

    // ========================================================
    // GROQ TRANSCRIPTION
    // ========================================================

    const form = new FormData();

    form.append(
      "file",
      audioFile,
      audioFile.name ||
        "sarathi-voice.webm"
    );

    form.append(
      "model",
      TRANSCRIBE_MODEL
    );

    form.append(
      "language",
      "hi"
    );

    form.append(
      "response_format",
      "json"
    );

    form.append(
      "temperature",
      "0"
    );

    form.append(
      "prompt",
      "हिंदी में साफ शब्दों में बोले गए प्रश्न को लिखो।"
    );

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${env.GROQ_API_KEY}`,
        },

        body: form,
      }
    );

    const raw =
      await response.text();

    let data;

    try {
      data = raw
        ? JSON.parse(raw)
        : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      return json(
        {
          error:
            data?.error?.message ||
            raw ||
            `Groq transcription error (${response.status})`,
          code:
            "TRANSCRIPTION_API_ERROR",
        },
        response.status
      );
    }

    return json({
      text: String(
        data?.text ?? ""
      ).trim(),
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        code: "TRANSCRIPTION_ERROR",
      },
      500
    );
  }
}

// ============================================================
// GROQ CALL
// ============================================================

async function callGroq(
  payload,
  apiKey,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",
        },

        body: JSON.stringify(payload),

        signal:
          controller.signal,
      }
    );

    const raw =
      await response.text();

    let data;

    try {
      data = raw
        ? JSON.parse(raw)
        : {};
    } catch {
      data = {};
    }

    const requestId =
      response.headers.get(
        "x-request-id"
      ) ||
      response.headers.get(
        "x-groq-request-id"
      ) ||
      data?.id ||
      null;

    // ========================================================
    // ERROR HANDLING
    // ========================================================

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        raw ||
        `Groq API error (${response.status})`;

      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500;

      let retryAfterMs =
        getRetryAfterMs(
          response,
          message
        );

      if (
        !retryAfterMs &&
        response.status === 429
      ) {
        retryAfterMs = 9000;
      }

      return {
        ok: false,
        retryable,
        retryAfterMs,
        status: response.status,

        code:
          data?.error?.code ||
          `HTTP_${response.status}`,

        error: message,

        requestId,

        raw: null,
      };
    }

    // ========================================================
    // RESPONSE
    // ========================================================

    const choice =
      Array.isArray(data?.choices)
        ? data.choices[0]
        : null;

    const content =
      typeof choice?.message?.content === "string"
        ? choice.message.content.trim()
        : "";

    // ========================================================
    // STRUCTURED RESPONSE
    // ========================================================

    if (payload.response_format) {
      if (!content) {
        return {
          ok: false,
          retryable: false,
          retryAfterMs: 0,
          status: 502,
          code:
            "EMPTY_STRUCTURED_RESPONSE",
          error:
            "Structured response खाली है।",
          requestId,
          raw: null,
        };
      }

      return {
        ok: true,
        reply: "",
        raw: content,
        requestId,
      };
    }

    // ========================================================
    // NORMAL RESPONSE
    // ========================================================

    if (!content) {
      return {
        ok: false,
        retryable: true,
        retryAfterMs: 3000,
        status: 502,
        code:
          "EMPTY_RESPONSE",
        error:
          "Groq ने खाली उत्तर दिया।",
        requestId,
        raw: null,
      };
    }

    return {
      ok: true,
      reply: content,
      raw: null,
      requestId,
    };

  } catch (error) {
    return {
      ok: false,
      retryable: true,
      retryAfterMs: 5000,
      status: 504,

      code:
        error?.name === "AbortError"
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      error:
        error?.name === "AbortError"
          ? "Groq से जवाब आने में बहुत समय लगा।"
          : `Groq connection error: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`,

      requestId: null,
      raw: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// RETRY-AFTER
// ============================================================

function getRetryAfterMs(
  response,
  message
) {
  // पहले HTTP header देखें
  const header =
    response.headers.get(
      "retry-after"
    );

  if (header) {
    const seconds =
      Number(header);

    if (
      Number.isFinite(seconds) &&
      seconds > 0
    ) {
      return (
        Math.min(seconds, 30) *
        1000
      );
    }
  }

  // Groq error message में
  // "try again in 7.17s" जैसा समय
  const match =
    String(message).match(
      /try again in\s+([\d.]+)s/i
    );

  if (match) {
    const seconds =
      Number(match[1]);

    if (
      Number.isFinite(seconds) &&
      seconds > 0
    ) {
      return (
        Math.min(seconds + 1, 30) *
        1000
      );
    }
  }

  return 0;
}

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",
  };
}

// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...corsHeaders(),

        "Content-Type":
          "application/json; charset=utf-8",
      },
    }
  );
}
