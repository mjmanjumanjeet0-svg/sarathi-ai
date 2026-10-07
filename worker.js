async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY Cloudflare Secret में configured नहीं है।",
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
    // HISTORY LIMIT
    // ========================================================

    let messages = history
      .slice(-8)
      .map((m) => ({
        role:
          m?.role === "assistant"
            ? "assistant"
            : "user",
        content: String(m?.content ?? "")
          .trim()
          .slice(0, 3500),
      }))
      .filter((m) => m.content);

    // Current user message हमेशा भेजें
    if (
      !(
        messages.length &&
        messages[messages.length - 1].role === "user" &&
        messages[messages.length - 1].content === message
      )
    ) {
      messages.push({
        role: "user",
        content: message.slice(0, 6000),
      });
    }

    // ========================================================
    // INDIA CURRENT DATE + TIME
    // ========================================================

    const indiaNow = new Intl.DateTimeFormat("hi-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());

    // Machine-readable date: YYYY-MM-DD
    const todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());

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
यदि User "आज", "अभी", "ताजा", "latest", "current", "live" पूछता है,
तो Search result की वास्तविक तारीख जांचे बिना कोई वर्तमान दावा मत करो।

यदि Search result पुराना है तो उसे आज का डेटा मत बताओ।
यदि Search result की तारीख उपलब्ध नहीं है और जानकारी current है,
तो बिना प्रमाण वर्तमान आंकड़ा मत गढ़ो।
`;
मौसम अलर्ट के लिए महत्वपूर्ण नियम:

किसी जिले के लिए Yellow Alert, Orange Alert या Red Alert
तभी बताओ जब Search source में उसी जिले का नाम स्पष्ट रूप से
उस alert के साथ दिया गया हो।

किसी दूसरे जिले के alert को User द्वारा पूछे गए जिले पर लागू मत करो।

यदि source में केवल बारिश, मेघगर्जन या वज्रपात की संभावना है
लेकिन alert स्पष्ट नहीं है, तो कोई Yellow/Orange/Red Alert मत लिखो।

स्थान, तारीख, मौसम और alert को अलग-अलग सत्यापित करो।
    // ========================================================
    // GROQ PAYLOAD
    // ========================================================

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: systemContent,
        },
        ...messages,
      ],

      max_completion_tokens: 2048,

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

अगर सवाल मौसम, बारिश, तापमान, सोने का भाव,
कीमत, ट्रेन, समाचार, शेयर, खेल या किसी अन्य
बदलने वाली/current जानकारी से संबंधित है:

1. नवीनतम उपलब्ध Search result खोजो।
2. Search result की वास्तविक तारीख जांचो।
3. पुराने result को आज का result मत मानो।
4. भविष्य की तारीख वाले result को वर्तमान जानकारी का प्रमाण मत मानो।
5. Source की तारीख और data की तारीख अलग हो सकती हैं — दोनों को मत मिलाओ।
6. अगर आज का विश्वसनीय data नहीं मिला तो साफ बताओ कि आज का पक्का data नहीं मिला।
7. कोई संख्या या तथ्य मन से मत बनाओ।

अगर User ने शहर/स्थान बताया है तो उसी स्थान की जानकारी खोजो।

अगर User ने मौसम पूछा है और शहर/स्थान नहीं बताया है,
तो स्थान पूछो। User की exact location का अनुमान मत लगाओ।

उत्तर सरल हिंदी में दो।
जहाँ संभव हो source और उसकी तारीख बताओ।
`;

      payload.messages[
        payload.messages.length - 1
      ] = {
        role: "user",
        content: searchUserMessage,
      };

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
      60000
    );

    // ========================================================
    // RATE LIMIT / TEMPORARY ERROR RETRY
    // ========================================================

    if (!result.ok && result.retryable) {
      const waitMs =
        result.retryAfterMs || 9000;

      await sleep(waitMs);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );
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
        // Hindi + English month names
        // Unicode spaces भी support होंगे
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
          const day = String(match[1]).padStart(2, "0");
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

          // पुरानी तारीख
          if (foundDate < todayISO) {
            invalidOldDate = match[0];
            break;
          }
        }

        // ----------------------------------------------------
        // FUTURE DATE RESULT BLOCK
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
        // OLD DATE RESULT BLOCK
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
        // EXTRA WEATHER PROTECTION
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
      // SEARCH ANSWER DIRECTLY RETURN
      // ======================================================

      // IMPORTANT:
      // Search result पर Self-check नहीं चलेगा।
      // इससे Self-check valid Search answer को
      // "मेरे पास live internet नहीं है" में नहीं बदलेगा।

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
        messages,
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
