export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    if (
      allowedOrigin !== "*" &&
      origin &&
      origin !== allowedOrigin
    ) {
      return json({ error: "यह वेबसाइट अनुमति प्राप्त नहीं है।" }, 403);
    }

    if (url.pathname === "/") {
      return new Response("Sarathi AI Worker is running.", {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    }

    if (url.pathname !== "/api/chat") {
      return json({ error: "यह रास्ता उपलब्ध नहीं है।" }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "केवल POST अनुरोध स्वीकार है।" }, 405);
    }

    if (!env.GROQ_API_KEY) {
      return json({
        error: "Cloudflare Worker में GROQ_API_KEY Secret सेट नहीं है।"
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "अनुरोध का JSON सही नहीं है।" }, 400);
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: "बातचीत के संदेश नहीं मिले।" }, 400);
    }

    const messages = body.messages
      .filter((message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 12000)
      }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "आखिरी संदेश उपयोगकर्ता का होना चाहिए।" }, 400);
    }

    try {
      const apiResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content:
                  "तुम सारथी AI हो, एक सहायक और विनम्र हिंदी AI सहायक। " +
                  "उपयोगकर्ता की भाषा में स्पष्ट और उपयोगी उत्तर दो। " +
                  "कोड माँगा जाए तो सही, पूरा और समझने योग्य कोड दो। " +
                  "जहाँ जानकारी निश्चित न हो, वहाँ स्पष्ट बताओ। " +
                  "तुम्हारे पास अपने-आप लाइव इंटरनेट सर्च, फाइल पढ़ने या " +
                  "बाहरी काम करने की क्षमता होने का दावा मत करो, जब तक " +
                  "उस सुविधा को वास्तव में जोड़ा न गया हो।"
              },
              ...messages
            ],
            temperature: 0.7,
            max_tokens: 2048
          })
        }
      );

      const data = await apiResponse.json().catch(() => ({}));

      if (!apiResponse.ok) {
        return json({
          error:
            data.error?.message ||
            "AI सेवा से जवाब नहीं मिला।"
        }, 502);
      }

      const reply = data.choices?.[0]?.message?.content;

      if (typeof reply !== "string" || !reply.trim()) {
        return json({ error: "AI ने खाली जवाब भेजा।" }, 502);
      }

      return json({ reply: reply.trim() });

    } catch {
      return json({
        error: "AI सर्वर से कनेक्शन नहीं हो पाया।"
      }, 502);
    }
  }
};
