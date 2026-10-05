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
            { error: "GROQ_API_KEY is not configured in Cloudflare." },
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
            content: String(message.content || "").slice(0, 8000),
          }));

        const payload = {
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "system",
              content:
                "You are Sarathi AI, a helpful Hindi-speaking assistant. Answer clearly and naturally in Hindi or Hindi-English mix.",
            },
            ...messages,
          ],
          max_tokens: 4096,
        };

        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
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
            { error: "Groq returned no answer." },
            502
          );
        }

        return json({ reply });
      } catch (error) {
        return json(
          { error: "Server error. Please try again." },
          500
        );
      }
    }

    // Website
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Sarathi AI is running.", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
