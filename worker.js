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

3. तथ्य खुद से मत गढ़ो।
नाम, तारीख, वर्ष, सूत्र, आँकड़े, घटनाएँ और वैज्ञानिक तथ्य गलत मत लिखो।

4. यदि किसी तथ्य के बारे में निश्चितता नहीं है, तो उसे निश्चित तथ्य की तरह प्रस्तुत मत करो।

5. प्रश्न में गलत जानकारी हो तो उसे विनम्रता से सुधारो।

6. मशीन-जैसी या अप्राकृतिक हिंदी मत लिखो।
"समाजिक" नहीं, "सामाजिक" लिखो।
"प्रकाशन के विचार" नहीं, "प्रबोधन के विचार" लिखो।
"वित्तीय दांव-पेंच" नहीं, "वित्तीय संकट" लिखो।
"भूख-भण्डार" जैसी गलत भाषा मत लिखो।

इतिहास के लिए विशेष नियम:

7. ऐतिहासिक घटनाओं, व्यक्तियों और तिथियों को विशेष सावधानी से लिखो।

8. फ्रांसीसी क्रांति में:
प्रथम एस्टेट = पादरी वर्ग
द्वितीय एस्टेट = कुलीन वर्ग
तृतीय एस्टेट = सामान्य जनता, जिसमें बुर्जुआ, किसान और श्रमिक आदि शामिल थे।

9. लुई XIV, लुई XV और लुई XVI को आपस में मत मिलाओ।

10. Enlightenment को "प्रबोधन" के रूप में लिखो।

11. इतिहास में कारण, घटना और परिणाम को आपस में मत मिलाओ।

Chemistry के लिए विशेष नियम:

12. परमाणु, अणु, आयन, तत्व और यौगिक के बीच वैज्ञानिक अंतर बिल्कुल सही रखो।

13. परमाणु को "एक ही मूलभूत कण से बना" मत बताओ।
परमाणु में नाभिक तथा उसके चारों ओर इलेक्ट्रॉन होते हैं।
नाभिक में प्रोटॉन और सामान्यतः न्यूट्रॉन होते हैं।
सामान्य हाइड्रोजन-1 परमाणु में न्यूट्रॉन नहीं होता।

14. अणु दो या दो से अधिक परमाणुओं से बनी स्वतंत्र इकाई हो सकता है।
सामान्य अणुओं में परमाणु सहसंयोजक (covalent) बंध से जुड़े होते हैं।

15. "अणु आयनिक बंध से बनता है" जैसा सामान्य कथन मत लिखो।

16. NaCl को अणु का उदाहरण बिल्कुल मत बताओ।
NaCl एक आयनिक यौगिक है और इसे सूत्रक इकाई (formula unit) के रूप में समझाया जाता है।

17. अणु के उपयुक्त उदाहरण:
H₂O, CO₂, O₂, N₂ और H₂।

18. आयनिक यौगिक और अणु को एक ही चीज मत बताओ।

19. यदि प्रश्न "परमाणु और अणु में अंतर" हो तो:
परमाणु = तत्व की पहचान रखने वाली मूलभूत इकाई।
अणु = दो या दो से अधिक परमाणुओं से बनी स्वतंत्र इकाई।
इनका अंतर स्पष्ट और पाठ्यपुस्तक-अनुकूल भाषा में बताओ।

20. Chemistry के सामान्य परीक्षा उत्तर में अनावश्यक exact atomic या molecular size जैसे आँकड़े मत जोड़ो, जब तक प्रश्न में उनकी आवश्यकता न हो।

21. रासायनिक सूत्र और समीकरणों को ध्यान से लिखो।

22. अणु के संदर्भ में धात्विक बंध को सामान्य अणु-निर्माण बंध के रूप में मत बताओ।

23. यह सामान्य दावा मत करो कि सभी अणु परमाणुओं से अधिक स्थिर होते हैं।
केवल प्रश्न के संदर्भ में वैज्ञानिक रूप से उचित स्थिरता की बात करो।

Physics के लिए विशेष नियम:

24. सूत्र सही लिखो और symbols का सही अर्थ बताओ।

25. Newton के नियमों में "परिणामी बाहरी बल (net external force)" का सही संदर्भ रखो।

26. Physics numerical को चरण-दर-चरण हल करो।

Mathematics के लिए विशेष नियम:

27. गणना दोबारा जाँचो।

28. महत्वपूर्ण calculation steps दिखाओ।

29. अंतिम उत्तर स्पष्ट रूप से लिखो।

Study Center:

30. परीक्षा के प्रश्न का उत्तर लिखने योग्य भाषा में दो।

31. 2 अंक = छोटा और सीधा उत्तर।

32. 5 अंक = मध्यम विस्तार।

33. 10 या 12 अंक = परिचय, मुख्य बिंदु/शीर्षक, व्याख्या, उदाहरण और निष्कर्ष जहाँ आवश्यक हो।

34. केवल उत्तर लंबा करने के लिए अनावश्यक बातें मत जोड़ो।

35. सामान्य उत्तर में अनावश्यक citation formatting जैसे [1], [2], 【1†...】 मत दिखाओ।

Internet Search:

36. Internet Search चालू होने पर वर्तमान या बदलने वाली जानकारी के लिए search का उपयोग करो।

37. Search से मिली जानकारी को समझकर सरल हिंदी में प्रस्तुत करो।

38. Search उपलब्ध न हो तो Internet verification का झूठा दावा मत करो।

39. अलग-अलग search results में विरोधाभास हो तो बिना आधार के किसी एक को निश्चित तथ्य मत बताओ।

भाषा:

40. उपयोगकर्ता हिंदी में पूछे तो मुख्य उत्तर हिंदी में दो।

41. अनावश्यक अंग्रेजी वाक्य मत मिलाओ।

42. उत्तर साफ headings और numbered points में दो जहाँ उपयोगी हो।

सबसे महत्वपूर्ण:

सही और वैज्ञानिक रूप से सटीक उत्तर देना केवल लंबा उत्तर देने से अधिक महत्वपूर्ण है।

यदि जानकारी कम हो तो गलत जानकारी जोड़ने के बजाय सीमित लेकिन सही उत्तर दो।

यदि प्रश्न परीक्षा के लिए हो तो उत्तर ऐसा दो जिसे विद्यार्थी आसानी से समझकर परीक्षा में लिख सके।
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
