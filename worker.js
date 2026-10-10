/**
 * SAARTHI AI — SECURE CLOUDFLARE WORKER
 *
 * Required Cloudflare Secret:
 * GROQ_API_KEY
 *
 * Optional Worker variable:
 * ALLOWED_ORIGINS
 *
 * Routes:
 * GET  /
 * GET  /api/health
 * POST /api/chat
 * POST /api/vision
 * POST /api/transcribe
 */

const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

const GROQ_API = "https://api.groq.com/openai/v1";

const MAX_BODY_SIZE = 1_000_000;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_HISTORY_ITEMS = 12;

const SYSTEM_PROMPT = `
You are Saarthi AI, a helpful, honest, and safety-conscious AI assistant.

LANGUAGE:
- Reply in the language used by the user.
- When the user writes Hindi, reply in simple, natural Hindi.
- Explain technical instructions step by step.

ACCURACY:
- Never invent facts, sources, or search results.
- If you are unsure, clearly say so.
- Do not claim to have searched the live web unless a search tool was actually used.
- If information may be outdated, explain that limitation.

STYLE:
- Use clear headings and readable paragraphs when helpful.
- Avoid unnecessary decorative separator lines.
- Keep simple questions concise and complex questions detailed.

PRIVACY:
- Never ask the user to reveal passwords, OTPs, API keys, or secret credentials.
- Do not request unnecessary personal information.
- Do not claim that data is deleted from systems you do not control.

SAFETY:
- Give careful, responsible answers.
- For medical, legal, financial, and other high-impact topics, explain limitations.
- Never pretend to be a licensed professional.

Be useful, respectful, and transparent.
`;

function getAllowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  };

  const origin = request.headers.get("Origin");

  if (!origin) {
    return headers;
  }

  let sameOrigin = false;

  try {
    sameOrigin = new URL(request.url).origin === origin;
  } catch {
    sameOrigin = false;
  }

  const allowedOrigins = getAllowedOrigins(env);

  if (sameOrigin || allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function cleanText(value, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function safeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-MAX_HISTORY_ITEMS)
    .filter(item =>
      item &&
      typeof item === "object" &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string"
    )
    .map(item => ({
      role: item.role,
      content: item.content.slice(0, 4000)
    }));
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      status: 415,
      error: "Content-Type must be application/json."
    };
  }

  const contentLength = Number(
    request.headers.get("Content-Length") || "0"
  );

  if (contentLength > MAX_BODY_SIZE) {
    return {
      ok: false,
      status: 413,
      error: "Request is too large."
    };
  }

  let raw;

  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Could not read request."
    };
  }

  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_SIZE) {
    return {
      ok: false,
      status: 413,
      error: "Request is too large."
    };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(raw)
    };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Invalid JSON."
    };
  }
}

async function callGroq(env, endpoint, payload) {
  if (!env.GROQ_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: "AI service is not configured. Add GROQ_API_KEY in Cloudflare Secrets."
    };
  }

  let response;

  try {
    response = await fetch(`${GROQ_API}${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "AI service could not be reached. Please try again."
    };
  }

  let result;

  try {
    result = await response.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: "AI service returned an invalid response."
    };
  }

  if (!response.ok) {
    // Do not expose provider response bodies, credentials, or internal details.
    return {
      ok: false,
      status: response.status === 429 ? 429 : 502,
      error: response.status === 429
        ? "AI service rate limit reached. Please wait and try again."
        : "AI service request failed. Please try again later."
    };
  }

  return {
    ok: true,
    data: result
  };
}

function validateImageData(value) {
  if (typeof value !== "string") {
    return null;
  }

  // Accept only base64 data URLs for common image formats.
  const match = value.match(
    /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i
  );

  if (!match) {
    return null;
  }

  if (value.length > 850_000) {
    return null;
  }

  return value;
}

async function handleChat(request, env) {
  const parsed = await readJson(request);

  if (!parsed.ok) {
    return jsonResponse(
      request,
      env,
      { error: parsed.error },
      parsed.status
    );
  }

  const body = parsed.data || {};

  const message = cleanText(
    body.message ?? body.prompt ?? body.question
  );

  if (!message) {
    return jsonResponse(
      request,
      env,
      { error: "Please enter a message." },
      400
    );
  }

  const history = safeHistory(body.history);

  // The current user message is added exactly once.
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.filter(item =>
      item.content !== message || item.role !== "user"
    ),
    { role: "user", content: message }
  ];

  const result = await callGroq(env, "/chat/completions", {
    model: CHAT_MODEL,
    messages,
    temperature: 0.5,
    max_tokens: 1800
  });

  if (!result.ok) {
    return jsonResponse(
      request,
      env,
      { error: result.error },
      result.status
    );
  }

  const answer = result.data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    return jsonResponse(
      request,
      env,
      { error: "AI returned an empty response. Please try again." },
      502
    );
  }

  return jsonResponse(request, env, {
    success: true,
    answer: answer.trim(),
    model: CHAT_MODEL
  });
}

async function handleVision(request, env) {
  const parsed = await readJson(request);

  if (!parsed.ok) {
    return jsonResponse(
      request,
      env,
      { error: parsed.error },
      parsed.status
    );
  }

  const body = parsed.data || {};

  const prompt = cleanText(
    body.prompt || body.message || "इस तस्वीर को ध्यान से समझाओ।",
    4000
  );

  const image = validateImageData(
    body.image || body.imageData || body.imageUrl
  );

  if (!image) {
    return jsonResponse(
      request,
      env,
      {
        error: "Valid image data URL required. Supported formats: JPEG, PNG, WebP, GIF."
      },
      400
    );
  }

  const result = await callGroq(env, "/chat/completions", {
    model: VISION_MODEL,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image_url",
            image_url: {
              url: image
            }
          }
        ]
      }
    ],
    temperature: 0.3,
    max_tokens: 1500
  });

  if (!result.ok) {
    return jsonResponse(
      request,
      env,
      { error: result.error },
      result.status
    );
  }

  const answer = result.data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    return jsonResponse(
      request,
      env,
      { error: "AI could not describe this image." },
      502
    );
  }

  return jsonResponse(request, env, {
    success: true,
    answer: answer.trim()
  });
}

async function handleTranscription(request, env) {
  if (!env.GROQ_API_KEY) {
    return jsonResponse(
      request,
      env,
      { error: "AI service is not configured." },
      503
    );
  }

  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return jsonResponse(
      request,
      env,
      { error: "Send audio using multipart/form-data with an audio file." },
      415
    );
  }

  const contentLength = Number(
    request.headers.get("Content-Length") || "0"
  );

  if (contentLength > 8_000_000) {
    return jsonResponse(
      request,
      env,
      { error: "Audio file is too large. Maximum request size is 8 MB." },
      413
    );
  }

  let form;

  try {
    form = await request.formData();
  } catch {
    return jsonResponse(
      request,
      env,
      { error: "Could not read the audio upload." },
      400
    );
  }

  const file = form.get("file");

  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return jsonResponse(
      request,
      env,
      { error: "Please attach an audio file in the 'file' field." },
      400
    );
  }

  if (file.size <= 0 || file.size > 7_500_000) {
    return jsonResponse(
      request,
      env,
      { error: "Audio file must be smaller than 7.5 MB." },
      413
    );
  }

  const upload = new FormData();

  upload.append("file", file, file.name || "audio.webm");
  upload.append("model", TRANSCRIBE_MODEL);
  upload.append("response_format", "json");

  let response;

  try {
    response = await fetch(`${GROQ_API}/audio/transcriptions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`
      },
      body: upload,
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    return jsonResponse(
      request,
      env,
      { error: "Audio transcription service could not be reached." },
      502
    );
  }

  if (!response.ok) {
    return jsonResponse(
      request,
      env,
      {
        error: response.status === 429
          ? "Audio service rate limit reached. Try again later."
          : "Audio transcription failed. Please try another file."
      },
      response.status === 429 ? 429 : 502
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    return jsonResponse(
      request,
      env,
      { error: "Audio service returned an invalid response." },
      502
    );
  }

  if (typeof data.text !== "string") {
    return jsonResponse(
      request,
      env,
      { error: "No transcript was returned." },
      502
    );
  }

  return jsonResponse(request, env, {
    success: true,
    text: data.text.trim()
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // CORS preflight.
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(request, env);

      if (
        request.headers.get("Origin") &&
        !headers["Access-Control-Allow-Origin"]
      ) {
        return new Response(null, { status: 403, headers });
      }

      return new Response(null, {
        status: 204,
        headers
      });
    }

    // Reject cross-origin browser requests from unapproved sites.
    const origin = request.headers.get("Origin");

    if (origin) {
      const headers = corsHeaders(request, env);

      if (!headers["Access-Control-Allow-Origin"]) {
        return jsonResponse(
          request,
          env,
          { error: "Origin is not allowed." },
          403
        );
      }
    }

    if (request.method === "GET" && path === "/") {
      return jsonResponse(request, env, {
        name: "Saarthi AI API",
        status: "online",
        endpoints: [
          "GET /api/health",
          "POST /api/chat",
          "POST /api/vision",
          "POST /api/transcribe"
        ]
      });
    }

    if (request.method === "GET" && path === "/api/health") {
      return jsonResponse(request, env, {
        success: true,
        status: "online",
        aiConfigured: Boolean(env.GROQ_API_KEY)
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        request,
        env,
        { error: "Method not allowed." },
        405
      );
    }

    try {
      if (path === "/api/chat") {
        return await handleChat(request, env);
      }

      if (path === "/api/vision") {
        return await handleVision(request, env);
      }

      if (path === "/api/transcribe") {
        return await handleTranscription(request, env);
      }

      return jsonResponse(
        request,
        env,
        { error: "Endpoint not found." },
        404
      );
    } catch {
      // Keep internal exception details out of public responses.
      return jsonResponse(
        request,
        env,
        { error: "Unexpected server error. Please try again." },
        500
      );
    }
  }
};
