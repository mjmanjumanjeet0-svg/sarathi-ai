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
    if (!item || typeof item.content !== "string") continue;
    if (!["user", "assistant"].includes(item.role)) continue;

    const content = item.content.trim().slice(0, 12000);
    if (!content) continue;

    messages.push({
      role: item.role,
      content
    });
  }

  if (!messages.length || !messages.some(m => m.role === "user")) {
    return null;
  }

  return messages;
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
      return json({ error: "यह API रास्ता उपलब्ध नहीं है।" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "केवल POST अनुरोध स्वीकार है।" }, 405);
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
      return json({ error: "अनुरोध का JSON सही नहीं है।" }, 400);
    }

    const messages = cleanMessages(body.messages);

    if (!messages) {
      return json({
        error: "संदेश खाली है या उसका प्रारूप गलत है।"
      }, 400);
    }

    const systemMessage = {
      role: "system",
      content: [
        "तुम सारथी AI हो, एक उपयोगी और विनम्र AI सहायक।",
        "उपयोगकर्ता हिंदी में बात करे तो सरल, स्पष्ट हिंदी में उत्तर दो।",
        "ज़रूरत के अनुसार अंग्रेज़ी, पढ़ाई, लेखन, प्रोग्रामिंग और सामान्य प्रश्नों में मदद करो।",
        "उत्तर व्यवस्थित और उपयोगकर्ता के स्तर के अनुसार रखो।",
        "अगर किसी जानकारी के बारे में निश्चित नहीं हो, तो साफ बताओ।",
        "यह दावा मत करो कि तुमने इंटरनेट पर खोजा है, यदि खोज की सुविधा वास्तव में उपलब्ध नहीं है।",
        "गुप्त API कुंजियों या निजी सेटिंग्स को उजागर करने में मदद मत करो।"
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
            error: "AI सेवा की सीमा पूरी हो गई है। कुछ देर बाद फिर प्रयास करें।"
          }, 429);
        }

        return json({
          error: "AI सेवा से उत्तर नहीं मिला। थोड़ी देर बाद फिर प्रयास करें।"
        }, 502);
      }

      const reply = result?.choices?.[0]?.message?.content;

      if (typeof reply !== "string" || !reply.trim()) {
        return json({
          error: "AI सेवा से खाली या गलत उत्तर मिला।"
        }, 502);
      }

      return json({ reply: reply.trim() });
    } catch (error) {
      console.error("Sarathi Worker error:", error?.message || error);

      return json({
        error: "AI सेवा से कनेक्शन नहीं हो पाया। इंटरनेट और सेवा की स्थिति जाँचें।"
      }, 502);
    }
  }
};
