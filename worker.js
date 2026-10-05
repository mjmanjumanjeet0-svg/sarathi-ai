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
    // CHAT API
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
    // WEBSITE FILES
    // =========================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Sarathi AI is running.", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  },
};


// ============================================================
// MAIN CHAT HANDLER
// ============================================================

async function handleChat(request, env) {
  try {
    // --------------------------------------------------------
    // API KEY CHECK
    // --------------------------------------------------------

    if (!env.GROQ_API_KEY) {
      return json(
        {
          error:
            "GROQ_API_KEY Cloudflare Secret में configured नहीं है।",
          code: "MISSING_API_KEY",
        },
        500
      );
    }

    // --------------------------------------------------------
    // READ JSON
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // VALIDATE MESSAGES
    // --------------------------------------------------------

    if (!body || !Array.isArray(body.messages)) {
      return json(
        {
          error: "Messages उपलब्ध नहीं हैं।",
          code: "INVALID_MESSAGES",
        },
        400
      );
    }

    if (body.messages.length === 0) {
      return json(
        {
          error: "कृपया कोई प्रश्न लिखें।",
          code: "EMPTY_MESSAGES",
        },
        400
      );
    }

    // --------------------------------------------------------
    // CLEAN MESSAGES
    // --------------------------------------------------------

    const messages = body.messages
      .slice(-20)
      .map((message) => {
        const role =
          message?.role === "assistant"
            ? "assistant"
            : "user";

        const content = String(
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
          error: "प्रश्न खाली है।",
          code: "EMPTY_QUESTION",
        },
        400
      );
    }

    // --------------------------------------------------------
    // SEARCH MODE
    // --------------------------------------------------------

    const useSearch =
      body.webSearch === true;

    // ========================================================
    // SARATHI SYSTEM PROMPT
    // ========================================================

    const systemPrompt = `
तुम "सारथी AI" हो।

तुम्हारा मुख्य उद्देश्य:
सही, स्पष्ट, प्राकृतिक, भरोसेमंद और उपयोगी उत्तर देना।

==================================================
सामान्य नियम
==================================================

1. मुख्य उत्तर हिंदी में दो।
2. भाषा आसान और स्वाभाविक रखो।
3. अनावश्यक अंग्रेजी मत लिखो।
4. जरूरी अंग्रेजी शब्द हो तो उसका अर्थ समझाओ।
5. तथ्य कभी मत गढ़ो।
6. निश्चित जानकारी न हो तो उसे निश्चित तथ्य की तरह मत लिखो।
7. प्रश्न में जो पूछा है उसी पर केंद्रित रहो।
8. अनावश्यक जानकारी मत जोड़ो।
9. एक ही बात बार-बार मत दोहराओ।
10. नकली citation या source मत बनाओ।
11. नकली quotation मत बनाओ।
12. मनगढ़ंत व्यक्ति, तारीख, संख्या या घटना मत बनाओ।
13. गणना में अनुमान लगाकर उत्तर मत दो।
14. अगर जानकारी उपलब्ध नहीं है तो साफ बताओ।

==================================================
STUDY CENTER
==================================================

2 अंक:
बहुत छोटा और सीधा उत्तर।

5 अंक:
छोटी भूमिका/परिभाषा +
लगभग 4–6 मुख्य बिंदु +
जरूरत हो तो छोटा उदाहरण +
छोटा निष्कर्ष।

10 अंक:
भूमिका +
स्पष्ट headings +
पर्याप्त आसान व्याख्या +
उदाहरण +
निष्कर्ष।

12 अंक:
संक्षिप्त भूमिका +
स्पष्ट headings +
विस्तृत लेकिन आसान व्याख्या +
उदाहरण +
निष्कर्ष।

केवल उत्तर लंबा दिखाने के लिए advanced जानकारी मत जोड़ो।

==================================================
इतिहास
==================================================

प्रथम एस्टेट = पादरी वर्ग।

द्वितीय एस्टेट = कुलीन वर्ग।

तृतीय एस्टेट = सामान्य जनता का बड़ा वर्ग,
जिसमें बुर्जुआ, किसान और शहरी श्रमिक शामिल थे।

फ्रांसीसी क्रांति के प्रमुख कारण:

1. सामाजिक असमानता
2. करों का असमान बोझ
3. वित्तीय संकट और राज्य ऋण
4. खाद्य संकट
5. निरंकुश राजतंत्र और राजनीतिक प्रतिनिधित्व की समस्या
6. प्रबोधन के विचार

यदि प्रश्न केवल कारण पूछता है,
तो घटना या परिणाम को कारण बनाकर मत लिखो।

14 जुलाई 1789 की बास्तील घटना
फ्रांसीसी क्रांति का महत्वपूर्ण घटनाक्रम थी।
इसे केवल "कारण" के रूप में मत लिखो।

==================================================
CHEMISTRY
==================================================

परमाणु, अणु, आयन, तत्व और यौगिक
को आपस में मत मिलाओ।

NaCl को सामान्यतः आयनिक यौगिक की
formula unit बताओ, molecule नहीं।

==================================================
PHYSICS
==================================================

जड़त्व =
वस्तु की अपनी अवस्था में परिवर्तन का विरोध करने की प्रवृत्ति।

न्यूटन का प्रथम नियम:
यदि किसी वस्तु पर कुल बाहरी बल शून्य है,
तो विराम की वस्तु विराम में रहती है और
गतिशील वस्तु समान वेग से सीधी रेखा में चलती रहती है।

अनावश्यक calculus, vector notation
या advanced derivation मत दो।

Numerical में:

दिया गया
→ सूत्र
→ मान रखना
→ calculation
→ अंतिम उत्तर

==================================================
BIOLOGY
==================================================

प्रकाश संश्लेषण के सामान्य प्रश्न में
मुख्य बातें:

प्रकाश
क्लोरोफिल
कार्बन डाइऑक्साइड
जल
कार्बनिक पदार्थ/ग्लूकोज का निर्माण
ऑक्सीजन का निकलना

सामान्य प्रश्न में बिना आवश्यकता:

Photosystem I
Photosystem II
ATP
NADPH
Calvin cycle
thylakoid
stroma

जैसी advanced जानकारी मत दो।

==================================================
MATHEMATICS
==================================================

गणना ध्यान से करो।

महत्वपूर्ण steps दिखाओ।

अंतिम उत्तर स्पष्ट लिखो।

जहाँ संभव हो calculation की जाँच करो।

==================================================
INTERNET SEARCH
==================================================

यदि इंटरनेट खोज चालू है:

1. वर्तमान जानकारी के लिए search का उपयोग करो।
2. आज/अभी/latest/current जैसी जानकारी में
   ताजा जानकारी को प्राथमिकता दो।
3. नकली source मत बनाओ।
4. नकली citation मत बनाओ।
5. Search असफल हो तो current information
   को verified fact की तरह मत बताओ।

==================================================
FINAL SELF-CHECK
==================================================

उत्तर देने से पहले अपने उत्तर को internally जाँचो:

क्या प्रश्न सही समझा गया?
क्या उत्तर सही विषय का है?
क्या तथ्य सही हैं?
क्या तारीख सही है?
क्या व्यक्ति सही है?
क्या formula सही है?
क्या calculation सही है?
क्या अंक के अनुसार उत्तर की लंबाई सही है?
क्या कोई advanced जानकारी बिना जरूरत जोड़ दी?
क्या कोई मनगढ़ंत नाम है?
क्या कोई मनगढ़ंत संख्या है?
क्या कोई नकली quotation है?
क्या कारण और घटना आपस में मिल गए?
क्या कारण और परिणाम आपस में मिल गए?
क्या कोई बात दोहराई गई है?

यदि गलती हो तो उत्तर भेजने से पहले सुधारो।
`;

    // ========================================================
    // MAIN GROQ REQUEST
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

      max_completion_tokens: 4096,

      temperature: 0.2,

      reasoning_effort: "low",

      stream: false,
    };

    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search",
        },
      ];

      payload.tool_choice = "required";
    }

    // --------------------------------------------------------
    // CALL GROQ
    // --------------------------------------------------------

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      55000
    );

    // --------------------------------------------------------
    // RETRY
    // --------------------------------------------------------

    if (
      !result.ok &&
      result.retryable
    ) {
      await sleep(1200);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        55000
      );
    }

    // ========================================================
    // SEARCH FALLBACK
    // ========================================================

    if (!result.ok && useSearch) {
      const fallbackPayload = {
        model: "openai/gpt-oss-120b",

        messages: [
          {
            role: "system",
            content:
              systemPrompt +
              `

महत्वपूर्ण:
इस अनुरोध में इंटरनेट खोज उपलब्ध नहीं हो पाई।
इसलिए आज/अभी/latest/current जानकारी को
verified current fact की तरह मत बताओ।
`,
          },

          ...messages,
        ],

        max_completion_tokens: 4096,

        temperature: 0.2,

        reasoning_effort: "low",

        stream: false,
      };

      let fallback = await callGroq(
        fallbackPayload,
        env.GROQ_API_KEY,
        55000
      );

      if (
        !fallback.ok &&
        fallback.retryable
      ) {
        await sleep(1200);

        fallback = await callGroq(
          fallbackPayload,
          env.GROQ_API_KEY,
          55000
        );
      }

      if (
        fallback.ok &&
        fallback.reply
      ) {
        const checked =
          await selfCheckAndCorrect(
            messages,
            fallback.reply,
            env.GROQ_API_KEY
          );

        return json({
          reply: checked.reply,
          searchUnavailable: true,
          selfChecked:
            checked.selfChecked,
          selfCorrected:
            checked.selfCorrected,
        });
      }
    }

    // ========================================================
    // FINAL ERROR
    // ========================================================

    if (!result.ok) {
      return json(
        {
          error: result.error,
          code: result.code,
          requestId:
            result.requestId || null,
        },
        result.status || 502
      );
    }

    if (!result.reply) {
      return json(
        {
          error:
            "Groq ने खाली उत्तर लौटाया। कृपया फिर कोशिश करें।",
          code: "EMPTY_GROQ_RESPONSE",
          requestId:
            result.requestId || null,
        },
        502
      );
    }

    // ========================================================
    // SELF-CHECK + SELF-CORRECTION
    // ========================================================

    const checked =
      await selfCheckAndCorrect(
        messages,
        result.reply,
        env.GROQ_API_KEY
      );

    return json({
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

        code: "WORKER_ERROR",
      },
      500
    );
  }
}


// ============================================================
// SELF CHECK + SELF CORRECTION
// ============================================================

async function selfCheckAndCorrect(
  messages,
  answer,
  apiKey
) {
  try {
    const checkerPrompt = `
तुम "सारथी AI Quality Checker" हो।

नीचे उपयोगकर्ता का प्रश्न और AI का उत्तर दिया गया है।

तुम्हारा काम केवल quality check करना है।

जाँच करो:

1. क्या उत्तर प्रश्न का सही उत्तर देता है?
2. क्या कोई factual error है?
3. क्या कोई मनगढ़ंत तथ्य है?
4. क्या कोई गलत नाम/date/number है?
5. क्या गणना गलत है?
6. क्या परीक्षा के marks के अनुसार उत्तर है?
7. क्या अनावश्यक advanced जानकारी है?
8. क्या प्रश्न और उत्तर का विषय अलग हो गया है?
9. क्या कोई बात दोहराई गई है?
10. क्या भाषा स्पष्ट है?

यदि उत्तर सही है:
needs_correction = false

यदि गलती है:
needs_correction = true
और corrected_answer में पूरा सही उत्तर दो।

महत्वपूर्ण:
- केवल छोटी गलती हो तो भी corrected_answer पूरा उत्तर होना चाहिए।
- नई जानकारी केवल तभी जोड़ो जब वह जरूरी और विश्वसनीय हो।
- facts मत गढ़ो।
- प्रश्न का उत्तर बदलकर कोई दूसरा उत्तर मत दो।
`;

    const conversationText =
      messages
        .map(
          (m) =>
            `${m.role}: ${m.content}`
        )
        .join("\n\n");

    const checkerPayload = {
      model: "openai/gpt-oss-120b",

      messages: [
        {
          role: "system",
          content: checkerPrompt,
        },

        {
          role: "user",
          content: `
USER CONVERSATION:

${conversationText}

AI ANSWER:

${answer}
`,
        },
      ],

      max_completion_tokens: 4096,

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

              issues: {
                type: "array",

                items: {
                  type: "string",
                },
              },

              corrected_answer: {
                type: "string",
              },
            },

            required: [
              "needs_correction",
              "issues",
              "corrected_answer",
            ],

            additionalProperties: false,
          },
        },
      },
    };

    let check = await callGroq(
      checkerPayload,
      apiKey,
      20000
    );

    if (
      !check.ok &&
      check.retryable
    ) {
      await sleep(700);

      check = await callGroq(
        checkerPayload,
        apiKey,
        20000
      );
    }

    // --------------------------------------------------------
    // CHECKER FAILS
    // --------------------------------------------------------

    if (!check.ok || !check.raw) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    // --------------------------------------------------------
    // PARSE CHECK RESULT
    // --------------------------------------------------------

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
      typeof report.needs_correction !==
      "boolean"
    ) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false,
      };
    }

    // --------------------------------------------------------
    // NO CORRECTION REQUIRED
    // --------------------------------------------------------

    if (
      report.needs_correction === false
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    // --------------------------------------------------------
    // CORRECTED ANSWER VALIDATION
    // --------------------------------------------------------

    const corrected =
      typeof report.corrected_answer ===
      "string"
        ? report.corrected_answer.trim()
        : "";

    if (!corrected) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    // --------------------------------------------------------
    // SAFETY CHECK:
    // Don't allow a wildly oversized correction.
    // --------------------------------------------------------

    const maximumAllowed =
      Math.max(
        answer.length * 2.5,
        20000
      );

    if (
      corrected.length >
      maximumAllowed
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    // --------------------------------------------------------
    // CORRECTION ACCEPTED
    // --------------------------------------------------------

    return {
      reply: corrected,
      selfChecked: true,
      selfCorrected: true,
    };

  } catch {
    // सबसे महत्वपूर्ण सुरक्षा:
    // Self-check में error हो तो original answer सुरक्षित रहेगा।

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
    setTimeout(() => {
      controller.abort();
    }, timeoutMs);

  try {
    const response =
      await fetch(
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

          signal: controller.signal,
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

    // --------------------------------------------------------
    // API ERROR
    // --------------------------------------------------------

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

      return {
        ok: false,
        retryable,
        status: response.status,
        code:
          data?.error?.code ||
          `HTTP_${response.status}`,
        error: message,
        requestId,
        raw: null,
      };
    }

    // --------------------------------------------------------
    // GET FIRST CHOICE
    // --------------------------------------------------------

    const choice =
      Array.isArray(data?.choices)
        ? data.choices[0]
        : null;

    const reply =
      typeof choice?.message?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    // --------------------------------------------------------
    // CHECKER RAW JSON SUPPORT
    // --------------------------------------------------------

    if (
      payload.response_format &&
      raw
    ) {
      return {
        ok: true,
        reply: "",
        raw:
          typeof choice?.message?.content ===
          "string"
            ? choice.message.content.trim()
            : raw,
        requestId,
      };
    }

    // --------------------------------------------------------
    // NORMAL ANSWER
    // --------------------------------------------------------

    if (!reply) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code: "EMPTY_RESPONSE",
        error:
          "Groq response आया लेकिन उसमें कोई text answer नहीं था।",
        requestId,
        raw: null,
      };
    }

    return {
      ok: true,
      reply,
      raw: null,
      requestId,
    };

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    const isTimeout =
      error?.name === "AbortError";

    return {
      ok: false,
      retryable: true,
      status: 504,

      code: isTimeout
        ? "GROQ_TIMEOUT"
        : "GROQ_NETWORK_ERROR",

      error: isTimeout
        ? "Groq से जवाब आने में बहुत समय लगा।"
        : `Groq connection error: ${message}`,

      requestId: null,
      raw: null,
    };

  } finally {
    clearTimeout(timeout);
  }
}


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) => setTimeout(resolve, ms)
  );
}


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",
  };
}


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
