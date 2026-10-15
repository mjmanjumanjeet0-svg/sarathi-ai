export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // स्वास्थ्य जाँच और आज की तारीख
    if (request.method === "GET") {
      const now = new Date();

      return json({
        success: true,
        name: "Sarathi AI",
        status: "running",
        date: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(now),
        time: new Intl.DateTimeFormat("hi-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }).format(now),
      });
    }

    if (url.pathname !== "/api/chat") {
      return json({ error: "API endpoint नहीं मिला।" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "केवल POST अनुरोध स्वीकार है।" }, 405);
    }

    if (!env.GROQ_API_KEY) {
      return json({
        error: "Cloudflare में GROQ_API_KEY सेट नहीं है।",
      }, 500);
    }

    try {
      const body = await request.json();

      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return json({
          error: "कृपया अपना सवाल लिखें।",
        }, 400);
      }

      // भारत की तारीख और समय
      const now = new Date();

      const currentDate = new Intl.DateTimeFormat("hi-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now);

      const currentTime = new Intl.DateTimeFormat("hi-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(now);

      // संदेशों की जाँच
      const messages = body.messages
        .filter(
          (m) =>
            m &&
            ["user", "assistant"].includes(m.role) &&
            typeof m.content === "string"
        )
        .slice(-20)
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 12000),
        }));

      if (!messages.length) {
        return json({ error: "कोई वैध संदेश नहीं मिला।" }, 400);
      }

      const latestUserMessage = [...messages]
        .reverse()
        .find((m) => m.role === "user")?.content || "";

      let webContext = "";
      let searchWarning = "";
      let searchedWeb = false;

      // इंटरनेट सर्च केवल माँगने पर
      const webSearchEnabled =
        body.webSearch === true || body.internet === true;

      if (webSearchEnabled) {
        if (!env.TAVILY_API_KEY) {
          searchWarning =
            "लाइव इंटरनेट सर्च के लिए Cloudflare में TAVILY_API_KEY जोड़ें।";
        } else {
          try {
            const searchResponse = await fetch(
              "https://api.tavily.com/search",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  api_key: env.TAVILY_API_KEY,
                  query: latestUserMessage,
                  topic: "general",
                  search_depth: "basic",
                  max_results: 5,
                  include_answer: true,
                }),
                signal: AbortSignal.timeout(15000),
              }
            );

            if (searchResponse.ok) {
              const searchData = await searchResponse.json();

              const results = Array.isArray(searchData.results)
                ? searchData.results
                : [];

              webContext = results
                .map((item, index) => {
                  return [
                    `स्रोत ${index + 1}: ${item.title || "शीर्षक नहीं"}`,
                    `वेबसाइट: ${item.url || ""}`,
                    `जानकारी: ${(item.content || "").slice(0, 2500)}`,
                  ].join("\n");
                })
                .join("\n\n");

              if (searchData.answer) {
                webContext =
                  `सर्च सारांश:\n${searchData.answer}\n\n${webContext}`;
              }

              searchedWeb = results.length > 0 ||
                Boolean(searchData.answer);

              if (!searchedWeb) {
                searchWarning =
                  "इंटरनेट सर्च से उपयोगी परिणाम नहीं मिले।";
              }
            } else {
              searchWarning =
                "इंटरनेट सर्च सेवा अभी परिणाम नहीं दे रही है।";
            }
          } catch (error) {
            console.error("Web search failed:", error.message);

            searchWarning =
              "इंटरनेट सर्च में समस्या आई। थोड़ी देर बाद कोशिश करें।";
          }
        }
      }

      const systemPrompt = `
तुम सारथी AI हो, एक उपयोगी, विनम्र और सच्चाई बताने वाले हिंदी AI सहायक।

वर्तमान भारतीय तारीख: ${currentDate}
वर्तमान भारतीय समय: ${currentTime}
समय क्षेत्र: Asia/Kolkata

नियम:
1. उपयोगकर्ता से उसकी भाषा में सरल और स्पष्ट उत्तर दो।
2. तारीख पूछने पर ऊपर दी गई वर्तमान तारीख बताओ।
3. वर्तमान जानकारी का दावा बिना प्रमाण के मत करो।
4. सोने के भाव, मौसम, ट्रेन की स्थिति और अन्य बदलती जानकारी में
   उपलब्ध ताज़ा स्रोतों को प्राथमिकता दो।
5. यदि लाइव जानकारी उपलब्ध नहीं है, तो साफ बताओ।
6. खोज के परिणामों में दिए गए तथ्यों और तारीखों को ध्यान से देखो।
7. खोज परिणामों के स्रोतों के URL उत्तर में स्पष्ट लिखो।
8. यदि खोज में कोई जानकारी नहीं मिली, तो उसे खोजकर मिला हुआ मत बताओ।
9. उपयोगकर्ता ने जो नहीं पूछा, उसके बारे में अनावश्यक लंबा उत्तर मत दो।

${
  webContext
    ? `नीचे इंटरनेट सर्च से प्राप्त जानकारी है।
इसे उपयोगी संदर्भ की तरह इस्तेमाल करो, लेकिन गलत या अप्रमाणित
दावों को तथ्य बनाकर प्रस्तुत मत करो।

${webContext}`
    : webSearchEnabled
      ? "इस अनुरोध में उपयोगी इंटरनेट परिणाम उपलब्ध नहीं हैं। लाइव जानकारी होने का झूठा दावा मत करो।"
      : "इस अनुरोध के लिए अलग से इंटरनेट सर्च परिणाम उपलब्ध नहीं हैं।"
}
`;

      // Groq AI अनुरोध
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              ...messages,
            ],
            temperature: 0.5,
            max_completion_tokens: 2048,
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!groqResponse.ok) {
        const errorText = await groqResponse.text();

        console.error(
          "Groq request failed:",
          groqResponse.status,
          errorText.slice(0, 1500)
        );

        return json({
          error:
            groqResponse.status === 401
              ? "Groq API Key सही नहीं है। Cloudflare Secret जाँचें।"
              : groqResponse.status === 429
                ? "AI सेवा की अनुरोध सीमा पूरी हो गई है। थोड़ी देर बाद प्रयास करें।"
                : "AI सेवा से जवाब नहीं मिला। Cloudflare Logs जाँचें।",
        }, 502);
      }

      const result = await groqResponse.json();

      const reply = result.choices?.[0]?.message?.content;

      if (typeof reply !== "string" || !reply.trim()) {
        console.error("Groq returned an empty or invalid response.");

        return json({
          error: "AI से खाली जवाब मिला। दोबारा प्रयास करें।",
        }, 502);
      }

      return json({
        reply: reply.trim(),
        webSearch: searchedWeb,
        searchWarning: searchWarning || undefined,
        date: currentDate,
        time: currentTime,
      });
    } catch (error) {
      console.error("Worker error:", error.message);

      return json({
        error:
          error.name === "TimeoutError"
            ? "अनुरोध में समय अधिक लग गया। दोबारा प्रयास करें।"
            : "सर्वर में समस्या आई। कृपया दोबारा कोशिश करें।",
      }, 500);
    }
  },
};
