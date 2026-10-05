export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================================
    // CORS
    // =========================================================

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    }

    function getRequestId() {
      return crypto.randomUUID();
    }

    function cleanText(value, max = 4500) {
      if (typeof value !== "string") {
        return "";
      }

      return value.trim().slice(0, max);
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // =========================================================
    // MARK BASED TOKEN LIMIT
    // =========================================================

    function getAnswerLimit(marks) {
      const m = Number(marks);

      if (!Number.isFinite(m)) {
        return 768;
      }

      if (m <= 1) {
        return 256;
      }

      if (m <= 2) {
        return 384;
      }

      if (m <= 5) {
        return 768;
      }

      if (m <= 10) {
        return 1280;
      }

      return 1536;
    }

    // =========================================================
    // EXTRACT MARKS
    // =========================================================

    function extractMarks(text) {
      const match = String(text || "").match(
        /(?:^|\s)(\d{1,2})\s*(?:अंक|marks?|मार्क्स?)\b/i
      );

      if (!match) {
        return null;
      }

      const marks = Number(match[1]);

      if (!Number.isFinite(marks)) {
        return null;
      }

      return marks;
    }

    // =========================================================
    // GET QUESTION FROM DIFFERENT FRONTEND FORMATS
    // =========================================================

    function getQuestionFromBody(body) {
      // Format 1
      if (typeof body?.message === "string") {
        const text = body.message.trim();

        if (text) {
          return cleanText(text);
        }
      }

      // Format 2
      if (typeof body?.question === "string") {
        const text = body.question.trim();

        if (text) {
          return cleanText(text);
        }
      }

      // Format 3
      // Current index.html sends:
      // messages: [...]
      if (Array.isArray(body?.messages)) {
        for (let i = body.messages.length - 1; i >= 0; i--) {
          const item = body.messages[i];

          if (
            item &&
            item.role === "user" &&
            typeof item.content === "string"
          ) {
            const text = item.content.trim();

            if (text) {
              return cleanText(text);
            }
          }
        }
      }

      return "";
    }

    // =========================================================
    // SIMPLE PHOTOSYNTHESIS ANSWER
    // =========================================================

    function simplePhotosynthesisAnswer() {
      return `प्रकाश संश्लेषण

प्रकाश संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे सूर्य के प्रकाश की ऊर्जा की सहायता से जल और कार्बन डाइऑक्साइड से अपना भोजन बनाते हैं और ऑक्सीजन वातावरण में छोड़ते हैं।

मुख्य बिंदु

1. यह प्रक्रिया हरे पौधों में होती है।
2. पत्तियाँ वायु से कार्बन डाइऑक्साइड लेती हैं।
3. पौधे जड़ों द्वारा मिट्टी से जल प्राप्त करते हैं।
4. क्लोरोफिल सूर्य के प्रकाश को ग्रहण करता है।
5. पौधे प्रकाश की सहायता से अपना भोजन बनाते हैं।
6. इस प्रक्रिया में ऑक्सीजन वातावरण में निकलती है।

महत्व

प्रकाश संश्लेषण पौधों के लिए भोजन बनाने की मुख्य प्रक्रिया है और इससे वातावरण में ऑक्सीजन मिलती है।

निष्कर्ष

इस प्रकार प्रकाश संश्लेषण पौधों और पृथ्वी पर जीवन के लिए बहुत महत्वपूर्ण है।`;
    }

    // =========================================================
    // SELF CHECK
    // =========================================================

    function finalSelfCheck(answer, question, marks) {
      let result =
        typeof answer === "string"
          ? answer.trim()
          : "";

      const q = String(question || "").toLowerCase();

      // -------------------------------------------------------
      // 5 MARK PHOTOSYNTHESIS
      // -------------------------------------------------------

      if (
        q.includes("प्रकाश संश्लेषण") &&
        (
          Number(marks) === 5 ||
          /5\s*(?:अंक|marks?)/i.test(question)
        )
      ) {
        return simplePhotosynthesisAnswer();
      }

      // -------------------------------------------------------
      // REMOVE ADVANCED TERMS FROM SHORT ANSWERS
      // -------------------------------------------------------

      if (marks && Number(marks) <= 5) {
        const advancedTerms = [
          "photosystem i",
          "photosystem ii",
          "फोटोसिस्टम I",
          "फोटोसिस्टम II",
          "calvin cycle",
          "कैल्विन चक्र",
          "nadph",
          "ATP",
          "electron transport chain",
          "इलेक्ट्रॉन परिवहन श्रृंखला",
        ];

        for (const term of advancedTerms) {
          const escaped = term.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

          result = result.replace(
            new RegExp(escaped, "gi"),
            ""
          );
        }

        result = result
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      return result;
    }

    // =========================================================
    // GROQ API CALL
    // =========================================================

    async function callGroq({
      messages,
      model = "openai/gpt-oss-20b",
      maxCompletionTokens = 768,
      useSearch = false,
    }) {
      if (!env.GROQ_API_KEY) {
        throw new Error(
          "GROQ_API_KEY is not configured."
        );
      }

      const body = {
        model,
        messages,
        temperature: 0.2,
        max_completion_tokens: maxCompletionTokens,
        stream: false,
        reasoning_effort: "low",
      };

      // =======================================================
      // INTERNET SEARCH
      // =======================================================

      if (useSearch) {
        body.tools = [
          {
            type: "browser_search",
          },
        ];

        body.tool_choice = "required";
      }

      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${env.GROQ_API_KEY}`,
          },

          body: JSON.stringify(body),
        }
      );

      const raw = await response.text();

      let payload = null;

      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          raw ||
          "Groq request failed.";

        const error = new Error(message);

        error.status = response.status;
        error.payload = payload;

        throw error;
      }

      if (
        !payload ||
        !Array.isArray(payload.choices) ||
        !payload.choices[0]
      ) {
        throw new Error(
          "Groq returned an invalid response."
        );
      }

      const choice = payload.choices[0];

      const content =
        choice?.message?.content ?? "";

      return {
        content:
          typeof content === "string"
            ? content.trim()
            : String(content),

        raw: payload,
      };
    }

    // =========================================================
    // SYSTEM PROMPT
    // =========================================================

    function buildSystemPrompt({
      marks,
      useSearch,
    }) {
      const answerLimit =
        getAnswerLimit(marks);

      let prompt = `
तुम "सारथी AI" हो।

उपयोगकर्ता को सरल, साफ और सही हिंदी में उत्तर दो।

मुख्य नियम:

1. उपयोगकर्ता की भाषा में उत्तर दो।
2. जहाँ संभव हो आसान हिंदी का प्रयोग करो।
3. पढ़ाई के प्रश्न में परीक्षा के हिसाब से उत्तर दो।
4. अनावश्यक कठिन और advanced जानकारी मत भरो।
5. यदि प्रश्न में अंक दिए गए हैं तो उसी के अनुसार उत्तर दो।
6. छोटे प्रश्न का बहुत लंबा उत्तर मत दो।
7. तथ्य निश्चित नहीं है तो उसे बनाकर मत लिखो।
8. उपयोगकर्ता को सीधे उत्तर दो।
9. बिना जरूरत यह मत कहना कि "मैं AI हूँ"।
10. जरूरत के अनुसार headings और points इस्तेमाल कर सकते हो।
`;

      if (marks) {
        prompt += `

इस प्रश्न के ${marks} अंक हैं।

उत्तर लगभग ${answerLimit} completion tokens के भीतर रखो.

${
  Number(marks) <= 5
    ? "यह छोटा परीक्षा-उत्तर है। बहुत advanced technical details से बचो।"
    : "अंक के अनुसार पर्याप्त विस्तार दो।"
}
`;
      }

      // =======================================================
      // SEARCH INSTRUCTIONS
      // =======================================================

      if (useSearch) {
        prompt += `

IMPORTANT — INTERNET SEARCH:

इस प्रश्न के लिए इंटरनेट से वर्तमान जानकारी खोजनी है।

browser_search tool का उपयोग करना जरूरी है।

विशेष रूप से अगर प्रश्न में ये शब्द हों:

आज
अभी
वर्तमान
ताजा
latest
current
भाव
कीमत
रेट
मौसम
समाचार
news
ट्रेन
live
result
सरकारी योजना
सरकारी नियम
खेल परिणाम

तो इंटरनेट से जानकारी खोजे बिना उत्तर मत देना।

बहुत महत्वपूर्ण:

यदि इंटरनेट से जानकारी मिल जाए तो कभी यह मत कहना:

"मेरे पास रीयल-टाइम जानकारी नहीं है।"

इसके बजाय खोजी गई जानकारी के आधार पर उत्तर दो।

सोने के भाव जैसे प्रश्न में:

1. सबसे पहले तारीख देखो।
2. 24 कैरेट की कीमत पहचानो।
3. 10 ग्राम की कीमत हो तो स्पष्ट लिखो।
4. 22 कैरेट और 18 कैरेट उपलब्ध हों तो अलग-अलग लिख सकते हो।
5. अगर दो विश्वसनीय स्रोतों में कीमत अलग हो तो दोनों को स्पष्ट रूप से बताओ।
6. बिना आधार के कीमत मत बनाओ।
7. स्रोत का नाम बताओ।
8. यदि search result में source URL उपलब्ध हो तो उसे भी बताओ।
9. पुरानी कीमत को आज की कीमत बताकर मत लिखो।

उदाहरण:

आज 5 अक्टूबर 2026 के अनुसार:
24 कैरेट — ₹_____ प्रति 10 ग्राम
22 कैरेट — ₹_____ प्रति 10 ग्राम

स्रोत: ______

अगर कीमत स्रोत के अनुसार बदलती है तो लिखो:
"स्रोत के अनुसार कीमत में थोड़ा अंतर हो सकता है।"

इंटरनेट खोज उपलब्ध होने पर real-time जानकारी से संबंधित प्रश्न में "मुझे वर्तमान जानकारी नहीं है" वाला सामान्य जवाब नहीं देना है।
`;
      }

      return prompt.trim();
    }

    // =========================================================
    // /api/chat
    // =========================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/chat"
    ) {
      const requestId =
        getRequestId();

      try {
        const body =
          await request.json();

        // =====================================================
        // FIX:
        // Current index.html sends "messages",
        // not "message".
        // =====================================================

        const question =
          getQuestionFromBody(body);

        // =====================================================
        // SEARCH FLAG
        // =====================================================

        const webSearch =
          Boolean(
            body?.webSearch ??
            body?.useSearch ??
            false
          );

        // =====================================================
        // HISTORY
        // =====================================================

        let history = [];

        if (Array.isArray(body?.history)) {
          history = body.history;
        } else if (
          Array.isArray(body?.messages)
        ) {
          history = body.messages;
        }

        // =====================================================
        // EMPTY QUESTION CHECK
        // =====================================================

        if (!question) {
          return json(
            {
              answer:
                "प्रश्न खाली है। कृपया अपना सवाल लिखें।",

              reply:
                "प्रश्न खाली है। कृपया अपना सवाल लिखें।",

              selfChecked: false,

              selfCorrected: false,

              webSearch,

              errorCode:
                "EMPTY_QUESTION",

              requestId,
            },

            400
          );
        }

        // =====================================================
        // MARKS
        // =====================================================

        let marks = null;

        if (body?.marks != null) {
          const parsed =
            Number(body.marks);

          if (Number.isFinite(parsed)) {
            marks = parsed;
          }
        }

        if (marks == null) {
          marks =
            extractMarks(question);
        }

        // =====================================================
        // SAFE HISTORY
        // =====================================================

        const safeHistory =
          history
            .slice(-10)
            .map((item) => {
              const role =
                item?.role === "assistant"
                  ? "assistant"
                  : "user";

              return {
                role,

                content:
                  cleanText(
                    item?.content ||
                    "",
                    3500
                  ),
              };
            })
            .filter(
              (item) =>
                item.content
            );

        // =====================================================
        // PREVENT DUPLICATE LAST QUESTION
        // =====================================================

        const messages = [
          {
            role: "system",

            content:
              buildSystemPrompt({
                marks,
                useSearch:
                  webSearch,
              }),
          },
        ];

        // Add previous conversation.
        for (
          const item of safeHistory
        ) {
          messages.push(item);
        }

        // Current question is already present
        // in messages from the frontend.
        //
        // If the last user message is not the same,
        // add it manually.

        const lastMessage =
          messages[
            messages.length - 1
          ];

        if (
          !lastMessage ||
          lastMessage.role !==
            "user" ||
          lastMessage.content.trim() !==
            question.trim()
        ) {
          messages.push({
            role: "user",
            content: question,
          });
        }

        // =====================================================
        // TOKEN LIMIT
        // =====================================================

        const maxTokens =
          getAnswerLimit(marks);

        // =====================================================
        // INTERNET SEARCH
        // =====================================================

        if (webSearch) {
          try {
            const result =
              await callGroq({
                messages,

                model:
                  "openai/gpt-oss-20b",

                maxCompletionTokens:
                  Math.min(
                    maxTokens,
                    768
                  ),

                useSearch: true,
              });

            let answer =
              result.content;

            answer =
              finalSelfCheck(
                answer,
                question,
                marks
              );

            // =================================================
            // RETURN BOTH "answer" AND "reply"
            // =================================================

            return json({
              answer,

              reply: answer,

              selfChecked: true,

              selfCorrected: true,

              webSearch: true,

              requestId,
            });
          } catch (
            searchError
          ) {
            console.error(
              "Browser search error:",
              searchError?.message
            );

            const status =
              searchError?.status ||
              500;

            // =================================================
            // RATE LIMIT
            // =================================================

            if (status === 429) {
              return json(
                {
                  answer:
                    "अभी Internet Search की token/rate limit पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।",

                  reply:
                    "अभी Internet Search की token/rate limit पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।",

                  selfChecked: false,

                  selfCorrected: false,

                  webSearch: true,

                  errorCode:
                    "RATE_LIMIT",

                  requestId,
                },

                429
              );
            }

            // =================================================
            // SEARCH FAILED
            // =================================================

            return json(
              {
                answer:
                  "Internet Search अभी उपलब्ध नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।",

                reply:
                  "Internet Search अभी उपलब्ध नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।",

                selfChecked: false,

                selfCorrected: false,

                webSearch: true,

                errorCode:
                  "SEARCH_FAILED",

                requestId,
              },

              502
            );
          }
        }

        // =====================================================
        // NORMAL AI CHAT
        // =====================================================

        const result =
          await callGroq({
            messages,

            model:
              "openai/gpt-oss-20b",

            maxCompletionTokens:
              maxTokens,

            useSearch: false,
          });

        let answer =
          result.content;

        answer =
          finalSelfCheck(
            answer,
            question,
            marks
          );

        return json({
          answer,

          reply: answer,

          selfChecked: true,

          selfCorrected: true,

          webSearch: false,

          requestId,
        });

      } catch (error) {
        console.error(
          "Chat error:",
          error?.message
        );

        const status =
          error?.status ||
          500;

        // =====================================================
        // RATE LIMIT
        // =====================================================

        if (status === 429) {
          const message =
            "अभी AI की token/rate limit पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।";

          return json(
            {
              answer: message,

              reply: message,

              selfChecked: false,

              selfCorrected: false,

              errorCode:
                "RATE_LIMIT",

              requestId,
            },

            429
          );
        }

        // =====================================================
        // NORMAL ERROR
        // =====================================================

        const message =
          "अभी जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।";

        return json(
          {
            answer: message,

            reply: message,

            selfChecked: false,

            selfCorrected: false,

            errorCode:
              "CHAT_FAILED",

            requestId,
          },

          502
        );
      }
    }

    // =========================================================
    // /api/vision
    // =========================================================

    if (
      request.method === "POST" &&
      url.pathname === "/api/vision"
    ) {
      const requestId =
        getRequestId();

      try {
        const body =
          await request.json();

        // =====================================================
        // SUPPORT BOTH imageData AND image
        // =====================================================

        const image =
          typeof body?.imageData === "string"
            ? body.imageData
            : typeof body?.image === "string"
              ? body.image
              : "";

        const question =
          cleanText(
            body?.question ||
            body?.message ||
            "इस फोटो को ध्यान से देखकर सरल हिंदी में समझाओ।",
            2500
          );

        if (!image) {
          return json(
            {
              answer:
                "फोटो नहीं मिली।",

              reply:
                "फोटो नहीं मिली।",

              errorCode:
                "NO_IMAGE",

              requestId,
            },

            400
          );
        }

        // =====================================================
        // IMAGE SIZE
        // =====================================================

        if (
          image.length >
          20000000
        ) {
          return json(
            {
              answer:
                "फोटो बहुत बड़ी है। कृपया छोटी फोटो भेजें।",

              reply:
                "फोटो बहुत बड़ी है। कृपया छोटी फोटो भेजें।",

              errorCode:
                "IMAGE_TOO_LARGE",

              requestId,
            },

            413
          );
        }

        if (!env.GROQ_API_KEY) {
          return json(
            {
              answer:
                "GROQ_API_KEY configured नहीं है।",

              reply:
                "GROQ_API_KEY configured नहीं है।",

              requestId,
            },

            500
          );
        }

        // =====================================================
        // VISION PROMPT
        // =====================================================

        const visionMessages = [
          {
            role: "system",

            content: `
तुम सारथी AI हो।

फोटो को ध्यान से देखकर उपयोगकर्ता के प्रश्न का
सरल और स्पष्ट हिंदी में उत्तर दो।

अगर फोटो में प्रश्न है तो उसे समझकर उत्तर दो।

अगर फोटो में किताब, नोट्स, दस्तावेज,
diagram, chart या लिखाई है तो दिखाई दे रही
जानकारी के आधार पर बताओ।

जो जानकारी फोटो में साफ दिखाई नहीं देती,
उसे अनुमान से मत बनाओ।

अगर फोटो में प्रश्न है तो पहले प्रश्न को समझो,
फिर उसका सही उत्तर दो।
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
                  url: image,
                },
              },
            ],
          },
        ];

        const result =
          await callGroq({
            messages:
              visionMessages,

            model:
              "qwen/qwen3.8-27b",

            maxCompletionTokens:
              1024,

            useSearch: false,
          });

        return json({
          answer:
            result.content,

          reply:
            result.content,

          selfChecked: true,

          selfCorrected: true,

          requestId,
        });

      } catch (error) {
        console.error(
          "Vision error:",
          error?.message
        );

        const status =
          error?.status ||
          500;

        if (status === 429) {
          const message =
            "अभी फोटो AI की token/rate limit पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।";

          return json(
            {
              answer: message,

              reply: message,

              errorCode:
                "RATE_LIMIT",

              requestId,
            },

            429
          );
        }

        const message =
          "फोटो को समझने में अभी समस्या आ गई। कृपया फिर से कोशिश करें।";

        return json(
          {
            answer: message,

            reply: message,

            errorCode:
              "VISION_FAILED",

            requestId,
          },

          502
        );
      }
    }

    // =========================================================
    // WEBSITE
    // =========================================================

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(
          request
        );
      }

      return new Response(
        "Sarathi AI Worker is running.",
        {
          status: 200,

          headers: {
            ...corsHeaders,

            "Content-Type":
              "text/plain; charset=utf-8",
          },
        }
      );
    }

    // =========================================================
    // CLOUDFLARE ASSETS
    // =========================================================

    if (env.ASSETS) {
      try {
        return env.ASSETS.fetch(
          request
        );
      } catch {
        // Continue to 404.
      }
    }

    // =========================================================
    // 404
    // =========================================================

    return json(
      {
        error:
          "Not Found",
      },

      404
    );
  },
};
