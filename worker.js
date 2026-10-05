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
    // WEBSITE ASSETS
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

  // ==========================================================
  // CLEAN MESSAGES
  // ==========================================================

  const messages = body.messages
    .slice(-20)
    .map((message) => {
      const role =
        message?.role === "assistant" ? "assistant" : "user";

      let content = "";

      if (typeof message?.content === "string") {
        content = message.content;
      } else if (message?.content != null) {
        try {
          content = JSON.stringify(message.content);
        } catch {
          content = "";
        }
      }

      content = content.slice(0, 8000);

      return {
        role,
        content,
      };
    })
    .filter((message) => message.content.trim().length > 0);

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
तुम "सारथी AI" हो — एक सुरक्षित, सरल, तथ्य-जाँच करने वाला हिंदी AI सहायक।

मुख्य नियम:

1. उपयोगकर्ता के प्रश्न का सीधा उत्तर दो।
2. भाषा सरल और स्वाभाविक हिंदी रखो।
3. अगर प्रश्न परीक्षा/Study Center से जुड़ा है तो exam-ready उत्तर दो।
4. प्रश्न में जितने अंक मांगे गए हैं, उसी के अनुसार उत्तर की लंबाई और कठिनाई रखो।
5. बिना जरूरत बहुत advanced terminology मत दो।
6. अगर कोई तथ्य निश्चित नहीं है तो उसे तथ्य की तरह मत लिखो।
7. प्रश्न से बाहर की अनावश्यक जानकारी मत जोड़ो।
8. उत्तर में कोई ऐसी बात मत लिखो जो अगले ही वाक्य में उससे contradict करे।
9. गणित में calculation दोबारा जाँचो।
10. विज्ञान में scientific facts दोबारा जाँचो।
11. इतिहास में तारीख, घटना, व्यक्ति और कारण-परिणाम जाँचो।
12. भाषा और grammar की गलतियाँ सुधारो।

============================================================
MARKS CONTROL
============================================================

यदि प्रश्न में 1 अंक:
- केवल बहुत छोटा और सीधा उत्तर।

यदि 2 अंक:
- लगभग 2–4 मुख्य वाक्य/बिंदु।
- अनावश्यक उदाहरण और लंबा निष्कर्ष नहीं।

यदि 5 अंक:
- परिभाषा/भूमिका।
- लगभग 4–6 मुख्य बिंदु।
- जरूरत हो तो छोटा उदाहरण।
- छोटा निष्कर्ष।
- बहुत advanced university-level detail नहीं।

यदि 10 अंक:
- भूमिका।
- स्पष्ट headings।
- पर्याप्त मुख्य बिंदु।
- उदाहरण/व्याख्या जहाँ जरूरी हो।
- निष्कर्ष।

यदि 12 अंक:
- विस्तृत लेकिन विषय पर केंद्रित उत्तर।
- भूमिका, headings, मुख्य व्याख्या, उदाहरण और निष्कर्ष।
- उत्तर exam-ready होना चाहिए।

यदि marks स्पष्ट नहीं हैं:
- प्रश्न के स्तर के अनुसार संतुलित उत्तर दो।

============================================================
PHOTOSYNTHESIS SPECIAL FACT CHECK
============================================================

यदि प्रश्न प्रकाश संश्लेषण से संबंधित है:

सही मुख्य बातें:
- हरे पौधे प्रकाश ऊर्जा का उपयोग करते हैं।
- कार्बन डाइऑक्साइड और जल से भोजन/ग्लूकोज़ बनता है।
- क्लोरोफिल प्रकाश को अवशोषित करता है।
- प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ी जाती है।
- पौधे दिन और रात दोनों समय श्वसन करते हैं।
- "रात में प्रकाश संश्लेषण करके ऑक्सीजन छोड़ते हैं" जैसा दावा मत करो।
- यह मत लिखो कि पौधे केवल रात में श्वसन करते हैं।
- बहुत छोटे exam answer में Photosystem, ATP, NADPH, Calvin cycle जैसी advanced details तभी दो जब प्रश्न विशेष रूप से उन्हीं के बारे में हो।

विशेष रूप से यह गलत दावा नहीं होना चाहिए:
"पौधा रात में श्वसन के लिए ऑक्सीजन छोड़ता है।"

सही विचार:
"पौधे श्वसन के दौरान ऑक्सीजन का उपयोग करते हैं। प्रकाश संश्लेषण के दौरान ऑक्सीजन निकलती है।"

============================================================
HISTORY FACT CHECK
============================================================

इतिहास के उत्तर में:
- तारीख और घटना का संबंध जाँचो।
- व्यक्ति और घटना को गलत तरीके से न जोड़ो।
- कारण और परिणाम अलग रखो।
- अनुमान को निश्चित तथ्य की तरह मत लिखो।
- यदि मतभेद हो तो स्पष्ट भाषा में बताओ।

============================================================
CHEMISTRY FACT CHECK
============================================================

- Chemical formula जाँचो।
- Equation balance जाँचो।
- पदार्थों के नाम और formula का मिलान जाँचो।
- गलत reaction या गलत product मत लिखो।

============================================================
PHYSICS FACT CHECK
============================================================

- Formula जाँचो।
- Units जाँचो।
- Numerical calculation दोबारा करो।
- Given values और final answer का मिलान करो।
- Direction/sign जहाँ जरूरी हो वहाँ जाँचो।

============================================================
MATHEMATICS FACT CHECK
============================================================

- Calculation दोबारा करो।
- Formula सही लगाओ।
- Intermediate steps में arithmetic error मत रहने दो।
- Final answer को original question से मिलाओ।

============================================================
INTERNET SEARCH
============================================================

यदि web search उपलब्ध है और उपयोगकर्ता ने Internet Search मांगा है:
- current information के लिए search का उपयोग करो।
- search result से मिले तथ्य और सामान्य knowledge को अलग समझो।
- current information को बिना verification के निश्चित मत बताओ।
- उपलब्ध sources/citations को बनाए रखो।

============================================================
FINAL RESPONSE RULE
============================================================

उत्तर देने से पहले खुद से जाँचो:

A. क्या मैंने प्रश्न का सही उत्तर दिया?
B. क्या तथ्य सही हैं?
C. क्या marks के अनुसार उत्तर की लंबाई सही है?
D. क्या भाषा और grammar सही है?
E. क्या कोई contradictory statement है?
F. क्या कोई अनावश्यक advanced information है?
G. क्या उदाहरण सही है?
H. क्या conclusion सही है?

अगर कोई गलती मिले तो उत्तर को सुधारो और फिर दोबारा जाँचो।

सिर्फ अंतिम साफ और उपयोगी उत्तर दो।
`;

// ============================================================
// GROQ REQUEST
// ============================================================

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

  let result = await callGroq(apiKey, payload, useSearch ? 60000 : 45000);

  // ==========================================================
  // RETRY
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
      ...payload,
      tools: undefined,
      tool_choice: undefined,
      messages: [
        {
          role: "system",
          content:
            systemPrompt +
            "\n\nInternet search इस समय उपलब्ध नहीं हो सका। Current जानकारी को verified न मानें।",
        },
        ...messages,
      ],
    };

    result = await callGroq(apiKey, fallbackPayload, 45000);

    if (result.ok) {
      result.reply =
        result.reply +
        "\n\n⚠️ Internet search इस समय उपलब्ध नहीं हो सका, इसलिए current जानकारी की स्वतंत्र पुष्टि नहीं हुई है।";
    }
  }

  // ==========================================================
  // GROQ FAILURE
  // ==========================================================

  if (!result.ok) {
    return json(
      {
        error: "अभी जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।",
        code: result.code || "GROQ_ERROR",
        requestId: result.requestId || null,
      },
      result.status || 502
    );
  }

  // ==========================================================
  // FINAL SELF-CHECK + SELF-CORRECTION
  // ==========================================================

  const checked = await finalSelfCheck(
    messages,
    result.reply,
    apiKey
  );

  // ==========================================================
  // FINAL RESPONSE
  // ==========================================================

  return json({
    reply: checked.answer,
    selfChecked: checked.selfChecked,
    selfCorrected: checked.selfCorrected,
    factChecked: checked.factChecked,
    finalReviewed: checked.finalReviewed,
  });
}

// ============================================================
// FINAL SELF-CHECK SYSTEM
// ============================================================

async function finalSelfCheck(messages, originalAnswer, apiKey) {
  // ----------------------------------------------------------
  // STEP 1: Deterministic fact correction
  // ----------------------------------------------------------

  let answer = deterministicFactCheck(messages, originalAnswer);

  const deterministicChanged = answer !== originalAnswer;

  // ----------------------------------------------------------
  // STEP 2: AI structured self-check
  // ----------------------------------------------------------

  const checkerPrompt = `
तुम Sarathi AI के Final Quality Controller हो।

तुम्हें एक USER QUESTION और AI ANSWER दिया जाएगा।

तुम्हारा काम उत्तर को 5 स्तरों पर जाँचना है:

1. FACT CHECK
2. MARKS / LENGTH CHECK
3. LANGUAGE / GRAMMAR CHECK
4. RELEVANCE CHECK
5. CONTRADICTION / CONSISTENCY CHECK

विशेष नियम:

- उत्तर में तथ्यात्मक गलती हो तो सुधारो।
- grammar/typing गलती हो तो सुधारो।
- प्रश्न से बाहर की जानकारी हटाओ।
- marks के अनुसार उत्तर की लंबाई रखो।
- 5 marks के उत्तर को जरूरत से ज्यादा advanced मत बनाओ।
- 10/12 marks में पर्याप्त explanation रखो।
- सही उत्तर को केवल style के लिए अनावश्यक रूप से मत बदलो।
- Photosynthesis में "रात में पौधे ऑक्सीजन छोड़ते हैं" जैसा गलत दावा स्वीकार मत करो।
- पौधे श्वसन दिन और रात दोनों करते हैं।
- Photosynthesis के दौरान oxygen release होती है।
- वैज्ञानिक उत्तर में contradiction नहीं होना चाहिए।
- यदि उत्तर पहले से सही है तो उसे लगभग वैसा ही रखो।

महत्वपूर्ण:
यदि कोई correction जरूरी हो तो पूरा corrected answer दो।
सिर्फ correction की सूची मत दो।

JSON के अलावा कुछ मत लिखो।
`;

  const userQuestion = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n")
    .slice(-12000);

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
USER QUESTION:
${userQuestion}

AI ANSWER:
${answer}
        `,
      },
    ],

    temperature: 0,
    max_completion_tokens: 4096,
    reasoning_effort: "low",
    stream: false,

    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sarathi_final_check",
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

            fact_check_passed: {
              type: "boolean",
            },

            marks_check_passed: {
              type: "boolean",
            },

            language_check_passed: {
              type: "boolean",
            },

            relevance_check_passed: {
              type: "boolean",
            },

            final_review_passed: {
              type: "boolean",
            },
          },

          required: [
            "needs_correction",
            "issues",
            "corrected_answer",
            "fact_check_passed",
            "marks_check_passed",
            "language_check_passed",
            "relevance_check_passed",
            "final_review_passed",
          ],

          additionalProperties: false,
        },
      },
    },
  };

  let check = await callGroq(apiKey, checkerPayload, 12000);

  // Retry checker once
  if (!check.ok && check.retryable) {
    await sleep(500);

    check = await callGroq(apiKey, checkerPayload, 12000);
  }

  // ----------------------------------------------------------
  // STEP 3: Checker failed
  // ----------------------------------------------------------

  if (!check.ok) {
    return {
      answer,
      selfChecked: false,
      selfCorrected: deterministicChanged,
      factChecked: deterministicChanged,
      finalReviewed: false,
    };
  }

  // ----------------------------------------------------------
  // STEP 4: Parse checker result
  // ----------------------------------------------------------

  let report;

  try {
    report = JSON.parse(check.reply);
  } catch {
    return {
      answer,
      selfChecked: false,
      selfCorrected: deterministicChanged,
      factChecked: deterministicChanged,
      finalReviewed: false,
    };
  }

  // ----------------------------------------------------------
  // STEP 5: Validate corrected answer
  // ----------------------------------------------------------

  let finalAnswer = answer;
  let selfCorrected = deterministicChanged;

  if (
    report.needs_correction === true &&
    typeof report.corrected_answer === "string"
  ) {
    const corrected = report.corrected_answer.trim();

    // Never replace a good answer with an empty/absurdly huge answer.
    const tooLarge =
      corrected.length >
      Math.max(answer.length * 2.5, 20000);

    if (corrected.length > 0 && !tooLarge) {
      finalAnswer = corrected;
      selfCorrected = true;
    }
  }

  // ----------------------------------------------------------
  // STEP 6: Run deterministic fact check AGAIN
  // ----------------------------------------------------------

  const secondPass = deterministicFactCheck(
    messages,
    finalAnswer
  );

  if (secondPass !== finalAnswer) {
    finalAnswer = secondPass;
    selfCorrected = true;
  }

  // ----------------------------------------------------------
  // STEP 7: Final cleanup
  // ----------------------------------------------------------

  finalAnswer = normalizeAnswer(finalAnswer);

  return {
    answer: finalAnswer,

    selfChecked: true,

    selfCorrected,

    factChecked:
      report.fact_check_passed === true ||
      deterministicChanged,

    finalReviewed:
      report.final_review_passed === true,
  };
}

// ============================================================
// DETERMINISTIC FACT CHECK
// ============================================================

function deterministicFactCheck(messages, answer) {
  let text = String(answer || "");

  const question = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n")
    .toLowerCase();

  // ==========================================================
  // PHOTOSYNTHESIS CHECK
  // ==========================================================

  const isPhotosynthesis =
    question.includes("प्रकाश संश्लेषण") ||
    question.includes("photosynthesis");

  if (isPhotosynthesis) {
    // --------------------------------------------------------
    // Wrong: "रात में ... ऑक्सीजन छोड़ता है"
    // Only target affirmative claims.
    // Do NOT touch sentences containing negation.
    // --------------------------------------------------------

    const badNightPatterns = [
      /रात में[^।\n]{0,100}ऑक्सीजन छोड़ता है/g,
      /रात में[^।\n]{0,100}ऑक्सीजन छोड़ती है/g,
      /रात में[^।\n]{0,100}ऑक्सीजन छोड़ते हैं/g,
      /रात को[^।\n]{0,100}ऑक्सीजन छोड़ता है/g,
      /रात को[^।\n]{0,100}ऑक्सीजन छोड़ती है/g,
      /रात को[^।\n]{0,100}ऑक्सीजन छोड़ते हैं/g,
      /रात्रि में[^।\n]{0,100}ऑक्सीजन छोड़ता है/g,
      /रात्रि में[^।\n]{0,100}ऑक्सीजन छोड़ती है/g,
      /रात्रि में[^।\n]{0,100}ऑक्सीजन छोड़ते हैं/g,
    ];

    for (const pattern of badNightPatterns) {
      text = text.replace(pattern, (match) => {
        // Avoid changing scientifically correct negative sentences.
        if (
          /नहीं/.test(match) ||
          /नही/.test(match)
        ) {
          return match;
        }

        return "प्रकाश संश्लेषण के दौरान पौधे ऑक्सीजन वातावरण में छोड़ते हैं";
      });
    }

    // English accidental claims
    text = text.replace(
      /at night[^.\n]{0,100}release oxygen/gi,
      "during photosynthesis, plants release oxygen"
    );

    text = text.replace(
      /plants release oxygen at night/gi,
      "plants release oxygen during photosynthesis"
    );

    // --------------------------------------------------------
    // Grammar fixes
    // --------------------------------------------------------

    text = text.replace(
      /जड़ों द्वारा जमीनी से/g,
      "जड़ों द्वारा जमीन से"
    );

    text = text.replace(
      /जमीनी से/g,
      "जमीन से"
    );

    // --------------------------------------------------------
    // Common incorrect sentence
    // --------------------------------------------------------

    text = text.replace(
      /और रात में श्वसन के लिए ऑक्सीजन छोड़ता है/g,
      "और प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ता है"
    );

    text = text.replace(
      /और रात में श्वसन के लिए ऑक्सीजन छोड़ती है/g,
      "और प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ती है"
    );

    text = text.replace(
      /और रात में श्वसन के लिए ऑक्सीजन छोड़ते हैं/g,
      "और प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ते हैं"
    );

    // --------------------------------------------------------
    // Correct another common misconception
    // --------------------------------------------------------

    text = text.replace(
      /पौधे केवल रात में श्वसन करते हैं/gi,
      "पौधे दिन और रात दोनों समय श्वसन करते हैं"
    );

    text = text.replace(
      /पौधे सिर्फ रात में श्वसन करते हैं/gi,
      "पौधे दिन और रात दोनों समय श्वसन करते हैं"
    );
  }

  return normalizeAnswer(text);
}

// ============================================================
// ANSWER NORMALIZATION
// ============================================================

function normalizeAnswer(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================
// GROQ API CALL
// ============================================================

async function callGroq(apiKey, payload, timeoutMs) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

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

    const requestId =
      response.headers.get("x-request-id") ||
      response.headers.get("x-groq-request-id") ||
      null;

    const rawText = await response.text();

    let data = null;

    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    // --------------------------------------------------------
    // HTTP ERROR
    // --------------------------------------------------------

    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500;

      return {
        ok: false,
        retryable,
        status: response.status,
        code: `GROQ_HTTP_${response.status}`,
        requestId,
        error:
          data?.error?.message ||
          rawText.slice(0, 1000) ||
          "Groq request failed.",
      };
    }

    // --------------------------------------------------------
    // INVALID JSON
    // --------------------------------------------------------

    if (!data) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code: "INVALID_GROQ_JSON",
        requestId,
      };
    }

    // --------------------------------------------------------
    // EXTRACT CONTENT
    // --------------------------------------------------------

    const content =
      data?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      return {
        ok: false,
        retryable: false,
        status: 502,
        code: "INVALID_GROQ_RESPONSE",
        requestId,
      };
    }

    return {
      ok: true,
      reply: content.trim(),
      requestId,
      status: response.status,
    };
  } catch (error) {
    const aborted =
      error?.name === "AbortError";

    return {
      ok: false,
      retryable: true,
      status: 504,
      code: aborted
        ? "GROQ_TIMEOUT"
        : "GROQ_NETWORK_ERROR",
      requestId: null,
      error:
        error?.message ||
        "Network error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,

    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
