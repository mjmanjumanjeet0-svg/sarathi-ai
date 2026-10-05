const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3.8-27b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

const SYSTEM_PROMPT = `
तुम "सारथी AI" हो — एक भरोसेमंद हिंदी AI सहायक।

मुख्य उत्तर आसान, स्वाभाविक हिंदी में दो।
प्रश्न में जो पूछा है उसी पर केंद्रित रहो।
तथ्य मत गढ़ो।
आज/अभी/latest/current जानकारी के लिए Internet Search उपलब्ध हो तो उसका उपयोग करो।
पढ़ाई के उत्तर में परीक्षा के अनुसार लंबाई रखो।
2 अंक में छोटा उत्तर।
5 अंक में भूमिका + मुख्य बिंदु + निष्कर्ष।
10/12 अंक में भूमिका + headings + पर्याप्त बिंदु + उदाहरण + निष्कर्ष।
गणित में steps और अंतिम उत्तर स्पष्ट दो।
फोटो में जो दिखाई देता है उसी के आधार पर उत्तर दो।
`;

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
      if (request.method !== "POST") {
        return json(
          { error: "Only POST is allowed." },
          405
        );
      }

      return handleChat(request, env);
    }

    if (url.pathname === "/api/transcribe") {
      if (request.method !== "POST") {
        return json(
          { error: "Only POST is allowed." },
          405
        );
      }

      return handleTranscribe(request, env);
    }

    if (url.pathname === "/api/vision") {
      if (request.method !== "POST") {
        return json(
          { error: "Only POST is allowed." },
          405
        );
      }

      return handleVision(request, env);
    }

    if (url.pathname === "/") {
      return new Response(
        "Sarathi AI Worker is running.",
        {
          headers: {
            ...corsHeaders(),
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        }
      );
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Sarathi AI is running.",
      {
        headers: {
          ...corsHeaders(),
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }
};


// ============================================================
// CHAT
// ============================================================

async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error:
          "GROQ_API_KEY Cloudflare Secret में configured नहीं है।",
        code: "MISSING_API_KEY"
      },
      500
    );
  }

  try {
    const body = await request.json();

    const history = Array.isArray(body?.history)
      ? body.history
      : [];

    const message =
      String(body?.message ?? "").trim();

    const useSearch =
      body?.webSearch === true;

    if (!message && history.length === 0) {
      return json(
        {
          error:
            "कृपया पहले अपना सवाल लिखें।",
          code: "EMPTY_QUESTION"
        },
        400
      );
    }

    // --------------------------------------------------------
    // History
    // --------------------------------------------------------

    let messages = history
      .slice(-20)
      .map((item) => {
        const role =
          item?.role === "assistant"
            ? "assistant"
            : "user";

        return {
          role,
          content: String(
            item?.content ?? ""
          )
            .trim()
            .slice(0, 8000)
        };
      })
      .filter(
        (item) => item.content.length > 0
      );

    // --------------------------------------------------------
    // नया सवाल हमेशा अंत में जोड़ें
    // --------------------------------------------------------

    if (message) {
      const last = messages[messages.length - 1];

      // अगर frontend ने सवाल history में नहीं भेजा
      if (
        !last ||
        last.role !== "user" ||
        last.content !== message
      ) {
        messages.push({
          role: "user",
          content: message
        });
      }
    }

    if (messages.length === 0) {
      return json(
        {
          error:
            "कृपया अपना सवाल लिखें।",
          code: "EMPTY_QUESTION"
        },
        400
      );
    }

    // --------------------------------------------------------
    // Main Groq payload
    // --------------------------------------------------------

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        ...messages
      ],

      max_completion_tokens: 4096,
      temperature: 0.2,
      reasoning_effort: "low",
      stream: false
    };

    // --------------------------------------------------------
    // INTERNET SEARCH
    // --------------------------------------------------------

    if (useSearch) {
      payload.tools = [
        {
          type: "browser_search"
        }
      ];

      // IMPORTANT:
      // required की जगह auto
      // इससे सामान्य सवाल पर tool error नहीं होगा।
      payload.tool_choice = "auto";
    }

    // --------------------------------------------------------
    // Main AI call
    // --------------------------------------------------------

    let result = await callGroq(
      payload,
      env.GROQ_API_KEY,
      60000
    );

    // Retry
    if (
      !result.ok &&
      result.retryable
    ) {
      await sleep(1200);

      result = await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );
    }

    // --------------------------------------------------------
    // अगर Search वाला request fail हो जाए
    // तो बिना Search के जवाब देने की कोशिश
    // --------------------------------------------------------

    if (!result.ok && useSearch) {
      const fallbackPayload = {
        model: CHAT_MODEL,

        messages: [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              `
Internet Search इस समय उपलब्ध नहीं हो पाई।
Current/latest जानकारी को verified fact की तरह मत बताओ।
`
          },
          ...messages
        ],

        max_completion_tokens: 4096,
        temperature: 0.2,
        reasoning_effort: "low",
        stream: false
      };

      result = await callGroq(
        fallbackPayload,
        env.GROQ_API_KEY,
        60000
      );
    }

    if (!result.ok) {
      return json(
        {
          error: result.error,
          code: result.code,
          requestId:
            result.requestId || null
        },
        result.status || 502
      );
    }

    if (!result.reply) {
      return json(
        {
          error:
            "AI ने खाली उत्तर दिया। फिर से कोशिश करें।",
          code: "EMPTY_RESPONSE"
        },
        502
      );
    }

    // --------------------------------------------------------
    // SELF CHECK
    // --------------------------------------------------------

    let finalAnswer = result.reply;

    let selfChecked = false;
    let selfCorrected = false;

    try {
      const checked =
        await selfCheckAndCorrect(
          messages,
          result.reply,
          env.GROQ_API_KEY
        );

      if (checked?.reply) {
        finalAnswer = checked.reply;
        selfChecked =
          checked.selfChecked;
        selfCorrected =
          checked.selfCorrected;
      }
    } catch (error) {
      // Self-check fail होने पर भी
      // मुख्य AI का जवाब नहीं रुकेगा।
      console.error(
        "Self-check failed:",
        error
      );

      finalAnswer = result.reply;
    }

    return json({
      answer: finalAnswer,
      selfChecked,
      selfCorrected,
      searchUsed: useSearch
    });

  } catch (error) {
    console.error(
      "Chat error:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        code: "WORKER_ERROR"
      },
      500
    );
  }
}


// ============================================================
// SELF CHECK
// ============================================================

async function selfCheckAndCorrect(
  messages,
  answer,
  apiKey
) {
  try {
    const questionText =
      messages
        .slice(-6)
        .map(
          (item) =>
            `${item.role}: ${item.content}`
        )
        .join("\n\n");

    const payload = {
      model: CHAT_MODEL,

      messages: [
        {
          role: "system",
          content: `
तुम "सारथी AI Quality Checker" हो।

User के सवाल और AI के उत्तर को जाँचो।

जाँच:
1. क्या उत्तर सवाल के अनुसार है?
2. क्या कोई बड़ी factual गलती है?
3. क्या अनावश्यक बात है?
4. क्या उत्तर बहुत छोटा या बहुत लंबा है?
5. क्या कोई मनगढ़ंत जानकारी है?

अगर उत्तर सही है तो उसे लगभग वैसा ही रखो।
अगर गलती है तो पूरा सुधरा हुआ उत्तर दो।

सिर्फ यह JSON format दो:

{
  "needs_correction": false,
  "corrected_answer": "उत्तर"
}
`
        },

        {
          role: "user",
          content:
            `USER:\n${questionText}\n\nAI ANSWER:\n${answer}`
        }
      ],

      max_completion_tokens: 4096,
      temperature: 0,
      reasoning_effort: "low",
      stream: false,

      // JSON schema की जगह plain JSON instruction
      // ताकि model compatibility बेहतर रहे।
      response_format: {
        type: "json_object"
      }
    };

    let result = await callGroq(
      payload,
      apiKey,
      30000
    );

    if (
      !result.ok &&
      result.retryable
    ) {
      await sleep(800);

      result = await callGroq(
        payload,
        apiKey,
        30000
      );
    }

    if (
      !result.ok ||
      !result.raw
    ) {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false
      };
    }

    let report;

    try {
      report = JSON.parse(
        result.raw
      );
    } catch {
      return {
        reply: answer,
        selfChecked: false,
        selfCorrected: false
      };
    }

    const corrected =
      String(
        report?.corrected_answer ?? ""
      ).trim();

    if (!corrected) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false
      };
    }

    if (
      report?.needs_correction !== true
    ) {
      return {
        reply: answer,
        selfChecked: true,
        selfCorrected: false
      };
    }

    // बहुत बड़ा अचानक बदला हुआ उत्तर
    // स्वीकार नहीं करेंगे।
    if (
      corrected.length >
      Math.max(
        answer.length * 3,
        20000
      )
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

  } catch (error) {
    console.error(
      "Self-check error:",
      error
    );

    return {
      reply: answer,
      selfChecked: false,
      selfCorrected: false
    };
  }
}


// ============================================================
// PHOTO / VISION
// ============================================================

async function handleVision(
  request,
  env
) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error:
          "GROQ_API_KEY configured नहीं है।",
        code: "MISSING_API_KEY"
      },
      500
    );
  }

  try {
    const body =
      await request.json();

    const image =
      String(
        body?.image ??
        body?.imageData ??
        body?.imageBase64 ??
        ""
      ).trim();

    const question =
      String(
        body?.question ??
        body?.prompt ??
        "इस फोटो को ध्यान से देखकर सरल हिंदी में समझाओ।"
      ).trim();

    if (!image) {
      return json(
        {
          error:
            "फोटो उपलब्ध नहीं है।",
          code: "MISSING_IMAGE"
        },
        400
      );
    }

    if (
      !image.startsWith(
        "data:image/"
      )
    ) {
      return json(
        {
          error:
            "फोटो का format सही नहीं है।",
          code:
            "INVALID_IMAGE_FORMAT"
        },
        400
      );
    }

    const payload = {
      model: VISION_MODEL,

      messages: [
        {
          role: "system",
          content: `
तुम सारथी AI हो।

फोटो को ध्यान से देखकर सरल और सही हिंदी में उत्तर दो।

अगर फोटो में:
- प्रश्न है तो प्रश्न हल करो।
- किताब/नोट्स हैं तो समझाओ।
- diagram है तो समझाओ।
- chart है तो उसका अर्थ बताओ।
- कोई वस्तु है तो दिखाई देने वाली जानकारी बताओ।

जो फोटो में दिखाई नहीं देता उसके बारे में अनुमान मत लगाओ।
`
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

      max_completion_tokens: 4096,
      temperature: 0.4,
      reasoning_effort: "low",
      stream: false
    };

    const result =
      await callGroq(
        payload,
        env.GROQ_API_KEY,
        60000
      );

    if (!result.ok) {
      return json(
        {
          error: result.error,
          code: result.code,
          requestId:
            result.requestId || null
        },
        result.status || 502
      );
    }

    return json({
      answer:
        result.reply ||
        "फोटो से कोई उत्तर नहीं मिला।"
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        code: "VISION_ERROR"
      },
      500
    );
  }
}


// ============================================================
// VOICE TRANSCRIPTION
// ============================================================

async function handleTranscribe(
  request,
  env
) {
  if (!env.GROQ_API_KEY) {
    return json(
      {
        error:
          "GROQ_API_KEY configured नहीं है।",
        code: "MISSING_API_KEY"
      },
      500
    );
  }

  try {
    let audioFile = null;

    const contentType =
      request.headers.get(
        "content-type"
      ) || "";

    // --------------------------------------------------------
    // Multipart
    // --------------------------------------------------------

    if (
      contentType.includes(
        "multipart/form-data"
      )
    ) {
      const form =
        await request.formData();

      const file =
        form.get("file") ||
        form.get("audio");

      if (file instanceof File) {
        audioFile = file;
      }
    }

    // --------------------------------------------------------
    // JSON Base64
    // --------------------------------------------------------

    else {
      const body =
        await request.json();

      const base64 =
        String(
          body?.audio ?? ""
        ).trim();

      const mimeType =
        String(
          body?.mimeType ??
          "audio/webm"
        ).trim();

      if (!base64) {
        return json(
          {
            error:
              "Audio उपलब्ध नहीं है।",
            code:
              "MISSING_AUDIO"
          },
          400
        );
      }

      const cleanBase64 =
        base64.includes(",")
          ? base64
              .split(",")
              .pop()
          : base64;

      let binary;

      try {
        binary =
          atob(cleanBase64);
      } catch {
        return json(
          {
            error:
              "Audio Base64 सही नहीं है।",
            code:
              "INVALID_BASE64"
          },
          400
        );
      }

      const bytes =
        new Uint8Array(
          binary.length
        );

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

      let extension = "webm";

      if (
        safeMime.includes("mp4")
      ) {
        extension = "mp4";
      } else if (
        safeMime.includes("ogg")
      ) {
        extension = "ogg";
      } else if (
        safeMime.includes("wav")
      ) {
        extension = "wav";
      } else if (
        safeMime.includes("mpeg") ||
        safeMime.includes("mp3")
      ) {
        extension = "mp3";
      }

      audioFile =
        new File(
          [bytes],
          `sarathi-voice.${extension}`,
          {
            type: safeMime
          }
        );
    }

    if (!audioFile) {
      return json(
        {
          error:
            "Audio file नहीं मिला।",
          code:
            "MISSING_AUDIO"
        },
        400
      );
    }

    const form =
      new FormData();

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

    const response =
      await fetch(
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
      data = raw
        ? JSON.parse(raw)
        : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      return json(
        {
          error:
            data?.error?.message ||
            raw ||
            `Groq transcription error (${response.status})`,
          code:
            "TRANSCRIPTION_API_ERROR"
        },
        response.status
      );
    }

    return json({
      text:
        String(
          data?.text ?? ""
        ).trim()
    });

  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        code:
          "TRANSCRIPTION_ERROR"
      },
      500
    );
  }
}


// ============================================================
// GROQ API CALL
// ============================================================

async function callGroq(
  payload,
  apiKey,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
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

          body: JSON.stringify(
            payload
          ),

          signal:
            controller.signal
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data = raw
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

    // --------------------------------------------------------
    // API Error
    // --------------------------------------------------------

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
      Array.isArray(
        data?.choices
      )
        ? data.choices[0]
        : null;

    const content =
      typeof choice?.message?.content ===
      "string"
        ? choice.message.content.trim()
        : "";

    // --------------------------------------------------------
    // Structured JSON response
    // --------------------------------------------------------

    if (
      payload.response_format
    ) {
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

    // --------------------------------------------------------
    // Empty response
    // --------------------------------------------------------

    if (!content) {
      return {
        ok: false,
        retryable: true,
        status: 502,
        code:
          "EMPTY_RESPONSE",
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


// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization"
  };
}


function json(
  data,
  status = 200
) {
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
