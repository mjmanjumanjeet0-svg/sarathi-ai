/**
 * SAARTHI AI — CLOUDFLARE WORKER
 *
 * Required secret:
 *   GROQ_API_KEY
 *
 * Required variable:
 *   ALLOWED_ORIGINS
 *
 * Routes:
 *   GET  /
 *   GET  /api/health
 *   POST /api/chat
 *   POST /api/vision
 *   POST /api/transcribe
 */

const GROQ_API = "https://api.groq.com/openai/v1";

const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

const MAX_JSON_BYTES = 1_000_000;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_ITEM_LENGTH = 4_000;
const MAX_IMAGE_LENGTH = 850_000;
const MAX_AUDIO_BYTES = 7_500_000;

const SYSTEM_PROMPT = `
You are Saarthi AI, a helpful, honest and safety-conscious assistant.

LANGUAGE:
- Reply in the language used by the user.
- When the user writes Hindi, use simple, natural Hindi.
- Explain technical instructions step by step.

ACCURACY:
- Never invent facts, sources or search results.
- Clearly state uncertainty.
- Never claim to have searched the live web unless a search tool was used.

PRIVACY:
- Never ask for passwords, OTPs or API keys.
- Do not request unnecessary personal information.
- Do not claim that external services have deleted data.

SAFETY:
- Give careful, responsible answers.
- Explain limitations on high-impact topics.
- Never pretend to be a licensed professional.

Be useful, respectful and transparent.
`;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");

  // Non-browser clients may omit Origin.
  // This is not authentication; public requests still need abuse controls.
  if (!origin) return true;

  try {
    const parsed = new URL(origin);

    if (parsed.origin !== origin) return false;

    return allowedOrigins(env).includes(origin);
  } catch {
    return false;
  }
}

function baseHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function jsonResponse(request, env, data, status = 200) {
  const headers = {
    ...baseHeaders(),
    "Content-Type": "application/json; charset=utf-8"
  };

  const origin = request.headers.get("Origin");

  if (origin && originAllowed(request, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function errorResponse(request, env, message, status) {
  return jsonResponse(request, env, { error: message }, status);
}

function methodNotAllowed(request, env) {
  return errorResponse(request, env, "Method not allowed.", 405);
}

async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";

  if (!type.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      status: 415,
      error: "Content-Type must be application/json."
    };
  }

  const declaredLength = request.headers.get("Content-Length");

  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_JSON_BYTES)
  ) {
    return {
      ok: false,
      status: 413,
      error: "Request is too large."
    };
  }

  let text;

  try {
    // The streaming read prevents buffering an unlimited request body.
    const reader = request.body?.getReader();

    if (!reader) {
      return {
        ok: false,
        status: 400,
        error: "Request body is missing."
      };
    }

    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      total += value.byteLength;

      if (total > MAX_JSON_BYTES) {
        await reader.cancel();

        return {
          ok: false,
          status: 413,
          error: "Request is too large."
        };
      }

      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Could not read request."
    };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(text)
    };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Invalid JSON."
    };
  }
}

function cleanText(value, maxLength = MAX_MESSAGE_LENGTH) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function safeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY_ITEMS)
    .filter(item =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string"
    )
    .map(item => ({
      role: item.role,
      content: item.content.slice(0, MAX_HISTORY_ITEM_LENGTH)
    }));
}

async function callGroq(env, endpoint, payload) {
  if (!env.GROQ_API_KEY) {
    return {
      ok: false,
      status: 503,
      error: "AI सेवा कॉन्फ़िगर नहीं है।"
    };
  }

  let response;

  try {
    response = await fetch(GROQ_API + endpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GROQ_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000)
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: "AI सेवा से संपर्क नहीं हो पाया।"
    };
  }

  if (!response.ok) {
    // Do not return provider response bodies or internal details.
    return {
      ok: false,
      status: response.status === 429 ? 429 : 502,
      error: response.status === 429
        ? "AI सेवा की सीमा पूरी हुई। थोड़ी देर बाद प्रयास करें।"
        : "AI अनुरोध पूरा नहीं हुआ। बाद में प्रयास करें।"
    };
  }

  let data;

  try {
    data = await response.json();
  } catch {
    return {
      ok: false,
      status: 502,
      error: "AI सेवा से अमान्य उत्तर मिला।"
    };
  }

  return { ok: true, data };
}

function validImage(value) {
  if (typeof value !== "string") return false;
  if (value.length > MAX_IMAGE_LENGTH) return false;

  return /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i
    .test(value);
}

async function handleChat(request, env) {
  const parsed = await readJson(request);

  if (!parsed.ok) {
    return errorResponse(
      request, env, parsed.error, parsed.status
    );
  }

  const body = parsed.data;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(request, env, "Invalid request.", 400);
  }

  const message = cleanText(
    body.message ?? body.prompt ?? body.question
  );

  if (!message) {
    return errorResponse(
      request, env, "कृपया अपना प्रश्न लिखें।", 400
    );
  }

  const history = safeHistory(body.history).filter(item =>
    item.role !== "user" || item.content !== message
  );

  const result = await callGroq(env, "/chat/completions", {
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message }
    ],
    temperature: 0.5,
    max_tokens: 1800
  });

  if (!result.ok) {
    return errorResponse(
      request, env, result.error, result.status
    );
  }

  const answer = result.data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    return errorResponse(
      request, env, "AI से उत्तर नहीं मिला।", 502
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
    return errorResponse(
      request, env, parsed.error, parsed.status
    );
  }

  const body = parsed.data;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(request, env, "Invalid request.", 400);
  }

  const image = body.image ?? body.imageData ?? body.imageUrl;

  if (!validImage(image)) {
    return errorResponse(
      request,
      env,
      "JPEG, PNG, WebP या GIF की मान्य base64 data URL भेजें।",
      400
    );
  }

  const prompt = cleanText(
    body.prompt || body.message || "इस तस्वीर को समझाओ।",
    4000
  );

  const result = await callGroq(env, "/chat/completions", {
    model: VISION_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: image }
          }
        ]
      }
    ],
    temperature: 0.3,
    max_tokens: 1500
  });

  if (!result.ok) {
    return errorResponse(
      request, env, result.error, result.status
    );
  }

  const answer = result.data?.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    return errorResponse(
      request, env, "तस्वीर का उत्तर नहीं मिल पाया।", 502
    );
  }

  return jsonResponse(request, env, {
    success: true,
    answer: answer.trim()
  });
}

async function handleTranscription(request, env) {
  if (!env.GROQ_API_KEY) {
    return errorResponse(
      request, env, "AI सेवा कॉन्फ़िगर नहीं है।", 503
    );
  }

  const type = request.headers.get("Content-Type") || "";

  if (!type.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse(
      request,
      env,
      "Audio को multipart/form-data में file नाम से भेजें।",
      415
    );
  }

  const declaredLength = request.headers.get("Content-Length");

  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_AUDIO_BYTES + 500_000)
  ) {
    return errorResponse(
      request, env, "ऑडियो अनुरोध बहुत बड़ा है।", 413
    );
  }

  let form;

  try {
    form = await request.formData();
  } catch {
    return errorResponse(
      request, env, "ऑडियो फ़ाइल पढ़ी नहीं जा सकी।", 400
    );
  }

  const file = form.get("file");

  if (
    !file ||
    typeof file === "string" ||
    typeof file.arrayBuffer !== "function"
  ) {
    return errorResponse(
      request, env, "ऑडियो फ़ाइल नहीं मिली।", 400
    );
  }

  if (file.size < 1 || file.size > MAX_AUDIO_BYTES) {
    return errorResponse(
      request, env, "ऑडियो फ़ाइल की सीमा 7.5 MB है।", 413
    );
  }

  const upload = new FormData();

  upload.append("file", file, file.name || "audio.webm");
  upload.append("model", TRANSCRIBE_MODEL);
  upload.append("response_format", "json");

  let response;

  try {
    response = await fetch(GROQ_API + "/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GROQ_API_KEY
      },
      body: upload,
      signal: AbortSignal.timeout(45_000)
    });
  } catch {
    return errorResponse(
      request, env, "ऑडियो सेवा से संपर्क नहीं हो पाया।", 502
    );
  }

  if (!response.ok) {
    return errorResponse(
      request,
      env,
      response.status === 429
        ? "ऑडियो सेवा की सीमा पूरी हुई।"
        : "ऑडियो को टेक्स्ट में बदलना विफल रहा।",
      response.status === 429 ? 429 : 502
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    return errorResponse(
      request, env, "ऑडियो सेवा से अमान्य उत्तर मिला।", 502
    );
  }

  if (typeof data.text !== "string") {
    return errorResponse(
      request, env, "ऑडियो का टेक्स्ट नहीं मिला।", 502
    );
  }

  return jsonResponse(request, env, {
    success: true,
    text: data.text.slice(0, 50_000)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = request.headers.get("Origin");

    const headers = {
      ...baseHeaders(),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (origin && originAllowed(request, env)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }

    if (request.method === "OPTIONS") {
      if (origin && !originAllowed(request, env)) {
        return new Response(null, {
          status: 403,
          headers
        });
      }

      return new Response(null, {
        status: 204,
        headers
      });
    }

    if (origin && !originAllowed(request, env)) {
      return errorResponse(
        request, env, "यह वेबसाइट अनुमति प्राप्त नहीं है।", 403
      );
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
      return methodNotAllowed(request, env);
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

      return errorResponse(
        request, env, "Endpoint नहीं मिला।", 404
      );
    } catch {
      return errorResponse(
        request, env, "सर्वर में समस्या हुई। बाद में प्रयास करें।", 500
      );
    }
  }
};
