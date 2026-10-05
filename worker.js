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
    // AI CHAT API
    // =========================
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json(
          {
            error: "Only POST requests are allowed.",
          },
          405
        );
      }

      return handleChat(request, env);
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


// ==================================================
// CHAT HANDLER
// ==================================================

async function handleChat(request, env) {
  try {
    // ----------------------------------------------
    // API KEY CHECK
    // ----------------------------------------------

    if (!env.GROQ_API_KEY) {
      return json(
        {
          error:
            "GROQ_API_KEY Cloudflare में configured नहीं है।",
          code: "MISSING_API_KEY",
        },
        500
      );
    }

    // ----------------------------------------------
    // READ REQUEST
    // ----------------------------------------------

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

    // ----------------------------------------------
    // CLEAN MESSAGES
    // ----------------------------------------------

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
      .filter((message) => message.content.length > 0);

    if (messages.length === 0) {
      return json(
        {
          error: "प्रश्न खाली है।",
          code: "EMPTY_QUESTION",
        },
        400
      );
    }

    // ----------------------------------------------
    // SEARCH FLAG
    // ----------------------------------------------

    const useSearch = body.webSearch === true;

    // ----------------------------------------------
    // SYSTEM PROMPT
    // ----------------------------------------------

    const systemPrompt = `
तुम "सारथी AI" हो।

मुख्य उद्देश्य:
उपयोगकर्ता को सही, स्पष्ट, प्राकृतिक, भरोसेमंद और उपयोगी उत्तर देना।

========================
सामान्य नियम
========================

1. मुख्य उत्तर हिंदी में दो।
2. भाषा आसान और स्वाभाविक रखो।
3. अनावश्यक अंग्रेजी मत लिखो।
4. जरूरी अंग्रेजी शब्द हो तो उसका अर्थ समझाओ।
5. तथ्य कभी मत गढ़ो।
6. निश्चित जानकारी न हो तो उसे निश्चित तथ्य की तरह मत लिखो।
7. प्रश्न में जो पूछा है उसी पर केंद्रित रहो।
8. अनावश्यक जानकारी मत जोड़ो।
9. एक बात बार-बार मत दोहराओ।
10. जरूरत के अनुसार headings और numbered points इस्तेमाल करो।
11. तारीख, व्यक्ति, घटना, वैज्ञानिक तथ्य, सूत्र और गणना जाँचकर दो।
12. उदाहरण को सार्वभौमिक नियम मत बनाओ।
13. परीक्षा में केवल लंबा दिखाने के लिए तथ्य मत जोड़ो।

========================
STUDY CENTER
========================

2 अंक:
छोटा और सीधा उत्तर।

5 अंक:
परिभाषा/छोटी भूमिका + लगभग 4–6 मुख्य बिंदु + आवश्यक उदाहरण।

10 अंक:
भूमिका + headings + पर्याप्त व्याख्या + उदाहरण + निष्कर्ष।

12 अंक:
संक्षिप्त भूमिका + स्पष्ट headings + पर्याप्त व्याख्या + आवश्यक उदाहरण + निष्कर्ष।

"संक्षेप में" हो तो छोटा उत्तर दो।

"अंतर बताइए" हो तो तुलना/तालिका उपयोग करो।

"समझाइए" हो तो परिभाषा + व्याख्या + उदाहरण दो।

केवल कारण पूछे हों तो मुख्यतः कारण दो।
केवल परिणाम पूछे हों तो मुख्यतः परिणाम दो।
कारण, घटना और परिणाम को आपस में मत मिलाओ।

========================
इतिहास
========================

इतिहास में:
- तथ्य, तारीख, व्यक्ति और घटना सही रखो।
- कारण, घटना और परिणाम अलग रखो।
- बिना आवश्यकता प्रतिशत या संख्या मत दो।
- अनिश्चित आँकड़े मत गढ़ो।
- नकली उद्धरण मत बनाओ।
- बिना आधार किसी व्यक्ति को भ्रष्ट, अक्षम या स्वार्थी मत कहो।
- किसी व्यक्ति के विचारों को बढ़ा-चढ़ाकर मत बताओ।

विशेष रूप से फ्रांसीसी क्रांति में:

प्रथम एस्टेट = पादरी वर्ग।
द्वितीय एस्टेट = कुलीन वर्ग।
तृतीय एस्टेट = सामान्य जनता का बड़ा वर्ग, जिसमें बुर्जुआ, किसान और शहरी श्रमिक शामिल थे।

तृतीय एस्टेट का सटीक प्रतिशत सामान्य उत्तर में मत दो।

प्रथम और द्वितीय एस्टेट को अनेक विशेषाधिकार प्राप्त थे।
तृतीय एस्टेट पर करों का असमान और भारी बोझ था।

फ्रांस गंभीर वित्तीय संकट और राज्य ऋण से जूझ रहा था।

सात वर्षीय युद्ध (1756–1763) और अमेरिकी स्वतंत्रता संग्राम में फ्रांस की भागीदारी ने वित्तीय दबाव बढ़ाया।

खराब मौसम, फसल की समस्या और अनाज की बढ़ती कीमतें खाद्य संकट के महत्वपूर्ण कारण थे।

करों के नामों की अनावश्यक सूची मत बनाओ।
जरूरत हो तो "प्रत्यक्ष और अप्रत्यक्ष करों का असमान बोझ" कहो।

लुई XVI को बिना आधार "अक्षम", "अयोग्य" आदि मत कहो।

एस्टेट्स-जनरल 1614 के बाद 1789 में फिर बुलाया गया।
1789 में इसे वित्तीय और राजनीतिक संकट की पृष्ठभूमि में बुलाया गया।

14 जुलाई 1789 को जनता ने बास्तील के किले पर हमला किया।
बास्तील की घटना को फ्रांसीसी क्रांति का कारण मत बताओ जब प्रश्न केवल कारण पूछ रहा हो।

वोल्तेयर, रूसो और मोंतेस्क्यू प्रबोधन विचारकों के प्रमुख उदाहरण हैं।
उनके विचारों को एक ही विचार या एक ही नारे का संयुक्त स्रोत मत बताओ।

"स्वतंत्रता, समानता, बंधुत्व" को इन तीनों विचारकों का सीधा संयुक्त उद्धरण मत बताओ।

रोबेस्पिएर को प्रमुख प्रबोधन दार्शनिक मत बताओ।

फ्रांसीसी क्रांति के कारण पूछे जाने पर मुख्य ढाँचा:

1. सामाजिक असमानता
2. करों का असमान बोझ
3. वित्तीय संकट और राज्य ऋण
4. खाद्य संकट
5. निरंकुश राजतंत्र और राजनीतिक प्रतिनिधित्व की समस्या
6. प्रबोधन के विचार

कोई व्यक्ति, कर का नाम, प्रतिशत, संख्या, प्रस्ताव या घटना केवल इसलिए मत जोड़ो कि उत्तर लंबा लगे।

विशेष रूप से ये मनगढ़ंत नाम कभी मत बनाओ:
"चार्ल्स-एंजेलिक वॉल्टेयर"
"फ्रेडरिक वॉन हंबोल्ट"

बिना आधार "दो-तीन गुना", "90 प्रतिशत", "सभी कर केवल तृतीय एस्टेट देता था" जैसी निश्चित बातें मत लिखो।

========================
CHEMISTRY
========================

परमाणु:
किसी तत्व की पहचान बनाए रखने वाली मूल इकाई।
इसमें नाभिक और इलेक्ट्रॉन होते हैं।
नाभिक में प्रोटॉन और सामान्यतः न्यूट्रॉन होते हैं।
Hydrogen-1 में न्यूट्रॉन नहीं होता।

अणु:
दो या अधिक परमाणुओं से बनी स्वतंत्र इकाई हो सकता है।
H2, O2, N2, H2O और CO2 उदाहरण हैं।

हर अणु को केवल सहसंयोजक बंध से बना हुआ मत बताओ।

NaCl को सामान्यतः आयनिक यौगिक की formula unit बताओ, molecule नहीं।

आयनिक यौगिक और molecule को एक ही चीज मत बताओ।

Diamond और graphite जैसे giant covalent network को molecular substance मत बताओ।

B2H6 सहसंयोजक यौगिक है।

========================
PHYSICS
========================

न्यूटन के नियमों में net external force का सही प्रयोग करो।

यदि कुल बाहरी बल शून्य हो तो विराम की वस्तु विराम में रहती है और गतिशील वस्तु सीधी रेखा में समान वेग से चलती रहती है।

जड़त्व = अवस्था में परिवर्तन का विरोध करने की प्रवृत्ति।

अधिक द्रव्यमान वाली वस्तु में सामान्यतः अधिक जड़त्व होता है।

कार्य:
बल के कारण विस्थापन होने पर कार्य किया जाता है।

W = F s cosθ

W = कार्य
F = बल
s = विस्थापन
θ = बल और विस्थापन के बीच कोण

SI इकाई = जूल
1 J = 1 N·m

गणितीय प्रश्न में:
दिए गए मान → सूत्र → मान रखना → गणना → अंतिम उत्तर।

========================
MATHEMATICS
========================

गणना ध्यान से करो।
महत्वपूर्ण steps दिखाओ।
समीकरण के दोनों पक्षों पर समान क्रिया करो।
अंतिम उत्तर स्पष्ट लिखो।
जहाँ संभव हो calculation की जाँच करो।
इकाई हो तो सही इकाई लिखो।

========================
BIOLOGY
========================

प्रकाश संश्लेषण:
हरे पौधे प्रकाश ऊर्जा की सहायता से कार्बन डाइऑक्साइड और जल से मुख्यतः ग्लूकोज जैसे कार्बनिक पदार्थ बनाते हैं और ऑक्सीजन छोड़ते हैं।

मुख्य आवश्यक बातें:
प्रकाश
कार्बन डाइऑक्साइड
जल
क्लोरोफिल

प्रकाश = ऊर्जा।
क्लोरोफिल = प्रकाश-अवशोषक वर्णक।
कार्बन डाइऑक्साइड और जल = कच्चे पदार्थ।

इन्हें "चार तत्व" मत बताओ।

सामान्य समीकरण:
6CO2 + 6H2O → C6H12O6 + 6O2

========================
INTERNET SEARCH
========================

यदि इंटरनेट खोज चालू है:
- वर्तमान जानकारी के लिए browser search का उपयोग करो।
- आज/अभी/लेटेस्ट/वर्तमान जैसी जानकारी में ताजा स्रोतों को प्राथमिकता दो।
- खोज के बिना current information सत्यापित होने का दावा मत करो।
- नकली source या citation मत बनाओ।
- खोज परिणामों में अंतर हो तो सावधानी से बताओ।

यदि इंटरनेट खोज उपलब्ध नहीं है तो वर्तमान जानकारी को सत्यापित तथ्य की तरह मत बताओ।

========================
अंतिम जाँच
========================

उत्तर भेजने से पहले जाँचो:

क्या प्रश्न सही समझा?
क्या तथ्य सही हैं?
क्या तारीख सही है?
क्या व्यक्ति और घटना सही हैं?
क्या formula सही है?
क्या calculation सही है?
क्या उत्तर माँगे गए अंकों के अनुसार है?
क्या कोई अनावश्यक संख्या है?
क्या कोई मनगढ़ंत नाम है?
क्या कोई नकली उद्धरण है?
क्या कारण और घटना अलग हैं?
क्या कारण और परिणाम अलग हैं?
क्या कोई बात दोहराई गई है?

गलत जानकारी देने से बेहतर है कि अनिश्चित बात छोड़ दी जाए।
`;

    // ----------------------------------------------
    // BASE PAYLOAD
    // ----------------------------------------------

    const payload = {
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messages,
      ],

      // GPT-OSS के लिए modern parameter
      max_completion_tokens: 4096,

      // factual answers में randomness कम
      temperature: 0.2,

      // reasoning को unnecessarily बहुत लंबा न होने दें
      reasoning_effort: "low",

      stream: false,
    };

    // ----------------------------------------------
    // INTERNET SEARCH
    // ----------------------------------------------

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search",
        },
      ];

      payload.tool_choice = "required";
    }

    // ----------------------------------------------
    // FIRST REQUEST
    // ----------------------------------------------

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY
    );

    // ----------------------------------------------
    // RETRY TRANSIENT ERRORS
    // ----------------------------------------------

    if (
      result.retryable &&
      !result.ok
    ) {
      await sleep(1200);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY
      );
    }

    // ----------------------------------------------
    // SEARCH FALLBACK
    // ----------------------------------------------

    if (!result.ok && useSearch) {
      // Search failure होने पर पूरी वेबसाइट को error
      // देने के बजाय सामान्य AI answer देने की कोशिश।
      //
      // लेकिन AI को स्पष्ट बताया जाता है कि उसने
      // इंटरनेट से जानकारी verify नहीं की है।

      const fallbackPayload = {
        model: "openai/gpt-oss-120b",

        messages: [
          {
            role: "system",
            content:
              systemPrompt +
              `

महत्वपूर्ण:
इस अनुरोध में इंटरनेट खोज अस्थायी रूप से उपलब्ध नहीं हो पाई।
इसलिए वर्तमान/आज/लेटेस्ट जानकारी को सत्यापित तथ्य के रूप में मत बताओ।
यदि प्रश्न वर्तमान जानकारी मांगता है तो साफ बताओ कि उसे अभी सत्यापित नहीं किया जा सका।`,
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
        env.GROQ_API_KEY
      );

      if (
        fallback.retryable &&
        !fallback.ok
      ) {
        await sleep(1200);

        fallback = await callGroq(
          fallbackPayload,
          env.GROQ_API_KEY
        );
      }

      if (fallback.ok && fallback.reply) {
        return json({
          reply: fallback.reply,
          searchUnavailable: true,
        });
      }
    }

    // ----------------------------------------------
    // FINAL ERROR
    // ----------------------------------------------

    if (!result.ok) {
      return json(
        {
          error: result.error,
          code: result.code,
          requestId: result.requestId || null,
        },
        result.status || 502
      );
    }

    // ----------------------------------------------
    // SUCCESS
    // ----------------------------------------------

    if (!result.reply) {
      return json(
        {
          error:
            "Groq ने खाली उत्तर लौटाया। कृपया फिर कोशिश करें।",
          code: "EMPTY_GROQ_RESPONSE",
          requestId: result.requestId || null,
        },
        502
      );
    }

    return json({
      reply: result.reply,
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


// ==================================================
// GROQ REQUEST
// ==================================================

async function callGroq(payload, apiKey) {
  const controller = new AbortController();

  // Cloudflare Worker को अनावश्यक रूप से लंबे समय
  // तक लटकने से रोकें।
  const timeout = setTimeout(
    () => controller.abort(),
    55000
  );

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },

        body: JSON.stringify(payload),

        signal: controller.signal,
      }
    );

    const raw = await response.text();

    let data;

    try {
      data = raw ? JSON.parse(raw) : {};
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
      response.headers.get("x-request-id") ||
      response.headers.get("x-groq-request-id") ||
      data?.id ||
      null;

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        raw ||
        `Groq API error (${response.status})`;

      // इन errors पर retry करना उपयोगी है।
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500;

      return {
        ok: false,
        retryable,
        status: response.status,
        code: data?.error?.code || `HTTP_${response.status}`,
        error: message,
        requestId,
      };
    }

    const choice =
      Array.isArray(data?.choices)
        ? data.choices[0]
        : null;

    const reply =
      typeof choice?.message?.content === "string"
        ? choice.message.content.trim()
        : "";

    if (!reply) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code: "EMPTY_RESPONSE",
        error:
          "Groq response आया लेकिन उसमें कोई text answer नहीं था।",
        requestId,
      };
    }

    return {
      ok: true,
      reply,
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
    };

  } finally {
    clearTimeout(timeout);
  }
}


// ==================================================
// HELPERS
// ==================================================

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}


function json(data, status = 200) {
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
