// ============================================================
// SARATHI AI — Cloudflare Worker
// Chat + Internet Search + Voice + Photo + Self Check
// ============================================================

const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3.8-27b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ----------------------------------------------------------
    // CORS
    // ----------------------------------------------------------
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    try {
      // --------------------------------------------------------
      // Health Check
      // --------------------------------------------------------
      if (url.pathname === "/" && request.method === "GET") {
        return json(
          {
            ok: true,
            service: "Sarathi AI",
            status: "running",
          },
          200
        );
      }

      // --------------------------------------------------------
      // CHAT
      // --------------------------------------------------------
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await handleChat(request, env);
      }

      // --------------------------------------------------------
      // VOICE TRANSCRIPTION
      // --------------------------------------------------------
      if (
        url.pathname === "/api/transcribe" &&
        request.method === "POST"
      ) {
        return await handleTranscribe(request, env);
      }

      // --------------------------------------------------------
      // PHOTO / VISION
      // --------------------------------------------------------
      if (url.pathname === "/api/vision" && request.method === "POST") {
        return await handleVision(request, env);
      }

      return json(
        {
          error: "API endpoint not found.",
        },
        404
      );
    } catch (error) {
      console.error("Worker error:", error);

      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown server error.",
        },
        500
      );
    }
  },
};


// ============================================================
// CHAT HANDLER
// ============================================================

async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY is not configured.",
      },
      500
    );
  }

  const body = await request.json();

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  const history = Array.isArray(body.history)
    ? body.history
    : [];

  const webSearch = Boolean(body.webSearch);

  if (!message) {
    return json(
      {
        error: "Message is required.",
      },
      400
    );
  }

  const messages = [
    {
      role: "system",
      content: `
तुम "सारथी AI" हो।

तुम्हारा काम उपयोगकर्ता को सरल, सही और उपयोगी उत्तर देना है।

नियम:
1. उपयोगकर्ता हिंदी में पूछे तो हिंदी में उत्तर दो।
2. उत्तर आसान भाषा में दो।
3. जरूरत हो तो उदाहरण दो।
4. तथ्य को लेकर निश्चित न हो तो साफ बताओ।
5. इंटरनेट सर्च उपलब्ध हो तो ताजा जानकारी के लिए उसका उपयोग करो।
6. गलत जानकारी बनाने की कोशिश मत करो।
7. पढ़ाई के सवालों में परीक्षा के हिसाब से स्पष्ट उत्तर दो।
8. कोड मांगने पर पूरा copy-paste योग्य code दो।
9. उपयोगकर्ता को API key, password या secret chat में भेजने को मत कहो।
10. उत्तर अनावश्यक रूप से बहुत लंबा मत करो।
      `.trim(),
    },
  ];

  // ----------------------------------------------------------
  // पुराने messages सुरक्षित रूप से जोड़ें
  // ----------------------------------------------------------

  for (const item of history.slice(-20)) {
    if (!item || typeof item !== "object") continue;

    const role =
      item.role === "assistant"
        ? "assistant"
        : item.role === "user"
          ? "user"
          : null;

    const content =
      typeof item.content === "string"
        ? item.content
        : typeof item.text === "string"
          ? item.text
          : "";

    if (role && content.trim()) {
      messages.push({
        role,
        content: content.trim(),
      });
    }
  }

  // ----------------------------------------------------------
  // नया user message
  // ----------------------------------------------------------

  messages.push({
    role: "user",
    content: message,
  });

  // ----------------------------------------------------------
  // Groq request
  // ----------------------------------------------------------

  const payload = {
    model: CHAT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 2000,
  };

  // ----------------------------------------------------------
  // Internet Search
  // ----------------------------------------------------------

  if (webSearch) {
    payload.tools = [
      {
        type: "browser_search",
      },
    ];

    payload.tool_choice = "required";
  }

  const result = await callGroq(env.GROQ_API_KEY, payload);

  const answer = extractAnswer(result);

  if (!answer) {
    console.error("Groq response:", result);

    return json(
      {
        error: "Groq returned an empty response.",
      },
      502
    );
  }

  // ----------------------------------------------------------
  // Self Check
  // ----------------------------------------------------------

  let selfChecked = false;
  let finalAnswer = answer;

  try {
    const checked = await selfCheckAndCorrect(
      env.GROQ_API_KEY,
      message,
      answer
    );

    if (
      checked &&
      typeof checked.answer === "string" &&
      checked.answer.trim()
    ) {
      finalAnswer = checked.answer.trim();
      selfChecked = true;
    }
  } catch (error) {
    console.error("Self-check failed:", error);
  }

  return json(
    {
      answer: finalAnswer,
      selfChecked,
    },
    200
  );
}


// ============================================================
// VOICE TRANSCRIPTION
// ============================================================

async function handleTranscribe(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY is not configured.",
      },
      500
    );
  }

  let audioBlob;
  let mimeType = "audio/webm";

  const contentType =
    request.headers.get("content-type") || "";

  // ----------------------------------------------------------
  // JSON BASE64
  // ----------------------------------------------------------

  if (contentType.includes("application/json")) {
    const body = await request.json();

    const audioBase64 =
      typeof body.audio === "string"
        ? body.audio
        : "";

    mimeType =
      typeof body.mimeType === "string"
        ? body.mimeType
        : "audio/webm";

    if (!audioBase64) {
      return json(
        {
          error: "Audio data is missing.",
        },
        400
      );
    }

    const cleanBase64 = audioBase64.includes(",")
      ? audioBase64.split(",").pop()
      : audioBase64;

    const binary = Uint8Array.from(
      atob(cleanBase64),
      (char) => char.charCodeAt(0)
    );

    audioBlob = new Blob([binary], {
      type: mimeType,
    });
  }

  // ----------------------------------------------------------
  // MULTIPART FORM DATA
  // ----------------------------------------------------------

  else if (
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();

    const file =
      formData.get("file") ||
      formData.get("audio");

    if (!(file instanceof File)) {
      return json(
        {
          error: "Audio file is missing.",
        },
        400
      );
    }

    audioBlob = file;

    mimeType =
      file.type || "audio/webm";
  }

  else {
    return json(
      {
        error: "Unsupported audio request format.",
      },
      400
    );
  }

  // ----------------------------------------------------------
  // Groq Whisper
  // ----------------------------------------------------------

  const form = new FormData();

  const extension =
    mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("mpeg")
        ? "mp3"
        : "webm";

  form.append(
    "file",
    new File(
      [audioBlob],
      `voice.${extension}`,
      {
        type: mimeType,
      }
    )
  );

  form.append(
    "model",
    TRANSCRIBE_MODEL
  );

  form.append(
    "language",
    "hi"
  );

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: form,
    }
  );

  const text = await response.text();

  if (!response.ok) {
    console.error(
      "Groq transcription error:",
      text
    );

    return json(
      {
        error:
          "Voice transcription failed.",
        details: text,
      },
      response.status
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return json(
      {
        error:
          "Invalid transcription response.",
      },
      502
    );
  }

  return json(
    {
      text:
        typeof data.text === "string"
          ? data.text.trim()
          : "",
    },
    200
  );
}


// ============================================================
// PHOTO / VISION
// ============================================================

async function handleVision(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error: "GROQ_API_KEY is not configured.",
      },
      500
    );
  }

  const body = await request.json();

  const image =
    typeof body.image === "string"
      ? body.image
      : typeof body.imageData === "string"
        ? body.imageData
        : typeof body.imageBase64 === "string"
          ? body.imageBase64
          : "";

  const question =
    typeof body.question === "string" &&
    body.question.trim()
      ? body.question.trim()
      : "इस फोटो को समझाओ।";

  if (!image) {
    return json(
      {
        error: "Image is missing.",
      },
      400
    );
  }

  // ----------------------------------------------------------
  // Image URL / Data URL
  // ----------------------------------------------------------

  let imageUrl = image;

  if (!image.startsWith("data:")) {
    imageUrl =
      `data:image/jpeg;base64,${image}`;
  }

  const messages = [
    {
      role: "system",
      content:
        "तुम सारथी AI के vision assistant हो। फोटो को ध्यान से देखकर हिंदी में सरल और सही उत्तर दो। जो फोटो में दिखाई नहीं देता उसके बारे में अनुमान मत लगाओ।",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: question,
        },
        {
          type: "image_url",
          image_url: {
            url: imageUrl,
          },
        },
      ],
    },
  ];

  const payload = {
    model: VISION_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 1500,
  };

  const result = await callGroq(
    env.GROQ_API_KEY,
    payload
  );

  const answer = extractAnswer(result);

  if (!answer) {
    console.error(
      "Vision response:",
      result
    );

    return json(
      {
        error:
          "Photo analysis returned an empty response.",
      },
      502
    );
  }

  return json(
    {
      answer,
    },
    200
  );
}


// ============================================================
// SELF CHECK
// ============================================================

async function selfCheckAndCorrect(
  apiKey,
  question,
  answer
) {
  const payload = {
    model: CHAT_MODEL,

    messages: [
      {
        role: "system",
        content: `
तुम उत्तर की quality check करने वाले assistant हो।

तुम्हें:
1. दिए गए उत्तर में बड़ी factual गलती देखनी है।
2. प्रश्न से असंबंधित बात हटानी है।
3. अगर उत्तर सही है तो उसे लगभग वैसा ही रखो।
4. अगर उत्तर गलत या भ्रामक है तो उसे सुधारो।
5. बिना कारण उत्तर को लंबा मत करो।

सिर्फ JSON दो:
{
  "answer": "सुधारा हुआ अंतिम उत्तर"
}
        `.trim(),
      },
      {
        role: "user",
        content:
          `प्रश्न:\n${question}\n\nउत्तर:\n${answer}`,
      },
    ],

    temperature: 0.1,
    max_tokens: 2000,

    response_format: {
      type: "json_schema",
      json_schema: {
        name: "answer_check",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: {
              type: "string",
            },
          },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    },
  };

  const result =
    await callGroq(apiKey, payload);

  const content =
    result?.choices?.[0]?.message?.content;

  if (
    typeof content !== "string" ||
    !content.trim()
  ) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return {
      answer: content.trim(),
    };
  }
}


// ============================================================
// GROQ API
// ============================================================

async function callGroq(apiKey, payload) {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify(payload),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    console.error(
      "Groq API error:",
      response.status,
      text
    );

    let message =
      `Groq API error: ${response.status}`;

    try {
      const errorData =
        JSON.parse(text);

      if (
        errorData?.error?.message
      ) {
        message =
          errorData.error.message;
      }
    } catch {
      // Ignore JSON parse error
    }

    throw new Error(message);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Groq returned invalid JSON."
    );
  }
}


// ============================================================
// EXTRACT ANSWER
// ============================================================

function extractAnswer(result) {
  const message =
    result?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  if (
    typeof message.content === "string"
  ) {
    return message.content.trim();
  }

  // कुछ tool responses में content array हो सकता है
  if (Array.isArray(message.content)) {
    const parts = [];

    for (const part of message.content) {
      if (
        typeof part?.text === "string"
      ) {
        parts.push(part.text);
      }
    }

    return parts.join("\n").trim();
  }

  return "";
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type":
          "application/json; charset=utf-8",
      },
    }
  );
}


// ============================================================
// CORS HEADERS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
  };
}
