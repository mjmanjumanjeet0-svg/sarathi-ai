export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Security headers
    const securityHeaders = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';",
    };

    // CORS (only same origin + your domain)
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = [url.origin, "https://sarathi-ai.yourdomain.workers.dev"];
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : url.origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { ...corsHeaders, ...securityHeaders } });
    }

    // Serve static files
    if (path === "/" || path === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
    }
    if (path === "/study.html") {
      return env.ASSETS.fetch(new Request(new URL("/study.html", request.url)));
    }

    // AI Chat API
    if (path === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        let messages = body.messages || [];

        // Security: limit history & message length
        if (!Array.isArray(messages) || messages.length > 30) {
          return json({ error: "बहुत ज़्यादा मैसेज" }, 400, corsHeaders, securityHeaders);
        }

        messages = messages
          .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map(m => ({
            role: m.role,
            content: m.content.slice(0, 4000) // max 4k chars per message
          }))
          .slice(-20); // last 20 only

        if (messages.length === 0) {
          return json({ error: "मैसेज खाली है" }, 400, corsHeaders, securityHeaders);
        }

        // System prompt – सारथी जैसा
        const systemPrompt = {
          role: "system",
          content: `तुम सारथी AI हो। तुम एक मददगार, समझदार और दोस्ताना हिन्दी AI सहायक हो। 
हमेशा साफ़, सही और उपयोगी जवाब दो। 
अगर सवाल हिन्दी में हो तो हिन्दी में जवाब दो, अंग्रेज़ी में हो तो अंग्रेज़ी में। 
कभी भी गलत या हानिकारक जानकारी मत दो। 
तुम Grok की तरह सोचते हो – सच्चाई, मदद और थोड़ी सी मस्ती के साथ।`
        };

        const finalMessages = [systemPrompt, ...messages];

        // Workers AI call (Llama 3.1 8B – fast & free)
        const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: finalMessages,
          max_tokens: 1024,
          temperature: 0.7,
          stream: false
        });

        const reply = response.response || "माफ़ करना, कुछ गड़बड़ हो गई।";

        return json({ reply }, 200, corsHeaders, securityHeaders);

      } catch (err) {
        console.error(err);
        return json({ error: "सर्वर में समस्या" }, 500, corsHeaders, securityHeaders);
      }
    }

    return new Response("Not Found", { status: 404, headers: securityHeaders });
  }
};

function json(data, status = 200, cors = {}, security = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...cors,
      ...security
    }
  });
}
