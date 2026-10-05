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
      if (request.method !== "POST") {
        return json(
          {
            error: "Only POST requests are allowed.",
            code: "METHOD_NOT_ALLOWED",
          },
          405
        );
      }

      return handleChat(request, env);
    }

    // =========================
    // VISION
    // =========================
    if (url.pathname === "/api/vision") {
      if (request.method !== "POST") {
        return json(
          {
            error: "Only POST requests are allowed.",
            code: "METHOD_NOT_ALLOWED",
          },
          405
        );
      }

      return handleVision(request, env);
    }

    // =========================
    // ASSETS
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


// ============================================================
// CHAT
// ============================================================

async function handleChat(request, env) {
  try {
    if (!env.GROQ_API_KEY) {
      return json(
        {
          error:
            "GROQ_API_KEY Cloudflare Secret configured नहीं है।",
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
          error: "Request JSON सही नहीं है।",
          code: "INVALID_JSON",
        },
        400
      );
    }

    // ========================================================
    // FRONTEND COMPATIBILITY
    //
    // तुम्हारा index.html भेजता है:
    // message + history + webSearch
    //
    // नया format:
    // messages + webSearch
    // ========================================================

    let messages = [];

    if (Array.isArray(body?.messages)) {
      messages = body.messages;
    } else if (Array.isArray(body?.history)) {
      messages = body.history;
    }

    // अगर सिर्फ message आया है तो उसे भी जोड़ो
    if (
      body?.message &&
      String(body.message).trim()
    ) {
      const messageText =
        String(body.message).trim();

      const alreadyLast =
        messages.length > 0 &&
        String(
          messages[messages.length - 1]?.content || ""
        ).trim() === messageText;

      if (!alreadyLast) {
        messages.push({
          role: "user",
          content: messageText,
        });
      }
    }

    // ========================================================
    // CLEAN MESSAGES
    // ========================================================

    messages = messages
      .slice(-20)
      .map((message) => {
        const role =
          message?.role === "assistant"
            ? "assistant"
            : "user";

        const content =
          String(
            message?.content ?? ""
          )
            .trim()
            .slice(0, 8000);

        return {
          role,
          content,
        };
      })
      .filter(
        (message) =>
          message.content.length > 0
      );

    if (messages.length === 0) {
      return json(
        {
          error: "Messages उपलब्ध नहीं हैं।",
          code: "INVALID_MESSAGES",
        },
        400
      );
    }

    const useSearch =
      body?.webSearch === true;

    // ========================================================
    // LATEST USER QUESTION
    // ========================================================

    const latestUserMessage =
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "user"
        )?.content || "";

    // ========================================================
    // INDIA DATE
    // ========================================================

    const todayIndia =
      getIndiaDate();

    const todayIndiaReadable =
      getIndiaReadableDate();

    const currentQuestion =
      isCurrentInformationQuestion(
        latestUserMessage
      );

    // ========================================================
    // SYSTEM PROMPT
    // ========================================================

    const systemPrompt = `
तुम "सारथी AI" हो।

तुम्हारा काम सही, सरल, भरोसेमंद और उपयोगी
हिंदी में उत्तर देना है।

==================================================
आज की तारीख
==================================================

भारत में आज की तारीख है:

${todayIndiaReadable}

ISO date:

${todayIndia}

Time zone:

Asia/Kolkata

==================================================
CURRENT INFORMATION RULE
==================================================

यदि user पूछता है:

आज
अभी
ताजा
ताज़ा
वर्तमान
latest
current
today
now
live

तो पुरानी जानकारी को आज की जानकारी मत बताओ।

यदि Search Result की तारीख आज की तारीख से पुरानी है,
तो उसे "आज का" result मत बताओ।

कभी भी पुराने result की तारीख देखकर
उसे आज का result बनाकर मत लिखो।

यदि verified current information नहीं मिलती,
तो साफ बताओ कि उपलब्ध source पुराना है।

किसी current price, rate, weather, news या result
का अनुमान लगाकर संख्या मत बनाओ।

==================================================
INTERNET SEARCH
==================================================

यदि Internet Search ON है:

1. Browser Search का उपयोग करो।
2. आज की तारीख ${todayIndiaReadable} है।
3. Search result की तारीख ध्यान से देखो।
4. आज के result को पुराने result से प्राथमिकता दो।
5. पुराने result को आज का मत बताओ।
6. नकली source मत बनाओ।
7. नकली citation मत बनाओ।
8. current information verified न हो तो साफ बताओ।

विशेष रूप से gold price के लिए:

यदि user पूछता है:

"आज भारत में सोने के भाव क्या हैं?"

तो आज की तारीख:

${todayIndiaReadable}

को ध्यान में रखकर search करो।

यदि search result में उदाहरण के लिए
5 मई 2026 लिखा है जबकि आज
${todayIndiaReadable} है,
तो उसे आज का gold price मत बताओ।

==================================================
सामान्य नियम
==================================================

1. उत्तर मुख्यतः हिंदी में दो।
2. आसान भाषा का उपयोग करो।
3. तथ्य मत गढ़ो।
4. प्रश्न से बाहर मत जाओ।
5. अनावश्यक लंबा उत्तर मत दो।
6. यदि जानकारी निश्चित नहीं है तो उसे निश्चित तथ्य मत बताओ।
7. User के सवाल का सीधा उत्तर दो।

==================================================
MARKS RULE
==================================================

2 अंक:
छोटी परिभाषा + मुख्य बात।

5 अंक:
भूमिका + 4–6 मुख्य बातें + छोटा निष्कर्ष।

10 अंक:
भूमिका + headings + 5–7 मुख्य बातें + निष्कर्ष।

12 अंक:
भूमिका + headings + 6–8 मुख्य बातें + निष्कर्ष।

==================================================
BIOLOGY
==================================================

प्रकाश संश्लेषण के सामान्य 5 अंक के उत्तर में
अनावश्यक advanced terms मत डालो।

बिना जरूरत इन terms का उपयोग मत करो:

Photosystem I
Photosystem II
ATP
NADPH
Calvin cycle
electron transport chain
thylakoid
stroma
electron/proton transfer
water splitting
reaction center

सामान्य उत्तर सरल school/college स्तर का रखो।

==================================================
HISTORY
==================================================

उत्तर प्रश्न के अनुसार दो।

यदि कारण पूछे गए हैं तो केवल कारणों पर ध्यान दो।

==================================================
PHYSICS
==================================================

Numerical में:

दिया गया
→ सूत्र
→ मान रखना
→ calculation
→ अंतिम उत्तर

==================================================
MATHEMATICS
==================================================

Calculation के steps दिखाओ।
अंतिम उत्तर स्पष्ट लिखो।
जहाँ जरूरी हो calculation की जाँच करो।

==================================================
FINAL CHECK
==================================================

उत्तर भेजने से पहले जाँचो:

1. क्या प्रश्न सही समझा?
2. क्या सही subject है?
3. क्या marks के अनुसार उत्तर है?
4. क्या भाषा आसान है?
5. क्या कोई factual error है?
6. क्या current date सही है?
7. क्या पुराना search result आज का तो नहीं बताया?
8. क्या कोई संख्या बिना verification के तो नहीं बनाई?
9. क्या source की date सही है?
10. क्या उत्तर सीधे उपयोग किया जा सकता है?

यदि गलती मिले तो उत्तर भेजने से पहले सुधारो।
`;

    // ========================================================
    // GROQ PAYLOAD
    // ========================================================

    const payload = {
      model: "openai/gpt-oss-120b",

      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messages,
      ],

      max_completion_tokens:
        currentQuestion
          ? 2500
          : 4096,

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

      payload.tool_choice = "required";
    }

    // ========================================================
    // CALL GROQ
    // ========================================================

    let result =
      await callGroq(
        payload,
        env.GROQ_API_KEY,
        55000
      );

    // Retry
    if (
      !result.ok &&
      result.retryable
    ) {
      await sleep(1200);

      result =
        await callGroq(
          payload,
          env.GROQ_API_KEY,
          55000
        );
    }

    // ========================================================
    // ERROR
    // ========================================================

    if (!result.ok) {
      return json(
        {
          error:
            result.error ||
            "अभी जवाब नहीं मिल पाया।",

          code:
            result.code ||
            "GROQ_ERROR",

          requestId:
            result.requestId ||
            null,
        },
        result.status || 502
      );
    }

    if (!result.reply) {
      return json(
        {
          error:
            "Groq ने खाली जवाब दिया।",

          code:
            "EMPTY_GROQ_RESPONSE",
        },
        502
      );
    }

    // ========================================================
    // SELF CHECK
    // ========================================================

    const checked =
      await selfCheckAndCorrect(
        messages,
        result.reply,
        env.GROQ_API_KEY,
        todayIndiaReadable
      );

    // ========================================================
    // RESPONSE
    // ========================================================

    return json({
      // तुम्हारे वर्तमान index.html के लिए
      answer: checked.reply,

      // नए frontend के लिए भी
      reply: checked.reply,

      selfChecked:
        checked.selfChecked,

      selfCorrected:
        checked.selfCorrected,
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),

        code:
          "WORKER_ERROR",
      },
      500
    );
  }
}


// ============================================================
// VISION
// ============================================================

async function handleVision(
  request,
  env
) {
  try {
    if (!env.GROQ_API_KEY) {
      return json(
        {
          error:
            "GROQ_API_KEY configured नहीं है।",
          code:
            "MISSING_API_KEY",
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
          error:
            "Image request JSON सही नहीं है।",
          code:
            "INVALID_JSON",
        },
        400
      );
    }

    // तुम्हारा index.html "image" भेजता है
    // लेकिन imageData भी स्वीकार करेंगे
    const imageData =
      body?.image ||
      body?.imageData ||
      "";

    const question =
      String(
        body?.question ||
        "इस फोटो को ध्यान से देखकर समझाओ।"
      )
        .trim()
        .slice(0, 4000);

    if (!imageData) {
      return json(
        {
          error:
            "Image उपलब्ध नहीं है।",
          code:
            "MISSING_IMAGE",
        },
        400
      );
    }

    const visionPrompt = `
तुम सारथी AI के image assistant हो।

User का प्रश्न:

${question}

तस्वीर को ध्यान से देखकर उत्तर दो।

नियम:

1. तस्वीर में जो स्पष्ट है वही बताओ।
2. जो दिखाई नहीं दे रहा उसे निश्चित मत बताओ।
3. तस्वीर में text हो तो उसे पढ़ने की कोशिश करो।
4. पढ़ाई का प्रश्न हो तो आसान हिंदी में उत्तर दो।
5. diagram/chart/question हो तो समझाओ।
6. image अस्पष्ट हो तो साफ बताओ।
7. मुख्य उत्तर हिंदी में दो।
`;

    const payload = {
      model:
        "qwen/qwen3-vl-32b-instruct",

      messages: [
        {
          role: "system",
          content:
            visionPrompt,
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

      max_completion_tokens:
        2500,

      temperature:
        0.2,

      stream:
        false,
    };

    let result =
      await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );

    if (
      !result.ok &&
      result.retryable
    ) {
      await sleep(1000);

      result =
        await callGroq(
          payload,
          env.GROQ_API_KEY,
          60000
        );
    }

    if (!result.ok) {
      return json(
        {
          error:
            result.error,

          code:
            result.code,

          requestId:
            result.requestId ||
            null,
        },
        result.status || 502
      );
    }

    return json({
      answer:
        result.reply,

      reply:
        result.reply,
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),

        code:
          "VISION_WORKER_ERROR",
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
  todayIndiaReadable
) {
  try {
    const checkerPrompt = `
तुम "Sarathi AI Quality Checker" हो।

आज भारत की तारीख:
${todayIndiaReadable}

User के प्रश्न और AI answer को जाँचो।

विशेष रूप से current information की date जाँचो।

यदि AI ने पुरानी जानकारी को "आज", "today",
"current", "latest" आदि बताया है,
तो correction करो।

लेकिन बिना verified information के
नई संख्या या date मत बनाओ।

सामान्य 5 अंक के उत्तर को unnecessarily
advanced मत बनाओ।

Correction जरूरी हो तो पूरा corrected answer दो।

Correction जरूरी न हो तो original answer रखो।
`;

    const conversationText =
      messages
        .map(
          (message) =>
            `${message.role}: ${message.content}`
        )
        .join("\n\n");

    const checkerPayload = {
      model:
        "openai/gpt-oss-120b",

      messages: [
        {
          role: "system",
          content:
            checkerPrompt,
        },

        {
          role: "user",
          content: `
USER:

${conversationText}

AI ANSWER:

${answer}
`,
        },
      ],

      max_completion_tokens:
        1800,

      temperature: 0,

      reasoning_effort: "low",

      stream: false,

      response_format: {
        type:
          "json_schema",

        json_schema: {
          name:
            "sarathi_quality_check",

          strict: true,

          schema: {
            type:
              "object",

            properties: {
              needs_correction: {
                type:
                  "boolean",
              },

              issues: {
                type:
                  "array",

                items: {
                  type:
                    "string",
                },
              },

              corrected_answer: {
                type:
                  "string",
              },
            },

            required: [
              "needs_correction",
              "issues",
              "corrected_answer",
            ],

            additionalProperties:
              false,
          },
        },
      },
    };

    let check =
      await callGroq(
        checkerPayload,
        apiKey,
        25000
      );

    if (
      !check.ok &&
      check.retryable
    ) {
      await sleep(700);

      check =
        await callGroq(
          checkerPayload,
          apiKey,
          25000
        );
    }

    if (
      !check.ok ||
      !check.raw
    ) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    let report;

    try {
      report =
        JSON.parse(check.raw);
    } catch {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    if (
      report.needs_correction !== true
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    const corrected =
      String(
        report.corrected_answer ||
        ""
      ).trim();

    if (!corrected) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    if (
      corrected.length >
      Math.max(
        answer.length * 2.5,
        20000
      )
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
// GROQ API
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
    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body:
            JSON.stringify(payload),

          signal:
            controller.signal,
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data =
        raw
          ? JSON.parse(raw)
          : {};
    } catch {
      data = {
        error: {
          message:
            raw ||
            "Groq ने invalid response दिया।",
        },
      };
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

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        raw ||
        `Groq API error (${response.status})`;

      return {
        ok: false,

        retryable:
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500,

        status:
          response.status,

        code:
          data?.error?.code ||
          `HTTP_${response.status}`,

        error:
          message,

        requestId,
      };
    }

    const choice =
      Array.isArray(data?.choices)
        ? data.choices[0]
        : null;

    const content =
      typeof choice?.message?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    if (!content) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code:
          "EMPTY_RESPONSE",
        error:
          "Groq ने खाली response दिया।",
        requestId,
      };
    }

    return {
      ok: true,

      reply:
        content,

      raw:
        payload.response_format
          ? content
          : null,

      requestId,
    };

  } catch (error) {
    const isTimeout =
      error?.name ===
      "AbortError";

    return {
      ok: false,

      retryable: true,

      status: 504,

      code:
        isTimeout
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      error:
        isTimeout
          ? "Groq से जवाब आने में बहुत समय लगा।"
          : (
              error instanceof Error
                ? error.message
                : String(error)
            ),

      requestId:
        null,
    };

  } finally {
    clearTimeout(timeout);
  }
}


// ============================================================
// INDIA DATE
// ============================================================

function getIndiaDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Kolkata",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",
    }
  ).format(
    new Date()
  );
}


function getIndiaReadableDate() {
  return new Intl.DateTimeFormat(
    "hi-IN",
    {
      timeZone:
        "Asia/Kolkata",

      day:
        "numeric",

      month:
        "long",

      year:
        "numeric",
    }
  ).format(
    new Date()
  );
}


// ============================================================
// CURRENT QUESTION DETECTOR
// ============================================================

function isCurrentInformationQuestion(
  text
) {
  const q =
    String(text || "")
      .toLowerCase();

  const currentWords = [
    "आज",
    "आज का",
    "आज की",
    "आज के",
    "अभी",
    "वर्तमान",
    "ताजा",
    "ताज़ा",
    "latest",
    "current",
    "today",
    "now",
    "live",
  ];

  const domainWords = [
    "सोना",
    "gold",
    "भाव",
    "कीमत",
    "price",
    "rate",
    "रेट",
    "मौसम",
    "weather",
    "समाचार",
    "news",
    "result",
  ];

  const hasCurrent =
    currentWords.some(
      (word) =>
        q.includes(word)
    );

  const hasDomain =
    domainWords.some(
      (word) =>
        q.includes(word)
    );

  return (
    hasCurrent ||
    (
      hasDomain &&
      (
        q.includes("कितना") ||
        q.includes("क्या है") ||
        q.includes("क्या हैं")
      )
    )
  );
}


// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
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
// JSON
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
