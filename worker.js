const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return null;

  const messages = [];

  for (const item of input.slice(-30)) {
    if (!item || !["user", "assistant"].includes(item.role)) {
      continue;
    }

    let content = item.content;

    // सामान्य टेक्स्ट संदेश
    if (typeof content === "string") {
      content = content.trim().slice(0, 12000);
      if (!content) continue;

      messages.push({
        role: item.role,
        content
      });

      continue;
    }

    // फोटो सहित संदेश
    if (
      item.role === "user" &&
      Array.isArray(content)
    ) {
      const parts = [];

      for (const part of content.slice(0, 6)) {
        if (
          part?.type === "text" &&
          typeof part.text === "string"
        ) {
          parts.push({
            type: "text",
            text: part.text.slice(0, 12000)
          });
        }

        if (
          part?.type === "image_url" &&
          typeof part.image_url?.url === "string"
        ) {
          const imageUrl = part.image_url.url;

          // केवल data URL स्वीकार करें।
          // बाहरी URL को सीधे AI तक नहीं भेजेंगे।
          if (
            /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(imageUrl) &&
            imageUrl.length <= 7000000
          ) {
            parts.push({
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            });
          }
        }
      }

      if (parts.length) {
        messages.push({
          role: "user",
          content: parts
        });
      }
    }
  }

  if (
    !messages.length ||
    !messages.some(message => message.role === "user")
  ) {
    return null;
  }

  return messages;
}

async function searchInternet(query, apiKey) {
  if (!apiKey) {
    return {
      error: "इंटरनेट सर्च के लिए TAVILY_API_KEY सेट नहीं है।"
    };
  }

  try {
    const response = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: query.slice(0, 1000),
          topic: "general",
          search_depth: "basic",
          max_results: 5,
          include_answer: true
        })
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      console.error("Tavily search failed:", response.status);

      return {
        error: "इंटरनेट सर्च अभी उपलब्ध नहीं है।"
      };
    }

    return {
      answer: data.answer || "",
      results: (data.results || []).slice(0, 5).map(item => ({
        title: String(item.title || "").slice(0, 300),
        url: String(item.url || "").slice(0, 1000),
        content: String(item.content || "").slice(0, 2000)
      }))
    };
  } catch (error) {
    console.error("Search error:", error?.message || error);

    return {
      error: "इंटरनेट सर्च सेवा से कनेक्शन नहीं हो पाया।"
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Sarathi AI Worker is running.", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname !== "/api/chat") {
      return json({
        error: "यह API रास्ता उपलब्ध नहीं है।"
      }, 404);
    }

    if (request.method !== "POST") {
      return json({
        error: "केवल POST अनुरोध स्वीकार है।"
      }, 405);
    }

    if (!env.GROQ_API_KEY) {
      return json({
        error: "Cloudflare में GROQ_API_KEY Secret सेट नहीं है।"
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        error: "अनुरोध का JSON सही नहीं है।"
      }, 400);
    }

    const messages = cleanMessages(body.messages);

    if (!messages) {
      return json({
        error: "संदेश खाली है या उसका प्रारूप गलत है।"
      }, 400);
    }

    // वेबसाइट से internet: true आने पर ही सर्च करें।
    const internetEnabled = body.internet === true;

    // आखिरी यूज़र संदेश से सर्च क्वेरी बनाएँ।
    const lastUserMessage = [...messages]
      .reverse()
      .find(message => message.role === "user");

    let lastUserText = "";

    if (typeof lastUserMessage?.content === "string") {
      lastUserText = lastUserMessage.content;
    } else if (Array.isArray(lastUserMessage?.content)) {
      lastUserText = lastUserMessage.content
        .filter(part => part.type === "text")
        .map(part => part.text)
        .join("\n");
    }

    let webContext = "";

    if (internetEnabled && lastUserText.trim()) {
      const search = await searchInternet(
        lastUserText,
        env.TAVILY_API_KEY
      );

      if (search.results?.length) {
        webContext = [
          "वेब सर्च से मिली जानकारी:",
          search.answer || "",
          ...search.results.map((item, index) =>
            `${index + 1}. ${item.title}\n` +
            `URL: ${item.url}\n` +
            `${item.content}`
          ),
          "वेब जानकारी का उपयोग करते समय स्रोत का नाम और उपलब्ध URL बताओ।",
          "सर्च परिणामों को पूरी तरह सत्य मानने के बजाय सावधानी से समझो।"
        ].filter(Boolean).join("\n\n");
      } else if (search.error) {
        webContext =
          "वेब सर्च सफल नहीं हुआ। उपयोगकर्ता को साफ बताओ कि ताज़ा जानकारी खोजने में समस्या हुई है।";
      }
    }

    const systemMessage = {
      role: "system",
      content: [
        "तुम सारथी AI हो, एक उपयोगी और विनम्र AI सहायक।",
        "उपयोगकर्ता हिंदी में बात करे तो सरल और स्पष्ट हिंदी में उत्तर दो।",
        "उत्तर साफ-सुथरे शीर्षक, सूची और छोटे पैराग्राफ में दो।",
        "Markdown का उपयोग जरूरत के अनुसार करो।",
        "फोटो मिलने पर उसमें दिखाई देने वाली चीजों को समझकर उत्तर दो।",
        "फोटो में जो स्पष्ट नहीं है, उसके बारे में अनुमान को तथ्य की तरह मत बताओ।",
        "यदि इंटरनेट सर्च उपलब्ध नहीं हुआ, तो खोज करने का झूठा दावा मत करो।",
        "गुप्त API कुंजियों या निजी सेटिंग्स को उजागर मत करो।",
        internetEnabled
          ? "इंटरनेट सर्च चालू है। दिए गए वेब संदर्भ उपयोग करो और स्रोतों को स्पष्ट करो।"
          : "इंटरनेट सर्च बंद है। वेब सर्च करने का दावा मत करो।",
        webContext ? `\n${webContext}` : ""
      ].join("\n")
    };

    try {
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            // यह मॉडल फोटो समझने के लिए सक्षम होना चाहिए।
            model: "openai/gpt-oss-20b",
            messages: [systemMessage, ...messages],
            temperature: 0.7,
            max_tokens: 2048
          })
        }
      );

      const result = await groqResponse.json().catch(() => null);

      if (!groqResponse.ok) {
        console.error(
          "Groq request failed:",
          groqResponse.status,
          result?.error?.message || "Unknown provider error"
        );

        if (groqResponse.status === 401) {
          return json({
            error: "Groq API कुंजी अमान्य है। Cloudflare Secret जाँचें।"
          }, 502);
        }

        if (groqResponse.status === 429) {
          return json({
            error: "AI सेवा की सीमा पूरी हो गई है। कुछ देर बाद प्रयास करें।"
          }, 429);
        }

        return json({
          error:
            "AI सेवा से उत्तर नहीं मिला। मॉडल उपलब्धता और Cloudflare Logs जाँचें।"
        }, 502);
      }

      const reply = result?.choices?.[0]?.message?.content;

      if (typeof reply !== "string" || !reply.trim()) {
        return json({
          error: "AI सेवा से खाली या गलत उत्तर मिला।"
        }, 502);
      }

      return json({
        reply: reply.trim(),
        internet: internetEnabled
      });
    } catch (error) {
      console.error("Sarathi Worker error:", error?.message || error);

      return json({
        error: "AI सेवा से कनेक्शन नहीं हो पाया। थोड़ी देर बाद प्रयास करें।"
      }, 502);
    }
  }
};
