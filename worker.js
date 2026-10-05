// ============================================================
// सारथी AI - Cloudflare Worker
// Chat + Internet Search + Vision + Hindi Voice Transcription
// ============================================================

const CHAT_MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3.8-27b";
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

const GROQ_URL =
  "https://api.groq.com/openai/v1/chat/completions";

const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";


// ============================================================
// MAIN WORKER
// ============================================================

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


    // ----------------------------------------------------------
    // HEALTH CHECK
    // ----------------------------------------------------------

    if (request.method === "GET") {

      return json({
        ok: true,
        service: "Sarathi AI",

        model: CHAT_MODEL,

        visionModel: VISION_MODEL,

        transcriptionModel:
          TRANSCRIBE_MODEL,
      });
    }


    // ----------------------------------------------------------
    // POST ONLY
    // ----------------------------------------------------------

    if (request.method !== "POST") {

      return json(
        {
          error: "Method not allowed.",
        },
        405
      );
    }


    try {

      // --------------------------------------------------------
      // CHAT
      // --------------------------------------------------------

      if (url.pathname === "/api/chat") {

        return await handleChat(
          request,
          env
        );
      }


      // --------------------------------------------------------
      // VISION
      // --------------------------------------------------------

      if (url.pathname === "/api/vision") {

        return await handleVision(
          request,
          env
        );
      }


      // --------------------------------------------------------
      // VOICE TRANSCRIPTION
      // --------------------------------------------------------

      if (
        url.pathname === "/api/transcribe"
      ) {

        return await handleTranscribe(
          request,
          env
        );
      }


      // --------------------------------------------------------
      // NOT FOUND
      // --------------------------------------------------------

      return json(
        {
          error: "Not found.",
        },
        404
      );

    } catch (error) {

      console.error(
        "Worker error:",
        error
      );


      return json(
        {
          ok: false,

          error:
            error?.message ||
            "Server error.",

          answer:
            "अभी जवाब नहीं मिल पाया। कृपया थोड़ी देर बाद फिर से कोशिश करें।",
        },
        500
      );
    }
  },
};


// ============================================================
// CHAT HANDLER
// ============================================================

async function handleChat(
  request,
  env
) {

  const body =
    await request.json();


  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";


  if (!message) {

    return json(
      {
        ok: false,

        error:
          "Message is required.",

        answer:
          "कृपया अपना सवाल लिखें।",
      },
      400
    );
  }


  const webSearch =
    Boolean(body.webSearch);


  // ----------------------------------------------------------
  // CURRENT INDIA DATE
  // ----------------------------------------------------------

  const now =
    new Date();


  const todayIndia =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Kolkata",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    ).format(now);


  const readableIndiaDate =
    new Intl.DateTimeFormat(
      "hi-IN",
      {
        timeZone:
          "Asia/Kolkata",

        dateStyle:
          "full",
      }
    ).format(now);


  // ----------------------------------------------------------
  // HISTORY
  // ----------------------------------------------------------

  const history =
    Array.isArray(body.history)

      ? body.history
          .slice(-8)
          .filter(
            (item) =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content ===
                "string"
          )
          .map(
            (item) => ({
              role:
                item.role,

              content:
                item.content.slice(
                  0,
                  3000
                ),
            })
          )

      : [];


  // ----------------------------------------------------------
  // CURRENT QUESTION
  // ----------------------------------------------------------

  const currentQuestion =
    isCurrentQuestion(
      message
    );


  // ----------------------------------------------------------
  // SYSTEM PROMPT
  // ----------------------------------------------------------

  const systemPrompt = `
तुम "सारथी AI" हो — एक मददगार, सटीक और सरल हिंदी AI assistant।

भारत की वर्तमान तारीख:
${todayIndia}

भारत में आज:
${readableIndiaDate}

नियम:

1. सामान्य सवालों का स्पष्ट और सरल उत्तर दो।

2. यदि Internet Search उपलब्ध है और सवाल
आज, अभी, वर्तमान, latest, current, price, rate,
weather, news, train, time या किसी अन्य ताजा जानकारी
से संबंधित है, तो Search से ताजा जानकारी लो।

3. Search से मिली पुरानी तारीख को "आज" मत बताओ।

4. वर्तमान जानकारी देते समय तारीख स्पष्ट रखना जरूरी हो
तो तारीख जरूर बताओ।

5. जानकारी गढ़ो मत।

6. यदि स्रोतों में अंतर हो तो उसे संक्षेप में बताओ।

7. भारत से संबंधित सवालों में भारतीय संदर्भ रखो।

8. उपयोगकर्ता हिंदी में पूछे तो हिंदी में जवाब दो।

9. जवाब बहुत अनावश्यक रूप से लंबा मत करो।

10. गणना में सावधानी रखो।

11. अगर सवाल अस्पष्ट है तो जरूरी clarification मांगो।

12. Search results और पुराने knowledge में
अंतर हो तो वर्तमान Search information को प्राथमिकता दो।

13. "आज" भारत के समय Asia/Kolkata के अनुसार
${todayIndia} है।

अब उपयोगकर्ता के सवाल का सबसे उपयोगी उत्तर दो।
`.trim();


  // ----------------------------------------------------------
  // MESSAGES
  // ----------------------------------------------------------

  const messages = [

    {
      role: "system",

      content:
        systemPrompt,
    },


    ...history,


    {
      role: "user",

      content:
        message,
    },
  ];


  // ----------------------------------------------------------
  // GROQ PAYLOAD
  // ----------------------------------------------------------

  const payload = {

    model:
      CHAT_MODEL,

    messages,

    temperature:
      0.3,

    max_completion_tokens:
      webSearch
        ? 1600
        : 1400,

    top_p:
      1,

    stream:
      false,

    reasoning_effort:
      "low",
  };


  // ----------------------------------------------------------
  // INTERNET SEARCH
  // ----------------------------------------------------------

  if (webSearch) {

    payload.tools = [
      {
        type:
          "browser_search",
      },
    ];


    payload.tool_choice =
      "required";
  }


  // ----------------------------------------------------------
  // CALL GROQ
  // ----------------------------------------------------------

  const result =
    await callGroq(
      env,
      payload
    );


  if (!result.ok) {

    const errorMessage =
      friendlyGroqError(
        result.error
      );


    return json(
      {
        ok: false,

        error:
          result.error,

        answer:
          errorMessage,

        reply:
          errorMessage,

        selfChecked:
          false,

        selfCorrected:
          false,
      },
      result.status || 502
    );
  }


  let answer =
    result.answer;


  if (!answer) {

    answer =
      "अभी सही जवाब नहीं मिल पाया। कृपया फिर से कोशिश करें।";
  }


  // ----------------------------------------------------------
  // CURRENT DATE GUARD
  // ----------------------------------------------------------

  if (
    currentQuestion &&
    webSearch
  ) {

    answer =
      cleanCurrentAnswer(
        answer,
        todayIndia
      );
  }


  // ----------------------------------------------------------
  // RESPONSE
  // ----------------------------------------------------------

  return json({

    ok:
      true,

    answer,

    reply:
      answer,

    selfChecked:
      true,

    selfCorrected:
      true,

    searched:
      webSearch,

    currentQuestion,

    dateIndia:
      todayIndia,

    model:
      CHAT_MODEL,
  });
}


// ============================================================
// VISION HANDLER
// ============================================================

async function handleVision(
  request,
  env
) {

  const body =
    await request.json();


  const image =
    typeof body.image === "string"
      ? body.image
      : "";


  const question =
    typeof body.question === "string" &&
    body.question.trim()

      ? body.question.trim()

      : "इस फोटो में क्या दिखाई दे रहा है?";


  if (!image) {

    return json(
      {
        ok: false,

        error:
          "Image is required.",

        answer:
          "फोटो नहीं मिली।",
      },
      400
    );
  }


  // ----------------------------------------------------------
  // CURRENT INDIA DATE
  // ----------------------------------------------------------

  const todayIndia =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Kolkata",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    ).format(
      new Date()
    );


  // ----------------------------------------------------------
  // VISION MESSAGES
  // ----------------------------------------------------------

  const messages = [

    {
      role:
        "system",

      content: `
तुम "सारथी AI" हो।

उपयोगकर्ता द्वारा भेजी गई फोटो को ध्यान से देखकर
सरल हिंदी में उत्तर दो।

आज भारत की तारीख:
${todayIndia}

फोटो में जो स्पष्ट रूप से दिखाई देता है,
उसी के आधार पर जवाब दो।

जो दिखाई नहीं देता उसके बारे में अनुमान मत लगाओ।

अगर फोटो अस्पष्ट है तो साफ बताओ।

अगर फोटो में लिखा हुआ text दिखाई देता है,
तो उसे पढ़कर उपयोगकर्ता के सवाल के अनुसार बताओ।
      `.trim(),
    },


    {
      role:
        "user",

      content: [

        {
          type:
            "text",

          text:
            question,
        },


        {
          type:
            "image_url",

          image_url: {
            url:
              image,
          },
        },

      ],
    },

  ];


  // ----------------------------------------------------------
  // VISION PAYLOAD
  // ----------------------------------------------------------

  const payload = {

    model:
      VISION_MODEL,

    messages,

    temperature:
      0.2,

    max_completion_tokens:
      1200,

    top_p:
      1,

    stream:
      false,

    // Vision में reasoning_effort नहीं भेज रहे हैं
    // ताकि model compatibility की समस्या न हो
  };


  // ----------------------------------------------------------
  // CALL GROQ
  // ----------------------------------------------------------

  const result =
    await callGroq(
      env,
      payload
    );


  if (!result.ok) {

    return json(
      {
        ok: false,

        error:
          result.error,

        answer:
          friendlyGroqError(
            result.error
          ),
      },
      result.status || 502
    );
  }


  return json({

    ok:
      true,

    answer:
      result.answer ||
      "फोटो को समझने में अभी समस्या हुई।",

    model:
      VISION_MODEL,
  });
}


// ============================================================
// VOICE / SPEECH-TO-TEXT
// ============================================================

async function handleTranscribe(
  request,
  env
) {

  // ----------------------------------------------------------
  // API KEY CHECK
  // ----------------------------------------------------------

  if (!env.GROQ_API_KEY) {

    return json(
      {
        ok: false,

        error:
          "GROQ_API_KEY is not configured.",

        text:
          "",
      },
      500
    );
  }


  // ----------------------------------------------------------
  // CONTENT TYPE CHECK
  // ----------------------------------------------------------

  const contentType =
    request.headers.get(
      "content-type"
    ) || "";


  if (
    !contentType.includes(
      "multipart/form-data"
    )
  ) {

    return json(
      {
        ok: false,

        error:
          "Audio must be sent as multipart/form-data.",

        text:
          "",
      },
      400
    );
  }


  // ----------------------------------------------------------
  // FORM DATA
  // ----------------------------------------------------------

  const formData =
    await request.formData();


  const audio =
    formData.get(
      "file"
    );


  if (
    !audio ||
    typeof audio === "string"
  ) {

    return json(
      {
        ok: false,

        error:
          "Audio file is required.",

        text:
          "",
      },
      400
    );
  }


  // ----------------------------------------------------------
  // SIZE CHECK
  // ----------------------------------------------------------

  const MAX_AUDIO_SIZE =
    25 * 1024 * 1024;


  if (
    audio.size >
    MAX_AUDIO_SIZE
  ) {

    return json(
      {
        ok: false,

        error:
          "Audio file is too large.",

        text:
          "ऑडियो बहुत बड़ी है। कृपया छोटी recording करें।",
      },
      413
    );
  }


  // ----------------------------------------------------------
  // NEW FORM FOR GROQ
  // ----------------------------------------------------------

  const groqForm =
    new FormData();


  groqForm.append(
    "file",
    audio,
    audio.name ||
      "sarathi-voice.webm"
  );


  groqForm.append(
    "model",
    TRANSCRIBE_MODEL
  );


  // Hindi
  groqForm.append(
    "language",
    "hi"
  );


  groqForm.append(
    "response_format",
    "json"
  );


  groqForm.append(
    "temperature",
    "0"
  );


  groqForm.append(
    "prompt",
    "यह भारतीय हिंदी भाषा में बोला गया सवाल है। हिंदी में ही सही transcription करो।"
  );


  // ----------------------------------------------------------
  // CALL GROQ TRANSCRIPTION API
  // ----------------------------------------------------------

  try {

    const response =
      await fetch(
        GROQ_TRANSCRIBE_URL,
        {

          method:
            "POST",

          headers: {

            Authorization:
              `Bearer ${env.GROQ_API_KEY}`,
          },

          body:
            groqForm,
        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(text);

    } catch {

      data =
        null;
    }


    // --------------------------------------------------------
    // GROQ ERROR
    // --------------------------------------------------------

    if (!response.ok) {

      console.error(
        "Groq transcription error:",
        response.status,
        text
      );


      return json(
        {
          ok: false,

          error:
            data?.error?.message ||
            text ||
            `Groq HTTP ${response.status}`,

          text:
            "",
        },
        response.status
      );
    }


    // --------------------------------------------------------
    // TRANSCRIPT
    // --------------------------------------------------------

    const transcript =
      typeof data?.text === "string"
        ? data.text.trim()
        : "";


    if (!transcript) {

      return json(
        {
          ok: false,

          error:
            "Groq returned an empty transcription.",

          text:
            "",
        },
        502
      );
    }


    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return json({

      ok:
        true,

      text:
        transcript,

      transcript:
        transcript,

      model:
        TRANSCRIBE_MODEL,
    });


  } catch (error) {

    console.error(
      "Transcription fetch error:",
      error
    );


    return json(
      {
        ok: false,

        error:
          error?.message ||
          "Unable to connect to Groq transcription service.",

        text:
          "",
      },
      502
    );
  }
}


// ============================================================
// GROQ CHAT API CALL
// ============================================================

async function callGroq(
  env,
  payload
) {

  // ----------------------------------------------------------
  // API KEY CHECK
  // ----------------------------------------------------------

  if (!env.GROQ_API_KEY) {

    return {

      ok:
        false,

      status:
        500,

      error:
        "GROQ_API_KEY is not configured.",
    };
  }


  try {

    const response =
      await fetch(
        GROQ_URL,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${env.GROQ_API_KEY}`,
          },

          body:
            JSON.stringify(
              payload
            ),
        }
      );


    const text =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(text);

    } catch {

      data =
        null;
    }


    // --------------------------------------------------------
    // GROQ ERROR
    // --------------------------------------------------------

    if (!response.ok) {

      console.error(
        "Groq API error:",
        response.status,
        text
      );


      return {

        ok:
          false,

        status:
          response.status,

        error:
          data?.error?.message ||
          text ||
          `Groq HTTP ${response.status}`,
      };
    }


    // --------------------------------------------------------
    // GET ANSWER
    // --------------------------------------------------------

    const answer =
      data?.choices?.[0]?.message?.content;


    if (
      typeof answer !==
        "string" ||
      !answer.trim()
    ) {

      return {

        ok:
          false,

        status:
          502,

        error:
          "Groq returned an empty response.",
      };
    }


    return {

      ok:
        true,

      answer:
        answer.trim(),

      raw:
        data,
    };


  } catch (error) {

    console.error(
      "Groq fetch error:",
      error
    );


    return {

      ok:
        false,

      status:
        502,

      error:
        error?.message ||
        "Unable to connect to Groq.",
    };
  }
}


// ============================================================
// CURRENT QUESTION DETECTOR
// ============================================================

function isCurrentQuestion(
  text
) {

  const q =
    text.toLowerCase();


  const words = [

    "आज",
    "अभी",
    "वर्तमान",
    "लेटेस्ट",
    "नवीनतम",
    "ताजा",
    "ताज़ा",

    "current",
    "today",
    "latest",
    "now",
    "live",

    "price",
    "rate",

    "भाव",
    "कीमत",
    "रेट",

    "मौसम",
    "weather",

    "समाचार",
    "news",

    "ट्रेन",
    "train",

    "समय",
    "time",
  ];


  return words.some(
    (word) =>
      q.includes(word)
  );
}


// ============================================================
// CURRENT ANSWER CLEANER
// ============================================================

function cleanCurrentAnswer(
  answer,
  todayIndia
) {

  const parts =
    todayIndia.split("-");


  const year =
    parts[0];


  const month =
    parts[1];


  const day =
    parts[2];


  const currentDateText =
    `${day}-${month}-${year}`;


  if (
    answer.includes("आज") &&
    !answer.includes(year) &&
    !answer.includes(
      currentDateText
    )
  ) {

    return (
      answer +
      `\n\n📅 भारत की वर्तमान तारीख: ${day}-${month}-${year}`
    );
  }


  return answer;
}


// ============================================================
// FRIENDLY GROQ ERROR
// ============================================================

function friendlyGroqError(
  error
) {

  const text =
    String(
      error || ""
    );


  // ----------------------------------------------------------
  // DAILY TOKEN LIMIT
  // ----------------------------------------------------------

  if (
    text.includes(
      "tokens per day"
    ) ||
    text.includes(
      "TPD"
    ) ||
    text.includes(
      "rate limit"
    ) ||
    text.includes(
      "Rate limit"
    )
  ) {

    return (
      "अभी AI की token limit पूरी हो गई है। " +
      "थोड़ी देर बाद फिर से कोशिश करें।"
    );
  }


  // ----------------------------------------------------------
  // API KEY
  // ----------------------------------------------------------

  if (
    text.includes("401") ||
    text.includes(
      "invalid_api_key"
    ) ||
    text.includes(
      "Invalid API Key"
    ) ||
    text.includes(
      "authentication"
    )
  ) {

    return (
      "Groq API की authentication में समस्या है। " +
      "Cloudflare में GROQ_API_KEY secret जांचें।"
    );
  }


  // ----------------------------------------------------------
  // TOO MANY REQUESTS
  // ----------------------------------------------------------

  if (
    text.includes("429")
  ) {

    return (
      "अभी बहुत ज्यादा requests हो गई हैं। " +
      "थोड़ी देर बाद फिर से कोशिश करें।"
    );
  }


  // ----------------------------------------------------------
  // AUDIO TOO LARGE
  // ----------------------------------------------------------

  if (
    text.includes(
      "25MB"
    ) ||
    text.includes(
      "25 MB"
    ) ||
    text.includes(
      "file size"
    )
  ) {

    return (
      "ऑडियो बहुत बड़ी है। " +
      "कृपया छोटी voice recording करें।"
    );
  }


  // ----------------------------------------------------------
  // IMAGE ERROR
  // ----------------------------------------------------------

  if (
    text.includes(
      "image_url"
    ) ||
    text.includes(
      "image"
    )
  ) {

    return (
      "फोटो समझने में समस्या हुई। " +
      "कृपया छोटी या साफ फोटो से फिर कोशिश करें।"
    );
  }


  return (
    "अभी जवाब नहीं मिल पाया। " +
    "कृपया थोड़ी देर बाद फिर से कोशिश करें।"
  );
}


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data
    ),

    {
      status,

      headers: {

        ...corsHeaders(),

        "Content-Type":
          "application/json; charset=UTF-8",
      },
    }
  );
}


// ============================================================
// CORS
// ============================================================

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type",
  };
}
