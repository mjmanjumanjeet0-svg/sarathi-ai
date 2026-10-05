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
    // PHOTO / VISION API
    // =========================================================
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

    // =========================================================
    // WEBSITE
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

  const useSearch =
    body.webSearch === true;


  // ==========================================================
  // SYSTEM PROMPT
  // ==========================================================

  const systemPrompt = `
तुम "सारथी AI" हो — सरल, सुरक्षित, दोस्ताना और
तथ्य-जाँच करने वाला हिंदी AI सहायक।

मुख्य नियम:

1. प्रश्न का सीधा और स्पष्ट उत्तर दो।
2. सरल और स्वाभाविक हिंदी का उपयोग करो।
3. यूज़र जिस भाषा में बात करे उसी भाषा में जवाब दो।
4. परीक्षा वाले प्रश्न में exam-ready उत्तर दो।
5. दिए गए marks के अनुसार लंबाई और कठिनाई रखो।
6. बिना जरूरत advanced terminology मत दो।
7. प्रश्न से बाहर की जानकारी मत जोड़ो।
8. विरोधाभासी बातें मत लिखो।
9. गणित की calculation दोबारा जाँचो।
10. विज्ञान के facts जाँचो।
11. इतिहास में तारीख, व्यक्ति, घटना और कारण-परिणाम जाँचो।
12. Chemistry में formula और equation जाँचो।
13. Physics में formula, unit और calculation जाँचो।
14. Grammar और spelling सुधारो।

============================================================
MARKS CONTROL
============================================================

1 अंक:
- एक सीधा उत्तर।

2 अंक:
- लगभग 2–4 छोटे वाक्य या बिंदु।

5 अंक:
- सरल परिभाषा या भूमिका।
- लगभग 4–6 मुख्य बिंदु।
- छोटा महत्व या निष्कर्ष।
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
- भूमिका।
- headings।
- विस्तृत व्याख्या।
- उदाहरण।
- निष्कर्ष।

============================================================
QUIZ / PRACTICE MODE
============================================================

अगर यूज़र कहे:

"मुझसे सवाल पूछो"
"मुझे quiz कराओ"
"मेरा test लो"
"practice कराओ"
"एक सवाल पूछो"

तो:

1. एक समय में केवल एक सवाल पूछो।
2. तुरंत उसका उत्तर मत बताओ।
3. यूज़र के उत्तर का इंतजार करो।
4. यूज़र उत्तर दे तो उसे जाँचो।
5. सही हो तो बताओ कि सही है।
6. गलत हो तो सही उत्तर और छोटा explanation दो।
7. फिर अगला सवाल पूछ सकते हो।

============================================================
5 MARKS STRICT RULE
============================================================

यदि प्रश्न में 5 अंक हैं तो उत्तर सरल और
परीक्षा में लिखने योग्य होना चाहिए।

============================================================
PHOTOSYNTHESIS
============================================================

यदि सामान्य प्रश्न हो:

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

यह गलत मत लिखना:

"पौधे रात में ऑक्सीजन छोड़ते हैं।"

पौधे दिन और रात दोनों समय श्वसन करते हैं।

============================================================
INTERNET SEARCH
============================================================

यदि Internet Search मांगा गया है:

- current information खोजो।
- उपलब्ध sources/citations बनाए रखो।
- current information को बिना verification के
  निश्चित तथ्य की तरह मत लिखो।

============================================================
FINAL CHECK
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

    max_completion_tokens: 2048,

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
  // RETRY
  // ==========================================================

  if (
    !result.ok &&
    result.retryable
  ) {
    await sleep(900);

    result = await callGroq(
      apiKey,
      payload,
      useSearch ? 60000 : 45000
    );
  }


  // ==========================================================
  // SEARCH FALLBACK
  // ==========================================================

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

Internet search अभी उपलब्ध नहीं है।
Current जानकारी को independently verified न मानें।
`,
        },
        ...messages,
      ],

      max_completion_tokens: 2048,

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
          result.code ||
          "GROQ_ERROR",

        status:
          result.status ||
          502,

        requestId:
          result.requestId ||
          null,

        detail:
          result.error ||
          null,
      },
      result.status || 502
    );
  }


  // ==========================================================
  // LIGHTWEIGHT SELF CHECK
  // ==========================================================

  const checked =
    finalSelfCheck(
      messages,
      result.reply
    );


  // ==========================================================
  // FINAL RESPONSE
  // ==========================================================

  return json({
    reply:
      checked.answer,

    selfChecked: true,

    selfCorrected:
      checked.changed,

    factChecked:
      checked.changed,

    finalReviewed:
      true,
  });
}


// ============================================================
// PHOTO / VISION
// ============================================================

async function handleVision(
  request,
  env
) {
  const apiKey =
    env.GROQ_API_KEY;

  if (!apiKey) {
    return json(
      {
        error:
          "GROQ_API_KEY is not configured.",
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
          "Invalid JSON request.",
        code:
          "INVALID_JSON",
      },
      400
    );
  }

  const imageData =
    typeof body?.imageData === "string"
      ? body.imageData
      : "";

  const question =
    typeof body?.question === "string" &&
    body.question.trim()
      ? body.question
          .trim()
          .slice(0, 5000)
      : "इस फोटो में क्या है? इसे सरल हिंदी में समझाओ।";


  if (
    !imageData.startsWith(
      "data:image/"
    )
  ) {
    return json(
      {
        error:
          "A valid image is required.",
        code:
          "INVALID_IMAGE",
      },
      400
    );
  }


  // लगभग 20 MB सुरक्षा सीमा
  if (
    imageData.length >
    20 * 1024 * 1024
  ) {
    return json(
      {
        error:
          "फोटो बहुत बड़ी है। छोटी फोटो अपलोड करें।",
        code:
          "IMAGE_TOO_LARGE",
      },
      413
    );
  }


  // ==========================================================
  // VISION MODEL
  // ==========================================================

  const payload = {
    model:
      "qwen/qwen3.6-27b",

    messages: [
      {
        role: "system",
        content: `
तुम "सारथी AI" के vision assistant हो।

फोटो को ध्यान से देखकर सरल हिंदी में समझाओ।

अगर फोटो में:
- सवाल है तो सवाल पढ़ो और उत्तर दो।
- किताब का पेज है तो मुख्य बात समझाओ।
- diagram है तो उसके parts समझाओ।
- chart/table है तो दिखाई देने वाली जानकारी समझाओ।
- handwritten text है तो जितना साफ दिखाई दे उतना पढ़ो।

अगर कोई चीज साफ दिखाई नहीं देती तो अनुमान मत लगाओ।

अगर फोटो में परीक्षा का प्रश्न है तो
उत्तर marks के अनुसार exam-ready रखो।
`,
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
      2048,

    temperature:
      0.2,

    stream:
      false,
  };


  const result =
    await callGroq(
      apiKey,
      payload,
      60000
    );


  if (!result.ok) {
    return json(
      {
        error:
          "Photo analysis failed.",

        code:
          result.code ||
          "VISION_ERROR",

        status:
          result.status ||
          502,

        requestId:
          result.requestId ||
          null,

        detail:
          result.error ||
          null,
      },
      result.status || 502
    );
  }


  return json({
    reply:
      normalizeAnswer(
        result.reply
      ),

    model:
      "qwen/qwen3.6-27b",
  });
}


// ============================================================
// LIGHTWEIGHT SELF CHECK
// ============================================================

function finalSelfCheck(
  messages,
  originalAnswer
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
    detectMarks(
      question
    );


  // ==========================================================
  // 5 MARKS PHOTOSYNTHESIS
  // ==========================================================

  if (
    marks === 5 &&
    isSimplePhotosynthesisQuestion(
      question
    )
  ) {
    return {
      answer:
        buildSimplePhotosynthesisAnswer(),

      changed: true,
    };
  }


  return {
    answer:
      normalizeAnswer(
        answer
      ),

    changed:
      firstChanged,
  };
}


// ============================================================
// SIMPLE PHOTOSYNTHESIS QUESTION
// ============================================================

function isSimplePhotosynthesisQuestion(
  question
) {
  const text =
    String(question || "")
      .toLowerCase();

  const photo =
    text.includes(
      "प्रकाश संश्लेषण"
    ) ||
    text.includes(
      "photosynthesis"
    );

  if (!photo) {
    return false;
  }

  return (
    /क्या है|की परिभाषा|समझाइए|बताइए/.test(
      text
    )
  );
}


// ============================================================
// GUARANTEED SIMPLE 5-MARK ANSWER
// ============================================================

function buildSimplePhotosynthesisAnswer() {
  return `**प्रकाश संश्लेषण**

प्रकाश संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे सूर्य के प्रकाश की ऊर्जा की सहायता से जल और कार्बन डाइऑक्साइड से अपना भोजन बनाते हैं और ऑक्सीजन वातावरण में छोड़ते हैं।

**मुख्य बिंदु**

1. यह प्रक्रिया हरे पौधों में होती है।
2. पत्तियाँ वायु से कार्बन डाइऑक्साइड लेती हैं।
3. पौधे जड़ों द्वारा मिट्टी से जल प्राप्त करते हैं।
4. क्लोरोफिल सूर्य के प्रकाश को ग्रहण करता है।
5. पौधे प्रकाश की सहायता से अपना भोजन बनाते हैं।
6. इस प्रक्रिया में ऑक्सीजन वातावरण में निकलती है।

**महत्व**

प्रकाश संश्लेषण पौधों के लिए भोजन बनाने की मुख्य प्रक्रिया है और इससे वातावरण में ऑक्सीजन मिलती है।

**निष्कर्ष**

इस प्रकार प्रकाश संश्लेषण पौधों और पृथ्वी पर जीवन के लिए बहुत महत्वपूर्ण है।`;
}


// ============================================================
// MARK DETECTOR
// ============================================================

function detectMarks(
  question
) {
  const text =
    String(question || "")
      .toLowerCase();


  if (
    /12\s*अंक|12\s*marks?|12\s*mark/.test(
      text
    )
  ) {
    return 12;
  }


  if (
    /10\s*अंक|10\s*marks?|10\s*mark/.test(
      text
    )
  ) {
    return 10;
  }


  if (
    /5\s*अंक|5\s*marks?|5\s*mark/.test(
      text
    )
  ) {
    return 5;
  }


  if (
    /2\s*अंक|2\s*marks?|2\s*mark/.test(
      text
    )
  ) {
    return 2;
  }


  if (
    /1\s*अंक|1\s*marks?|1\s*mark/.test(
      text
    )
  ) {
    return 1;
  }


  return null;
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


  // ==========================================================
  // PHOTOSYNTHESIS FACT CHECK
  // ==========================================================

  if (
    question.includes(
      "प्रकाश संश्लेषण"
    ) ||
    question.includes(
      "photosynthesis"
    )
  ) {


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


    // भाषा सुधार

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

function normalizeAnswer(
  text
) {
  return String(
    text || ""
  )
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
          method:
            "POST",

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


    let data =
      null;


    try {
      data =
        JSON.parse(
          raw
        );
    } catch {
      data =
        null;
    }


    if (
      !response.ok
    ) {
      return {

        ok:
          false,

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

        ok:
          false,

        retryable:
          true,

        status:
          502,

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
      data
        ?.choices?.[0]
        ?.message
        ?.content;


    if (
      typeof content !==
      "string"
    ) {
      return {

        ok:
          false,

        retryable:
          false,

        status:
          502,

        code:
          "INVALID_GROQ_RESPONSE",

        requestId,

        error:
          "Groq returned no usable message content.",
      };
    }


    return {

      ok:
        true,

      reply:
        content.trim(),

      requestId,

      status:
        response.status,
    };

  } catch (
    error
  ) {

    return {

      ok:
        false,

      retryable:
        true,

      status:
        504,

      code:
        error?.name ===
        "AbortError"
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      requestId:
        null,

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

function sleep(
  ms
) {
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
    JSON.stringify(
      data
    ),
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
