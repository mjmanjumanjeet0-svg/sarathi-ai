/*
 * Cloudflare Worker — सारथी AI API
 *
 * Cloudflare Dashboard > Worker > Settings > Variables and Secrets:
 *   Secret name: GROQ_API_KEY
 *   Secret value: your Groq API key
 *
 * Deploy this file as the Worker entry point. Never place the API key in app.js.
 */
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 12000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function cleanMessages(value) {
  if (!Array.isArray(value)) return null;
  const messages = value
    .filter(item => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-MAX_MESSAGES)
    .map(item => ({ role: item.role, content: item.content.trim().slice(0, MAX_MESSAGE_CHARS) }))
    .filter(item => item.content.length > 0);
  if (!messages.length || !messages.some(item => item.role === "user")) return null;
  return messages;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "केवल POST अनुरोध स्वीकार किया जाता है।" }, 405);
    }
    if (!env.GROQ_API_KEY) {
      return json({ error: "सर्वर पर GROQ_API_KEY सेट नहीं है। Cloudflare Secrets जाँचें।" }, 500);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "अनुरोध का JSON सही नहीं है।" }, 400); }

    const messages = cleanMessages(body.messages);
    if (!messages) {
      return json({ error: "कृपया एक संदेश लिखकर भेजें।" }, 400);
    }

    const systemPrompt = [
      "तुम्हारा नाम सारथी AI है।",
      "उपयोगकर्ता से स्वाभाविक, विनम्र और स्पष्ट हिंदी में बात करो; यदि उपयोगकर्ता दूसरी भाषा माँगे तो उस भाषा में उत्तर दो।",
      "पढ़ाई, लेखन, प्रोग्रामिंग और सामान्य सवालों में चरणबद्ध व उपयोगी सहायता दो।",
      "जहाँ तथ्य निश्चित न हों, अनिश्चितता साफ़ बताओ; जानकारी गढ़ो मत।",
      "उपयोगकर्ता के निजी डेटा, API keys या पासवर्ड माँगने से बचो।",
      "तुम इस शुरुआती संस्करण में अपने आप इंटरनेट ब्राउज़ नहीं कर सकते और डिवाइस की फाइलें/ऐप नियंत्रित नहीं कर सकते; ऐसा करने का दावा मत करो।",
      "उत्तर को पढ़ने में आसान रखो।"
    ].join(" ");

    let upstream;
    try {
      upstream = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          temperature: 0.6,
          max_tokens: 1800,
          stream: false
        })
      });
    } catch {
      return json({ error: "AI सर्वर से संपर्क नहीं हो पाया। थोड़ी देर बाद कोशिश करें।" }, 502);
    }

    let payload;
    try { payload = await upstream.json(); }
    catch { return json({ error: "AI सर्वर से पढ़ने योग्य जवाब नहीं मिला।" }, 502); }

    if (!upstream.ok) {
      // Do not expose upstream headers, keys, or raw error payload to the browser.
      const status = upstream.status === 429 ? 429 : 502;
      const message = upstream.status === 401
        ? "Groq API key अमान्य है। Cloudflare Secret जाँचें।"
        : upstream.status === 429
          ? "अभी AI अनुरोधों की सीमा पूरी हो गई है। थोड़ी देर बाद कोशिश करें।"
          : "AI सेवा से जवाब नहीं मिला। Worker और Groq सेटिंग जाँचें।";
      return json({ error: message }, status);
    }

    const reply = payload?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return json({ error: "AI सेवा ने खाली या गलत प्रारूप का जवाब दिया।" }, 502);
    }
    return json({ reply: reply.trim() });
  }
};
