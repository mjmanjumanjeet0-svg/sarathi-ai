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
    // API
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
    // WEBSITE
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
  const apiKey = env.GROQ_API_KEY;

  if (!apiKey) {
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

  if (!body || !Array.isArray(body.messages)) {
    return json(
      {
        error: "messages array is required.",
        code: "INVALID_MESSAGES",
      },
      400
    );
  }

  const messages = body.messages
    .slice(-20)
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
          content = JSON.stringify(
            message.content
          );
        } catch {
          content = "";
        }
      }

      return {
        role,
        content: content.slice(0, 8000),
      };
    })
    .filter(
      (message) =>
        message.content.trim().length > 0
    );

  if (messages.length === 0) {
    return json(
      {
        error: "At least one message is required.",
        code: "EMPTY_MESSAGES",
      },
      400
    );
  }

  const useSearch = body.webSearch === true;

  // ==========================================================
  // SYSTEM PROMPT
  // ==========================================================

  const systemPrompt = `
तुम "सारथी AI" हो — सरल, सुरक्षित और तथ्य-जाँच करने वाला हिंदी AI सहायक।

मुख्य नियम:

1. प्रश्न का सीधा उत्तर दो।
2. सरल और स्वाभाविक हिंदी का उपयोग करो।
3. परीक्षा वाले प्रश्न में exam-ready उत्तर दो।
4. दिए गए marks के अनुसार लंबाई और कठिनाई रखो।
5. बिना जरूरत advanced terminology मत दो।
6. गलत या संदिग्ध तथ्य मत लिखो।
7. प्रश्न से बाहर की जानकारी मत जोड़ो।
8. विरोधाभासी बातें मत लिखो।
9. गणित की calculation दोबारा जाँचो।
10. विज्ञान के facts जाँचो।
11. इतिहास में तारीख, व्यक्ति, घटना और कारण-परिणाम जाँचो।
12. grammar और spelling सुधारो।

============================================================
MARKS CONTROL
============================================================

1 अंक:
- एक सीधा उत्तर।

2 अंक:
- लगभग 2–4 छोटे वाक्य या बिंदु।

5 अंक:
- सरल परिभाषा/भूमिका।
- लगभग 4–6 मुख्य बिंदु।
- छोटा निष्कर्ष।
- उत्तर मध्यम लंबाई का हो।
- अनावश्यक advanced detail नहीं।

10 अंक:
- भूमिका।
- headings।
- पर्याप्त व्याख्या।
- मुख्य बिंदु।
- उदाहरण जहाँ जरूरी हो।
- निष्कर्ष।

12 अंक:
- विस्तृत exam-ready उत्तर।
- भूमिका, headings, व्याख्या, उदाहरण और निष्कर्ष।

============================================================
5 MARKS STRICT RULE
============================================================

यदि प्रश्न में 5 अंक हैं तो उत्तर सरल और
परीक्षा में लिखने योग्य होना चाहिए।

सामान्य प्रश्न में अनावश्यक advanced terminology
का उपयोग मत करो।

============================================================
PHOTOSYNTHESIS
============================================================

यदि प्रश्न सामान्य है:

"प्रकाश संश्लेषण क्या है?"

तो:

- सरल परिभाषा दो।
- 4–6 मुख्य बिंदु दो।
- क्लोरोफिल का उल्लेख कर सकते हो।
- जल का उल्लेख करो।
- कार्बन डाइऑक्साइड का उल्लेख करो।
- भोजन बनने की बात बताओ।
- ऑक्सीजन निकलने की बात बताओ।
- छोटा महत्व या निष्कर्ष दो।

सामान्य 5 अंक के उत्तर में ये terms मत दो:

ATP
NADPH
Calvin cycle
Photosystem I
Photosystem II
Photosystem
electron transport chain
carbon fixation
proton gradient
इलेक्ट्रॉन
हाइड्रोजन आयन
जल का विभाजन
प्रकाश अभिक्रिया
अंधकार अभिक्रिया
जैविक पदार्थ
ऊर्जा भंडारण
कार्बन-फिक्सेशन

जब तक प्रश्न विशेष रूप से इन विषयों के बारे में
नहीं पूछता।

यह गलत नहीं लिखना:

"पौधे रात में ऑक्सीजन छोड़ते हैं।"

पौधे दिन और रात दोनों समय श्वसन करते हैं।

============================================================
SCIENCE
============================================================

वैज्ञानिक तथ्य सही रखो।

============================================================
HISTORY
============================================================

तारीख, व्यक्ति, घटना और कारण-परिणाम जाँचो।

============================================================
CHEMISTRY
============================================================

Formula और chemical equation जाँचो।

============================================================
PHYSICS
============================================================

Formula, unit और calculation जाँचो।

============================================================
MATHEMATICS
============================================================

हर calculation दोबारा verify करो।

============================================================
INTERNET SEARCH
============================================================

यदि Internet Search मांगा गया है:

- current information खोजो।
- उपलब्ध sources/citations बनाए रखो।
- current information को बिना verification के
  निश्चित तथ्य की तरह मत लिखो।

============================================================
FINAL RULE
============================================================

उत्तर देने से पहले खुद से जाँचो:

FACT
MARKS
LANGUAGE
RELEVANCE
CONSISTENCY

सिर्फ अंतिम उत्तर दो।
`;

  // ==========================================================
  // MAIN GROQ PAYLOAD
  // ==========================================================

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

  // ==========================================================
  // INTERNET SEARCH
  // ==========================================================

  if (useSearch) {
    payload.tools = [
      {
        type: "browser_search",
      },
    ];

    payload.tool_choice = "required";
  }

  // ==========================================================
  // MAIN GROQ REQUEST
  // ==========================================================

  let result = await callGroq(
    apiKey,
    payload,
    useSearch ? 60000 : 45000
  );

  // ==========================================================
  // RETRY ONLY MAIN REQUEST
  // ==========================================================

  if (!result.ok && result.retryable) {
    await sleep(1000);

    result = await callGroq(
      apiKey,
      payload,
      useSearch ? 60000 : 45000
    );
  }

  // ==========================================================
  // SEARCH FALLBACK
  // ==========================================================

  if (!result.ok && useSearch) {
    const fallbackPayload = {
      model: "openai/gpt-oss-120b",

      messages: [
        {
          role: "system",
          content:
            systemPrompt +
            `

Internet search अभी उपलब्ध नहीं है।
Current जानकारी को independently verified न मानें।
`,
        },
        ...messages,
      ],

      max_completion_tokens: 4096,

      temperature: 0.2,

      reasoning_effort: "low",

      stream: false,
    };

    result = await callGroq(
      apiKey,
      fallbackPayload,
      45000
    );

    if (result.ok) {
      result.reply += `

⚠️ Internet search इस समय उपलब्ध नहीं हो सका,
इसलिए current जानकारी की स्वतंत्र पुष्टि नहीं हुई है।`;
    }
  }

  // ==========================================================
  // MAIN ERROR
  // ==========================================================

  if (!result.ok) {
    return json(
      {
        error: "Groq request failed.",
        code:
          result.code || "GROQ_ERROR",
        status:
          result.status || 502,
        requestId:
          result.requestId || null,
        detail:
          result.error || null,
      },
      result.status || 502
    );
  }

  // ==========================================================
  // LIGHTWEIGHT SELF CHECK
  // ==========================================================

  let checked;

  try {
    checked = await finalSelfCheck(
      messages,
      result.reply,
      apiKey
    );
  } catch {
    checked = {
      answer:
        deterministicFactCheck(
          messages,
          result.reply
        ),

      selfChecked: false,
      selfCorrected: false,
      factChecked: false,
      finalReviewed: false,
    };
  }

  // ==========================================================
  // FINAL RESPONSE
  // ==========================================================

  return json({
    reply:
      checked.answer ||
      result.reply,

    selfChecked:
      checked.selfChecked === true,

    selfCorrected:
      checked.selfCorrected === true,

    factChecked:
      checked.factChecked === true,

    finalReviewed:
      checked.finalReviewed === true,
  });
}


// ============================================================
// LIGHTWEIGHT SELF CHECK
// ============================================================

async function finalSelfCheck(
  messages,
  originalAnswer,
  apiKey
) {
  let answer =
    deterministicFactCheck(
      messages,
      originalAnswer
    );

  const firstChanged =
    answer !== originalAnswer;

  const question =
    messages
      .filter(
        (m) =>
          m.role === "user"
      )
      .map(
        (m) =>
          m.content
      )
      .join("\n");

  const marks =
    detectMarks(question);

  // ==========================================================
  // 5 MARKS PHOTOSYNTHESIS
  // ==========================================================

  if (
    marks === 5 &&
    isPhotosynthesisQuestion(question) &&
    needsSimplePhotosynthesisRewrite(answer)
  ) {
    try {
      const simplified =
        await simplifyPhotosynthesisAnswer(
          question,
          answer,
          apiKey
        );

      if (
        simplified.ok &&
        simplified.reply &&
        simplified.reply.length >= 20
      ) {
        answer =
          deterministicFactCheck(
            messages,
            simplified.reply
          );
      }
    } catch {
      // मुख्य उत्तर सुरक्षित रखें।
    }
  }

  // ==========================================================
  // FINAL DETERMINISTIC CHECK
  // ==========================================================

  answer =
    deterministicFactCheck(
      messages,
      answer
    );

  return {
    answer:
      normalizeAnswer(answer),

    selfChecked: true,

    selfCorrected:
      firstChanged ||
      answer !== originalAnswer,

    factChecked:
      firstChanged ||
      answer !== originalAnswer,

    finalReviewed:
      true,
  };
}


// ============================================================
// SHOULD SIMPLIFY PHOTOSYNTHESIS?
// ============================================================

function needsSimplePhotosynthesisRewrite(
  answer
) {
  const text =
    String(answer || "");

  if (
    text.length > 1800
  ) {
    return true;
  }

  if (
    hasAdvancedPhotosynthesisTerms(
      text
    )
  ) {
    return true;
  }

  if (
    /शैवाल|बैक्टीरिया|जैविक पदार्थ|कार्बन डाइऑक्साइड का स्थिरीकरण|जल का विभाजन/.test(
      text
    )
  ) {
    return true;
  }

  return false;
}


// ============================================================
// MARK DETECTOR
// ============================================================

function detectMarks(question) {
  const text =
    String(question || "")
      .toLowerCase();

  if (
    /12\s*अंक|12\s*marks|12\s*mark/.test(
      text
    )
  ) {
    return 12;
  }

  if (
    /10\s*अंक|10\s*marks|10\s*mark/.test(
      text
    )
  ) {
    return 10;
  }

  if (
    /5\s*अंक|5\s*marks|5\s*mark/.test(
      text
    )
  ) {
    return 5;
  }

  if (
    /2\s*अंक|2\s*marks|2\s*mark/.test(
      text
    )
  ) {
    return 2;
  }

  if (
    /1\s*अंक|1\s*mark|1\s*marks/.test(
      text
    )
  ) {
    return 1;
  }

  return null;
}


// ============================================================
// PHOTOSYNTHESIS DETECTOR
// ============================================================

function isPhotosynthesisQuestion(
  question
) {
  const text =
    String(question || "")
      .toLowerCase();

  return (
    text.includes(
      "प्रकाश संश्लेषण"
    ) ||
    text.includes(
      "photosynthesis"
    )
  );
}


// ============================================================
// ADVANCED PHOTOSYNTHESIS DETECTOR
// ============================================================

function hasAdvancedPhotosynthesisTerms(
  answer
) {
  const text =
    String(answer || "")
      .toLowerCase();

  const terms = [
    "atp",
    "nadph",
    "calvin cycle",
    "photosystem i",
    "photosystem ii",
    "photosystem",
    "electron transport chain",
    "carbon fixation",
    "proton gradient",

    "इलेक्ट्रॉन परिवहन",
    "प्रोटॉन ग्रेडिएंट",
    "कार्बन स्थिरीकरण",
    "कार्बन-फिक्सेशन",
    "कार्बन फिक्सेशन",
    "कैल्विन चक्र",

    "इलेक्ट्रॉन",
    "हाइड्रोजन आयन",
    "जल का विभाजन",
    "प्रकाश अभिक्रिया",
    "अंधकार अभिक्रिया",
    "जैविक पदार्थ",
    "ऊर्जा भंडारण",
  ];

  return terms.some(
    (term) =>
      text.includes(term)
  );
}


// ============================================================
// SIMPLE PHOTOSYNTHESIS REWRITE
// ============================================================

async function simplifyPhotosynthesisAnswer(
  question,
  answer,
  apiKey
) {
  const prompt = `
तुम "सारथी AI" के परीक्षा-उत्तर सुधारक हो।

प्रश्न:
${question}

मौजूदा उत्तर:
${answer}

यह सामान्य 5 अंक का प्रश्न है।

इसे बहुत सरल, साफ और परीक्षा में लिखने योग्य
हिंदी में दोबारा लिखो।

नियम:

1. आसान परिभाषा दो।

2. 4 से 6 मुख्य बिंदु दो।

3. छोटा महत्व या निष्कर्ष दो।

4. सामान्य कॉलेज विद्यार्थी आसानी से समझ सके।

5. उत्तर बहुत बड़ा नहीं होना चाहिए।

6. ये शब्द बिल्कुल मत लिखो:

ATP
NADPH
Calvin cycle
Photosystem
Photosystem I
Photosystem II
electron transport chain
carbon fixation
proton gradient
इलेक्ट्रॉन
हाइड्रोजन आयन
जल का विभाजन
प्रकाश अभिक्रिया
अंधकार अभिक्रिया
जैविक पदार्थ
ऊर्जा भंडारण
कार्बन-फिक्सेशन

7. "शैवाल और कुछ बैक्टीरिया" जैसी अतिरिक्त
जानकारी सामान्य 5 अंक के उत्तर में मत दो।

8. "सूर्य के प्रकाश ऊर्जा" मत लिखो।

सही:
"सूर्य के प्रकाश की ऊर्जा"

9. लिख सकते हो:

"पौधे जड़ों द्वारा मिट्टी से जल प्राप्त करते हैं।"

10. लिख सकते हो:

"पत्तियाँ वायु से कार्बन डाइऑक्साइड लेती हैं।"

11. लिख सकते हो:

"क्लोरोफिल प्रकाश को ग्रहण करता है।"

12. लिख सकते हो:

"प्रकाश संश्लेषण में पौधे अपना भोजन बनाते हैं
और ऑक्सीजन वातावरण में छोड़ते हैं।"

13. रात के बारे में अनावश्यक चर्चा मत करो।

14. यह कभी मत लिखो:

"पौधे रात में ऑक्सीजन छोड़ते हैं।"

15. कोई अनावश्यक उदाहरण मत जोड़ो।

वांछित संरचना:

**प्रकाश संश्लेषण**

सरल परिभाषा।

**मुख्य बिंदु**

1. ...
2. ...
3. ...
4. ...
5. ...

**महत्व**

1–2 छोटे वाक्य।

**निष्कर्ष**

एक छोटा वाक्य।

केवल अंतिम उत्तर दो।
`;

  const payload = {
    model:
      "openai/gpt-oss-120b",

    messages: [
      {
        role: "system",
        content: prompt,
      },
    ],

    max_completion_tokens: 1200,

    temperature: 0.05,

    reasoning_effort: "low",

    stream: false,
  };

  return callGroq(
    apiKey,
    payload,
    20000
  );
}


// ============================================================
// DETERMINISTIC FACT CHECK
// ============================================================

function deterministicFactCheck(
  messages,
  answer
) {
  let text =
    String(answer || "");

  const question =
    messages
      .filter(
        (m) =>
          m.role === "user"
      )
      .map(
        (m) =>
          m.content
      )
      .join("\n")
      .toLowerCase();

  if (
    question.includes(
      "प्रकाश संश्लेषण"
    ) ||
    question.includes(
      "photosynthesis"
    )
  ) {
    // ------------------------------------------
    // गलत रात/ऑक्सीजन वाक्य
    // ------------------------------------------

    const badPatterns = [
      /रात में[^।\n]{0,80}ऑक्सीजन छोड़ता है/g,
      /रात में[^।\n]{0,80}ऑक्सीजन छोड़ती है/g,
      /रात में[^।\n]{0,80}ऑक्सीजन छोड़ते हैं/g,

      /रात को[^।\n]{0,80}ऑक्सीजन छोड़ता है/g,
      /रात को[^।\n]{0,80}ऑक्सीजन छोड़ती है/g,
      /रात को[^।\n]{0,80}ऑक्सीजन छोड़ते हैं/g,

      /रात्रि में[^।\n]{0,80}ऑक्सीजन छोड़ता है/g,
      /रात्रि में[^।\n]{0,80}ऑक्सीजन छोड़ती है/g,
      /रात्रि में[^।\n]{0,80}ऑक्सीजन छोड़ते हैं/g,
    ];

    for (
      const pattern of badPatterns
    ) {
      text =
        text.replace(
          pattern,
          (match) => {
            if (
              /नहीं/.test(
                match
              ) ||
              /नही/.test(
                match
              )
            ) {
              return match;
            }

            return "प्रकाश संश्लेषण के दौरान पौधे ऑक्सीजन वातावरण में छोड़ते हैं";
          }
        );
    }

    // ------------------------------------------
    // छोटे भाषा सुधार
    // ------------------------------------------

    text =
      text.replace(
        /सूर्य के प्रकाश ऊर्जा/g,
        "सूर्य के प्रकाश की ऊर्जा"
      );

    text =
      text.replace(
        /जड़ों द्वारा जमीनी से/g,
        "जड़ों द्वारा जमीन से"
      );

    text =
      text.replace(
        /जमीनी से/g,
        "जमीन से"
      );

    text =
      text.replace(
        /पौधे केवल रात में श्वसन करते हैं/g,
        "पौधे दिन और रात दोनों समय श्वसन करते हैं"
      );

    text =
      text.replace(
        /पौधे सिर्फ रात में श्वसन करते हैं/g,
        "पौधे दिन और रात दोनों समय श्वसन करते हैं"
      );
  }

  return normalizeAnswer(
    text
  );
}


// ============================================================
// NORMALIZE
// ============================================================

function normalizeAnswer(text) {
  return String(text || "")
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}


// ============================================================
// GROQ API
// ============================================================

async function callGroq(
  apiKey,
  payload,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify(
              payload
            ),

          signal:
            controller.signal,
        }
      );

    const requestId =
      response.headers.get(
        "x-request-id"
      ) ||
      response.headers.get(
        "x-groq-request-id"
      ) ||
      null;

    const raw =
      await response.text();

    let data = null;

    try {
      data =
        JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
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
          `GROQ_HTTP_${response.status}`,

        requestId,

        error:
          data?.error?.message ||
          raw.slice(
            0,
            1000
          ),
      };
    }

    if (!data) {
      return {
        ok: false,

        retryable: true,

        status: 502,

        code:
          "INVALID_GROQ_JSON",

        requestId,

        error:
          raw.slice(
            0,
            1000
          ),
      };
    }

    const content =
      data?.choices?.[0]?.message?.content;

    if (
      typeof content !==
      "string"
    ) {
      return {
        ok: false,

        retryable: false,

        status: 502,

        code:
          "INVALID_GROQ_RESPONSE",

        requestId,

        error:
          "Groq returned no usable message content.",
      };
    }

    return {
      ok: true,

      reply:
        content.trim(),

      requestId,

      status:
        response.status,
    };
  } catch (error) {
    return {
      ok: false,

      retryable: true,

      status: 504,

      code:
        error?.name ===
        "AbortError"
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      requestId: null,

      error:
        error?.message ||
        "Network error",
    };
  } finally {
    clearTimeout(
      timeout
    );
  }
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

    "Access-Control-Max-Age":
      "86400",
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
