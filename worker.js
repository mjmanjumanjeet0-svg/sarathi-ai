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
    // INDIA CURRENT DATE + TIME
    // ========================================================

    const indiaNow = new Intl.DateTimeFormat("hi-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());

    const todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());

    // ========================================================
    // SHORT HISTORY
    // ========================================================
    // पहले 8 messages भेजे जा रहे थे।
    // अब केवल आखिरी 4 messages भेजेंगे।
    // इससे Groq token usage कम होगा।

    const shortHistory = history
      .slice(-4)
      .map((m) => ({
        role:
          m?.role === "assistant"
            ? "assistant"
            : "user",

        content: String(m?.content ?? "")
          .trim()
          .slice(0, 1600),
      }))
      .filter((m) => m.content);

    // ========================================================
    // CURRENT USER MESSAGE
    // ========================================================

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
        content: message.slice(0, 4000),
      });
    }

    // ========================================================
    // SYSTEM MESSAGE
    // ========================================================

    const systemContent =
      SYSTEM_PROMPT +
      `

भारत में अभी का समय:
${indiaNow}

आज की मशीन तारीख:
${todayISO}

बहुत महत्वपूर्ण:

यदि User "आज", "अभी", "ताजा", "ताज़ा",
"latest", "current", "live", "today" या "now"
पूछता है, तो Search result की वास्तविक तारीख
जांचो।

पुराने Search result को आज का data मत बताओ।

यदि Search result की तारीख उपलब्ध नहीं है और
जानकारी current है, तो बिना प्रमाण वर्तमान
आंकड़ा मत गढ़ो।

मौसम अलर्ट के लिए महत्वपूर्ण नियम:

किसी जिले के लिए Yellow Alert, Orange Alert
या Red Alert तभी बताओ जब Search source में
उसी जिले का नाम स्पष्ट रूप से उसी alert के साथ
दिया गया हो।

किसी दूसरे जिले के alert को User द्वारा पूछे गए
जिले पर लागू मत करो।

यदि source में केवल बारिश, मेघगर्जन या वज्रपात
की संभावना है लेकिन alert स्पष्ट नहीं है,
तो Yellow/Orange/Red Alert मत लिखो।

मौसम की जानकारी में:
स्थान, तारीख, बारिश की संभावना और alert को
अलग-अलग सत्यापित करो।
`;

    // ========================================================
    // NORMAL CHAT PAYLOAD
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

      // पहले 2048 था
      max_completion_tokens: 1024,

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

==============================
IMPORTANT SEARCH INSTRUCTIONS
==============================

भारत में आज की तारीख: ${todayISO}
भारत में वर्तमान समय: ${indiaNow}

इस सवाल के लिए Browser Search का उपयोग करो।

यदि सवाल मौसम, बारिश, तापमान, सोने का भाव,
कीमत, ट्रेन, समाचार, शेयर, खेल या किसी अन्य
बदलने वाली/current जानकारी से संबंधित है:

1. नवीनतम उपलब्ध Search result खोजो।
2. Search result की वास्तविक तारीख जांचो।
3. पुराने result को आज का result मत मानो।
4. भविष्य की तारीख वाले result को वर्तमान जानकारी
   का प्रमाण मत मानो।
5. Source की तारीख और data की तारीख अलग हो सकती हैं।
6. यदि आज का विश्वसनीय data नहीं मिला तो साफ बताओ
   कि आज का पक्का data नहीं मिला।
7. कोई संख्या या तथ्य मन से मत बनाओ।

यदि User ने शहर/स्थान बताया है तो उसी स्थान की
जानकारी खोजो।

यदि User ने मौसम पूछा है और शहर/स्थान नहीं बताया है,
तो स्थान पूछो। User की exact location का अनुमान मत लगाओ।

उत्तर सरल हिंदी में दो।
जहाँ संभव हो source और उसकी तारीख बताओ।
`;

      // ======================================================
      // SEARCH में पुरानी history नहीं भेजेंगे
      // ======================================================

      payload.messages = [
        {
          role: "system",
          content: systemContent,
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

      // Search answer को थोड़ा छोटा रखेंगे
      payload.max_completion_tokens = 1200;
    }

    // ========================================================
    // FIRST GROQ REQUEST
    // ========================================================

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    // ========================================================
    // TPD LIMIT CHECK
    // ========================================================
    // यदि daily token limit पूरी हो गई है,
    // तो दोबारा वही request भेजने का फायदा नहीं है।

    const resultErrorText = String(
      result?.error ?? ""
    );

    const isDailyTPDLimit =
      /tokens per day|TPD|daily.*token|token.*daily/i.test(
        resultErrorText
      );

    if (isDailyTPDLimit) {
      return json(
        {
          answer:
            "आज Groq की दैनिक token सीमा पूरी हो गई है। " +
            "इसलिए अभी नई AI request नहीं भेजी गई। " +
            "कुछ समय बाद फिर कोशिश करें।",

          selfChecked: false,

          selfCorrected: false,

          searchUsed: useSearch,

          code: "GROQ_TPD_LIMIT",
        },
        429
      );
    }

    // ========================================================
    // TEMPORARY RATE LIMIT RETRY
    // ========================================================
    // केवल सामान्य temporary retryable error पर retry।
    // Daily TPD पर ऊपर ही return हो चुका है।

    if (!result.ok && result.retryable) {
      const waitMs =
        result.retryAfterMs || 9000;

      await sleep(waitMs);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );

      // Retry के बाद फिर TPD check
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

        // ----------------------------------------------------
        // DATE REGEX
        // Hindi + English months
        // Normal space + NBSP + narrow NBSP
        // ----------------------------------------------------

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
          const day = String(match[1]).padStart(
            2,
            "0"
          );

          const month = monthMap[match[2]];

          const year = match[3];

          if (!month) continue;

          const foundDate =
            `${year}-${month}-${day}`;

          // Future date
          if (foundDate > todayISO) {
            invalidFutureDate = match[0];
            break;
          }

          // Old date
          if (foundDate < todayISO) {
            invalidOldDate = match[0];
            break;
          }
        }

        // ----------------------------------------------------
        // FUTURE DATE BLOCK
        // ----------------------------------------------------

        if (invalidFutureDate) {
          return json({
            answer:
              `Search में भविष्य की तारीख (${invalidFutureDate}) का डेटा मिला। ` +
              `इसे आज की जानकारी मानना सही नहीं होगा। ` +
              `आज (${todayISO}) का विश्वसनीय वर्तमान डेटा Search से नहीं मिला।`,

            selfChecked: false,

            selfCorrected: false,

            searchUsed: true,
          });
        }

        // ----------------------------------------------------
        // OLD DATE BLOCK
        // ----------------------------------------------------

        if (invalidOldDate) {
          return json({
            answer:
              `Search में आज के बजाय पुराना डेटा मिला (${invalidOldDate})। ` +
              `इसलिए मैं उसे आज की जानकारी बताकर गलत जानकारी नहीं दूँगा। ` +
              `आज (${todayISO}) का विश्वसनीय ताजा डेटा Search से नहीं मिला।`,

            selfChecked: false,

            selfCorrected: false,

            searchUsed: true,
          });
        }

        // ----------------------------------------------------
        // WEATHER PROTECTION
        // ----------------------------------------------------

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
                `Search में आज के बजाय पुराना मौसम डेटा मिला। ` +
                `इसलिए मैं उसे आज का मौसम बताकर गलत जानकारी नहीं दूँगा। ` +
                `आज (${todayISO}) का विश्वसनीय ताजा मौसम डेटा Search से नहीं मिला।`,

              selfChecked: false,

              selfCorrected: false,

              searchUsed: true,
            });
          }
        }
      }

      // ======================================================
      // SEARCH RESULT DIRECTLY RETURN
      // ======================================================
      // Search के बाद Self-check नहीं चलेगा।
      // इससे दूसरा Groq request बचता है और
      // valid Search answer के गलत तरीके से बदलने की संभावना भी कम होती है।

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
