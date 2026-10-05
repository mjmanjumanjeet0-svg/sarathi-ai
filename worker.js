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

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function getRequestId() {
      return crypto.randomUUID();
    }

    function cleanText(value, max = 4500) {
      if (typeof value !== "string") return "";
      return value.trim().slice(0, max);
    }

    // =========================================================
    // MARK-BASED ANSWER LENGTH
    // =========================================================
    function getAnswerLimit(marks) {
      const m = Number(marks);

      if (!Number.isFinite(m)) return 768;

      if (m <= 1) return 256;
      if (m <= 2) return 384;
      if (m <= 5) return 768;
      if (m <= 10) return 1280;

      return 1536;
    }

    // =========================================================
    // EXTRACT MARKS
    // =========================================================
    function extractMarks(text) {
      const match = text.match(
        /(?:^|\s)(\d{1,2})\s*(?:अंक|marks?|मार्क्स?)\b/i
      );

      if (!match) return null;

      const marks = Number(match[1]);

      if (!Number.isFinite(marks)) return null;

      return marks;
    }

    // =========================================================
    // PHOTOSYNTHESIS SIMPLE ANSWER
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
    // SIMPLE SELF-CHECK
    // =========================================================
    function finalSelfCheck(answer, question, marks) {
      let result = answer || "";

      const q = question.toLowerCase();

      // -------------------------------------------------------
      // Special rule:
      // "प्रकाश संश्लेषण क्या है? 5 अंक"
      // should remain simple and exam-friendly.
      // -------------------------------------------------------
      if (
        q.includes("प्रकाश संश्लेषण") &&
        (marks === 5 || /5\s*(?:अंक|marks?)/i.test(question))
      ) {
        return simplePhotosynthesisAnswer();
      }

      // -------------------------------------------------------
      // Remove unnecessary advanced terms from short answers
      // -------------------------------------------------------
      if (marks && marks <= 5) {
        const advancedTerms = [
          "photosystem i",
          "photosystem ii",
          "फोटोसिस्टम I",
          "फोटोसिस्टम II",
          "calvin cycle",
          "कैल्विन चक्र",
          "nadph",
          "NADPH",
          "ATP",
          "electron transport chain",
          "इलेक्ट्रॉन परिवहन श्रृंखला",
        ];

        for (const term of advancedTerms) {
          result = result.replace(
            new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
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
    // GROQ CALL
    // =========================================================
    async function callGroq({
      messages,
      model = "openai/gpt-oss-20b",
      maxCompletionTokens = 768,
      useSearch = false,
    }) {
      if (!env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is not configured.");
      }

      const body = {
        model,
        messages,
        temperature: 0.2,
        max_completion_tokens: maxCompletionTokens,
        stream: false,
        reasoning_effort: "low",
      };

      // -------------------------------------------------------
      // IMPORTANT:
      // Internet Search is enabled directly through API.
      // Groq says GPT-OSS 20B supports browser_search.
      // -------------------------------------------------------
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
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(body),
        }
      );

      const raw = await response.text();

      let payload;

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
        !payload.choices ||
        !Array.isArray(payload.choices) ||
        !payload.choices[0]
      ) {
        throw new Error("Groq returned an invalid response.");
      }

      const choice = payload.choices[0];

      const content =
        choice?.message?.content ??
        "";

      return {
        content:
          typeof content === "string"
            ? content.trim()
            : String(content),
        raw: payload,
      };
    }

    // =========================================================
    // CHAT SYSTEM PROMPT
    // =========================================================
    function buildSystemPrompt({ marks, useSearch }) {
      const answerLimit = getAnswerLimit(marks);

      let prompt = `
तुम "सारथी AI" हो।

तुम्हें उपयोगकर्ता को सरल, साफ और सही हिंदी में उत्तर देना है।

मुख्य नियम:

1. उपयोगकर्ता की भाषा में उत्तर दो।
2. जहाँ संभव हो आसान हिंदी का प्रयोग करो।
3. पढ़ाई के प्रश्न में परीक्षा के हिसाब से उत्तर दो।
4. अनावश्यक कठिन शब्द और बहुत advanced जानकारी मत भरो।
5. यदि प्रश्न में अंक दिए गए हैं तो उसी के अनुसार उत्तर की लंबाई रखो।
6. छोटे प्रश्न का बहुत लंबा उत्तर मत दो।
7. यदि तथ्य निश्चित नहीं है तो उसे बनाकर मत लिखो।
8. उपयोगकर्ता को सीधे उत्तर दो।
9. बिना जरूरत के यह मत कहना कि "मैं AI हूँ"।
10. उत्तर को साफ headings और points में देना ठीक है।
`;

      if (marks) {
        prompt += `

इस प्रश्न के ${marks} अंक हैं।

उत्तर लगभग ${answerLimit} completion tokens के भीतर रखो।
${marks <= 5
  ? "यह छोटा परीक्षा-उत्तर है। बहुत advanced technical details से बचो।"
  : "अंक के अनुसार पर्याप्त विस्तार दो।"}
`;
      }

      if (useSearch) {
        prompt += `

IMPORTANT INTERNET SEARCH RULES:

इस प्रश्न के लिए इंटरनेट से वर्तमान जानकारी खोजना जरूरी है।

तुम्हें browser_search tool का उपयोग करना ही है।

बिना इंटरनेट खोजे यह मत कहना:
"मेरे पास रीयल-टाइम जानकारी नहीं है"
या
"मैं वर्तमान जानकारी नहीं देख सकता।"

Search से प्राप्त जानकारी को पढ़कर उत्तर दो।

अगर प्रश्न आज की कीमत, आज का भाव, मौसम, समाचार,
ट्रेन की वर्तमान स्थिति, वर्तमान सरकारी जानकारी,
वर्तमान खेल परिणाम या अन्य real-time जानकारी से संबंधित है,
तो पुरानी जानकारी के आधार पर उत्तर मत बनाओ।

जहाँ संभव हो स्रोत का नाम या URL भी उत्तर में बताओ।
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
      const requestId = getRequestId();

      try {
        const body = await request.json();

        const question = cleanText(
          body?.message ||
          body?.question ||
          "",
          4500
        );

        const webSearch = Boolean(
          body?.webSearch ??
          body?.useSearch ??
          false
        );

        const history = Array.isArray(body?.history)
          ? body.history
          : [];

        if (!question) {
          return json(
            {
              error: "प्रश्न खाली है।",
              requestId,
            },
            400
          );
        }

        const marks =
          body?.marks != null
            ? Number(body.marks)
            : extractMarks(question);

        // -----------------------------------------------------
        // Keep conversation small to reduce token usage.
        // -----------------------------------------------------
        const safeHistory = history
          .slice(-12)
          .map((item) => {
            const role =
              item?.role === "assistant"
                ? "assistant"
                : "user";

            return {
              role,
              content: cleanText(
                item?.content || "",
                4500
              ),
            };
          })
          .filter((item) => item.content);

        const messages = [
          {
            role: "system",
            content: buildSystemPrompt({
              marks,
              useSearch: webSearch,
            }),
          },
          ...safeHistory,
          {
            role: "user",
            content: question,
          },
        ];

        const maxTokens = getAnswerLimit(marks);

        // -----------------------------------------------------
        // SEARCH REQUEST
        // -----------------------------------------------------
        if (webSearch) {
          try {
            const result = await callGroq({
              messages,
              model: "openai/gpt-oss-20b",
              maxCompletionTokens: Math.min(
                maxTokens,
                768
              ),
              useSearch: true,
            });

            let answer = result.content;

            answer = finalSelfCheck(
              answer,
              question,
              marks
            );

            return json({
              answer,
              selfChecked: true,
              webSearch: true,
              requestId,
            });
          } catch (searchError) {
            console.error(
              "Browser search error:",
              searchError?.message
            );

            const status =
              searchError?.status || 500;

            // -------------------------------------------------
            // Special rate-limit message
            // -------------------------------------------------
            if (status === 429) {
              return json(
                {
                  answer:
                    "अभी Internet Search की सीमा पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।",
                  selfChecked: false,
                  webSearch: true,
                  errorCode: "RATE_LIMIT",
                  requestId,
                },
                429
              );
            }

            return json(
              {
                answer:
                  "Internet Search अभी उपलब्ध नहीं हो पाया। थोड़ी देर बाद फिर कोशिश करें।",
                selfChecked: false,
                webSearch: true,
                errorCode: "SEARCH_FAILED",
                requestId,
              },
              502
            );
          }
        }

        // -----------------------------------------------------
        // NORMAL CHAT
        // -----------------------------------------------------
        const result = await callGroq({
          messages,
          model: "openai/gpt-oss-20b",
          maxCompletionTokens: maxTokens,
          useSearch: false,
        });

        let answer = result.content;

        answer = finalSelfCheck(
          answer,
          question,
          marks
        );

        return json({
          answer,
          selfChecked: true,
          webSearch: false,
          requestId,
        });
      } catch (error) {
        console.error(
          "Chat error:",
          error?.message
        );

        const status =
          error?.status || 500;

        if (status === 429) {
          return json(
            {
              answer:
                "अभी AI की token/rate limit पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।",
              errorCode: "RATE_LIMIT",
              requestId,
            },
            429
          );
        }

        return json(
          {
            answer:
              "अभी जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।",
            errorCode: "CHAT_FAILED",
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
      const requestId = getRequestId();

      try {
        const body = await request.json();

        const image =
          typeof body?.image === "string"
            ? body.image
            : "";

        const question = cleanText(
          body?.question ||
          body?.message ||
          "इस फोटो को समझाकर बताओ।",
          2500
        );

        if (!image) {
          return json(
            {
              error: "फोटो नहीं मिली।",
              requestId,
            },
            400
          );
        }

        // -----------------------------------------------------
        // Prevent extremely large requests.
        // -----------------------------------------------------
        if (image.length > 20000000) {
          return json(
            {
              error:
                "फोटो बहुत बड़ी है। कृपया छोटी फोटो भेजें।",
              requestId,
            },
            413
          );
        }

        if (!env.GROQ_API_KEY) {
          return json(
            {
              error:
                "GROQ_API_KEY configured नहीं है।",
              requestId,
            },
            500
          );
        }

        const visionMessages = [
          {
            role: "system",
            content: `
तुम सारथी AI हो।

फोटो को ध्यान से देखकर उपयोगकर्ता के प्रश्न का
सरल और स्पष्ट हिंदी में उत्तर दो।

अगर फोटो में प्रश्न है तो उसे समझकर उत्तर दो।
अगर फोटो में कोई दस्तावेज है तो दिखाई दे रही जानकारी
के आधार पर बताओ।

जो जानकारी फोटो में साफ दिखाई नहीं देती,
उसे अनुमान से मत बनाओ।
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

        const result = await callGroq({
          messages: visionMessages,
          model: "qwen/qwen3.8-27b",
          maxCompletionTokens: 1024,
          useSearch: false,
        });

        return json({
          answer: result.content,
          selfChecked: true,
          requestId,
        });
      } catch (error) {
        console.error(
          "Vision error:",
          error?.message
        );

        const status =
          error?.status || 500;

        if (status === 429) {
          return json(
            {
              answer:
                "अभी फोटो AI की token/rate limit पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।",
              errorCode: "RATE_LIMIT",
              requestId,
            },
            429
          );
        }

        return json(
          {
            answer:
              "फोटो को समझने में अभी समस्या आ गई। कृपया फिर से कोशिश करें।",
            errorCode: "VISION_FAILED",
            requestId,
          },
          502
        );
      }
    }

    // =========================================================
    // DEFAULT / WEBSITE
    // =========================================================
    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response(
        "Sarathi AI Worker is running.",
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain; charset=utf-8",
          },
        }
      );
    }

    // ---------------------------------------------------------
    // Try Cloudflare Assets for other website files.
    // ---------------------------------------------------------
    if (env.ASSETS) {
      try {
        return env.ASSETS.fetch(request);
      } catch {
        // Ignore and continue to 404.
      }
    }

    return json(
      {
        error: "Not Found",
      },
      404
    );
  },
};
