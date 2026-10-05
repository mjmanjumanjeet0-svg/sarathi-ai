export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // =========================================================
    // CHAT API
    // =========================================================

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

    // =========================================================
    // WEBSITE FILES
    // =========================================================

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

// =============================================================
// MAIN CHAT
// =============================================================

async function handleChat(request, env) {
  try {
    // =========================================================
    // API KEY CHECK
    // =========================================================

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

    // =========================================================
    // READ REQUEST
    // =========================================================

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

    // =========================================================
    // CLEAN MESSAGES
    // =========================================================

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

    // =========================================================
    // SYSTEM PROMPT
    // =========================================================

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
11. यदि किसी तथ्य को लेकर निश्चितता नहीं है तो उसे तथ्य की तरह मत गढ़ो।
12. उदाहरण देते समय उदाहरण का तथ्य भी सही रखो।

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
- 2–3 पंक्ति की भूमिका या परिभाषा।
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

सही जानकारी होने का मतलब यह नहीं है कि
हर technical जानकारी उत्तर में डालना जरूरी है।

यदि technical जानकारी प्रश्न का उत्तर देने के लिए
आवश्यक नहीं है तो उसे छोड़ दो।

==================================================
PHOTOSYNTHESIS
==================================================

यदि सामान्य प्रश्न हो:

"प्रकाश संश्लेषण क्या है?"

तो उत्तर आसान school/college level पर रखो।

सामान्य 5 अंक के उत्तर में इन technical terms को
अनावश्यक रूप से मत जोड़ो:

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
biochemical pathway
molecular mechanism
प्रकाश अभिक्रिया
अंधकार अभिक्रिया

सामान्य उत्तर में यह पर्याप्त है:

- सूर्य का प्रकाश
- क्लोरोफिल
- जल
- कार्बन डाइऑक्साइड
- भोजन/ग्लूकोज़ का निर्माण
- ऑक्सीजन का वातावरण में निकलना

==================================================
IMPORTANT PHOTOSYNTHESIS FACT
==================================================

प्रकाश संश्लेषण के बारे में यह गलती मत करना:

"पौधा रात में प्रकाश संश्लेषण करके ऑक्सीजन छोड़ता है।"

यह सामान्य उत्तर में गलत है।

प्रकाश संश्लेषण के दौरान ऑक्सीजन का उत्पादन होता है
और पौधे वातावरण में ऑक्सीजन छोड़ते हैं।

श्वसन अलग प्रक्रिया है और पौधों में दिन-रात होता है।

इसलिए किसी सामान्य उदाहरण में:

"रात में श्वसन के लिए ऑक्सीजन छोड़ता है"

जैसा वाक्य मत लिखो।

==================================================
HISTORY
==================================================

यदि केवल कारण पूछे जाएँ,
तो घटनाओं और परिणामों को कारण मत बनाओ।

फ्रांसीसी क्रांति के कारणों के उदाहरण:

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

यदि web search चालू है:

- current जानकारी के लिए search करो।
- आज/latest/current जैसी जानकारी में ताजा स्रोतों को प्राथमिकता दो।
- नकली citation मत बनाओ।
- search उपलब्ध न हो तो current information को verified current fact मत बताओ।

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
8. कोई उदाहरण गलत तो नहीं?
9. कोई बात दोहराई तो नहीं?
10. उत्तर परीक्षा में सीधे लिखा जा सकता है?
11. भाषा आसान है?

यदि समस्या मिले,
तो उत्तर भेजने से पहले उसे सुधारो।
`;

    // =========================================================
    // MAIN GROQ PAYLOAD
    // =========================================================

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

    // =========================================================
    // BROWSER SEARCH
    // =========================================================

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search",
        },
      ];

      payload.tool_choice = "required";
    }

    // =========================================================
    // MAIN REQUEST
    // =========================================================

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      useSearch ? 60000 : 45000
    );

    // =========================================================
    // MAIN RETRY
    // =========================================================

    if (!result.ok && result.retryable) {
      await sleep(1000);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        useSearch ? 60000 : 45000
      );
    }

    // =========================================================
    // SEARCH FALLBACK
    // =========================================================

    if (!result.ok && useSearch) {
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
        45000
      );

      if (!fallback.ok && fallback.retryable) {
        await sleep(1000);

        fallback = await callGroq(
          fallbackPayload,
          env.GROQ_API_KEY,
          45000
        );
      }

      if (fallback.ok && fallback.reply) {
        const checked =
          await selfCheckAndCorrect(
            messages,
            fallback.reply,
            env.GROQ_API_KEY
          );

        return json({
          reply: checked.reply,
          searchUnavailable: true,
          selfChecked: checked.selfChecked,
          selfCorrected: checked.selfCorrected,
          factChecked: checked.factChecked,
        });
      }
    }

    // =========================================================
    // MAIN ERROR
    // =========================================================

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

    // =========================================================
    // EMPTY MAIN ANSWER
    // =========================================================

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

    // =========================================================
    // FACT CHECK + SELF CHECK
    // =========================================================

    const checked =
      await selfCheckAndCorrect(
        messages,
        result.reply,
        env.GROQ_API_KEY
      );

    return json({
      reply: checked.reply,
      selfChecked: checked.selfChecked,
      selfCorrected: checked.selfCorrected,
      factChecked: checked.factChecked,
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

// =============================================================
// DETERMINISTIC FACT CHECK
// =============================================================
//
// यह हिस्सा AI पर निर्भर नहीं है।
// कुछ स्पष्ट और ज्ञात factual patterns को सीधे पकड़ता है.
//
// =============================================================

function deterministicFactCheck(
  messages,
  answer
) {
  const userText = messages
    .filter(
      (message) =>
        message.role === "user"
    )
    .map(
      (message) =>
        message.content
    )
    .join("\n")
    .toLowerCase();

  let corrected = answer;
  const issues = [];

  const isPhotosynthesisQuestion =
    userText.includes("प्रकाश संश्लेषण") ||
    userText.includes("photosynthesis");

  // =========================================================
  // PHOTOSYNTHESIS FIX 1
  // =========================================================

  if (isPhotosynthesisQuestion) {
    const badNightPatterns = [
      /रात में[^।\n]{0,120}ऑक्सीजन छोड़/,
      /रात को[^।\n]{0,120}ऑक्सीजन छोड़/,
      /रात्रि में[^।\n]{0,120}ऑक्सीजन छोड़/,
      /रात में[^।\n]{0,120}oxygen छोड़/,
      /at night[^.\n]{0,120}release oxygen/i,
      /night[^.\n]{0,120}releases oxygen/i,
    ];

    for (const pattern of badNightPatterns) {
      if (pattern.test(corrected)) {
        corrected = corrected.replace(
          pattern,
          "श्वसन के दौरान पौधे ऑक्सीजन का उपयोग करते हैं"
        );

        issues.push(
          "रात में ऑक्सीजन छोड़ने वाली गलत बात सुधारी गई।"
        );

        break;
      }
    }
  }

  // =========================================================
  // PHOTOSYNTHESIS FIX 2
  // =========================================================

  if (isPhotosynthesisQuestion) {
    const wrongGroundPhrase =
      /जमीनी से/g;

    if (wrongGroundPhrase.test(corrected)) {
      corrected = corrected.replace(
        wrongGroundPhrase,
        "जमीन से"
      );

      issues.push(
        "जमीनी से → जमीन से सुधारा गया।"
      );
    }
  }

  // =========================================================
  // PHOTOSYNTHESIS FIX 3
  // =========================================================

  if (isPhotosynthesisQuestion) {
    const wrongRootPhrase =
      /जड़ों द्वारा जमीनी/g;

    if (wrongRootPhrase.test(corrected)) {
      corrected = corrected.replace(
        wrongRootPhrase,
        "जड़ों द्वारा जमीन"
      );

      issues.push(
        "जल के स्रोत से जुड़ी भाषा सुधारी गई।"
      );
    }
  }

  // =========================================================
  // REMOVE OBVIOUSLY WRONG NIGHT CLAIMS
  // =========================================================

  if (isPhotosynthesisQuestion) {
    const replacements = [
      {
        pattern:
          /और रात में श्वसन के लिए ऑक्सीजन छोड़ता है/gi,
        replacement:
          "और प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ता है",
      },
      {
        pattern:
          /और रात में श्वसन के लिए ऑक्सीजन छोड़ती है/gi,
        replacement:
          "और प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ती है",
      },
      {
        pattern:
          /रात में श्वसन के लिए ऑक्सीजन छोड़ता है/gi,
        replacement:
          "प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ता है",
      },
      {
        pattern:
          /रात में श्वसन के लिए ऑक्सीजन छोड़ती है/gi,
        replacement:
          "प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में छोड़ती है",
      },
    ];

    for (const item of replacements) {
      if (item.pattern.test(corrected)) {
        corrected = corrected.replace(
          item.pattern,
          item.replacement
        );

        issues.push(
          "प्रकाश संश्लेषण और श्वसन से जुड़ा factual error सुधारा गया।"
        );
      }
    }
  }

  // =========================================================
  // NORMALIZE EXCESSIVE SPACES
  // =========================================================

  corrected = corrected
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();

  return {
    answer: corrected,
    changed:
      corrected !== answer,
    issues,
  };
}

// =============================================================
// SELF CHECK + SELF CORRECTION
// =============================================================

async function selfCheckAndCorrect(
  messages,
  answer,
  apiKey
) {
  try {
    // ========================================================
    // FIRST: DETERMINISTIC FACT CHECK
    // ========================================================

    const factResult =
      deterministicFactCheck(
        messages,
        answer
      );

    let workingAnswer =
      factResult.answer;

    const factChanged =
      factResult.changed;

    // ========================================================
    // AI CHECKER PROMPT
    // ========================================================

    const checkerPrompt = `
तुम "सारथी AI Quality Checker" हो।

तुम्हें user का प्रश्न और AI का उत्तर दिया जाएगा।

उत्तर को सख्ती से जाँचो और जरूरत होने पर
पूरा corrected answer दो।

==================================================
PRIMARY GOAL
==================================================

उत्तर:

- factual रूप से सही हो
- प्रश्न के अनुसार हो
- marks के अनुसार हो
- आसान भाषा में हो
- परीक्षा में सीधे लिखा जा सके
- अनावश्यक technical detail से मुक्त हो

==================================================
MARKS CHECK
==================================================

1 अंक:
- बहुत छोटा सीधा उत्तर।

2 अंक:
- छोटी परिभाषा।
- 1–2 मुख्य बातें।

5 अंक:
- 2–3 पंक्ति की भूमिका/परिभाषा।
- लगभग 4–6 मुख्य बिंदु।
- जरूरत हो तो छोटा उदाहरण।
- छोटा निष्कर्ष।
- आसान भाषा।

10/12 अंक:
- पर्याप्त विस्तार।
- headings और मुख्य बिंदु।
- आवश्यक व्याख्या।
- उदाहरण।
- निष्कर्ष।

==================================================
FACTUAL ACCURACY
==================================================

हर महत्वपूर्ण factual statement जाँचो।

यदि कोई बात गलत है,
तो उसे सुधारो।

यदि कोई बात संदिग्ध है और
बिना verification के निश्चित रूप से नहीं कही जा सकती,
तो उसे तथ्य की तरह प्रस्तुत मत करो।

==================================================
PHOTOSYNTHESIS
==================================================

यदि प्रश्न प्रकाश संश्लेषण से संबंधित है:

सामान्य 5 अंक के उत्तर में
अनावश्यक रूप से यह terms मत रखो:

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
biochemical pathway
molecular mechanism
प्रकाश अभिक्रिया
अंधकार अभिक्रिया

लेकिन सबसे महत्वपूर्ण:

"रात में श्वसन के लिए ऑक्सीजन छोड़ता है"

जैसा कथन गलत है।

श्वसन और प्रकाश संश्लेषण को आपस में मत मिलाओ।

प्रकाश संश्लेषण के दौरान ऑक्सीजन वातावरण में
छोड़ी जाती है।

पौधों में श्वसन दिन और रात दोनों होता है।

==================================================
EXAMPLE CHECK
==================================================

यदि उत्तर में उदाहरण दिया गया है,
तो उदाहरण की factual correctness भी जाँचो।

गलत उदाहरण को सुधारो या हटा दो।

==================================================
HISTORY
==================================================

कारण और घटना अलग रखो।

यदि "कारण" पूछे गए हैं,
तो केवल घटना को कारण मत बनाओ।

==================================================
CHEMISTRY
==================================================

परमाणु, अणु, आयन, तत्व और यौगिक
को आपस में मत मिलाओ।

NaCl को सामान्यतः ionic compound की
formula unit बताओ, molecule नहीं।

==================================================
PHYSICS
==================================================

अनावश्यक advanced mathematics मत जोड़ो।

Numerical:

दिया गया
→ सूत्र
→ मान रखना
→ calculation
→ अंतिम उत्तर

==================================================
MATHEMATICS
==================================================

Calculation दोबारा जाँचो।

जरूरी steps दिखाओ।

==================================================
FINAL QUALITY TEST
==================================================

जाँचो:

1. प्रश्न सही समझा?
2. विषय सही है?
3. marks सही हैं?
4. factual error है?
5. example सही है?
6. अनावश्यक technical detail है?
7. advanced mechanism है?
8. repetition है?
9. भाषा आसान है?
10. क्या उत्तर परीक्षा में सीधे लिखा जा सकता है?

यदि कोई समस्या है,
तो corrected_answer में पूरा सुधरा हुआ उत्तर दो।

यदि कोई समस्या नहीं है,
तो corrected_answer में वही उत्तर दो।

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

${workingAnswer}

AUTOMATIC FACT CHECK NOTES:

${
  factResult.issues.length > 0
    ? factResult.issues.join("\n")
    : "कोई deterministic fact issue नहीं मिला।"
}
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
      12000
    );

    // ========================================================
    // CHECKER RETRY
    // ========================================================

    if (!check.ok && check.retryable) {
      await sleep(500);

      check = await callGroq(
        checkerPayload,
        apiKey,
        12000
      );
    }

    // ========================================================
    // CHECKER FAILED
    //
    // IMPORTANT:
    // Deterministic fact correction is still preserved.
    // ========================================================

    if (!check.ok || !check.raw) {
      return {
        reply: workingAnswer,
        selfChecked: false,
        selfCorrected: factChanged,
        factChecked: true,
      };
    }

    // ========================================================
    // PARSE CHECKER JSON
    // ========================================================

    let report;

    try {
      report = JSON.parse(check.raw);
    } catch {
      return {
        reply: workingAnswer,
        selfChecked: false,
        selfCorrected: factChanged,
        factChecked: true,
      };
    }

    // ========================================================
    // VALIDATE CHECKER RESULT
    // ========================================================

    if (
      typeof report?.needs_correction !==
      "boolean"
    ) {
      return {
        reply: workingAnswer,
        selfChecked: false,
        selfCorrected: factChanged,
        factChecked: true,
      };
    }

    // ========================================================
    // GET AI CORRECTED ANSWER
    // ========================================================

    const corrected =
      typeof report.corrected_answer ===
      "string"
        ? report.corrected_answer.trim()
        : "";

    // ========================================================
    // IF AI CHECKER HAS NO USABLE CORRECTION
    // ========================================================

    if (!corrected) {
      return {
        reply: workingAnswer,
        selfChecked: true,
        selfCorrected: factChanged,
        factChecked: true,
      };
    }

    // ========================================================
    // PREVENT EMPTY / HUGE / UNREALISTIC REWRITE
    // ========================================================

    const maximumAllowed =
      Math.max(
        workingAnswer.length * 2.5,
        20000
      );

    if (
      corrected.length >
      maximumAllowed
    ) {
      return {
        reply: workingAnswer,
        selfChecked: true,
        selfCorrected: factChanged,
        factChecked: true,
      };
    }

    // ========================================================
    // AI CHECKER RESULT
    //
    // Even if checker says no correction,
    // deterministic fact correction is preserved.
    // ========================================================

    if (!report.needs_correction) {
      return {
        reply: workingAnswer,
        selfChecked: true,
        selfCorrected: factChanged,
        factChecked: true,
      };
    }

    // ========================================================
    // FINAL ANSWER
    // ========================================================

    return {
      reply: corrected,
      selfChecked: true,
      selfCorrected:
        factChanged || true,
      factChecked: true,
    };
  } catch {
    // ========================================================
    // EMERGENCY FALLBACK
    // ========================================================

    const factResult =
      deterministicFactCheck(
        messages,
        answer
      );

    return {
      reply: factResult.answer,
      selfChecked: false,
      selfCorrected:
        factResult.changed,
      factChecked: true,
    };
  }
}

// =============================================================
// GROQ API
// =============================================================

async function callGroq(
  payload,
  apiKey,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

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

    // ========================================================
    // API ERROR
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
    // READ CHOICE
    // ========================================================

    const choice =
      Array.isArray(data?.choices)
        ? data.choices[0]
        : null;

    const content =
      typeof choice?.message?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    // ========================================================
    // STRUCTURED OUTPUT
    // ========================================================

    if (payload.response_format) {
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
    // NORMAL EMPTY RESPONSE
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

// =============================================================
// SLEEP
// =============================================================

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// =============================================================
// CORS
// =============================================================

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

// =============================================================
// JSON RESPONSE
// =============================================================

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
