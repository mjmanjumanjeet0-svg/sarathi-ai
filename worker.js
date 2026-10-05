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
    // CLOUDFLARE ASSETS
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
// CHAT
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

    // केवल जरूरी conversation रखो
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

    const latestUserMessage =
      [...messages]
        .reverse()
        .find(
          (m) => m.role === "user"
        )?.content || "";

    // ========================================================
    // CURRENT INDIA DATE
    // ========================================================

    const todayIndia =
      getIndiaDate();

    const todayIndiaReadable =
      getIndiaReadableDate();

    const currentSensitive =
      isCurrentInformationQuestion(
        latestUserMessage
      );

    // ========================================================
    // SYSTEM PROMPT
    // ========================================================

    const systemPrompt = `
तुम "सारथी AI" हो।

तुम्हारा उद्देश्य:
सही, स्पष्ट, प्राकृतिक, भरोसेमंद और उपयोगी उत्तर देना।

==================================================
आज की तारीख
==================================================

भारत में आज की वास्तविक तारीख:

${todayIndiaReadable}

ISO तारीख:
${todayIndia}

यह तारीख Worker द्वारा Asia/Kolkata timezone से निकाली गई है।

बहुत महत्वपूर्ण:
यदि user "आज", "अभी", "ताजा", "ताज़ा",
"current", "latest", "today", "now", "live"
जैसे शब्द इस्तेमाल करता है तो पुरानी जानकारी को
आज की जानकारी बताना सख्त मना है।

यदि Search Result की तारीख ${todayIndia}
से पुरानी है:

- उसे "आज का" मत बताओ।
- उसे current result मत बताओ।
- यदि ताजा source उपलब्ध हो तो उसे प्राथमिकता दो।
- यदि केवल पुराना source मिला है तो साफ बताओ कि
  source पुराना है।
- कोई अनुमान लगाकर current price/date मत बनाओ।

==================================================
सामान्य नियम
==================================================

1. मुख्य उत्तर हिंदी में दो।
2. भाषा आसान और प्राकृतिक रखो।
3. जरूरी अंग्रेजी शब्द हो तो अर्थ समझाओ।
4. तथ्य मत गढ़ो।
5. नकली source/citation/date/number मत बनाओ।
6. प्रश्न से बाहर मत जाओ।
7. एक बात बार-बार मत दोहराओ।
8. यदि जानकारी निश्चित नहीं है तो उसे निश्चित तथ्य मत बताओ।
9. current जानकारी में date को ध्यान से जाँचो।
10. Search result पुराना हो तो उसे आज का मत बताओ।

==================================================
INTERNET SEARCH
==================================================

यदि इंटरनेट खोज चालू है:

- current/latest/today/now/live प्रश्नों के लिए
  browser search का उपयोग करो।
- आज की तारीख ${todayIndiaReadable} है।
- ताजा और आज की तारीख वाले स्रोतों को प्राथमिकता दो।
- पुराने स्रोत को आज की जानकारी मत बताओ।
- Search result में date हो तो date पढ़ो।
- अगर source की date आज की तारीख से मेल नहीं खाती,
  तो उसे current source मत बताओ।
- नकली source मत बनाओ।
- search से मिला पुराना data देखकर आज का अनुमान मत लगाओ।

विशेष उदाहरण:

यदि user पूछता है:
"आज भारत में सोने का भाव क्या है?"

तो पहले आज की तारीख पहचानो:
${todayIndiaReadable}

फिर आज के gold price को खोजो।

यदि Search Result कहता है:
"5 May 2026"

और आज:
${todayIndiaReadable}

है, तो May वाला result आज का भाव नहीं है।

उसे आज का भाव लिखना गलत है।

यदि आज का verified result नहीं मिलता,
तो साफ बताओ कि मिला हुआ source पुराना है।
गलत current price मत बनाओ।

==================================================
STUDY CENTER: MARKS CONTROL
==================================================

यदि 2 अंक:

- छोटी परिभाषा
- 1–2 मुख्य बातें
- अनावश्यक विस्तार नहीं

यदि 5 अंक:

- 2–3 पंक्ति भूमिका
- 4–6 मुख्य बिंदु
- जरूरत हो तो उदाहरण
- छोटा निष्कर्ष

यदि 10 अंक:

- भूमिका
- headings
- 5–7 मुख्य बिंदु
- आवश्यक उदाहरण
- निष्कर्ष

यदि 12 अंक:

- भूमिका
- स्पष्ट headings
- 6–8 मुख्य बिंदु
- पर्याप्त व्याख्या
- उदाहरण
- निष्कर्ष

यदि marks नहीं दिए गए:
प्रश्न के अनुसार सामान्य संतुलित उत्तर दो।

==================================================
STRICT COMPLEXITY RULE
==================================================

सामान्य 5 अंक के प्रश्न को unnecessarily advanced मत बनाओ।

प्रकाश संश्लेषण के सामान्य प्रश्न में
इन terms को अपने आप मत जोड़ो:

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

जब तक user इन्हें विशेष रूप से न पूछे।

==================================================
BIOLOGY
==================================================

प्रकाश संश्लेषण:

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
5. निरंकुश राजतंत्र और राजनीतिक प्रतिनिधित्व की समस्या
6. प्रबोधन के विचार

यदि केवल कारण पूछे गए हैं तो
घटनाओं और परिणामों को कारण बनाकर मत लिखो।

==================================================
CHEMISTRY
==================================================

परमाणु, अणु, आयन, तत्व और यौगिक को आपस में मत मिलाओ।

NaCl को सामान्यतः आयनिक यौगिक की
formula unit बताओ, molecule नहीं।

==================================================
PHYSICS
==================================================

न्यूटन का प्रथम नियम:

यदि किसी वस्तु पर कुल बाहरी बल शून्य है,
तो विराम की वस्तु विराम में रहती है और
गतिशील वस्तु समान वेग से सीधी रेखा में
चलती रहती है, जब तक कोई बाहरी असंतुलित
बल उसकी अवस्था न बदले।

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

सभी जरूरी steps दिखाओ।

अंतिम उत्तर स्पष्ट लिखो।

जहाँ संभव हो calculation की जाँच करो।

==================================================
FINAL CHECK
==================================================

उत्तर भेजने से पहले जाँचो:

1. क्या प्रश्न सही समझा?
2. क्या विषय सही है?
3. क्या marks के अनुसार उत्तर है?
4. क्या उत्तर जरूरत से ज्यादा technical है?
5. क्या factual error है?
6. क्या कोई मनगढ़ंत date है?
7. क्या current information की तारीख सही है?
8. क्या पुराना search result आज का बताया जा रहा है?
9. क्या source की तारीख और आज की तारीख अलग है?
10. क्या उत्तर सीधे उपयोग किया जा सकता है?

यदि गलती मिले तो भेजने से पहले सुधारो।
`;

    // ========================================================
    // PAYLOAD
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
        currentSensitive
          ? 2500
          : 4096,

      temperature: 0.2,

      reasoning_effort: "low",

      stream: false,
    };

    // ========================================================
    // SEARCH TOOL
    // ========================================================

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search",
        },
      ];

      payload.tool_choice =
        "required";
    }

    // ========================================================
    // FIRST GROQ REQUEST
    // ========================================================

    let result =
      await callGroq(
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

      result =
        await callGroq(
          payload,
          env.GROQ_API_KEY,
          55000
        );
    }

    // ========================================================
    // SEARCH FAILED
    // ========================================================

    if (
      !result.ok &&
      useSearch
    ) {
      const fallbackPayload = {
        model:
          "openai/gpt-oss-120b",

        messages: [
          {
            role: "system",
            content:
              systemPrompt +
              `

महत्वपूर्ण:
इस request में internet search सफल नहीं हुई।

इसलिए current/latest/today जानकारी को
verified current fact की तरह मत बताओ।

यदि user current price/date पूछ रहा है,
तो बिना verification कोई संख्या मत बनाओ।
`,
          },

          ...messages,
        ],

        max_completion_tokens:
          currentSensitive
            ? 2000
            : 3500,

        temperature: 0.2,

        reasoning_effort: "low",

        stream: false,
      };

      let fallback =
        await callGroq(
          fallbackPayload,
          env.GROQ_API_KEY,
          55000
        );

      if (
        !fallback.ok &&
        fallback.retryable
      ) {
        await sleep(1200);

        fallback =
          await callGroq(
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
            env.GROQ_API_KEY,
            todayIndiaReadable
          );

        return json({
          reply: checked.reply,
          answer: checked.reply,
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
            result.requestId ||
            null,
        },
        result.status || 502
      );
    }

    // ========================================================
    // EMPTY ANSWER
    // ========================================================

    if (!result.reply) {
      return json(
        {
          error:
            "Groq ने खाली उत्तर लौटाया। कृपया फिर कोशिश करें।",
          code:
            "EMPTY_GROQ_RESPONSE",
          requestId:
            result.requestId ||
            null,
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

    return json({
      reply: checked.reply,
      answer: checked.reply,
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
            "GROQ_API_KEY Cloudflare Secret में configured नहीं है।",
          code:
            "MISSING_API_KEY",
        },
        500
      );
    }

    let body;

    try {
      body =
        await request.json();
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

    const imageData =
      body?.imageData ||
      body?.image ||
      "";

    const question =
      String(
        body?.question ||
        "इस तस्वीर को समझाकर बताओ।"
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
तुम "सारथी AI" के image assistant हो।

User का सवाल:

${question}

तस्वीर को ध्यान से देखकर उत्तर दो।

नियम:

1. जो तस्वीर में स्पष्ट है वही बताओ।
2. तस्वीर में दिखाई न देने वाली चीज को निश्चित मत बताओ।
3. यदि image में text है तो उसे पढ़ने की कोशिश करो।
4. यदि यह पढ़ाई का प्रश्न है तो आसान हिंदी में समझाओ।
5. यदि user ने किसी प्रश्न का उत्तर पूछा है तो सीधे उत्तर दो।
6. यदि image अस्पष्ट है तो साफ बताओ कि image स्पष्ट नहीं है।
7. medical/legal/current factual claims में अनुमान को fact मत बनाओ।
8. मुख्य उत्तर हिंदी में दो।
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

    if (!result.reply) {
      return json(
        {
          error:
            "Image AI ने खाली उत्तर दिया।",
          code:
            "EMPTY_VISION_RESPONSE",
        },
        502
      );
    }

    return json({
      reply:
        result.reply,

      answer:
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

User का प्रश्न और AI का उत्तर जाँचो।

आज भारत की तारीख:
${todayIndiaReadable}

बहुत महत्वपूर्ण:

यदि उत्तर में "आज", "today", "current",
"latest", "अभी", "ताजा", "ताज़ा" कहा गया है,
तो date consistency जाँचो।

यदि उत्तर में कोई पुरानी date है
और उसे आज की जानकारी की तरह प्रस्तुत किया गया है,
तो उसे correction की जरूरत है।

पुरानी date को current date मत बनाओ।

यदि current जानकारी verified नहीं है,
तो गलत संख्या या date मत बनाओ।

==================================================
STUDY CHECK
==================================================

2 marks:
छोटा और सीधा।

5 marks:
भूमिका + 4–6 मुख्य बातें + निष्कर्ष।

10 marks:
भूमिका + headings + 5–7 points + conclusion।

12 marks:
भूमिका + headings + 6–8 points + conclusion।

==================================================
COMPLEXITY
==================================================

सामान्य प्रश्न को unnecessarily advanced मत बनाओ।

प्रकाश संश्लेषण के सामान्य उत्तर में
बिना जरूरत:

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

मत जोड़ो।

==================================================
CORRECTION
==================================================

यदि उत्तर सही है:
needs_correction = false

यदि गलती है:
needs_correction = true

और corrected_answer में पूरा सही उत्तर दो।

केवल "सही है" मत लिखो।

Facts मत गढ़ो।
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
        2500,

      temperature:
        0,

      reasoning_effort:
        "low",

      stream:
        false,

      response_format: {
        type:
          "json_schema",

        json_schema: {
          name:
            "sarathi_quality_check",

          strict:
            true,

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
        JSON.parse(
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

    // बहुत बड़ा अनावश्यक correction रोकना
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
      reply:
        corrected,

      selfChecked:
        true,

      selfCorrected:
        true,
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
            JSON.stringify(
              payload
            ),

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

        error:
          message,

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
      typeof choice?.message?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    // Self-check JSON
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
        raw:
          content,
        requestId,
      };
    }

    if (!content) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code:
          "EMPTY_RESPONSE",
        error:
          "Groq response आया लेकिन text answer नहीं था।",
        requestId,
        raw: null,
      };
    }

    return {
      ok: true,
      reply:
        content,
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

      status:
        504,

      code:
        isTimeout
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      error:
        isTimeout
          ? "Groq से जवाब आने में बहुत समय लगा।"
          : `Groq connection error: ${message}`,

      requestId:
        null,

      raw:
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
// CURRENT INFORMATION DETECTOR
// ============================================================

function isCurrentInformationQuestion(
  text
) {
  const q =
    String(text || "")
      .toLowerCase();

  const currentWords =
    [
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

  const currentDomainWords =
    [
      "सोना",
      "gold",
      "भाव",
      "कीमत",
      "price",
      "rate",
      "मौसम",
      "weather",
      "समाचार",
      "news",
      "result",
      "रेट",
    ];

  const hasCurrent =
    currentWords.some(
      (word) =>
        q.includes(word)
    );

  const hasDomain =
    currentDomainWords.some(
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
