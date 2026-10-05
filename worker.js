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
// MAIN CHAT
// ============================================================

async function handleChat(request, env) {
  try {
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

    // =========================
    // READ REQUEST
    // =========================
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

    // =========================
    // CLEAN MESSAGES
    // =========================
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

    const useSearch =
      body.webSearch === true;

    // ========================================================
    // MAIN SYSTEM PROMPT
    // ========================================================

    const systemPrompt = `
तुम "सारथी AI" हो।

तुम्हारा उद्देश्य है:
सही, सरल, भरोसेमंद और उपयोगी उत्तर देना।

==================================================
GENERAL RULES
==================================================

1. मुख्य उत्तर हिंदी में दो।
2. उपयोगकर्ता की भाषा और स्तर के अनुसार उत्तर दो।
3. अनावश्यक अंग्रेजी मत लिखो।
4. जरूरी अंग्रेजी शब्द हो तो उसका अर्थ बताओ।
5. तथ्य मत गढ़ो।
6. नकली तारीख, संख्या, नाम या citation मत बनाओ।
7. प्रश्न से बाहर की जानकारी मत जोड़ो।
8. एक ही बात बार-बार मत दोहराओ।
9. उत्तर जरूरत से ज्यादा technical मत बनाओ।
10. परीक्षा के प्रश्न में सीधे लिखने योग्य उत्तर दो।

==================================================
MARKS CONTROL
==================================================

यदि 1 अंक:
- सीधा उत्तर।
- बहुत छोटा।

यदि 2 अंक:
- छोटी परिभाषा।
- 1–2 मुख्य बातें।

यदि 5 अंक:
- 2–3 पंक्ति की भूमिका/परिभाषा।
- लगभग 4–6 मुख्य बिंदु।
- जरूरत हो तो छोटा उदाहरण।
- छोटा निष्कर्ष।
- आसान भाषा।
- अनावश्यक technical detail नहीं।

यदि 10 अंक:
- भूमिका।
- headings।
- 5–7 मुख्य बिंदु।
- आवश्यक व्याख्या।
- उदाहरण।
- निष्कर्ष।

यदि 12 अंक:
- भूमिका।
- headings।
- 6–8 मुख्य बिंदु।
- पर्याप्त व्याख्या।
- उदाहरण।
- निष्कर्ष।

==================================================
IMPORTANT COMPLEXITY RULE
==================================================

यदि user ने सामान्य school/college level प्रश्न पूछा है,
तो university-level या research-level mechanism अपने आप मत जोड़ो।

सही जानकारी होने का मतलब यह नहीं है कि
हर technical जानकारी उत्तर में डालनी जरूरी है।

जो जानकारी प्रश्न का उत्तर देने के लिए आवश्यक नहीं है,
उसे छोड़ दो।

==================================================
PHOTOSYNTHESIS
==================================================

सामान्य 5 अंक के प्रश्न में:

"प्रकाश संश्लेषण क्या है?"

का उत्तर आसान स्तर पर रखो।

इन terms को सामान्य उत्तर में मत जोड़ो:

Photosystem I
Photosystem II
ATP
NADPH
Calvin cycle
electron transport chain
thylakoid
stroma
reaction center
electron transfer
proton transfer
water splitting

इन तरह की अनावश्यक technical explanations भी मत जोड़ो:

- जल के टूटने से ऑक्सीजन निकलती है।
- जल के विभाजन से ऑक्सीजन बनती है।
- इलेक्ट्रॉन और प्रोटॉन का स्थानांतरण।
- इलेक्ट्रॉन का स्रोत।
- प्रोटॉन का स्रोत।
- biochemical pathway।
- molecular mechanism।
- प्रकाश अभिक्रिया।
- अंधकार अभिक्रिया।

सामान्य उत्तर में:

"ऑक्सीजन वातावरण में छोड़ी जाती है।"

जैसी सरल भाषा पर्याप्त है।

==================================================
SAFE PHOTOSYNTHESIS LEVEL
==================================================

सामान्य 5 अंक के प्रश्न के लिए इस स्तर की जानकारी पर्याप्त है:

प्रकाश संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे
सूर्य के प्रकाश और क्लोरोफिल की सहायता से
कार्बन डाइऑक्साइड तथा जल से अपना भोजन बनाते हैं
और ऑक्सीजन छोड़ते हैं।

मुख्य बातें:

1. सूर्य का प्रकाश ऊर्जा प्रदान करता है।
2. क्लोरोफिल प्रकाश को अवशोषित करता है।
3. जल जड़ों द्वारा प्राप्त होता है।
4. कार्बन डाइऑक्साइड वायुमंडल से ली जाती है।
5. पौधे भोजन बनाते हैं।
6. ऑक्सीजन वातावरण में छोड़ी जाती है।

निष्कर्ष:
प्रकाश संश्लेषण पौधों के लिए भोजन बनाने की
महत्वपूर्ण प्रक्रिया है और वातावरण में
ऑक्सीजन उपलब्ध कराने में भी महत्वपूर्ण है।

==================================================
HISTORY
==================================================

यदि केवल कारण पूछे जाएँ,
तो घटनाओं और परिणामों को कारण मत बनाओ।

फ्रांसीसी क्रांति के कारण:

1. सामाजिक असमानता
2. करों का असमान बोझ
3. आर्थिक और वित्तीय संकट
4. खाद्य संकट
5. निरंकुश राजतंत्र
6. राजनीतिक प्रतिनिधित्व की समस्या
7. प्रबोधन के विचार

14 जुलाई 1789 की बास्तील घटना एक महत्वपूर्ण घटना थी,
लेकिन उसे केवल "कारण" के उत्तर में मुख्य कारण मत बनाओ।

==================================================
CHEMISTRY
==================================================

परमाणु, अणु, आयन, तत्व और यौगिक को
आपस में मत मिलाओ।

NaCl को सामान्यतः आयनिक यौगिक की
formula unit बताओ, molecule नहीं।

==================================================
PHYSICS
==================================================

बिना आवश्यकता advanced mathematics मत जोड़ो।

Numerical में:

दिया गया
→ सूत्र
→ मान रखना
→ calculation
→ अंतिम उत्तर

==================================================
MATHEMATICS
==================================================

सभी जरूरी steps दिखाओ।

Calculation जाँचो।

अंतिम उत्तर स्पष्ट लिखो।

==================================================
INTERNET SEARCH
==================================================

यदि web search उपलब्ध और चालू है:

- current जानकारी के लिए search करो।
- आज/latest/current जैसी जानकारी में ताजा स्रोतों को प्राथमिकता दो।
- नकली citation मत बनाओ।
- search उपलब्ध न हो तो current information को verified fact मत बताओ।

==================================================
FINAL CHECK
==================================================

उत्तर भेजने से पहले जाँचो:

1. प्रश्न सही समझा?
2. विषय सही है?
3. marks सही हैं?
4. उत्तर जरूरत से ज्यादा technical तो नहीं?
5. कोई अनावश्यक advanced term तो नहीं?
6. कोई अनावश्यक mechanism तो नहीं?
7. कोई factual error तो नहीं?
8. कोई बात दोहराई तो नहीं?
9. उत्तर परीक्षा में सीधे लिखा जा सकता है?
10. भाषा आसान है?

यदि कोई समस्या मिले,
तो उत्तर भेजने से पहले उसे सुधारो।
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

      max_completion_tokens: 4096,

      temperature: 0.2,

      reasoning_effort: "low",

      stream: false,
    };

    // ========================================================
    // WEB SEARCH
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
    // MAIN REQUEST
    // ========================================================

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      55000
    );

    // ========================================================
    // RETRY
    // ========================================================

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

    if (
      !result.ok &&
      useSearch
    ) {
      const fallbackPayload = {
        model: "openai/gpt-oss-120b",

        messages: [
          {
            role: "system",
            content:
              systemPrompt +
              `

इंटरनेट खोज इस समय उपलब्ध नहीं हो पाई।
इसलिए current/latest जानकारी को
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
    // ERROR
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
          code:
            "EMPTY_GROQ_RESPONSE",
          requestId:
            result.requestId || null,
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

तुम्हें user का प्रश्न और AI का उत्तर दिया जाएगा।

उत्तर को बहुत सख्ती से जाँचो।

==================================================
MARKS CHECK
==================================================

2 अंक:
- छोटी परिभाषा।
- 1–2 मुख्य बातें।

5 अंक:
- 2–3 पंक्ति की भूमिका।
- 4–6 मुख्य बिंदु।
- जरूरत हो तो छोटा उदाहरण।
- छोटा निष्कर्ष।
- आसान भाषा।
- unnecessary technical detail नहीं।

10/12 अंक:
- पर्याप्त लेकिन प्रश्न के अनुसार विस्तार।
- अनावश्यक advanced information नहीं।

==================================================
MOST IMPORTANT RULE
==================================================

यदि कोई technical जानकारी सही है लेकिन
प्रश्न का उत्तर देने के लिए जरूरी नहीं है,
तो उसे हटा दो।

उत्तर को केवल इसलिए technical मत बनाओ
कि technical जानकारी scientifically सही है।

==================================================
PHOTOSYNTHESIS
==================================================

यदि सामान्य 5 अंक का प्रश्न है,
तो इन terms को हटाओ:

Photosystem I
Photosystem II
ATP
NADPH
Calvin cycle
electron transport chain
thylakoid
stroma
reaction center
electron transfer
proton transfer
water splitting

इन प्रकार की technical explanations भी हटाओ:

"जल के टूटने से मुक्त हुई ऑक्सीजन"
"जल के विभाजन से ऑक्सीजन"
"जल से इलेक्ट्रॉन और प्रोटॉन"
"इलेक्ट्रॉन का स्रोत"
"प्रोटॉन का स्रोत"
"biochemical pathway"
"molecular mechanism"
"प्रकाश अभिक्रिया"
"अंधकार अभिक्रिया"

इनकी जगह सरल भाषा रखो:

"ऑक्सीजन वातावरण में छोड़ी जाती है।"

==================================================
PHOTOSYNTHESIS QUALITY TEST
==================================================

यदि user ने केवल:

"प्रकाश संश्लेषण क्या है? 5 अंक"

पूछा है, तो उत्तर में सामान्यतः:

- परिभाषा
- प्रकाश
- क्लोरोफिल
- जल
- कार्बन डाइऑक्साइड
- भोजन निर्माण
- ऑक्सीजन
- छोटा निष्कर्ष

पर्याप्त हैं।

इसके आगे का biochemical mechanism
अनावश्यक माना जाए।

==================================================
OTHER SUBJECTS
==================================================

History:
कारण और घटना अलग रखो।

Chemistry:
अनावश्यक molecular-level detail मत जोड़ो।

Physics:
अनावश्यक advanced mathematics मत जोड़ो।

Biology:
सामान्य प्रश्न में molecular mechanism मत जोड़ो।

==================================================
FINAL CHECK
==================================================

जाँचो:

- प्रश्न सही समझा?
- marks सही हैं?
- विषय सही है?
- भाषा आसान है?
- कोई अनावश्यक technical detail है?
- कोई advanced mechanism है?
- कोई factual error है?
- कोई repetition है?
- क्या यह सीधे परीक्षा में लिखा जा सकता है?

यदि समस्या है तो पूरा corrected answer दो।

सिर्फ "सही है" मत लिखो।
`;

    const conversationText =
      messages
        .map(
          (message) =>
            `${message.role}: ${message.content}`
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
USER:

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
      report = JSON.parse(
        check.raw
      );
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

    if (
      !report.needs_correction
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

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

    // Prevent an accidental huge rewrite.
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

        status:
          response.status,

        code:
          data?.error?.code ||
          `HTTP_${response.status}`,

        error: message,

        requestId,

        raw: null,
      };
    }

    const choice =
      Array.isArray(
        data?.choices
      )
        ? data.choices[0]
        : null;

    const content =
      typeof choice
        ?.message
        ?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    // =========================
    // STRUCTURED CHECK RESPONSE
    // =========================

    if (
      payload.response_format
    ) {
      if (!content) {
        return {
          ok: false,

          retryable: true,

          status: 502,

          code:
            "EMPTY_CHECK_RESPONSE",

          error:
            "Self-check ने खाली response दिया।",

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

    // =========================
    // NORMAL EMPTY RESPONSE
    // =========================

    if (!content) {
      return {
        ok: false,

        retryable: true,

        status: 502,

        code:
          "EMPTY_RESPONSE",

        error:
          "Groq response आया लेकिन उसमें कोई text answer नहीं था।",

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
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    const isTimeout =
      error?.name ===
      "AbortError";

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
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms
      );
    }
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
