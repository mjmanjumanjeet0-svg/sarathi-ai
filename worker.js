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
    // HISTORY
    // ========================================================

    let messages = history
      .slice(-8)
      .map((m) => ({
        role: m?.role === "assistant"
          ? "assistant"
          : "user",
        content: String(m?.content ?? "")
          .trim()
          .slice(0, 3500),
      }))
      .filter((m) => m.content);

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
    // INDIA DATE / TIME
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

    const todayIndia = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);

    // ========================================================
    // SYSTEM
    // ========================================================

    const systemContent =
      SYSTEM_PROMPT +
      `

भारत में अभी की तारीख और समय: ${indiaNow}

बहुत महत्वपूर्ण:
यदि User वर्तमान जानकारी पूछता है, तो Search result की वास्तविक तारीख
और डेटा की तारीख को ध्यान में रखो।

पुराने Search result को आज की जानकारी मत बताओ।
भविष्य की तारीख वाले result को भी आज की जानकारी का प्रमाण मत मानो।
`;

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

SEARCH INSTRUCTIONS:

आज भारत में तारीख ${todayIndia} है।

इस सवाल का उत्तर देने के लिए Browser Search अनिवार्य रूप से उपयोग करो।

यदि सवाल आज/अभी/current/latest/tाजा जानकारी के बारे में है,
तो आज की तारीख ${todayIndia} के लिए नवीनतम उपलब्ध जानकारी खोजो।

Search result की प्रकाशित या अपडेट तारीख को ध्यान से देखो।

पुराने result को आज का result मत मानो।

यदि आज का विश्वसनीय डेटा नहीं मिलता,
तो साफ बताओ कि आज का ताजा डेटा उपलब्ध नहीं मिला।

पुरानी तारीख वाले मौसम पेज को आज का मौसम मत बताओ।
`;

      payload.messages[payload.messages.length - 1] = {
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
    // GROQ REQUEST
    // ========================================================

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    // ========================================================
    // RETRY
    // ========================================================

    if (!result.ok && result.retryable) {
      const waitMs = result.retryAfterMs || 9000;

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
          requestId: result.requestId || null,
        },
        result.status || 502
      );
    }

    if (!result.reply) {
      return json(
        {
          error: "AI ने खाली उत्तर दिया। फिर से कोशिश करें।",
          code: "EMPTY_RESPONSE",
        },
        502
      );
    }

    // ========================================================
    // OLD SEARCH RESULT PROTECTION
    // ========================================================

    if (useSearch) {
      const currentQuestion = message.toLowerCase();

      const asksCurrentInfo =
        /आज|अभी|ताज़ा|ताजा|latest|current|today|now|live/.test(
          currentQuestion
        );

      if (asksCurrentInfo) {
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
        };

        const dateRegex =
          /(\d{1,2})[\s\u00A0\u202F]*(जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर)[\s\u00A0\u202F]*(\d{4})/gi;

        const foundDates = [
          ...result.reply.matchAll(dateRegex),
        ];

        for (const match of foundDates) {
          const day = String(match[1]).padStart(2, "0");
          const month = monthMap[match[2]];
          const year = match[3];

          if (!month) continue;

          const foundISO =
            `${year}-${month}-${day}`;

          // अगर Search result की तारीख आज से पुरानी है
          if (foundISO < todayISO) {
            return json({
              answer:
                `Search में आज के बजाय पुराना डेटा मिला (${match[0]})।\n\n` +
                `आज ${todayIndia} है। इसलिए मैं ${match[0]} के पुराने डेटा को आज की जानकारी बताकर गलत जवाब नहीं दूँगा।\n\n` +
                `आज की तारीख का विश्वसनीय ताजा डेटा Search में नहीं मिला।`,
              selfChecked: false,
              selfCorrected: false,
              searchUsed: true,
            });
          }

          // भविष्य की तारीख
          if (foundISO > todayISO) {
            return json({
              answer:
                `Search में भविष्य की तारीख (${match[0]}) वाला डेटा मिला। ` +
                `इसे आज की जानकारी का प्रमाण नहीं माना जा सकता।\n\n` +
                `आज ${todayIndia} है और आज का विश्वसनीय डेटा Search में नहीं मिला।`,
              selfChecked: false,
              selfCorrected: false,
              searchUsed: true,
            });
          }
        }
      }

      // Search answer को Self-check से दोबारा बदलने मत दो
      return json({
        answer: result.reply,
        selfChecked: false,
        selfCorrected: false,
        searchUsed: true,
      });
    }

    // ========================================================
    // NORMAL CHAT SELF CHECK
    // ========================================================

    const checked = await selfCheckAndCorrect(
      messages,
      result.reply,
      env.GROQ_API_KEY,
      false
    );

    return json({
      answer: checked.reply,
      selfChecked: checked.selfChecked,
      selfCorrected: checked.selfCorrected,
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
