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

  // ==========================================================
  // CLEAN MESSAGES
  // ==========================================================

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
          content = JSON.stringify(message.content);
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
8. एक ही उत्तर में विरोधाभासी बातें मत लिखो।
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
- छोटा उदाहरण यदि उपयोगी हो।
- छोटा निष्कर्ष।
- उत्तर मध्यम लंबाई का हो।
- विश्वविद्यालय स्तर की अनावश्यक advanced detail नहीं।

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
5 MARKS STRICT LEVEL
============================================================

यदि प्रश्न में 5 अंक हैं:

उत्तर को सरल और exam-friendly रखो।

इन advanced terms को केवल तभी इस्तेमाल करो जब प्रश्न विशेष रूप से इनके बारे में पूछे:

ATP
NADPH
Calvin cycle
Photosystem I
Photosystem II
electron transport chain
carbon fixation
proton gradient

यदि प्रश्न केवल "प्रकाश संश्लेषण क्या है?" जैसे सामान्य 5 अंक के प्रश्न का है,
तो इन terms की जरूरत नहीं है।

============================================================
PHOTOSYNTHESIS FACTS
============================================================

प्रकाश संश्लेषण के सामान्य उत्तर में:

- हरे पौधे प्रकाश ऊर्जा का उपयोग करते हैं।
- जल और कार्बन डाइऑक्साइड से भोजन बनता है।
- क्लोरोफिल प्रकाश को अवशोषित करता है।
- प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ी जाती है।
- पौधे दिन और रात दोनों समय श्वसन करते हैं।

यह गलत नहीं लिखना:

"पौधे रात में ऑक्सीजन छोड़ते हैं।"

यदि रात और oxygen का उल्लेख हो तो वैज्ञानिक रूप से सही भाषा रखो।

============================================================
HISTORY
============================================================

- तारीख जाँचो।
- व्यक्ति और घटना का संबंध जाँचो।
- कारण और परिणाम अलग रखो।
- अनुमान को तथ्य की तरह मत लिखो।

============================================================
CHEMISTRY
============================================================

- Formula जाँचो।
- Chemical equation जाँचो।
- Equation balance जाँचो।
- पदार्थ और product सही रखो।

============================================================
PHYSICS
============================================================

- Formula जाँचो।
- Units जाँचो।
- Given values जाँचो।
- Calculation दोबारा करो।

============================================================
MATHEMATICS
============================================================

- Formula सही लगाओ।
- हर calculation जाँचो।
- Final answer दोबारा verify करो।

============================================================
INTERNET SEARCH
============================================================

यदि Internet Search मांगा गया है:
- current information के लिए search उपयोग करो।
- current facts को verify करने की कोशिश करो।
- available sources/citations को बनाए रखो।

============================================================
FINAL RULE
============================================================

उत्तर देने से पहले खुद से जाँचो:

FACT
MARKS
LANGUAGE
RELEVANCE
CONSISTENCY

जरूरत हो तो उत्तर सुधारो।

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
  // MAIN REQUEST
  // ==========================================================

  let result = await callGroq(
    apiKey,
    payload,
    useSearch ? 60000 : 45000
  );

  // ==========================================================
  // MAIN RETRY
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
            "\n\nInternet search अभी उपलब्ध नहीं है। Current जानकारी को verified न मानें।",
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
      result.reply =
        result.reply +
        "\n\n⚠️ Internet search इस समय उपलब्ध नहीं हो सका, इसलिए current जानकारी की स्वतंत्र पुष्टि नहीं हुई है।";
    }
  }

  // ==========================================================
  // MAIN GROQ FAILURE
  // ==========================================================

  if (!result.ok) {
    return json(
      {
        error:
          "अभी जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।",
        code:
          result.code || "GROQ_ERROR",
        requestId:
          result.requestId || null,
      },
      result.status || 502
    );
  }

  // ==========================================================
  // FINAL SELF CHECK
  //
  // IMPORTANT:
  // यह function कभी main answer को fail नहीं करेगा।
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
      answer: deterministicFactCheck(
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
  // ALWAYS RETURN MAIN ANSWER
  // ==========================================================

  return json({
    reply:
      checked?.answer ||
      result.reply,

    selfChecked:
      checked?.selfChecked === true,

    selfCorrected:
      checked?.selfCorrected === true,

    factChecked:
      checked?.factChecked === true,

    finalReviewed:
      checked?.finalReviewed === true,
  });
}


// ============================================================
// FINAL SELF CHECK
// ============================================================

async function finalSelfCheck(
  messages,
  originalAnswer,
  apiKey
) {
  // ----------------------------------------------------------
  // STEP 1
  // Deterministic corrections
  // ----------------------------------------------------------

  let answer = deterministicFactCheck(
    messages,
    originalAnswer
  );

  const firstChanged =
    answer !== originalAnswer;

  // ----------------------------------------------------------
  // STEP 2
  // Detect marks
  // ----------------------------------------------------------

  const question = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");

  const marks = detectMarks(question);

  // ----------------------------------------------------------
  // STEP 3
  // Detect overly advanced 5-mark science answer
  // ----------------------------------------------------------

  if (
    marks === 5 &&
    isPhotosynthesisQuestion(question) &&
    hasAdvancedPhotosynthesisTerms(answer)
  ) {
    const simplified =
      await simplifyPhotosynthesisAnswer(
        question,
        answer,
        apiKey
      );

    if (
      simplified.ok &&
      simplified.reply &&
      simplified.reply.length > 20
    ) {
      answer =
        deterministicFactCheck(
          messages,
          simplified.reply
        );
    }
  }

  // ----------------------------------------------------------
  // STEP 4
  // AI final quality check
  // ----------------------------------------------------------

  const report =
    await runQualityChecker(
      question,
      answer,
      marks,
      apiKey
    );

  // ----------------------------------------------------------
  // If checker fails:
  // RETURN WORKING ANSWER
  // Never fail the whole request.
  // ----------------------------------------------------------

  if (!report.ok) {
    return {
      answer: normalizeAnswer(
        deterministicFactCheck(
          messages,
          answer
        )
      ),

      selfChecked: false,
      selfCorrected:
        firstChanged ||
        answer !== originalAnswer,

      factChecked: firstChanged,
      finalReviewed: false,
    };
  }

  // ----------------------------------------------------------
  // STEP 5
  // Apply checker correction only if safe
  // ----------------------------------------------------------

  let finalAnswer = answer;
  let corrected = false;

  if (
    report.needsCorrection === true &&
    typeof report.correctedAnswer === "string"
  ) {
    const candidate =
      cleanCheckerAnswer(
        report.correctedAnswer
      );

    const tooLarge =
      candidate.length >
      Math.max(
        answer.length * 2.5,
        20000
      );

    if (
      candidate.length >= 20 &&
      !tooLarge
    ) {
      finalAnswer = candidate;
      corrected = true;
    }
  }

  // ----------------------------------------------------------
  // STEP 6
  // Deterministic check AGAIN
  // ----------------------------------------------------------

  finalAnswer =
    deterministicFactCheck(
      messages,
      finalAnswer
    );

  // ----------------------------------------------------------
  // STEP 7
  // Final advanced-term protection
  // ----------------------------------------------------------

  if (
    marks === 5 &&
    isPhotosynthesisQuestion(question) &&
    hasAdvancedPhotosynthesisTerms(finalAnswer)
  ) {
    const simplified =
      await simplifyPhotosynthesisAnswer(
        question,
        finalAnswer,
        apiKey
      );

    if (
      simplified.ok &&
      simplified.reply &&
      simplified.reply.length >= 20
    ) {
      finalAnswer =
        deterministicFactCheck(
          messages,
          simplified.reply
        );

      corrected = true;
    }
  }

  // ----------------------------------------------------------
  // STEP 8
  // Final cleanup
  // ----------------------------------------------------------

  finalAnswer =
    normalizeAnswer(finalAnswer);

  return {
    answer: finalAnswer,

    selfChecked: true,

    selfCorrected:
      firstChanged || corrected,

    factChecked:
      report.factCheckPassed === true ||
      firstChanged,

    finalReviewed:
      report.finalReviewPassed === true,
  };
}


// ============================================================
// MARK DETECTOR
// ============================================================

function detectMarks(question) {
  const text =
    String(question || "").toLowerCase();

  if (
    /12\s*अंक|12\s*marks|12\s*mark/.test(text)
  ) {
    return 12;
  }

  if (
    /10\s*अंक|10\s*marks|10\s*mark/.test(text)
  ) {
    return 10;
  }

  if (
    /5\s*अंक|5\s*marks|5\s*mark/.test(text)
  ) {
    return 5;
  }

  if (
    /2\s*अंक|2\s*marks|2\s*mark/.test(text)
  ) {
    return 2;
  }

  if (
    /1\s*अंक|1\s*mark|1\s*marks/.test(text)
  ) {
    return 1;
  }

  return null;
}


// ============================================================
// PHOTOSYNTHESIS DETECTOR
// ============================================================

function isPhotosynthesisQuestion(question) {
  const text =
    String(question || "").toLowerCase();

  return (
    text.includes("प्रकाश संश्लेषण") ||
    text.includes("photosynthesis")
  );
}


// ============================================================
// ADVANCED PHOTOSYNTHESIS TERM DETECTOR
// ============================================================

function hasAdvancedPhotosynthesisTerms(answer) {
  const text =
    String(answer || "").toLowerCase();

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
    "कैल्विन चक्र",
  ];

  return terms.some((term) =>
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
तुम परीक्षा के लिए उत्तर सुधारने वाले संपादक हो।

प्रश्न:
${question}

मौजूदा उत्तर:
${answer}

यह सामान्य 5 अंक का प्रश्न है।

काम:
- उत्तर को सरल हिंदी में दोबारा लिखो।
- परिभाषा रखो।
- लगभग 4–6 मुख्य बिंदु रखो।
- जरूरत हो तो छोटा उदाहरण दो।
- छोटा निष्कर्ष दो।
- ATP, NADPH, Calvin cycle, Photosystem जैसी advanced terminology हटाओ।
- कोई गलत वैज्ञानिक तथ्य मत रखो।
- "रात में पौधे ऑक्सीजन छोड़ते हैं" मत लिखो।
- उत्तर exam-ready और मध्यम लंबाई का हो।
- केवल पूरा अंतिम उत्तर दो।
`;

  const payload = {
    model: "openai/gpt-oss-120b",

    messages: [
      {
        role: "system",
        content: prompt,
      },
    ],

    max_completion_tokens: 1800,
    temperature: 0.1,
    reasoning_effort: "low",
    stream: false,
  };

  return callGroq(
    apiKey,
    payload,
    15000
  );
}


// ============================================================
// AI QUALITY CHECKER
// ============================================================

async function runQualityChecker(
  question,
  answer,
  marks,
  apiKey
) {
  const prompt = `
तुम Sarathi AI Final Quality Checker हो।

प्रश्न:
${question}

अंक:
${marks || "अज्ञात"}

उत्तर:
${answer}

उत्तर को इन चीजों पर जाँचो:

1. तथ्य सही हैं?
2. प्रश्न का उत्तर दिया गया है?
3. marks के अनुसार लंबाई सही है?
4. भाषा और grammar सही है?
5. कोई contradiction है?
6. कोई unnecessary advanced information है?
7. Science में कोई गलत तथ्य है?

यदि उत्तर सही है:
needs_correction = false

यदि सुधार जरूरी है:
needs_correction = true
और corrected_answer में पूरा सुधरा हुआ उत्तर दो।

यदि marks = 5 और सामान्य प्रकाश संश्लेषण का प्रश्न है:
ATP, NADPH, Calvin cycle, Photosystem जैसी advanced जानकारी सामान्यतः नहीं होनी चाहिए।

केवल यह JSON दो:

{
  "needs_correction": false,
  "issues": [],
  "corrected_answer": "",
  "fact_check_passed": true,
  "final_review_passed": true
}
`;

  const payload = {
    model: "openai/gpt-oss-120b",

    messages: [
      {
        role: "system",
        content: prompt,
      },
    ],

    max_completion_tokens: 2500,
    temperature: 0,
    reasoning_effort: "low",
    stream: false,
  };

  let result =
    await callGroq(
      apiKey,
      payload,
      12000
    );

  if (
    !result.ok &&
    result.retryable
  ) {
    await sleep(400);

    result =
      await callGroq(
        apiKey,
        payload,
        12000
      );
  }

  if (!result.ok) {
    return {
      ok: false,
    };
  }

  const parsed =
    parseCheckerJSON(result.reply);

  if (!parsed) {
    return {
      ok: false,
    };
  }

  return {
    ok: true,

    needsCorrection:
      parsed.needs_correction === true,

    correctedAnswer:
      typeof parsed.corrected_answer === "string"
        ? parsed.corrected_answer
        : "",

    factCheckPassed:
      parsed.fact_check_passed === true,

    finalReviewPassed:
      parsed.final_review_passed === true,
  };
}


// ============================================================
// SAFE JSON PARSER
// ============================================================

function parseCheckerJSON(text) {
  if (!text) return null;

  let clean =
    String(text).trim();

  // Remove markdown code fences
  clean = clean
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    // Try extracting the first JSON object
    const start =
      clean.indexOf("{");

    const end =
      clean.lastIndexOf("}");

    if (
      start >= 0 &&
      end > start
    ) {
      try {
        return JSON.parse(
          clean.slice(start, end + 1)
        );
      } catch {
        return null;
      }
    }
  }

  return null;
}


// ============================================================
// CLEAN CHECKER ANSWER
// ============================================================

function cleanCheckerAnswer(text) {
  return String(text || "")
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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
        (m) => m.role === "user"
      )
      .map(
        (m) => m.content
      )
      .join("\n")
      .toLowerCase();

  // ==========================================================
  // PHOTOSYNTHESIS
  // ==========================================================

  if (
    question.includes("प्रकाश संश्लेषण") ||
    question.includes("photosynthesis")
  ) {
    // --------------------------------------------------------
    // Wrong affirmative night-oxygen claims
    // --------------------------------------------------------

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

    for (const pattern of badPatterns) {
      text = text.replace(
        pattern,
        (match) => {
          if (
            /नहीं/.test(match) ||
            /नही/.test(match)
          ) {
            return match;
          }

          return "प्रकाश संश्लेषण के दौरान पौधे ऑक्सीजन वातावरण में छोड़ते हैं";
        }
      );
    }

    // --------------------------------------------------------
    // Common grammar mistakes
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
    // Incorrect night respiration sentence
    // --------------------------------------------------------

    text = text.replace(
      /रात में श्वसन के लिए ऑक्सीजन छोड़ता है/g,
      "प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ता है"
    );

    text = text.replace(
      /रात में श्वसन के लिए ऑक्सीजन छोड़ती है/g,
      "प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ती है"
    );

    text = text.replace(
      /रात में श्वसन के लिए ऑक्सीजन छोड़ते हैं/g,
      "प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ते हैं"
    );

    // --------------------------------------------------------
    // Wrong "only at night respiration"
    // --------------------------------------------------------

    text = text.replace(
      /पौधे केवल रात में श्वसन करते हैं/g,
      "पौधे दिन और रात दोनों समय श्वसन करते हैं"
    );

    text = text.replace(
      /पौधे सिर्फ रात में श्वसन करते हैं/g,
      "पौधे दिन और रात दोनों समय श्वसन करते हैं"
    );
  }

  return normalizeAnswer(text);
}


// ============================================================
// NORMALIZE
// ============================================================

function normalizeAnswer(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
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
      () => controller.abort(),
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
            JSON.stringify(payload),

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

    // --------------------------------------------------------
    // HTTP ERROR
    // --------------------------------------------------------

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
          raw.slice(0, 1000),
      };
    }

    if (!data) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code: "INVALID_GROQ_JSON",
        requestId,
      };
    }

    const content =
      data?.choices?.[0]?.message?.content;

    if (
      typeof content !== "string"
    ) {
      return {
        ok: false,
        retryable: false,
        status: 502,
        code:
          "INVALID_GROQ_RESPONSE",
        requestId,
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
        error?.name === "AbortError"
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      requestId: null,

      error:
        error?.message ||
        "Network error",
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
    (resolve) =>
      setTimeout(resolve, ms)
  );
}


// ============================================================
// CORS HEADERS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
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
