const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3.8-27b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

const SYSTEM_PROMPT = `तुम "सारथी AI" हो — एक भरोसेमंद हिंदी AI सहायक।

मुख्य उत्तर आसान, स्वाभाविक हिंदी में दो।
प्रश्न में जो पूछा है उसी पर केंद्रित रहो।
तथ्य मत गढ़ो।

CURRENT / SEARCH RULES:

जब User आज, अभी, latest, current, live, ताजा, आज का मौसम,
मौसम का पूर्वानुमान, आज की कीमत, सोने-चांदी का भाव,
ट्रेन की स्थिति, समाचार या किसी भी बदलने वाली वर्तमान जानकारी
के बारे में पूछे और Internet Search ON हो,
तो Browser Search का उपयोग करके ताजा जानकारी खोजो।

Search ON होने पर current-information वाले सवाल का उत्तर
बिना Search result के मत दो।

मौसम के सवाल में पहले Search से उपलब्ध ताजा मौसम जानकारी खोजो।

यदि Search से ताजा जानकारी प्राप्त नहीं हो पाती,
तो साफ बताओ कि ताजा जानकारी प्राप्त नहीं हो सकी।

Search result से मिली जानकारी को समझकर सरल हिंदी में उत्तर दो।
जहाँ संभव हो स्रोत का नाम और स्रोत की तारीख बताओ।

स्रोत की publication/update date और जिस तारीख का data है,
दोनों को अलग समझो।

जिस तारीख के बारे में User पूछ रहा है,
केवल उसी तारीख या उससे पहले उपलब्ध/प्रकाशित स्रोत को
उस तारीख के प्रमाण के रूप में उपयोग करो।

भविष्य की तारीख वाले स्रोत को वर्तमान या पिछली तारीख की
जानकारी का प्रमाण मत बनाओ।

यदि मांगी गई तारीख का exact ताजा data उपलब्ध नहीं है,
तो उपलब्ध सबसे हाल के data की तारीख साफ बताओ।
Exact current value मत गढ़ो।

यदि User "आज" पूछता है और सबसे नया विश्वसनीय Search result
पिछली तारीख का है, तो उसे "आज का भाव" या "आज का मौसम"
कहकर प्रस्तुत मत करो।

Search के उत्तर में Groq के internal citation markers
जैसे 【...】, [1], [2], L22-L34 आदि मत लिखो।
स्रोत का नाम और तारीख साधारण text में बताओ।

परीक्षा के उत्तर में अंक के अनुसार लंबाई रखो।
2 अंक में छोटा उत्तर।
5 अंक में भूमिका + 4–6 बिंदु + निष्कर्ष।
10/12 अंक में भूमिका + headings + पर्याप्त बिंदु + उदाहरण + निष्कर्ष।

बिना आवश्यकता advanced technical terms मत जोड़ो।
गणित में steps और अंतिम उत्तर स्पष्ट दो।
कारण, घटना और परिणाम को आपस में मत मिलाओ।
फोटो में जो दिखाई देता है उसी के आधार पर उत्तर दो।
अनावश्यक bold या italic formatting मत लगाओ।`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/api/chat") {
      return request.method === "POST"
        ? handleChat(request, env)
        : json({ error: "Only POST is allowed." }, 405);
    }

    if (url.pathname === "/api/transcribe") {
      return request.method === "POST"
        ? handleTranscribe(request, env)
        : json({ error: "Only POST is allowed." }, 405);
    }

    if (url.pathname === "/api/vision") {
      return request.method === "POST"
        ? handleVision(request, env)
        : json({ error: "Only POST is allowed." }, 405);
    }

    // पहले website assets serve होंगे
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/") {
      return new Response("Sarathi AI Worker is running.", {
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    }

    return new Response("Sarathi AI is running.", {
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
};


// =========================
// CHAT
// =========================

async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) {
    return json({
      error: "GROQ_API_KEY Cloudflare Secret में configured नहीं है।",
      code: "MISSING_API_KEY"
    }, 500);
  }

  try {
    const body = await request.json();

    const history = Array.isArray(body?.history)
      ? body.history
      : [];

    const message = String(body?.message ?? "").trim();
    const useSearch = body?.webSearch === true;

    let messages = history
      .slice(-20)
      .map((m) => ({
        role: m?.role === "assistant"
          ? "assistant"
          : "user",
        content: String(m?.content ?? "")
          .trim()
          .slice(0, 8000)
      }))
      .filter((m) => m.content);

    // अगर frontend ने current message history में पहले ही भेज दिया है,
    // तो उसे दोबारा नहीं जोड़ेंगे।
    if (
      message &&
      !(
        messages.length &&
        messages[messages.length - 1].role === "user" &&
        messages[messages.length - 1].content === message
      )
    ) {
      messages.push({
        role: "user",
        content: message.slice(0, 8000)
      });
    }

    if (!messages.length) {
      return json({
        error: "कृपया पहले अपना सवाल लिखें।",
        code: "EMPTY_QUESTION"
      }, 400);
    }

    const indiaNow = new Intl.DateTimeFormat(
      "hi-IN",
      {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "short"
      }
    ).format(new Date());

    const systemContent =
      SYSTEM_PROMPT +
      `\n\nभारत में अभी का समय: ${indiaNow}।
जब User आज/अभी/latest/current पूछे,
तो इस समय को संदर्भ मानो।`;

    const payload = {
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content: systemContent
        },
        ...messages
      ],
      max_completion_tokens: 2048,
      temperature: 0.2,
      reasoning_effort: "low",
      stream: false
    };

    // =========================
    // INTERNET SEARCH
    // =========================

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search"
        }
      ];

      payload.tool_choice = "required";
    }

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    if (!result.ok && result.retryable) {
      await sleep(1200);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );
    }

    // Search fail होने पर बिना Search के current answer नहीं देंगे।
    if (!result.ok) {
      return json({
        error: result.error,
        code: result.code,
        requestId: result.requestId || null
      }, result.status || 502);
    }

    if (!result.reply) {
      return json({
        error: "AI ने खाली उत्तर दिया। फिर से कोशिश करें।",
        code: "EMPTY_RESPONSE"
      }, 502);
    }

    // =========================
    // SEARCH ANSWER
    // Search answer पर दूसरा Groq request नहीं।
    // इससे rate-limit और गलत correction की समस्या कम होगी।
    // =========================

    if (useSearch) {
      const cleanReply = cleanSearchCitations(result.reply);

      return json({
        answer: cleanReply,
        selfChecked: false,
        selfCorrected: false,
        searchUsed: true
      });
    }

    // =========================
    // NORMAL CHAT SELF-CHECK
    // =========================

    const checked = await selfCheckAndCorrect(
      messages,
      result.reply,
      env.GROQ_API_KEY
    );

    return json({
      answer: checked.reply,
      selfChecked: checked.selfChecked,
      selfCorrected: checked.selfCorrected,
      searchUsed: false
    });

  } catch (error) {
    return json({
      error: error instanceof Error
        ? error.message
        : String(error),
      code: "WORKER_ERROR"
    }, 500);
  }
}


// =========================
// SELF CHECK
// =========================

async function selfCheckAndCorrect(
  messages,
  answer,
  apiKey
) {
  try {
    const questionText = messages
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: `तुम "सारथी AI Quality Checker" हो।

User के सवाल और AI answer की जाँच करो।

जाँच करो:
1. तथ्य सही हैं या नहीं।
2. सवाल का सीधा उत्तर दिया गया है या नहीं।
3. कोई मनगढ़ंत बात तो नहीं है।
4. अनावश्यक जानकारी तो नहीं है।

सही हो तो:
needs_correction=false

गलत हो तो:
needs_correction=true

गलती होने पर पूरा सुधरा हुआ उत्तर दो।
मनगढ़ंत जानकारी मत जोड़ो।`
        },

        {
          role: "user",
          content:
            `USER:\n${questionText}\n\nAI ANSWER:\n${answer}`
        }
      ],

      max_completion_tokens: 1024,
      temperature: 0,
      reasoning_effort: "low",
      stream: false,

      response_format: {
        type: "json_schema",

        json_schema: {
          name: "sarathi_quality_check",

          strict: true,

          schema: {
            type: "object",

            properties: {
              needs_correction: {
                type: "boolean"
              },

              corrected_answer: {
                type: "string"
              }
            },

            required: [
              "needs_correction",
              "corrected_answer"
            ],

            additionalProperties: false
          }
        }
      }
    };

    let result = await callGroq(
      payload,
      apiKey,
      30000
    );

    if (!result.ok || !result.raw) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false
      };
    }

    let report;

    try {
      report = JSON.parse(result.raw);
    } catch {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false
      };
    }

    const corrected = String(
      report?.corrected_answer ?? ""
    ).trim();

    if (!corrected) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false
      };
    }

    if (report?.needs_correction !== true) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false
      };
    }

    // बहुत बड़ा या अजीब correction आने पर
    // original answer ही सुरक्षित रखें।
    if (
      corrected.length >
      Math.max(answer.length * 3, 20000)
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false
      };
    }

    return {
      reply: corrected,
      selfChecked: true,
      selfCorrected: true
    };

  } catch {
    return {
      reply: answer,
      selfChecked: false,
      selfCorrected: false
    };
  }
}


// =========================
// VISION / PHOTO
// =========================

async function handleVision(request, env) {
  if (!env.GROQ_API_KEY) {
    return json({
      error: "GROQ_API_KEY configured नहीं है।",
      code: "MISSING_API_KEY"
    }, 500);
  }

  try {
    const body = await request.json();

    const image = String(
      body?.image ??
      body?.imageData ??
      body?.imageBase64 ??
      ""
    ).trim();

    const question = String(
      body?.question ??
      body?.prompt ??
      "इस फोटो को ध्यान से देखकर सरल हिंदी में समझाओ।"
    ).trim();

    if (!image) {
      return json({
        error: "फोटो उपलब्ध नहीं है।",
        code: "MISSING_IMAGE"
      }, 400);
    }

    if (!image.startsWith("data:image/")) {
      return json({
        error: "फोटो का format सही नहीं है।",
        code: "INVALID_IMAGE_FORMAT"
      }, 400);
    }

    const payload = {
      model: VISION_MODEL,

      messages: [
        {
          role: "system",
          content:
            "तुम सारथी AI हो। फोटो को ध्यान से देखो। " +
            "फोटो में प्रश्न, किताब, नोट्स, diagram, chart या handwriting हो " +
            "तो उसे पढ़कर सरल और सही हिंदी में समझाओ। " +
            "जो दिखाई नहीं देता उसे मत गढ़ो।"
        },

        {
          role: "user",

          content: [
            {
              type: "text",
              text: question
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

      max_completion_tokens: 2048,
      temperature: 0.4,
      reasoning_effort: "low",
      stream: false
    };

    const result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    if (!result.ok) {
      return json({
        error: result.error,
        code: result.code,
        requestId: result.requestId || null
      }, result.status || 502);
    }

    return json({
      answer:
        result.reply ||
        "फोटो से कोई उत्तर नहीं मिला।"
    });

  } catch (error) {
    return json({
      error: error instanceof Error
        ? error.message
        : String(error),
      code: "VISION_ERROR"
    }, 500);
  }
}


// =========================
// VOICE TRANSCRIPTION
// =========================

async function handleTranscribe(request, env) {
  if (!env.GROQ_API_KEY) {
    return json({
      error: "GROQ_API_KEY configured नहीं है।",
      code: "MISSING_API_KEY"
    }, 500);
  }

  try {
    let audioFile = null;

    const contentType =
      request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {

      const form = await request.formData();

      const file =
        form.get("file") ||
        form.get("audio");

      if (file instanceof File) {
        audioFile = file;
      }

    } else {

      const body = await request.json();

      const base64 =
        String(body?.audio ?? "").trim();

      const mimeType =
        String(
          body?.mimeType ??
          "audio/webm"
        ).trim();

      if (!base64) {
        return json({
          error: "Audio उपलब्ध नहीं है।",
          code: "MISSING_AUDIO"
        }, 400);
      }

      const cleanBase64 =
        base64.includes(",")
          ? base64.split(",").pop()
          : base64;

      let binary;

      try {
        binary = atob(cleanBase64);
      } catch {
        return json({
          error: "Audio Base64 सही नहीं है।",
          code: "INVALID_BASE64"
        }, 400);
      }

      const bytes =
        new Uint8Array(binary.length);

      for (
        let i = 0;
        i < binary.length;
        i++
      ) {
        bytes[i] =
          binary.charCodeAt(i);
      }

      const safeMime =
        mimeType.split(";")[0] ||
        "audio/webm";

      const extension =
        safeMime.includes("mp4")
          ? "mp4"
          : safeMime.includes("ogg")
            ? "ogg"
            : safeMime.includes("wav")
              ? "wav"
              : safeMime.includes("mpeg") ||
                safeMime.includes("mp3")
                ? "mp3"
                : "webm";

      audioFile = new File(
        [bytes],
        `sarathi-voice.${extension}`,
        {
          type: safeMime
        }
      );
    }

    if (!audioFile) {
      return json({
        error: "Audio file नहीं मिला।",
        code: "MISSING_AUDIO"
      }, 400);
    }

    const form = new FormData();

    form.append(
      "file",
      audioFile,
      audioFile.name ||
      "sarathi-voice.webm"
    );

    form.append(
      "model",
      TRANSCRIBE_MODEL
    );

    form.append(
      "language",
      "hi"
    );

    form.append(
      "response_format",
      "json"
    );

    form.append(
      "temperature",
      "0"
    );

    form.append(
      "prompt",
      "हिंदी में साफ शब्दों में बोले गए प्रश्न को लिखो।"
    );

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${env.GROQ_API_KEY}`
        },

        body: form
      }
    );

    const raw =
      await response.text();

    let data;

    try {
      data =
        raw
          ? JSON.parse(raw)
          : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      return json({
        error:
          data?.error?.message ||
          raw ||
          `Groq transcription error (${response.status})`,

        code:
          "TRANSCRIPTION_API_ERROR"

      }, response.status);
    }

    return json({
      text:
        String(
          data?.text ?? ""
        ).trim()
    });

  } catch (error) {
    return json({
      error:
        error instanceof Error
          ? error.message
          : String(error),

      code:
        "TRANSCRIPTION_ERROR"

    }, 500);
  }
}


// =========================
// GROQ API
// =========================

async function callGroq(
  payload,
  apiKey,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {

    const response =
      await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify(payload),

          signal:
            controller.signal
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data =
        raw
          ? JSON.parse(raw)
          : {};
    } catch {
      data = {};
    }

    const requestId =
      response.headers.get(
        "x-request-id"
      ) ||
      response.headers.get(
        "x-groq-request-id"
      ) ||
      data?.id ||
      null;

    if (!response.ok) {

      const message =
        data?.error?.message ||
        data?.message ||
        raw ||
        `Groq API error (${response.status})`;

      return {
        ok: false,

        retryable:
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500,

        status:
          response.status,

        code:
          data?.error?.code ||
          `HTTP_${response.status}`,

        error:
          message,

        requestId,

        raw: null
      };
    }

    const choice =
      Array.isArray(data?.choices)
        ? data.choices[0]
        : null;

    const content =
      typeof choice?.message?.content === "string"
        ? choice.message.content.trim()
        : "";

    // Self-check का JSON response
    if (payload.response_format) {

      if (!content) {
        return {
          ok: false,
          retryable: true,
          status: 502,
          code:
            "EMPTY_STRUCTURED_RESPONSE",
          error:
            "Structured response खाली है।",
          requestId,
          raw: null
        };
      }

      return {
        ok: true,
        reply: "",
        raw: content,
        requestId
      };
    }

    if (!content) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code: "EMPTY_RESPONSE",
        error:
          "Groq ने खाली उत्तर दिया।",
        requestId,
        raw: null
      };
    }

    return {
      ok: true,
      reply: content,
      raw: null,
      requestId
    };

  } catch (error) {

    return {
      ok: false,
      retryable: true,
      status: 504,

      code:
        error?.name === "AbortError"
          ? "GROQ_TIMEOUT"
          : "GROQ_NETWORK_ERROR",

      error:
        error?.name === "AbortError"
          ? "Groq से जवाब आने में बहुत समय लगा।"
          : `Groq connection error: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`,

      requestId: null,
      raw: null
    };

  } finally {
    clearTimeout(timeout);
  }
}


// =========================
// SEARCH CITATION CLEANER
// =========================

function cleanSearchCitations(text) {
  return String(text || "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[\d+\]\s*/g, "")
    .trim();
}


// =========================
// HELPERS
// =========================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),

    {
      status,

      headers: {
        ...corsHeaders(),

        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}
