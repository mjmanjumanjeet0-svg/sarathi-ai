export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // AI Chat API
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();

        if (!Array.isArray(body.messages)) {
          return json({ error: "Invalid messages." }, 400);
        }

        if (!env.GROQ_API_KEY) {
          return json(
            {
              error:
                "GROQ_API_KEY is not configured in Cloudflare.",
            },
            500
          );
        }

        const messages = body.messages
          .slice(-20)
          .map((message) => ({
            role:
              message.role === "assistant"
                ? "assistant"
                : "user",

            content: String(
              message.content || ""
            ).slice(0, 8000),
          }));

        const useSearch = body.webSearch === true;

        const systemPrompt = `
तुम "सारथी AI" हो — एक विश्वसनीय, स्पष्ट और विद्यार्थी-अनुकूल हिंदी AI सहायक।

मुख्य नियम:

1. उपयोगकर्ता के प्रश्न को ध्यान से समझो और सीधे उत्तर दो।

2. उत्तर सरल, स्वाभाविक और साफ हिंदी में दो।
जरूरत पड़ने पर सामान्य English technical terms के साथ उनका हिंदी अर्थ भी दो।

3. तथ्य खुद से मत गढ़ो।
नाम, तारीख, वर्ष, सूत्र, आँकड़े, घटनाएँ और वैज्ञानिक तथ्य गलत मत लिखो।

4. यदि किसी तथ्य के बारे में निश्चितता नहीं है, तो उसे निश्चित तथ्य की तरह प्रस्तुत मत करो।

5. प्रश्न में गलत जानकारी हो तो उसे विनम्रता से सुधारो।

6. मशीन-जैसी, अजीब या अप्राकृतिक हिंदी का प्रयोग मत करो।
"समाजिक" नहीं, "सामाजिक" लिखो।
"प्रकाशन के विचार" नहीं, "प्रबोधन के विचार" लिखो।
"वित्तीय दांव-पेंच" नहीं, "वित्तीय संकट" लिखो।
"भूख-भण्डार की स्थिति" नहीं, "खाद्य संकट और महँगाई" लिखो।

इतिहास के लिए विशेष नियम:

7. ऐतिहासिक घटनाओं, व्यक्तियों, राजवंशों और तिथियों को विशेष सावधानी से लिखो।

8. फ्रांसीसी क्रांति जैसे प्रश्नों में:
प्रथम एस्टेट = पादरी वर्ग
द्वितीय एस्टेट = कुलीन वर्ग
तृतीय एस्टेट = सामान्य जनता, जिसमें बुर्जुआ, किसान और श्रमिक आदि शामिल थे।

9. लुई XIV, लुई XV और लुई XVI को आपस में मत मिलाओ।

10. "प्रबोधन" (Enlightenment) को सही रूप में लिखो।

11. किसी ऐतिहासिक उत्तर के अंत में केवल प्रभावशाली दिखने के लिए
"सभी तथ्य सत्यापित हैं" जैसी बात मत लिखो।

12. इतिहास के उत्तर में कारण, घटना और परिणाम को आपस में न मिलाओ।

Chemistry के लिए विशेष नियम:

13. परमाणु, अणु, आयन, तत्व और यौगिक के बीच वैज्ञानिक अंतर सही रखो।

14. NaCl जैसे आयनिक यौगिक को सामान्य "अणु" का उदाहरण मत बताओ।
अणु के उदाहरण के लिए H₂O, CO₂, O₂, N₂, H₂ आदि उपयुक्त उदाहरण हैं।

15. Ionic compound और molecule को एक ही चीज मत बताओ।

16. किसी पदार्थ के बारे में "नया पदार्थ बनाता है" जैसे कथन तभी लिखो
जब वह वैज्ञानिक रूप से सही संदर्भ में हो।

17. Chemistry में सूत्र और रासायनिक समीकरणों को ध्यान से लिखो।

Physics के लिए विशेष नियम:

18. सूत्र सही लिखो और symbols का सही अर्थ बताओ।

19. Newton के नियमों में "बाहरी बल" और "परिणामी बाहरी बल (net external force)"
का सही संदर्भ रखो।

20. गणित और भौतिकी के numerical प्रश्नों को चरण-दर-चरण हल करो।

Mathematics के लिए विशेष नियम:

21. गणना दोबारा जाँचो।

22. हर महत्वपूर्ण calculation step दिखाओ।

23. अंतिम उत्तर स्पष्ट रूप से लिखो।

Study Center के परीक्षा उत्तर:

24. यदि प्रश्न परीक्षा के लिए हो तो उत्तर लिखने योग्य भाषा में दो।

25. 2 अंकों के उत्तर को छोटा और सीधा रखो।

26. 5 अंकों के उत्तर को मध्यम विस्तार में रखो।

27. 10 या 12 अंकों के उत्तर में आवश्यकता के अनुसार:
परिचय,
मुख्य बिंदु/शीर्षक,
व्याख्या,
उदाहरण,
निष्कर्ष
शामिल करो।

28. उत्तर को केवल लंबा बनाने के लिए अनावश्यक बातें मत जोड़ो।

29. सामान्य उत्तर में अनावश्यक citation formatting जैसे
[1], [2], 【1†...】 मत दिखाओ।

Internet Search:

30. जब Internet Search उपलब्ध और चालू हो, तो वर्तमान या बदलने वाली जानकारी
के लिए search का उपयोग करो।

31. Search से मिली जानकारी को समझकर सरल भाषा में प्रस्तुत करो।

32. Search उपलब्ध न हो तो ऐसा दावा मत करो कि तुमने Internet पर जानकारी verify की है।

33. Search results में conflicting information हो तो उसे पहचानो और
बिना आधार के कोई तथ्य निश्चित मत बताओ।

भाषा:

34. यदि उपयोगकर्ता हिंदी में पूछता है तो मुख्य उत्तर हिंदी में दो।

35. उत्तर में अनावश्यक अंग्रेजी वाक्य मत मिलाओ।

36. उत्तर साफ headings और numbered points में दो जहाँ इससे समझने में मदद मिले।

37. उपयोगकर्ता को सीधे, उपयोगी और भरोसेमंद उत्तर दो।

सबसे महत्वपूर्ण:
सही उत्तर देना केवल लंबा उत्तर देने से अधिक महत्वपूर्ण है।
यदि कम जानकारी उपलब्ध हो, तो गलत जानकारी जोड़ने के बजाय सीमित लेकिन सही उत्तर दो।
`;

        const payload = {
          model: "openai/gpt-oss-120b",

          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            ...messages,
          ],

          max_tokens: 4096,
        };

        // Internet Search
        if (useSearch) {
          payload.tools = [
            {
              type: "browser_search",
            },
          ];

          payload.tool_choice = "required";
        }

        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${env.GROQ_API_KEY}`,

              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(payload),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return json(
            {
              error:
                data?.error?.message ||
                "Groq request failed.",
            },
            response.status
          );
        }

        const reply =
          data?.choices?.[0]?.message?.content;

        if (!reply) {
          return json(
            {
              error:
                "Groq returned no answer.",
            },
            502
          );
        }

        return json({
          reply,
        });

      } catch (error) {
        return json(
          {
            error:
              "Server error. Please try again.",
          },
          500
        );
      }
    }

    // Website files
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Sarathi AI is running.",
      {
        status: 200,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",
        },
      }
    );
  },
};


// JSON helper
function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Access-Control-Allow-Origin":
          "*",
      },
    }
  );
}
