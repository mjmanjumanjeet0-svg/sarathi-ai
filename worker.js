async function handleChat(request, env) {
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

  try {
    const body = await request.json();

    const history = Array.isArray(body?.history)
      ? body.history
      : [];

    const message = String(body?.message ?? "").trim();
    const useSearch = body?.webSearch === true;

    if (!message) {
      return json(
        {
          error: "कृपया पहले अपना सवाल लिखें।",
          code: "EMPTY_QUESTION",
        },
        400
      );
    }

    // ========================================================
    // INDIA DATE + TIME
    // ========================================================

    const now = new Date();

    const indiaNow = new Intl.DateTimeFormat("hi-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "short",
    }).format(now);

    const todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(now);

    // ========================================================
    // TOKEN SAVING HISTORY
    // ========================================================
    // पहले 8 messages → अब केवल आखिरी 3
    // हर message केवल 1200 characters

    const shortHistory = history
      .slice(-3)
      .map((m) => ({
        role:
          m?.role === "assistant"
            ? "assistant"
            : "user",

        content: String(m?.content ?? "")
          .trim()
          .slice(0, 1200),
      }))
      .filter((m) => m.content);

    // Current question history में पहले से नहीं है
    // तो उसे जोड़ दें।

    if (
      !(
        shortHistory.length &&
        shortHistory[shortHistory.length - 1].role ===
          "user" &&
        shortHistory[shortHistory.length - 1].content ===
          message
      )
    ) {
      shortHistory.push({
        role: "user",
        content: message.slice(0, 3500),
      });
    }

    // ========================================================
    // SYSTEM PROMPT
    // ========================================================

    const systemContent =
      SYSTEM_PROMPT +
      `

भारत में अभी:
${indiaNow}

आज की मशीन तारीख:
${todayISO}

CURRENT INFORMATION RULE:

यदि User "आज", "अभी", "ताजा", "ताज़ा",
"latest", "current", "live", "today" या "now"
पूछता है, तो Search result की वास्तविक तारीख जांचो।

पुराने Search result को आज का data मत बताओ।

भविष्य की तारीख वाले result को वर्तमान data
का प्रमाण मत मानो।

यदि current जानकारी की तारीख उपलब्ध नहीं है,
तो कोई आंकड़ा मन से मत बनाओ।

WEATHER ALERT RULE:

Yellow Alert, Orange Alert या Red Alert
तभी बताओ जब Search source में उसी जिले का
नाम स्पष्ट रूप से उसी alert के साथ दिया गया हो।

दूसरे जिले का alert User के जिले पर लागू मत करो।

केवल बारिश, मेघगर्जन या वज्रपात की संभावना को
Yellow/Orange/Red Alert मत कहो।

मौसम में स्थान, तारीख, बारिश की संभावना और
alert को अलग-अलग जांचो।

PRICE RULE:

कीमत पूछे जाने पर price type स्पष्ट करो,
जैसे MCX, spot, retail, 22K या 24K।

SOURCE DATE और DATA DATE को अलग समझो।
`;

    // ========================================================
    // PAYLOAD
    // ========================================================

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: systemContent,
        },
        ...shortHistory,
      ],

      // 1024 → 900
      max_completion_tokens: 900,

      temperature: 0.2,

      reasoning_effort: "low",

      stream: false,
    };

    // ========================================================
    // BROWSER SEARCH
    // ========================================================

    if (useSearch) {
      const searchUserMessage = `
${message}

आज भारत की तारीख: ${todayISO}
वर्तमान समय: ${indiaNow}

Browser Search का उपयोग करना अनिवार्य है।

यदि सवाल current जानकारी से संबंधित है:

1. नवीनतम उपलब्ध source खोजो।
2. source की वास्तविक तारीख जांचो।
3. data की तारीख भी जांचो।
4. पुराने data को आज का data मत बताओ।
5. भविष्य के data को आज का data मत बताओ।
6. आज का विश्वसनीय data न मिले तो साफ बताओ।
7. कोई संख्या मन से मत बनाओ।

यदि User ने शहर/जिला बताया है,
तो उसी स्थान की जानकारी खोजो।

User की exact location का अनुमान मत लगाओ।

मौसम में:
स्थान + तारीख + बारिश + alert अलग-अलग जांचो।

Alert तभी लिखो जब उसी जिले का नाम
source में alert के साथ हो।

कीमत में:
MCX/spot/retail और 22K/24K जैसे
price type को स्पष्ट करो।

उत्तर छोटा और सरल हिंदी में दो।
`;

      // ======================================================
      // SEARCH TOKEN SAVING
      // ======================================================
      // Search में पुरानी history बिल्कुल नहीं भेजेंगे।
      // इससे काफी input tokens बचेंगे।

      payload.messages = [
        {
          role: "system",
          content:
            SYSTEM_PROMPT +
            `

आज की तारीख: ${todayISO}

Search में हमेशा source की तारीख जांचो।
पुराने data को आज का data मत बताओ।
`,
        },
        {
          role: "user",
          content: searchUserMessage,
        },
      ];

      payload.tools = [
        {
          type: "browser_search",
        },
      ];

      payload.tool_choice = "required";

      // Search answer छोटा
      payload.max_completion_tokens = 1000;
    }

    // ========================================================
    // GROQ REQUEST
    // ========================================================

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    // ========================================================
    // DAILY TPD CHECK
    // ========================================================

    const resultErrorText = String(
      result?.error ?? ""
    );

    const isDailyTPDLimit =
      /tokens per day|TPD|daily.*token|token.*daily/i.test(
        resultErrorText
      );

    // Daily limit पर RETRY बिल्कुल नहीं।
    if (isDailyTPDLimit) {
      return json(
        {
          answer:
            "आज Groq की दैनिक token सीमा पूरी हो गई है। " +
            "अभी नई AI request भेजने से फायदा नहीं होगा। " +
            "Token limit reset होने के बाद फिर कोशिश करें।",

          selfChecked: false,
          selfCorrected: false,
          searchUsed: useSearch,

          code: "GROQ_TPD_LIMIT",
        },
        429
      );
    }

    // ========================================================
    // TEMPORARY RATE LIMIT
    // ========================================================

    if (!result.ok && result.retryable) {
      const waitMs =
        result.retryAfterMs || 9000;

      await sleep(
        Math.min(waitMs, 12000)
      );

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );

      // Retry के बाद भी TPD check

      const retryErrorText = String(
        result?.error ?? ""
      );

      const retryTPD =
        /tokens per day|TPD|daily.*token|token.*daily/i.test(
          retryErrorText
        );

      if (retryTPD) {
        return json(
          {
            answer:
              "आज Groq की दैनिक token सीमा पूरी हो गई है। " +
              "कुछ समय बाद फिर कोशिश करें।",

            selfChecked: false,
            selfCorrected: false,
            searchUsed: useSearch,

            code: "GROQ_TPD_LIMIT",
          },
          429
        );
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

    // ========================================================
    // EMPTY RESPONSE
    // ========================================================

    if (!result.reply) {
      return json(
        {
          error:
            "AI ने खाली उत्तर दिया। फिर से कोशिश करें।",

          code: "EMPTY_RESPONSE",
        },
        502
      );
    }

    // ========================================================
    // SEARCH DATE SAFETY
    // ========================================================

    if (useSearch) {
      const currentQuestion =
        message.toLowerCase();

      const asksCurrentInfo =
        /आज|अभी|ताज़ा|ताजा|latest|current|today|now|live/.test(
          currentQuestion
        );

      if (asksCurrentInfo) {
        const answerText =
          String(result.reply).trim();

        const dateRegex =
          /(\d{1,2})[\s\u00A0\u202F-]*(जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर|January|February|March|April|May|June|July|August|September|October|November|December)[\s\u00A0\u202F,-]*(\d{4})/gi;

        const monthMap = {
          जनवरी: "01",
          फरवरी: "02",
          मार्च: "03",
          अप्रैल: "04",
          मई: "05",
          जून: "06",
          जुलाई: "07",
          अगस्त: "08",
          सितंबर: "09",
          अक्टूबर: "10",
          नवंबर: "11",
          दिसंबर: "12",

          January: "01",
          February: "02",
          March: "03",
          April: "04",
          May: "05",
          June: "06",
          July: "07",
          August: "08",
          September: "09",
          October: "10",
          November: "11",
          December: "12",
        };

        const matches = [
          ...answerText.matchAll(dateRegex),
        ];

        let invalidOldDate = null;
        let invalidFutureDate = null;

        for (const match of matches) {
          const day =
            String(match[1]).padStart(2, "0");

          const month =
            monthMap[match[2]];

          const year = match[3];

          if (!month) continue;

          const foundDate =
            `${year}-${month}-${day}`;

          if (foundDate > todayISO) {
            invalidFutureDate = match[0];
            break;
          }

          if (foundDate < todayISO) {
            invalidOldDate = match[0];
            break;
          }
        }

        // ====================================================
        // FUTURE DATE
        // ====================================================

        if (invalidFutureDate) {
          return json({
            answer:
              `Search में भविष्य की तारीख (${invalidFutureDate}) का data मिला। ` +
              `इसे आज की जानकारी मानना सही नहीं होगा। ` +
              `आज (${todayISO}) का विश्वसनीय data Search से नहीं मिला।`,

            selfChecked: false,
            selfCorrected: false,
            searchUsed: true,
          });
        }

        // ====================================================
        // OLD DATE
        // ====================================================

        if (invalidOldDate) {
          return json({
            answer:
              `Search में आज के बजाय पुराना data मिला (${invalidOldDate})। ` +
              `इसलिए मैं उसे आज की जानकारी बताकर गलत जानकारी नहीं दूँगा। ` +
              `आज (${todayISO}) का विश्वसनीय ताजा data Search से नहीं मिला।`,

            selfChecked: false,
            selfCorrected: false,
            searchUsed: true,
          });
        }

        // ====================================================
        // WEATHER OLD DATA PROTECTION
        // ====================================================

        const asksWeather =
          /मौसम|weather|बारिश|rain|temperature|तापमान|humidity|नमी|आंधी|तूफान/.test(
            currentQuestion
          );

        if (asksWeather) {
          const looksLikeOldWeather =
            /26\s*सितंबर|25\s*सितंबर|24\s*सितंबर|23\s*सितंबर|22\s*सितंबर|21\s*सितंबर|20\s*सितंबर|19\s*सितंबर|18\s*सितंबर|17\s*सितंबर|16\s*सितंबर|15\s*सितंबर/i.test(
              answerText
            );

          if (looksLikeOldWeather) {
            return json({
              answer:
                `Search में आज के बजाय पुराना मौसम data मिला। ` +
                `इसलिए मैं उसे आज का मौसम बताकर गलत जानकारी नहीं दूँगा। ` +
                `आज (${todayISO}) का विश्वसनीय ताजा मौसम data Search से नहीं मिला।`,

              selfChecked: false,
              selfCorrected: false,
              searchUsed: true,
            });
          }
        }
      }

      // ======================================================
      // IMPORTANT:
      // SEARCH के बाद SELF-CHECK नहीं।
      //
      // इससे एक दूसरा Groq request बचता है।
      // ======================================================

      return json({
        answer: result.reply,

        selfChecked: false,
        selfCorrected: false,

        searchUsed: true,
      });
    }

    // ========================================================
    // NORMAL CHAT SELF-CHECK
    // ========================================================
    // Search में यह call नहीं होगा।
    // इसलिए Search के दौरान 1 Groq request ही लगेगा।

    const checked =
      await selfCheckAndCorrect(
        shortHistory,
        result.reply,
        env.GROQ_API_KEY,
        false
      );

    return json({
      answer: checked.reply,

      selfChecked:
        checked.selfChecked,

      selfCorrected:
        checked.selfCorrected,

      searchUsed: false,
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
