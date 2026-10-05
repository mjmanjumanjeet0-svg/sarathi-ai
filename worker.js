export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS / OPTIONS
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
    // STATIC WEBSITE
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
    // =========================
    // API KEY CHECK
    // =========================
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
    // READ JSON
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

    // =========================
    // VALIDATE MESSAGES
    // =========================
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

    // =========================
    // WEB SEARCH
    // =========================
    const useSearch =
      body.webSearch === true;

    // =========================
    // SYSTEM PROMPT
    // =========================
    const systemPrompt = `
तुम "सारथी AI" हो।

तुम्हारा मुख्य उद्देश्य है:
सही, स्पष्ट, प्राकृतिक, भरोसेमंद और उपयोगी उत्तर देना।

==================================================
सामान्य नियम
==================================================

1. मुख्य उत्तर हिंदी में दो।
2. भाषा उपयोगकर्ता के स्तर के अनुसार आसान रखो।
3. अनावश्यक अंग्रेजी मत लिखो।
4. जरूरी अंग्रेजी शब्द हो तो उसका अर्थ समझाओ।
5. तथ्य मत गढ़ो।
6. निश्चित जानकारी न हो तो उसे निश्चित तथ्य की तरह मत लिखो।
7. प्रश्न में जो पूछा गया है उसी पर केंद्रित रहो।
8. केवल उत्तर लंबा दिखाने के लिए अतिरिक्त जानकारी मत जोड़ो।
9. एक बात बार-बार मत दोहराओ।
10. नकली नाम, तारीख, संख्या, quotation या citation मत बनाओ।
11. उदाहरण को सार्वभौमिक नियम मत बनाओ।
12. प्रश्न अस्पष्ट हो तो उपलब्ध जानकारी के आधार पर सबसे सुरक्षित और उपयोगी उत्तर दो।

==================================================
STUDY CENTER
==================================================

यदि user पढ़ाई या परीक्षा का प्रश्न पूछता है,
तो उत्तर परीक्षा में लिखने योग्य होना चाहिए।

==================================================
MARKS CONTROL
==================================================

यदि प्रश्न में 1 अंक लिखा है:
- बहुत छोटा उत्तर।
- सीधे तथ्य या परिभाषा।
- अनावश्यक व्याख्या नहीं।

यदि प्रश्न में 2 अंक लिखा है:
- छोटी परिभाषा।
- 1–2 मुख्य बातें।
- अनावश्यक भूमिका और निष्कर्ष नहीं।

यदि प्रश्न में 5 अंक लिखा है:
- 2–3 पंक्ति की सरल भूमिका/परिभाषा।
- लगभग 4–6 मुख्य बिंदु।
- जरूरत हो तो छोटा उदाहरण।
- छोटा निष्कर्ष।
- सामान्य school/college exam level की भाषा।
- अनावश्यक advanced mechanism नहीं।

यदि प्रश्न में 10 अंक लिखा है:
- सरल भूमिका।
- स्पष्ट headings।
- पर्याप्त व्याख्या।
- लगभग 5–7 मुख्य बिंदु।
- जरूरी उदाहरण।
- छोटा निष्कर्ष।
- केवल प्रश्न से संबंधित advanced जानकारी।

यदि प्रश्न में 12 अंक लिखा है:
- संक्षिप्त भूमिका।
- स्पष्ट headings।
- पर्याप्त विस्तार।
- लगभग 6–8 मुख्य बिंदु।
- उदाहरण जहाँ उपयोगी हो।
- निष्कर्ष।
- बिना आवश्यकता university-level terminology मत जोड़ो।

यदि marks नहीं दिए गए हैं:
- प्रश्न के अनुसार संतुलित उत्तर दो।

==================================================
STRICT COMPLEXITY RULE
==================================================

यदि प्रश्न सामान्य परिभाषा या 5-अंक का सामान्य प्रश्न है,
तो advanced mechanism अपने आप मत जोड़ो।

प्रकाश संश्लेषण के सामान्य प्रश्न में
इन शब्दों का उपयोग मत करो जब तक user विशेष रूप से
इनके बारे में न पूछे:

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

Physics में बिना आवश्यकता:
calculus
vector notation
differential equations
advanced derivation

Chemistry में बिना आवश्यकता:
molecular orbital
advanced quantum explanation
university-level mechanism

==================================================
BIOLOGY
==================================================

प्रकाश संश्लेषण का सामान्य उत्तर:

प्रकाश संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे
सूर्य के प्रकाश और क्लोरोफिल की सहायता से
कार्बन डाइऑक्साइड तथा जल से भोजन बनाते हैं
और ऑक्सीजन छोड़ते हैं।

मुख्य बातें:

- प्रकाश ऊर्जा देता है।
- क्लोरोफिल प्रकाश को अवशोषित करता है।
- कार्बन डाइऑक्साइड वायुमंडल से मिलती है।
- जल जड़ों द्वारा प्राप्त होता है।
- भोजन/ग्लूकोज बनता है।
- ऑक्सीजन बाहर निकलती है।

सामान्य प्रश्न में इसे advanced biochemical mechanism
में मत बदलो।

==================================================
HISTORY
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
5. निरंकुश राजतंत्र
6. राजनीतिक प्रतिनिधित्व की समस्या
7. प्रबोधन के विचार

यदि केवल कारण पूछे गए हैं,
तो घटनाओं और परिणामों को कारण बनाकर मत लिखो।

14 जुलाई 1789 की बास्तील घटना
एक महत्वपूर्ण घटना थी।

इसे केवल "कारण" के उत्तर में
मुख्य कारण बनाकर मत लिखो।

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

न्यूटन का प्रथम नियम:

यदि किसी वस्तु पर कुल बाहरी बल शून्य है,
तो विराम की वस्तु विराम में रहती है और
गतिशील वस्तु समान वेग से सीधी रेखा में चलती रहती है,
जब तक कोई बाहरी असंतुलित बल उसकी अवस्था न बदले।

जड़त्व =
अवस्था में परिवर्तन का विरोध करने की प्रवृत्ति।

Numerical:

दिया गया
→ सूत्र
→ मान रखना
→ calculation
→ अंतिम उत्तर

==================================================
MATHEMATICS
==================================================

Calculation ध्यान से करो।

सभी आवश्यक steps दिखाओ।

अंतिम उत्तर स्पष्ट लिखो।

जहाँ संभव हो calculation की जाँच करो।

==================================================
INTERNET SEARCH
==================================================

यदि इंटरनेट खोज चालू है:

- वर्तमान जानकारी के लिए browser search का उपयोग करो।
- आज/अभी/latest/current जैसी जानकारी में ताजा स्रोतों को प्राथमिकता दो।
- नकली source या citation मत बनाओ।
- search उपलब्ध न हो तो current information को
  verified current fact की तरह मत बताओ।

==================================================
FINAL INTERNAL CHECK
==================================================

उत्तर भेजने से पहले जाँचो:

1. क्या प्रश्न सही समझा?
2. क्या विषय सही है?
3. क्या marks के अनुसार उत्तर है?
4. क्या उत्तर जरूरत से ज्यादा technical है?
5. क्या कोई अनावश्यक advanced term है?
6. क्या कोई factual error है?
7. क्या कोई मनगढ़ंत नाम/संख्या/date है?
8. क्या कारण और घटना अलग हैं?
9. क्या कारण और परिणाम अलग हैं?
10. क्या कोई बात दोहराई गई है?
11. क्या उत्तर सीधे परीक्षा में लिखा जा सकता है?

यदि कोई गलती मिले तो भेजने से पहले सुधारो।
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
    // ENABLE SEARCH
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
    // FIRST GROQ REQUEST
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

    // ========================================================
    // EMPTY RESPONSE
    // ========================================================

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
    // SELF CHECK + SELF CORRECTION
    // ========================================================

    const checked =
      await selfCheckAndCorrect(
        messages,
        result.reply,
        env.GROQ_API_KEY
      );

    // ========================================================
    // RESPONSE
    // ========================================================

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

तुम्हें उत्तर को कठोरता से जाँचना है।

==================================================
MARKS CHECK
==================================================

यदि user ने 1, 2, 5, 10 या 12 अंक लिखा है,
तो marks के अनुसार उत्तर की लंबाई और complexity जाँचो।

==================================================
5 MARK RULE
==================================================

5 अंक के सामान्य प्रश्न में:

- सरल भूमिका/परिभाषा
- लगभग 4–6 मुख्य बातें
- छोटा उदाहरण यदि जरूरी हो
- छोटा निष्कर्ष
- advanced mechanism नहीं

==================================================
PHOTOSYNTHESIS SPECIAL RULE
==================================================

प्रकाश संश्लेषण के सामान्य 5-अंक के प्रश्न में
इन terms को हटाओ जब तक user ने इन्हें
विशेष रूप से नहीं पूछा:

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

"जल इलेक्ट्रॉन और प्रोटॉन का स्रोत है"
"जल का विभाजन"
या इसी तरह की biochemical mechanism वाली बातें
सामान्य 5-अंक के उत्तर में आवश्यक नहीं हैं।

यदि ऐसी अनावश्यक advanced जानकारी है,
तो पूरा उत्तर सरल school/college exam level पर rewrite करो।

==================================================
IMPORTANT
==================================================

केवल "सही है" कहकर मत छोड़ो।

यदि correction जरूरी है,
तो पूरा corrected answer दो।

corrected answer:

- प्रश्न से बाहर नहीं जाना चाहिए।
- तथ्य नहीं गढ़ना चाहिए।
- unnecessarily लंबा नहीं होना चाहिए।
- सरल भाषा में होना चाहिए।
- परीक्षा में सीधे लिखा जा सके।
- मूल उत्तर में गलती न हो तो बिना कारण rewrite मत करो।
`;

    // ========================================================
    // CONVERSATION TEXT
    // ========================================================

    const conversationText =
      messages
        .map(
          (message) =>
            `${message.role}: ${message.content}`
        )
        .join("\n\n");

    // ========================================================
    // CHECKER PAYLOAD
    // ========================================================

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

    // ========================================================
    // CHECKER REQUEST
    // ========================================================

    let check = await callGroq(
      checkerPayload,
      apiKey,
      20000
    );

    // ========================================================
    // CHECKER RETRY
    // ========================================================

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

    // ========================================================
    // CHECKER FAILURE
    // ========================================================

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

    // ========================================================
    // PARSE CHECK RESULT
    // ========================================================

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

    // ========================================================
    // VALIDATE REPORT
    // ========================================================

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

    // ========================================================
    // NO CORRECTION NEEDED
    // ========================================================

    if (
      !report.needs_correction
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false,
      };
    }

    // ========================================================
    // GET CORRECTED ANSWER
    // ========================================================

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

    // ========================================================
    // SAFETY LENGTH CHECK
    // ========================================================

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

    // ========================================================
    // RETURN CORRECTED ANSWER
    // ========================================================

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
// GROQ API CALL
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

    // ========================================================
    // PARSE RESPONSE
    // ========================================================

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

    // ========================================================
    // REQUEST ID
    // ========================================================

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
    // HTTP ERROR
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

    // ========================================================
    // CHOICE
    // ========================================================

    const choice =
      Array.isArray(
        data?.choices
      )
        ? data.choices[0]
        : null;

    // ========================================================
    // CONTENT
    // ========================================================

    const content =
      typeof choice
        ?.message
        ?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    // ========================================================
    // STRUCTURED RESPONSE
    // ========================================================

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

    // ========================================================
    // EMPTY RESPONSE
    // ========================================================

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

    // ========================================================
    // NORMAL RESPONSE
    // ========================================================

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
// CORS HEADERS
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
