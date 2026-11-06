import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Load the exact Worker source without changing its Cloudflare module format.
const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
assert.ok(appSource.includes('replyText.includes("खबर 1:")') && appSource.includes('replyText.includes("प्रकाशक:")') && appSource.includes('replyText.includes("प्रकाशित:")'), "inline Hindi news summaries must not render a duplicate source panel");
assert.match(source, /const claimsCause = .*test\(generatedText\)/, "news summaries must detect unsupported causal claims");
assert.match(source, /sourceExplicitlyStatesCause.*test\(sourceEvidence\)/, "causal claims must be backed by the same source");
const numericGuardStart = source.indexOf("function hasUnsupportedNumericClaim(");
const numericGuardEnd = source.indexOf("\nfunction hasMixedScriptToken", numericGuardStart);
assert.ok(numericGuardStart >= 0 && numericGuardEnd > numericGuardStart, "news numeric-claim validator must exist");
const hasUnsupportedNumericClaim = new Function(source.slice(numericGuardStart, numericGuardEnd) + "\nreturn hasUnsupportedNumericClaim;")();
assert.equal(hasUnsupportedNumericClaim("दोनों पक्षों ने अलग-अलग बयान दिए।", "दोनों पक्षों ने बयान दिए।"), false, "Hindi word 'दोनों' must not be mistaken for numeric two");
assert.equal(hasUnsupportedNumericClaim("दो पक्षों ने बयान दिए।", "पक्षों ने बयान दिए।"), true, "standalone unsupported Hindi number words must still be rejected");
assert.match(source, /स्रोत में न दिया कारण.*जिम्मेदार व्यक्ति/, "news prompt must forbid invented causes and responsibility");
assert.match(source, /Prefer headline evidence; snippets may mention unrelated topics incidentally/, "news categories must prioritize headline evidence over incidental snippet mentions");
assert.ok((source.match(/const category = classifyRequestedNewsCategory\(item\);/g) || []).length >= 2, "final news selection and fallback must reclassify the actual headline instead of trusting stale category metadata");
assert.match(source, /पाँच-श्रेणी समाचार जाँच पूरी नहीं हुई/, "five-category fallback must identify incomplete category coverage rather than claiming all summaries failed");
assert.match(source, /upsc\\s\*key|upsc-\[ \\]current-\[ \\]affairs|current affairs news/, "general news filtering must exclude UPSC exam-preparation explainers");
assert.match(source, /function groupNewsByEvent\(results\)/, "news processing must retain matching coverage from independent publishers");
assert.match(source, /function isSameIndianNewsEvent\(a, b\)/, "news grouping must recognize related Delhi cloud-seeding and Karnataka drought-relief headlines");
assert.match(source, /अतिरिक्त प्रकाशक रिपोर्ट/, "news digest must expose an additional publisher link when matching coverage exists");
assert.match(source, /केवल एक प्रकाशक की रिपोर्ट मिली; दूसरी रिपोर्ट से मिलान उपलब्ध नहीं है/, "news digest must disclose when no independent publisher corroboration is available");
assert.doesNotMatch(appSource, /detectAppLaunchCommand|getInstalledApps|openAppPackage|openPhone|SarathiNative\.openApp/, "web chat must not launch installed apps");
assert.ok(!appSource.includes("extractVideoFrames") && !appSource.includes("videoFile") && !appSource.includes("वीडियो") && !appSource.includes("video/mp4") && !appSource.includes("mp4|webm|mov"), "video upload and frame-analysis code must be absent");
assert.ok(appSource.includes('input.accept = ".pdf,.docx,.txt,.csv,.md,.json"'), "document picker must exclude video formats");
assert.ok(appSource.includes('file.type.startsWith("image/")'), "photo attachments must remain supported");
assert.match(appSource, /const asksForImageCreation\s*=/, "image creation/edit requests must be handled locally");
assert.match(appSource, /AI फोटो बनाना या एडिट करना अभी उपलब्ध नहीं है/, "disabled image generation/editing must be explained honestly");
assert.doesNotMatch(appSource, /requestSarathiImage|\/api\/media\/image|fileToImageDataUrl/, "photo data must never be uploaded to the disabled image-generation endpoint");
assert.ok(appSource.includes('if (!window.confirm("चुनी गई फाइलों से निकाला गया पाठ इंटरनेट के जरिए AI सेवा को भेजा जाएगा। क्या भेजना है?"))'), "attachment text must require explicit consent before sending");
assert.match(appSource, /const isBasicArithmetic\s*=/, "basic arithmetic must bypass unnecessary web search");
assert.ok(appSource.includes('Tesseract.createWorker("eng+hin")'), "photo OCR must support English and Hindi text");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.ok(!htmlSource.includes("वीडियो") && !htmlSource.includes("video/"), "attachment UI must not advertise video");
assert.ok(htmlSource.includes('accept="image/*,.pdf,.txt,.docx,.csv,.md,.json"'), "picker must accept photos and supported documents only");
const urlValidatorStart = source.indexOf("function validHttpUrl(value) {");
const urlValidatorEnd = source.indexOf("\n}\n", urlValidatorStart);
assert.ok(urlValidatorStart >= 0 && urlValidatorEnd > urlValidatorStart, "Worker HTTPS URL validator must exist");
const validHttpUrl = new Function("URL", source.slice(urlValidatorStart, urlValidatorEnd + 3) + "\nreturn validHttpUrl;")(URL);
assert.equal(validHttpUrl("https://example.com/source"), true, "HTTPS sources should be accepted");
assert.equal(validHttpUrl("https://example.com/article-xxxxxx"), false, "placeholder article IDs must be rejected");
assert.equal(validHttpUrl("https://example.com/placeholder/story"), false, "placeholder path segments must be rejected");
assert.equal(validHttpUrl("https://example.com/real-article-2026"), true, "real article URLs must remain accepted");
assert.equal(validHttpUrl("http://example.com/source"), false, "HTTP sources must be rejected");
assert.equal(validHttpUrl("file:///etc/passwd"), false, "local file URLs must be rejected");
assert.equal(validHttpUrl("not a URL"), false, "malformed URLs must be rejected");
assert.equal(validHttpUrl("https://localhost/secret"), false, "localhost sources must be rejected");
assert.equal(validHttpUrl("https://127.0.0.1/secret"), false, "IPv4 literal sources must be rejected");
assert.equal(validHttpUrl("https://192.168.1.1/secret"), false, "private network IP sources must be rejected");
assert.equal(validHttpUrl("https://[::1]/secret"), false, "IPv6 literal sources must be rejected");
assert.equal(validHttpUrl("https://metadata.google.internal/"), false, "internal metadata hostnames must be rejected");

assert.match(source.slice(source.indexOf("async function enrichGoldRateResults"), source.indexOf("function isHistoricalResearchQuery")), /redirect:\s*"manual"/, "third-party enrichment must not follow redirects");
assert.ok(source.includes(String.raw`visible.match(/On\s+`), "bullion lead summary regex must match whitespace rather than a literal backslash-s");
assert.ok(source.includes(String.raw`.replace(/\s+/g, " ").trim()`), "bullion lead summary whitespace must be normalized");
assert.match(source, /प्रकाशक का मुख्य दर-सारांश/, "bullion evidence must keep the publisher lead summary distinct");
assert.match(source, /शहरवार तालिका की हर पंक्ति को एक अविभाज्य इकाई/, "bullion answers must not mix city rows");
assert.match(source, /शहरवार तालिका की किसी भी पंक्ति से भाव बिल्कुल मत निकालो/, "India-wide bullion questions must not use city-only rates");
assert.match(source, /राष्ट्रीय भाव स्पष्ट रूप से उपलब्ध नहीं/, "missing national bullion rates must be reported as unavailable");
assert.match(source, /requestedCity\.re\.test\(row\)/, "city-specific bullion context must select only rows for the requested city");
assert.match(source, /माँगे गए शहर .*की मूल पेज\/तालिका पंक्तियाँ/, "requested city table rows must be passed into the model context");
assert.match(source, /matchingCityRows\.join\(" \\|\\| "\)/, "the selected city rows must actually be included in rate evidence");
assert.match(source, /function buildProviderBusySearchFallback/);
assert.match(source, /मूल HTML तालिका पंक्ति/);
assert.match(source, /AI सेवा ने सार नहीं बन सका|AI सेवा इस समय व्यस्त है/);
assert.match(source, /माँगे गए शहर/);
assert.match(source, /city\.key !== requestedCity\.key && city\.re\.test\(rawReply\)/, "city-specific bullion guard must scan the complete answer, including source notes, for foreign-city attribution");
assert.ok(source.includes("आम में विटामिन E प्रचुर होने") && source.includes("स्थापित पोषण-तथ्य"), "health answers must avoid unsupported nutrient and skin/hair claims");

const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { default: worker } = await import(moduleUrl);

const calls = [];
let groqMode = "success";
let groq413Count = 0;
let groq429Count = 0;
let exaMode = "success";
let groqReply = "यह सारथी का परीक्षण उत्तर है।";
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.includes("api.exa.ai/search")) {
    if (exaMode === "429") return Response.json({ error: "rate limited", tag: "RATE_LIMIT_EXCEEDED" }, { status: 429 });
    if (exaMode === "402") return Response.json({ error: "no credits", tag: "NO_MORE_CREDITS" }, { status: 402 });
    if (exaMode === "timeout") throw new DOMException("request timed out", "AbortError");
    if (exaMode === "network") throw new TypeError("network unavailable");
    const exaRequest = JSON.parse(init.body || "{}");
    if (exaMode === "news-undated" && exaRequest.category === "news") {
      return Response.json({ results: [
        { title: "Undated current news item", url: "https://www.bbc.com/news/undated", highlights: ["A current story without a publication timestamp."] }
      ] });
    }
    if (exaMode === "news-generic-live-page" && exaRequest.category === "news") {
      return Response.json({ results: [
        { title: "पढ़ें 4 नवम्बर के मुख्य और ताजा समाचार - लाइव ब्रेकिंग न्यूज - Latest And Breaking News Today In Hindi Live 4 November 2026", url: "https://www.amarujala.com/uttar-pradesh/mathura/sample-live-page", publishedDate: new Date(Date.now() - 30 * 60 * 1000).toISOString(), highlights: ["A generic daily live-news index page without a distinct reported story."] }
      ] });
    }
    if (exaMode === "news-single-source" && exaRequest.category === "news") {
      return Response.json({ results: [
        { title: "Mathura food safety inspection", url: "https://www.amarujala.com/uttar-pradesh/mathura/sample-live-page", publishedDate: new Date(Date.now() - 30 * 60 * 1000).toISOString(), highlights: ["A local report about an inspection in Mathura."] }
      ] });
    }
    if (exaRequest.query.includes("Bloody Sunday 1905")) {
      return Response.json({
        results: [
          { title: "Bloody Sunday: January 1905", url: "https://publish.iupress.indiana.edu/read/mutiny-amid-repression/section/7fb8bcb8-533a-4903-9bc8-aede21369fd7", highlights: ["Bloody Sunday on January 9, 1905, when soldiers shot workers marching to present a petition to the Tsar. About 1,000 workers were shot down."] },
          { title: "Mutiny amid Repression: January 1905", url: "https://publish.iupress.indiana.edu/read/mutiny-amid-repression/section/another-page", highlights: ["The January 9 massacre set off a revolutionary crisis."] },
          { title: "Bloody Sunday", url: "https://www.ebsco.com/research-starters/history/bloody-sunday", highlights: ["At least 130 demonstrators were killed and hundreds injured in St. Petersburg on January 22, 1905."] },
          { title: "Bloody Sunday in 1905", url: "https://www.worldhistory.org/Bloody_Sunday_in_1905/", highlights: ["The massacre took place in St. Petersburg on 22 January 1905 and helped trigger the 1905 Revolution."] },
          { title: "Bloody Sunday", url: "https://www.encyclopedia.com/history/modern-europe/british-and-irish-history/bloody-sunday", highlights: ["The official count eventually listed 130 killed."] },
          { title: "खूनी रविवार क्या है", url: "https://hindikul.com/khuni-ravivar", highlights: ["A short exam summary with no citations."] },
          { title: "Bloody Sunday", url: "https://en.wikipedia.org/wiki/Bloody_Sunday_(1905)", highlights: ["Historical overview."] }
        ]
      });
    }
    if (exaMode === "news-india-scope" && exaRequest.category === "news") {
      return Response.json({ results: [
        { title: "Ronaldo announces international retirement", url: "https://www.hindustantimes.com/sports/football/ronaldo-retirement", publishedDate: new Date(Date.now() - 30 * 60 * 1000).toISOString(), highlights: ["The Portuguese forward announced his international retirement; the story also mentions that he has fans in India."] },
        { title: "Supreme Court hears plea over Jantar Mantar protest", url: "https://www.thehindu.com/news/national/supreme-court-jantar-mantar", publishedDate: new Date(Date.now() - 20 * 60 * 1000).toISOString(), highlights: ["The Supreme Court of India is reviewing complaints about police conduct at Jantar Mantar in New Delhi."] }
      ] });
    }
    if (exaRequest.category === "news") {
      return Response.json({
        results: [
          { title: "IMD issues warning for Cyclone Murasu", url: "https://indianexpress.com/murasu", publishedDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(), highlights: ["IMD says Severe Cyclonic Storm Murasu is over the westcentral Bay of Bengal and is forecast to cross the south Andhra Pradesh coast late on 2 November."] },
          { title: "Cyclone Murasu update: IMD warning", url: "https://www.indianexpress.com/murasu-live", publishedDate: new Date(Date.now() - 45 * 60 * 1000).toISOString(), highlights: ["The same Indian Express newsroom repeats the cyclone warning in a live update."] },
          { title: "Supreme Court permits certified green crackers in Delhi-NCR", url: "https://thehindu.com/green-crackers", publishedDate: new Date(Date.now() - 20 * 60 * 1000).toISOString(), highlights: ["The Supreme Court allowed certified green crackers in Delhi-NCR during specified hours on 7 and 8 November."] },
          { title: "Undated report", url: "https://www.bbc.com/news/undated-report", highlights: ["This report has no publication date and must not be presented as current news."] },
          { title: "Delhi air quality update", url: "https://www.ndtv.com/india-news/delhi-air-quality", publishedDate: new Date(Date.now() - 30 * 60 * 1000).toISOString(), highlights: ["Delhi air quality remains a developing story."] },
          { title: "Old report outside freshness window", url: "https://www.bbc.com/news/old-report", publishedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), highlights: ["This report is five days old and must not be presented as a current news result."] },
          { title: "Report older than 48 hours", url: "https://www.reuters.com/world/older-than-48-hours", publishedDate: new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString(), highlights: ["This report is 60 hours old and must be filtered from current news."] },
          { title: "Future-dated report", url: "https://apnews.com/article/future-report", publishedDate: new Date(Date.now() + 60 * 1000).toISOString(), highlights: ["A future publication date must not be shown as current news."] },
          { title: "Sensex and Nifty rise in early trade as investors watch global cues", url: "https://timesofindia.indiatimes.com/business/markets/sensex-nifty-early-trade", publishedDate: new Date(Date.now() - 25 * 60 * 1000).toISOString(), highlights: ["Sensex and Nifty move higher in early trade."] },
          { title: "Stock Market Live: Sensex rises 288 points, Nifty up 77 in early trade", url: "https://www.hindustantimes.com/business/markets/late-candidate", publishedDate: new Date(Date.now() - 15 * 60 * 1000).toISOString(), highlights: ["Sensex and Nifty move higher in early trade."] }
        ]
      });
    }
    if (exaMode === "gold-undated-page-date") return Response.json({ results: [
      { title: "India silver rate today", url: "https://silver.example.net/silver-page-date", highlights: ["999 silver rate in India."] }
    ] });
    if (exaMode === "bullion-city-article-sections") return Response.json({ results: [
      { title: "Delhi gold and silver rates today", url: "https://mint.example.net/nov5-gold", publishedDate: new Date().toISOString(), highlights: ["Retail gold and silver rates in New Delhi."] }
    ] });
    if (exaMode === "bullion-city-busy") return Response.json({ results: [
      { title: "Delhi gold rates today", url: "https://example.com/delhi-gold", publishedDate: new Date().toISOString(), highlights: ["City-wise gold rates in Delhi."] },
      { title: "Delhi silver rates today", url: "https://silver.example.net/delhi-silver", publishedDate: new Date().toISOString(), highlights: ["999 silver rate in Delhi."] }
    ] });
    if (exaMode === "gold-stale") return Response.json({ results: [
      { title: "Gold rate today", url: "https://example.com/gold-old", publishedDate: "2025-08-26T18:30:00.000Z", highlights: ["Old gold rate ₹7000 per gram."] },
      { title: "Silver rate today", url: "https://example.com/silver-fresh", publishedDate: new Date().toISOString(), highlights: ["999 silver rate ₹95 per gram in India."] }
    ] });
    return Response.json({      results: [
        { title: "भारत में सोने का भाव", url: "https://example.com/gold-rate", publishedDate: new Date().toISOString(), highlights: ["24K gold rate ₹7800 per gram and 22K gold rate ₹7150 per gram in India."] },
        { title: "भारत में चांदी का भाव", url: groqMode === "413-always" ? "https://example.com/silver-rate" : "https://silver.example.net/silver-rate", publishedDate: new Date().toISOString(), highlights: ["Silver rate ₹95 per gram in India."] }
      ]
    });
  }
  if (url === "https://mint.example.net/nov5-gold") return new Response("<html><head><meta property='article:published_time' content='" + new Date().toISOString() + "'></head><body><h2>Gold Prices in New Delhi — 5 November</h2><p>24 karat gold rate in New Delhi — ₹145,510/10 gm</p><p>22 karat gold rate in New Delhi — ₹133,384/10 gm</p><p>Silver 999 Fine rate in New Delhi — ₹190,570/1 kg</p><h2>Gold Prices in Mumbai — 5 November</h2><p>24 karat gold rate in Mumbai — ₹145,600/10 gm</p><p>22 karat gold rate in Mumbai — ₹133,467/10 gm</p></body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  if (url === "https://mint.example.net/nov5-silver") return new Response("<html><head><meta property='article:published_time' content='" + new Date().toISOString() + "'></head><body><h2>Gold Prices in New Delhi — 5 November</h2><p>Silver 999 Fine rate in New Delhi — ₹190,570/1 kg</p><h2>Gold Prices in Mumbai — 5 November</h2><p>Silver 999 Fine rate in Mumbai — ₹190,730/1 kg</p></body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  if (url === "https://example.com/delhi-gold") return new Response('<html><head><meta property="article:published_time" content="' + new Date().toISOString() + '"></head><body><table>' + Array.from({ length: 45 }, (_, i) => '<tr><td>Other city ' + i + '</td><td>₹99,999 per 10 gm</td></tr>').join('') + '<tr><td>24 karat gold rate in Delhi</td><td>₹1,39,850 per 10 gm</td></tr><tr><td>22 karat gold rate in Delhi</td><td>₹1,27,683 per 10 gm</td></tr></table></body></html>', { status: 200, headers: { "Content-Type": "text/html" } });
  if (url === "https://silver.example.net/delhi-silver") return new Response('<html><head><meta property="article:published_time" content="' + new Date().toISOString() + '"></head><body><table><tr><td>Silver 999 Fine rate in Delhi</td><td>₹1,77,940 per 1 kg</td></tr></table></body></html>', { status: 200, headers: { "Content-Type": "text/html" } });
  if (url === "https://example.com/gold-rate") return new Response("<html><body>24K gold rate ₹7800 per gram and 22K gold rate ₹7150 per gram in India. <table><tr><td>24 karat gold rate in New Delhi</td><td>₹1,39,850 per 10 gm</td></tr><tr><td>22 karat gold rate in New Delhi</td><td>₹1,27,683 per 10 gm</td></tr></table></body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  if (url === "https://silver.example.net/silver-page-date") return new Response('<html><head><meta property="article:published_time" content="' + new Date().toISOString() + '"></head><body>999 silver rate in India. Silver 999 Fine rate in New Delhi ₹1,77,940 per 1 kg.</body></html>', { status: 200, headers: { "Content-Type": "text/html" } });
  if (url === "https://silver.example.net/silver-rate") return new Response("<html><body>999 silver rate ₹95 per gram in India. <table><tr><td>Silver 999 Fine rate in New Delhi</td><td>₹1,77,940 per 1 kg</td></tr></table></body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
  if (url.includes("api.groq.com")) {
    if (groqMode === "timeout") throw new DOMException("The operation was aborted.", "AbortError");
    if (groqMode === "empty") return Response.json({ choices: [{ message: { content: null }, finish_reason: "stop" }] });
    const requestBody = JSON.parse(init.body || "{}");
    if (groqMode === "news-partial-two-sentence") return Response.json({ choices: [{ message: { content: [
      "खबर 1: शेयर बाजार में शुरुआती तेजी",
      "सार: शुरुआती कारोबार में प्रमुख शेयर सूचकांकों में बढ़त दर्ज हुई। उपलब्ध अंश में कारोबार के इस रुझान का ही उल्लेख है।",
      "खबर 2: सुप्रीम कोर्ट का हरित पटाखों पर आदेश",
      "सार: अदालत ने दिल्ली-एनसीआर में प्रमाणित हरित पटाखों की अनुमति दी। यह अनुमति तय समय के दौरान लागू होगी।",
      "खबर 3: दिल्ली की वायु गुणवत्ता पर अपडेट",
      "सार: दिल्ली की वायु गुणवत्ता पर नई रिपोर्ट प्रकाशित हुई। उपलब्ध अंश में प्रदूषण के स्तर का विस्तृत आँकड़ा नहीं दिया गया है।",
      "खबर 4: चक्रवात मुरासु पर चेतावनी",
      "सार: मौसम विभाग ने चक्रवात मुरासु को लेकर चेतावनी जारी की।"
    ].join(String.fromCharCode(10)) } }] });
    if (groqMode === "news-two-sentence") return Response.json({ choices: [{ message: { content: [
      "खबर 1: शुरुआती कारोबार में शेयर बाजार में तेजी",
      "सार: शुरुआती कारोबार में सेंसेक्स और निफ्टी में बढ़त दर्ज हुई। लेख में कारोबार के इस रुझान का कोई और विवरण नहीं दिया गया है।",
      "खबर 2: सुप्रीम कोर्ट ने प्रमाणित हरित पटाखों की अनुमति दी",
      "सार: सुप्रीम कोर्ट ने दिल्ली-एनसीआर में प्रमाणित हरित पटाखों की अनुमति दी है। यह अनुमति 7 और 8 नवंबर को तय समय के दौरान लागू होगी।",
      "खबर 3: दिल्ली की वायु गुणवत्ता पर ताजा अपडेट",
      "सार: दिल्ली की वायु गुणवत्ता पर खबर को अभी विकसित होती स्थिति बताया गया है। उपलब्ध लेख-अंश में वायु गुणवत्ता के स्तर या बदलाव का विवरण नहीं दिया गया है।",
      "खबर 4: चक्रवात मुरासु को लेकर मौसम विभाग की चेतावनी",
      "सार: मौसम विभाग ने चक्रवात मुरासु की स्थिति बंगाल की खाड़ी के पश्चिम-मध्य हिस्से में बताई है। इसके दक्षिण आंध्र प्रदेश तट पार करने का पूर्वानुमान 2 नवंबर की देर रात के लिए दिया गया है।"
    ].join(String.fromCharCode(10)) } }] });
    if (groqMode === "malformed-news") return Response.json({ choices: [{ message: { content: "आज की खबरें जल्द पढ़ें।" } }] });
    if (groqMode === "malformed-news-secondary" && requestBody.model === "qwen/qwen3.8-27b") {
      return Response.json({ choices: [{ message: { content: [
        "खबर 1: ऊर्जा भंडारण योजना को मंजूरी",
        "सार: केंद्र सरकार ने बड़े स्तर पर ऊर्जा भंडारण विकसित करने की योजना को मंजूरी दी।",
        "खबर 2: महत्वपूर्ण खनिज प्रसंस्करण योजना",
        "सार: सरकार ने लिथियम और निकेल प्रसंस्करण संयंत्रों के लिए योजना को मंजूरी दी।",
        "खबर 3: अग्निवीर सेवा अवधि",
        "सार: अग्निवीरों की सेवा अवधि बढ़ाने की खबर प्रकाशित हुई।",
        "खबर 4: दिल्ली में वायु गुणवत्ता",
        "सार: दिवाली से पहले दिल्ली की वायु गुणवत्ता और खराब होने की खबर प्रकाशित हुई।"
      ].join("\\n") } }] });
    }
    if (groqMode === "malformed-news-secondary") return Response.json({ choices: [{ message: { content: "आज की खबरें जल्द पढ़ें।" } }] });
    if (groqMode === "news-plain-summary") return Response.json({ choices: [{ message: { content: "**खबर 1 – ऊर्जा भंडारण योजना को मंजूरी**\nसरकार ने बड़े स्तर पर ऊर्जा भंडारण विकसित करने के लिए योजना को मंजूरी दी।\n**खबर 2 – शेयर बाजार में तेजी**\nसेंसेक्स और निफ्टी में कारोबार के दौरान बढ़त दर्ज हुई।\n**खबर 3 – दिल्ली की हवा की गुणवत्ता**\nदिल्ली में वायु गुणवत्ता खराब होने की खबर प्रकाशित हुई।\n**खबर 4 – अग्निवीर सेवा अवधि**\nअग्निवीरों की सेवा अवधि बढ़ाने के फैसले की खबर प्रकाशित हुई।" } }] });
    if (groqMode === "news-unsupported-cause") return Response.json({ choices: [{ message: { content: "खबर 1: ऊर्जा भंडारण योजना को मंजूरी\nसार: सरकार ने ऊर्जा भंडारण योजना को मंजूरी दी।\nखबर 2: शेयर बाजार में तेजी\nसार: सेंसेक्स और निफ्टी में बढ़त दर्ज हुई।\nखबर 3: दिल्ली की हवा की गुणवत्ता\nसार: दिवाली के कारण दिल्ली की हवा खराब हुई।\nखबर 4: अग्निवीर सेवा अवधि\nसार: अग्निवीरों की सेवा अवधि बढ़ाने की खबर प्रकाशित हुई।" } }] });

    if (groqMode === "general-429-fallback-success" && requestBody.model === "openai/gpt-oss-20b") {
      return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    }
    if (groqMode === "general-429-fallback-success" && requestBody.model === "qwen/qwen3.8-27b") {
      return Response.json({ choices: [{ message: { content: "जड़त्व का अर्थ है किसी वस्तु का अपनी वर्तमान अवस्था बनाए रखना। उदाहरण के लिए, मेज पर रखी किताब अपने-आप नहीं चलती।" } }] });
    }
    if (groqMode === "primary-429-fallback-success" && requestBody.model === "openai/gpt-oss-20b") {
      return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    }
    if (groqMode === "primary-429-fallback-success" && requestBody.model === "qwen/qwen3.8-27b") {
      return Response.json({ choices: [{ message: { content: ["खबर 1: ऊर्जा भंडारण योजना को मंजूरी","सार: केंद्र सरकार ने बड़े स्तर पर ऊर्जा भंडारण विकसित करने की योजना को मंजूरी दी।","खबर 2: महत्वपूर्ण खनिज प्रसंस्करण योजना","सार: सरकार ने लिथियम और निकेल प्रसंस्करण संयंत्रों के लिए योजना को मंजूरी दी।","खबर 3: अग्निवीर सेवा अवधि","सार: अग्निवीरों की सेवा अवधि बढ़ाने की खबर प्रकाशित हुई।","खबर 4: दिल्ली में वायु गुणवत्ता","सार: दिवाली से पहले दिल्ली की वायु गुणवत्ता और खराब होने की खबर प्रकाशित हुई."].join("\n") } }] });
    }
    if (groqMode === "429") return Response.json({ error: { message: "rate limited" } }, { status: 429 });
    if (groqMode === "429-once" && groq429Count++ === 0) return Response.json({ error: { message: "token rate limited" } }, { status: 429 });
    if (groqMode === "429-once") groqMode = "news-plain-summary";
    if (groqMode === "500") return Response.json({ error: { message: "provider down" } }, { status: 500 });
    if (groqMode === "413-always") return Response.json({ error: { message: "payload too large" } }, { status: 413 });
    if (groqMode === "413-once" && groq413Count++ === 0) return Response.json({ error: { message: "payload too large" } }, { status: 413 });
    const body = requestBody;
    const last = body.messages?.at(-1)?.content || "";
    groqReply = last.includes("स्रोत 1:") && last.includes("शीर्षक:")
      ? "खबर 1: दिल्ली की वायु गुणवत्ता पर अपडेट\nसार: दिल्ली की वायु गुणवत्ता पर नई रिपोर्ट प्रकाशित हुई है। उपलब्ध अंश इसे विकसित होती स्थिति बताता है।\nखबर 2: हरित पटाखों पर सुप्रीम कोर्ट का फैसला\nसार: अदालत ने दिल्ली-एनसीआर में प्रमाणित हरित पटाखों की अनुमति दी है। यह अनुमति तय समय के दौरान लागू होगी।\nखबर 3: शेयर बाजार में शुरुआती तेजी\nसार: शुरुआती कारोबार में सेंसेक्स और निफ्टी में बढ़त दर्ज हुई। लेख में इसी बाजार गतिविधि का उल्लेख है।\nखबर 4: चक्रवात मुरासु को लेकर चेतावनी\nसार: मौसम विभाग ने चक्रवात मुरासु को लेकर चेतावनी दी है। उपलब्ध अंश के अनुसार इसके दक्षिण आंध्र प्रदेश तट पार करने का पूर्वानुमान है।"
      : last.includes("इतिहास") ? "1857 का विद्रोह ब्रिटिश शासन के विरुद्ध एक बड़ा विद्रोह था।" :
      last.includes("सोने") || last.includes("चांदी") ? "परीक्षण के लिए खोज परिणाम मिले। आज का भाव स्रोत और शुद्धता के अनुसार बदलता है।" :
      "यह सारथी का परीक्षण उत्तर है।";
    return Response.json({ choices: [{ message: { content: groqReply } }] });
  }
  if (url.startsWith("https://") && !url.includes("api.groq.com") && !url.includes("api.exa.ai")) {
    return new Response("<html><article><p>Deterministic test article body. No additional numeric facts are supplied by this fixture.</p></article></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=UTF-8" }
    });
  }
  throw new Error("Unexpected outbound request: " + url);
};

const env = { SARATHI_LOGIN_PASSWORD: "self-test-password", GROQ_API_KEY: "mock-groq-key", EXA_API_KEY: "mock-exa-key" };
async function request(path, method = "GET", body, token) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await worker.fetch(new Request("https://sarathi.test" + path, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data, headers: response.headers };
}
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}

await test("health endpoint", async () => {
  const r = await request("/");
  assert.equal(r.status, 200);
  assert.equal(r.data.status, "running");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://mjmanjumanjeet0-svg.github.io");
  assert.notEqual(r.headers.get("Access-Control-Allow-Origin"), "*");
});
await test("rejects wrong login password", async () => {
  const r = await request("/api/login", "POST", { password: "wrong" });
  assert.equal(r.status, 401);
});
let token = "";
await test("login issues a session token", async () => {
  const r = await request("/api/login", "POST", { password: env.SARATHI_LOGIN_PASSWORD });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  token = r.data.token;
});
await test("chat rejects requests without a bearer token", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] });
  assert.equal(r.status, 401);
});
await test("chat rejects a malformed or forged bearer token", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] }, "forged.token");
  assert.equal(r.status, 401);
});
await test("Hindi greeting is answered locally without provider calls", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सारथी" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /नमस्ते/);
  assert.equal(calls.length, before);
});

await test("Sarathi identity question is answered locally without web search even when toggle is on", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: true,
    messages: [{ role: "user", content: "नमस्ते सारथी, तुम कौन हो?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /मैं सारथी AI हूँ/);
  assert.equal(r.data.webSearch, false);
  assert.equal(calls.length, before, "identity questions must not consume Exa or Groq requests");
});
await test("voice capability question explains the actual microphone workflow locally", async () => {
  const before = calls.length;
  const result = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "क्या तुम मेरी आवाज सुनकर जवाब दे सकते हो?" }],
    webSearch: true
  }, token);
  assert.equal(result.status, 200);
  assert.match(result.data.reply, /माइक्रोफ़ोन बटन दबाकर अनुमति दें/);
  assert.match(result.data.reply, /आवाज़ को टेक्स्ट में बदलकर सवाल भेजता है/);
  assert.equal(result.data.webSearch, false);
  assert.deepEqual(result.data.sources, []);
  assert.equal(calls.length, before, "voice capability question must not call Exa or Groq");
});

await test("हेलो सर्दी is not treated as a Sarathi greeting alias", async () => {  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "हेलो सर्दी" }] }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")),
    "the removed wake-word alias must not receive the local greeting response");
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
    "removing the wake-word alias must not itself trigger a web search");
});
await test("India capital is answered locally without Groq quota", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत की राजधानी कहाँ है?" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /नई दिल्ली/);
  assert.equal(calls.length, before);
});
const arithmeticStart = source.indexOf("function solveBasicArithmetic(text) {");
const arithmeticEnd = source.indexOf("\nfunction isDateQuestion", arithmeticStart);
assert.ok(arithmeticStart >= 0 && arithmeticEnd > arithmeticStart, "local arithmetic solver must exist");
const solveBasicArithmetic = new Function(source.slice(arithmeticStart, arithmeticEnd) + "\nreturn solveBasicArithmetic;")();
assert.deepEqual(solveBasicArithmetic("125 × 24 कितना होता है?"), { expression: "125*24", result: "3000" });
assert.deepEqual(solveBasicArithmetic("18 + 7 × 2"), { expression: "18+7*2", result: "32" });
assert.deepEqual(solveBasicArithmetic("100 / 4"), { expression: "100/4", result: "25" });
assert.equal(solveBasicArithmetic("10 / 0"), null, "division by zero must not return a numeric answer");
assert.equal(solveBasicArithmetic("इतिहास 1857"), null, "a standalone year must not be treated as arithmetic");
const dateQuestionStart = source.indexOf("function isDateQuestion(text) {");
const dateQuestionEnd = source.indexOf("function explicitlyRequestsWebSearch", dateQuestionStart);
assert.ok(dateQuestionStart >= 0 && dateQuestionEnd > dateQuestionStart, "date intent detector must exist");
const isDateQuestion = new Function(source.slice(dateQuestionStart, dateQuestionEnd) + "\nreturn isDateQuestion;")();
assert.equal(isDateQuestion("आज की तारीख बताओ"), true, "a direct date request must still be recognized");
assert.equal(isDateQuestion("आज कौन-सा दिन है?"), true, "a direct weekday request must still be recognized");
assert.equal(isDateQuestion("आज का दिन अच्छा बनाने के लिए मुझे तीन अच्छी आदतें बताओ"), false, "a positive daily-routine question must not be mistaken for a date request");


const discountStart = source.indexOf("function solveDiscountQuestion(text) {");
const discountEnd = source.indexOf("\nfunction solveBasicArithmetic", discountStart);
assert.ok(discountStart >= 0 && discountEnd > discountStart, "local discount solver must exist");
const solveDiscountQuestion = new Function(source.slice(discountStart, discountEnd) + "\nreturn solveDiscountQuestion;")();
assert.match(solveDiscountQuestion("800 रुपये पर 15% छूट कितनी होगी और अंतिम कीमत क्या होगी?"), /छूट: 15% = ₹120/);
assert.match(solveDiscountQuestion("₹1,250 पर 10% की छूट"), /अंतिम कीमत: ₹1125/);
assert.match(solveDiscountQuestion("एक वस्तु की कीमत ₹1,200 है। उस पर 25% छूट मिलती है।"), /अंतिम कीमत: ₹900/);
assert.match(solveDiscountQuestion("₹2,000 की वस्तु पर 10% छूट है। छूट के बाद कीमत कितनी होगी?"), /अंतिम कीमत: ₹1800/);
assert.match(solveDiscountQuestion("एक वस्तु की कीमत 2000 रुपये है और उस पर 10% की छूट है"), /अंतिम कीमत: ₹1800/);
assert.equal(solveDiscountQuestion("100 रुपये पर 150% छूट"), null, "discount above 100 percent must be rejected");
assert.equal(solveDiscountQuestion("800 रुपये की कीमत"), null, "unrelated price questions must not be treated as discount calculations");
await test("discount calculation is answered locally without Exa or Groq", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "800 रुपये पर 15% छूट कितनी होगी और अंतिम कीमत क्या होगी?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /छूट: 15% = ₹120/);
  assert.match(r.data.reply, /अंतिम कीमत: ₹680/);
  assert.equal(r.data.webSearch, false);
  assert.deepEqual(r.data.sources, []);
  assert.equal(calls.length, before, "discount calculation must not call search or AI providers");
});

await test("natural-language discount calculation is answered locally without search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "₹2,000 की वस्तु पर 10% छूट है। छूट के बाद कीमत कितनी होगी? केवल इसी सवाल का उत्तर देना।" }]
  }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /मूल कीमत: ₹2000/);
  assert.match(r.data.reply, /छूट: 10% = ₹200/);
  assert.match(r.data.reply, /अंतिम कीमत: ₹1800/);
  assert.equal(r.data.webSearch, false);
  assert.deepEqual(r.data.sources, []);
  assert.equal(calls.length, before, "discount calculations must not call Exa or Groq");
});


await test("general knowledge reaches the AI provider", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "इतिहास क्या है?" }] }, token);
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /परीक्षण उत्तर|1857/);
  assert.ok(calls.some(x => x.url.includes("api.groq.com")));
});

await test("ordinary fruit-benefit question never searches even when an old web toggle flag is sent", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: true,
    internet: true,
    messages: [{ role: "user", content: "मुझे आम के दो फायदे बताओ।" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.webSearch, false);
  assert.deepEqual(r.data.sources, []);
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai")), false,
    "ordinary learning questions must not call Exa, even if stale client flags are true");
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")),
    "the ordinary question should still receive an AI answer");
});

await test("stable constitution date question does not trigger automatic historical web search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: true,
    messages: [{ role: "user", content: "भारत का संविधान किस तारीख को अपनाया गया था और कब लागू हुआ?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.webSearch, false);
  assert.deepEqual(r.data.sources, []);
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai")), false,
    "stable historical facts should not automatically call Exa");
});
await test("Android app-launch capability is distinguished from website limitations", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "क्या तुम Android में इंस्टॉल ऐप खोल सकते हो?" }]
  }, token);
  assert.equal(r.status, 200);
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "request should reach the assistant provider");
  const body = JSON.parse(groqCall.init.body || "{}");
  const system = body.messages?.find(message => message.role === "system")?.content || "";
  assert.match(system, /Android सारथी ऐप/);
  assert.match(system, /केवल वेबसाइट\/ब्राउज़र/);
  assert.match(system, /खुलना सत्यापित नहीं हुआ/);
});
await test("constitution and science accuracy rules are included in the assistant system prompt", async () => {
  for (const question of [
    "भारत का संविधान कब लागू हुआ? विस्तार से समझाओ।",
    "प्रकाश संश्लेषण और श्वसन में पाँच अंतर बताओ।"  ]) {
    const before = calls.length;
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: question }]
    }, token);
    assert.equal(r.status, 200);
    const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
    assert.ok(groqCall, "question should reach the configured assistant provider");
    const body = JSON.parse(groqCall.init.body || "{}");
    const system = body.messages?.find(message => message.role === "system")?.content || "";
    assert.match(system, /9 दिसंबर 1946/);
    assert.match(system, /26 नवंबर 1949/);
    assert.match(system, /26 जनवरी 1950/);
    assert.match(system, /26 जनवरी 1930/);
    assert.match(system, /8 अगस्त 1942/);
    assert.match(system, /395 वोटों से/);
    assert.match(system, /4 नवंबर 1948/);
    assert.match(system, /26 जनवरी 1930/);
    assert.match(system, /भारत छोड़ो आंदोलन 8 अगस्त 1942/);
    assert.match(system, /उसमें 7 सदस्य थे/);
    assert.match(system, /मौलिक कर्तव्य 11 हैं/);
    assert.match(system, /ठीक माँगी गई संख्या में/);
    assert.match(system, /परिपक्व स्तनधारी लाल रक्त कोशिकाओं/);
  }
});
await test("ordinary mango-benefit and expected-result prompts never trigger education web search", async () => {
  for (const question of [
    "मुझे आम के दो फायदे बताओ।",
    "अपेक्षित परिणाम: सीधे दो फायदे बताए, कोई इंटरनेट खोज या स्रोत सूची न दिखाए।"
  ]) {
    const before = calls.length;
    const r = await request("/api/chat", "POST", {
      webSearch: true,
      internet: true,
      messages: [{ role: "user", content: question }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.searchAttempted, false, question);
    assert.equal(r.data.webSearch, false, question);
    assert.deepEqual(r.data.sources, [], question);
    assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
      "ordinary fruit and expected-result wording must not invoke web search");
    assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")),
      "ordinary questions should still reach the AI provider");
  }
});
await test("explicit board examination result questions still trigger official search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "बिहार बोर्ड परीक्षा परिणाम 2026 कब जारी होगा?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")));
});
await test("stable general-knowledge questions do not trigger unnecessary web search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "गौतम बुद्ध कौन थे?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
    "stable biography/general knowledge should not spend search requests");
});
await test("regulated career pathways trigger current education search and strict official-source rules", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "भारत में डॉक्टर बनने के लिए वर्तमान योग्यता और सही प्रवेश परीक्षा क्या है?" }]
  }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "regulated career pathways must trigger current web verification");
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.numResults, 8, "education searches should compare a wider source pool");
  assert.ok(exaBody.includeDomains.includes("*.gov.in"));
  assert.ok(exaBody.includeDomains.includes("*.ac.in"));
  assert.ok(exaBody.includeDomains.includes("nmc.org.in"));
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "the searched education question should reach the assistant");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const system = groqBody.messages?.find(message => message.role === "system")?.content || "";
  assert.match(system, /शिक्षा और करियर में उच्च-सटीकता नियम/);
  assert.match(system, /आधिकारिक पुष्टि नहीं मिली/);
  assert.match(system, /NEET-UG/);
  assert.match(system, /Doctorate of Medicine \(DM\)/);
  assert.match(system, /Magister Chirurgiae \(MCh\)/);
  assert.match(system, /सभी कोर्स में 60% या Maths अनिवार्य मत कहो/);
});

await test("scholarship deadlines and eligibility trigger official education-source search", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "बिहार छात्रवृत्ति 2026 की आवेदन अंतिम तिथि और पात्रता क्या है?" }]
  }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "current scholarship rules must trigger official-source search");  const body = JSON.parse(exaCall.init.body || "{}");
  assert.equal(body.numResults, 8);
  assert.ok(body.includeDomains.includes("*.gov.in"), "scholarship search must be scoped to official government sources");
  assert.ok(body.query.includes("official website"), "scholarship search query should request official sources");
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
});

await test("Indian course catalog questions trigger official-source search even with web toggle off", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "भारत में ITI के कौन-कौन से कोर्स उपलब्ध हैं?" }]
  }, token);
  assert.equal(r.status, 200);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "Indian course catalog questions must trigger current verification");
  const body = JSON.parse(exaCall.init.body || "{}");
  assert.equal(body.numResults, 8);
  assert.ok(body.includeDomains.includes("*.gov.in"));
  assert.ok(body.includeDomains.includes("ncvet.gov.in"));
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
});

await test("medical super-specialty degree abbreviations use verified local definitions", async () => {
  for (const [question, expected] of [
    ["MCh का मतलब क्या है?", "Magister Chirurgiae"],
    ["DM का मतलब क्या है?", "Doctorate of Medicine"]
  ]) {
    const before = calls.length;
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: question }]
    }, token);
    assert.equal(r.status, 200);
    assert.match(r.data.reply, new RegExp(expected));
    assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false);
    assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), false,
      "verified degree names should not depend on an uncertain generated answer");
  }
});

await test("explicit Hindi command इंटरनेट खोजो triggers Exa even when webSearch toggle is off", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "इंटरनेट खोजो भारत की नई शिक्षा नीति के बारे में" }]
  }, token);
  assert.equal(r.status, 200);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")),
    "explicit Hindi search command must invoke Exa");
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.type, "auto");
  assert.deepEqual(exaBody.contents, { highlights: true });
});

await test("Bloody Sunday uses a deterministic date-safe answer and deduplicates historical publishers", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    webSearch: false,
    messages: [{ role: "user", content: "खूनी रविवार 1905 के बारे में बताओ और भरोसेमंद ऐतिहासिक स्रोत दो।" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchAttempted, true);
  assert.equal(r.data.webSearch, true);
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "historical question should automatically invoke Exa without the web toggle");
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.numResults, 15);
  assert.match(exaBody.query, /Bloody Sunday 1905 St Petersburg/);
  assert.ok(exaBody.includeDomains.includes("history.state.gov"));
  assert.ok(exaBody.includeDomains.includes("iupress.indiana.edu"));
  assert.ok(r.data.sources.length >= 3);
  assert.equal(r.data.sources.some(x => x.url.includes("hindikul.com")), false);
  assert.equal(r.data.sources.some(x => x.url.includes("wikipedia.org")), false);
  const publisherHosts = r.data.sources.map(x => new URL(x.url).hostname);
  assert.equal(new Set(publisherHosts).size, publisherHosts.length,
    "only one result per hostname should be displayed");
  const publishers = r.data.sources.map(x => x.publisher);
  assert.equal(new Set(publishers).size, publishers.length,
    "one source per normalized publisher should be displayed");
  assert.ok(r.data.sources.length >= 3, "at least three independent publishers are required");
  assert.match(r.data.reply, /मृतकों की संख्या पर स्रोतों में बड़ा अंतर|मृतकों की सटीक संख्या/);
  assert.match(r.data.reply, /अलग-अलग प्रकाशकों के स्रोत/);
  assert.doesNotMatch(r.data.reply, /https?:\/\//,
    "source links must be rendered once in the dedicated clickable source list");
  assert.match(r.data.reply, /22 जनवरी 1905 ग्रेगोरियन/);
  assert.match(r.data.reply, /9 जनवरी 1905/);
  assert.match(r.data.reply, /शांतिपूर्ण जुलूस/);
  assert.match(r.data.reply, /दंगा कहना गलत है/);
  assert.doesNotMatch(r.data.reply, /10 मई 1905|May 10, 1905/i);
  assert.match(r.data.reply, /कम-से-कम 130/);
  assert.match(r.data.reply, /लगभग 1,000/);
  assert.match(r.data.reply, /संख्या पर स्रोतों में बड़ा अंतर/);
  assert.ok(r.data.sources.some(x => x.url.startsWith("https://publish.iupress.indiana.edu/")));
  assert.ok(r.data.sources.some(x => x.url.startsWith("https://www.ebsco.com/")));
  assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), false,
    "Bloody Sunday answer should use the deterministic source-grounded response");
});
await test("current news with one publisher is not summarized as independently verified", async () => {
  const before = calls.length;  exaMode = "news-single-source";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की ताज़ा खबरें भरोसेमंद स्रोतों के साथ बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.searchAttempted, true);
    assert.equal(r.data.sources.length, 1);
    assert.match(r.data.reply, /केवल एक स्वतंत्र समाचार स्रोत मिला/);
    assert.match(r.data.searchWarning, /केवल एक स्वतंत्र प्रकाशक/);
    assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), false,
      "one publisher must not be passed to the language model for a news digest");
  } finally {
    exaMode = "success";
  }
});

await test("generic daily live-news index pages are not treated as reported news articles", async () => {
  exaMode = "news-generic-live-page";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की ताज़ा खबरें भरोसेमंद स्रोतों के साथ बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.searchAttempted, true);
    assert.equal(r.data.sources.length, 0, "generic live-feed index must not be presented as a report");
    assert.match(r.data.reply, /भरोसेमंद समाचार परिणाम नहीं मिले|पर्याप्त भरोसेमंद सामग्री नहीं मिली|अपुष्ट/);
    assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), false,
      "a generic live-feed page must not be summarized by the language model");
  } finally {
    exaMode = "success";
  }
});

await test("news digest shows only summaries that pass source validation", async () => {
  const before = calls.length;
  groqMode = "news-partial-two-sentence";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ। हर खबर का हिंदी में 2–3 वाक्यों में सार बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.match(r.data.reply, /अलग-अलग, तारीख़-जाँची खबरें मिलीं \(आपने 5 माँगी थीं\)/);
    const headlines = r.data.reply.split("\n").filter(line => /^खबर [1-5]: /.test(line));
    assert.ok(headlines.length > 0 && headlines.length < 5, "show only the individually validated summaries and disclose the shortfall");
    assert.doesNotMatch(r.data.reply, /आज की 5 अलग-अलग, तारीख़-जाँची खबरें:/);
    assert.match(r.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/);
    assert.ok(r.data.reply.includes("मूल लिंक: https://"), "news digest must include a plain article URL");
    assert.match(r.data.reply, /पुष्टि का आधार:/);
    assert.match(r.data.reply, /अतिरिक्त प्रकाशक रिपोर्ट:.*timesofindia\.indiatimes\.com/s, "matching Sensex coverage from another publisher must be linked as corroboration");
    assert.equal(r.data.sources.length, 4, "the API retains the four original source records for transparency");
    assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")));
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("natural India news wording excludes foreign stories with incidental India mentions", async () => {
  const before = calls.length;
  exaMode = "news-india-scope";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज भारत की 5 ताज़ा और महत्वपूर्ण खबरें बताओ। हर खबर का स्रोत और तारीख भी बताना।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.sources.length, 1, "only the India-focused article should survive");
    assert.match(r.data.sources[0].title, /Supreme Court hears plea over Jantar Mantar protest/);
    assert.doesNotMatch(r.data.sources[0].title, /Ronaldo/i,
      "an international story mentioning Indian fans is not an India news story");
    assert.match(r.data.reply, /केवल एक स्वतंत्र समाचार स्रोत मिला/);
    assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), false,
      "a single surviving source must not be expanded into a confident digest");
  } finally {
    exaMode = "success";
  }
});

await test("latest news query uses Exa news category and publication freshness filter", async () => {
  const before = calls.length;
  const newsResponse = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज 4 नवंबर 2026 की भारत की 5 ताज़ा और अलग-अलग प्रमुख खबरें बताओ। हर खबर का प्रकाशक और प्रकाशन समय दिखाओ।" }]
  }, token);
  assert.equal(newsResponse.status, 200);
  const newsHosts = newsResponse.data.sources.map(x => new URL(x.url).hostname.toLowerCase().replace(/^www\./, ""));
  assert.equal(newsHosts.length, 4, "late current news candidates must survive pre-filter truncation");
  assert.match(newsResponse.data.reply, /आज 2 अलग-अलग, तारीख़-जाँची खबरें मिलीं/,
    "when four distinct same-day articles survive, the reply should show individually verified summaries and disclose the shortfall");
  assert.equal(new Set(newsHosts).size, newsHosts.length, "duplicate publisher hostnames must be removed");
  const publishedTimes = newsResponse.data.sources.map(x => Date.parse(x.publishedAt));
  assert.ok(publishedTimes.every(Number.isFinite), "every displayed news source must have a valid publication timestamp");
  assert.deepEqual(publishedTimes, [...publishedTimes].sort((a, b) => b - a),
    "same-day sources should be displayed newest first, not in Exa relevance order");
  assert.ok(newsHosts.includes("indianexpress.com"));
  assert.ok(newsHosts.includes("thehindu.com"));
  assert.ok(newsHosts.includes("ndtv.com"));
  assert.ok(newsHosts.includes("hindustantimes.com"), "a valid current article after the first eight candidates must be retained");
  assert.equal(calls.slice(before).some(x => x.url.includes("api.groq.com")), true,
    "current-news requests may still attempt a Hindi summary from the retrieved source excerpts");
  const displayedHeadlines = newsResponse.data.reply.split("\n")
    .filter(line => /^खबर [1-5]: /.test(line)).length;
  assert.ok(displayedHeadlines > 0 && displayedHeadlines <= 4,
    "only individually validated stories should be shown for a four-source result");
  assert.equal((newsResponse.data.reply.match(/प्रकाशक:/g) || []).length, displayedHeadlines,
    "each displayed summary must have matching publisher metadata");
  assert.equal((newsResponse.data.reply.match(/प्रकाशित:/g) || []).length, displayedHeadlines,
    "each displayed summary must have matching publication time");
  assert.match(newsResponse.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/,
    "a partial digest must clearly disclose why fewer than five stories are shown");
  assert.equal(newsHosts.includes("timesofindia.indiatimes.com"), false,
    "near-identical Sensex/Nifty opening stories must be collapsed to one event");
  assert.equal(newsResponse.data.sources.filter(x => /sensex/i.test(x.title) && /nifty/i.test(x.title)).length, 1,
    "the same market opening event must appear only once");

  assert.equal(newsHosts.includes("bbc.com"), false, "five-day-old news must be filtered out");
  assert.equal(newsHosts.includes("reuters.com"), false, "news older than 48 hours must be filtered out");
  assert.equal(newsHosts.includes("apnews.com"), false, "even slightly future-dated news must be filtered out");
  assert.equal(newsHosts.includes("bbc.com"), false, "undated news must not be presented as current");
  const exaCall = calls.slice(before).find(x => x.url.includes("api.exa.ai/search"));
  assert.ok(exaCall, "latest news must invoke Exa");
  const exaBody = JSON.parse(exaCall.init.body || "{}");
  assert.equal(exaBody.type, "auto");
  assert.equal(exaBody.category, "news");
  assert.equal(exaBody.userLocation, "IN", "news search should localize ranking to India");
  assert.match(exaBody.query, /Latest national news from India/i, "news search should use a clear India-focused editorial query");
  assert.equal(exaBody.query.includes("when:2d"), false, "the hard publication-date filters, not a search-operator suffix, should enforce freshness");
  assert.equal(exaBody.numResults, 40, "news search should request a wider candidate pool for strict publisher/date filters");
  assert.deepEqual(exaBody.includeDomains, [
    "indianexpress.com", "thehindu.com", "ndtv.com", "hindustantimes.com",
    "bbc.com", "reuters.com", "apnews.com", "news18.com", "aajtak.in",
    "abplive.com", "amarujala.com", "jagran.com", "zeenews.india.com",
    "indiatoday.in", "theprint.in", "livemint.com", "indiatimes.com",
    "pti.in", "aninews.in", "business-standard.com", "economictimes.indiatimes.com",
    "financialexpress.com", "moneycontrol.com", "cnbctv18.com", "deccanherald.com",
    "tribuneindia.com", "telegraphindia.com", "pib.gov.in", "ddnews.gov.in",
    "newsonair.gov.in", "scroll.in", "theweek.in", "thequint.com"
  ], "news search should be scoped to supported trusted publishers");
  assert.ok(exaBody.startPublishedDate, "news search must constrain the 48-hour publication window");
  assert.ok(exaBody.endPublishedDate, "news search must exclude future publication dates at the provider");
  assert.deepEqual(exaBody.contents, { highlights: true });
  const shortfallHeadlines = newsResponse.data.reply.split("\n").filter(line => /^खबर [1-5]: /.test(line));
  assert.ok(shortfallHeadlines.length > 0 && shortfallHeadlines.length < 5,
    "the shortfall response should include only individually verified summaries");
  assert.match(newsResponse.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/);
  assert.equal(newsResponse.data.searchUnavailable, undefined);
});

await test("five-news prompt displays only individually validated summaries with a shortfall notice", async () => {
  groqMode = "news-two-sentence";
  exaMode = "success";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ। हर खबर का हिंदी में 2–3 वाक्यों में सार बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.sources.length, 4, "the API retains all four source records, while the digest groups duplicate events");
    assert.match(r.data.reply, /आज 3 अलग-अलग, तारीख़-जाँची खबरें मिलीं \(आपने 5 माँगी थीं\)/);
    assert.doesNotMatch(r.data.reply, /भरोसेमंद हिंदी सार तैयार नहीं हो सका/);
    const summaries = r.data.reply.split(String.fromCharCode(10)).filter(line => /^सार: /.test(line));
    assert.ok(summaries.length > 0 && summaries.length <= 4, "show only individually validated summaries, never claim five");
    assert.match(r.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("a casual sentence containing आज does not automatically trigger Exa", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज मैं क्या करूँ?" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")), false,
    "a generic use of आज must not start a web search");
  assert.ok(calls.slice(before).some(x => x.url.includes("api.groq.com")),
    "normal conversation should still reach the AI provider");
});

await test("failed web search is explicitly marked as attempted and unavailable", async () => {  exaMode = "429";
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "इंटरनेट पर आज की ताजा खबरें खोजो" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchAttempted, true);
  assert.equal(r.data.webSearch, true);
  assert.ok(r.data.searchWarning);
  assert.equal(r.data.sources.length, 0);
  exaMode = "success";
});

await test("today's gold and silver search excludes stale price pages", async () => {
  exaMode = "gold-stale";
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज सोने और चांदी का भाव बताओ" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.sources.length, 1);
  assert.match(r.data.sources[0].url, /silver-fresh/);
  assert.doesNotMatch(JSON.stringify(r.data.sources), /gold-old|2025/);
  assert.equal(calls.slice(before).filter(x => x.url.includes("api.groq.com")).length, 1);
  exaMode = "success";
});
await test("silver pages with a source publication date are retained when Exa omits publishedDate", async () => {
  exaMode = "gold-undated-page-date";
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज चांदी का भाव बताओ" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.sources.length, 1, "source-page publication date should satisfy the freshness check");
  assert.match(r.data.sources[0].url, /silver-page-date/);
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "dated silver evidence should be sent to the answer model");
  const prompt = JSON.parse(groqCall.init.body).messages.at(-1).content;
  assert.match(prompt, /राष्ट्रीय भाव स्पष्ट रूप से उपलब्ध नहीं/);
  assert.doesNotMatch(prompt, /Silver 999 Fine rate in New Delhi/, "India-wide query must not include a city-only price row");
  exaMode = "success";
});

await test("current price query invokes web search and AI", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने और चांदी का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.ok(r.data.reply);
  assert.ok(calls.slice(before).some(x => x.url.includes("api.exa.ai/search")));
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "Groq should receive the searched price question");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const enrichedUserPrompt = groqBody.messages?.at(-1)?.content || "";
  assert.match(enrichedUserPrompt, /सोना-चाँदी भाव उत्तर का अनिवार्य प्रारूप/);
  assert.match(enrichedUserPrompt, /24 कैरेट और 22 कैरेट/);
  assert.match(enrichedUserPrompt, /999 शुद्धता/);
  assert.doesNotMatch(enrichedUserPrompt, /24K gold rate ₹7800 per gram/, "unverified search snippets must not supply India-wide bullion prices");
  assert.doesNotMatch(enrichedUserPrompt, /22K gold rate ₹7150 per gram/, "unverified search snippets must not supply India-wide bullion prices");
  assert.doesNotMatch(enrichedUserPrompt, /999 silver rate ₹95 per gram/, "do not infer 999 purity from a generic silver snippet");
  assert.doesNotMatch(enrichedUserPrompt, /24 karat gold rate in New Delhi.*₹1,39,850 per 10 gm/);
  assert.doesNotMatch(enrichedUserPrompt, /22 karat gold rate in New Delhi.*₹1,27,683 per 10 gm/);
  assert.doesNotMatch(enrichedUserPrompt, /Silver 999 Fine rate in New Delhi.*₹1,77,940 per 1 kg/);
  assert.match(enrichedUserPrompt, /शहरवार तालिका की किसी भी पंक्ति से भाव बिल्कुल मत निकालो/);
  assert.match(enrichedUserPrompt, /13,888 × 10 = 1,38,880/);
  assert.match(enrichedUserPrompt, /179 × 1000 = 1,79,000/);
  assert.match(enrichedUserPrompt, /विसंगति बताओ/);
  assert.match(enrichedUserPrompt, /हर प्रकाशक के आँकड़े उसी प्रकाशक के अलग खंड में रखो/);
  assert.match(enrichedUserPrompt, /अधूरा या कटा हुआ अंक/);
  assert.match(enrichedUserPrompt, /उसी स्रोत के निकाले गए मूल मूल्य-संदर्भ/);
});
await test("long numbered prompts reach Groq without losing their beginning or ending", async () => {
  const longPrompt = Array.from({ length: 50 }, (_, i) => `${i + 1}. सवाल ${i + 1}: सामान्य ज्ञान का छोटा परीक्षण`).join("\n");
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: longPrompt }] }, token);
  assert.equal(r.status, 200);
  const groqCall = calls.slice(before).find(x => x.url.includes("api.groq.com"));
  assert.ok(groqCall, "Groq request should be made");
  const groqBody = JSON.parse(groqCall.init.body || "{}");
  const sentPrompt = groqBody.messages?.at(-1)?.content || "";
  assert.ok(sentPrompt.startsWith("1. सवाल 1:"), "first question must be preserved");
  assert.ok(sentPrompt.includes("50. सवाल 50:"), "last question must be preserved");
  assert.equal(groqBody.max_tokens, 6000, "output budget should support longer answer lists");
});
await test("Exa rate-limit is explained to the user and marked retryable", async () => {
  exaMode = "429";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchAttempted, true);
  assert.equal(r.data.searchUnavailable, true);
  assert.equal(r.data.providerStatus, 429);
  assert.equal(r.data.retryable, true);
  assert.match(r.data.reply, /अनुरोध सीमा पूरी हो गई है/);
  assert.match(r.data.searchWarning, /अनुरोध सीमा पूरी हो गई है/);
  assert.equal(r.data.sources.length, 0);
  exaMode = "success";
});
await test("Exa exhausted credits are not described as free and never trigger a paid fallback", async () => {
  exaMode = "402";
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchUnavailable, true);
  assert.equal(r.data.providerStatus, 402);
  assert.equal(r.data.searchErrorCode, "NO_MORE_CREDITS");
  assert.equal(r.data.retryable, false);
  assert.match(r.data.searchWarning, /प्लान की उपलब्ध सीमा पूरी हो गई है/);
  assert.match(r.data.searchWarning, /शुल्क लग सकता है/);
  assert.equal(calls.slice(before).filter(x => x.url.includes("api.groq.com")).length, 0);
  exaMode = "success";
});
await test("Exa timeout is returned as a retryable 504 search failure", async () => {
  exaMode = "timeout";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchUnavailable, true);
  assert.equal(r.data.providerStatus, 504);
  assert.equal(r.data.searchErrorCode, "AbortError");
  assert.equal(r.data.retryable, true);
  assert.match(r.data.reply, /समय अधिक लगा/);
  exaMode = "success";
});
await test("Exa network failure is returned as retryable and never sent to Groq as live data", async () => {
  exaMode = "network";
  const before = calls.length;
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज सोने का भाव बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchUnavailable, true);
  assert.equal(r.data.providerStatus, 502);
  assert.equal(r.data.searchErrorCode, "TypeError");
  assert.equal(r.data.retryable, true);
  assert.equal(calls.slice(before).filter(x => x.url.includes("api.groq.com")).length, 0);
  exaMode = "success";
});
await test("undated search results are not mislabeled as fresh news", async () => {
  exaMode = "news-undated";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "आज की ताजा खबरें बताओ" }] }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.searchUnavailable, true);
  assert.equal(r.data.sources.length, 0);
  assert.match(r.data.reply, /आज ही प्रकाशित और तारीख-जाँचे गए भरोसेमंद समाचार परिणाम नहीं मिले/);
  assert.match(r.data.reply, /कल या उससे पुरानी खबरों को आज की खबर बताकर नहीं दिखाऊँगा/);  assert.doesNotMatch(r.data.reply, /3 नवंबर/);
  exaMode = "success";
});
await test("Groq HTTP 413 retries once with compact context and preserves the complete latest question", async () => {
  groqMode = "413-once";
  groq413Count = 0;
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [
      { role: "user", content: "तीन सवालों के उत्तर दो: ग्रामीण विकास की चुनौतियाँ क्या हैं, औद्योगीकरण का सामाजिक प्रभाव क्या है, और आधुनिक शिक्षा की भूमिका क्या है?" },
      { role: "assistant", content: "मैं तीनों सवालों का उत्तर दूँगा।" },
      { role: "user", content: "सबका उत्तर दो।" }
    ]
  }, token);
  assert.equal(r.status, 200);
  const groqCalls = calls.slice(before).filter(x => x.url.includes("api.groq.com"));
  assert.equal(groqCalls.length, 2, "provider should be retried exactly once");
  const retryBody = JSON.parse(groqCalls[1].init.body || "{}");
  const retryPrompt = retryBody.messages?.at(-1)?.content || "";
  assert.match(retryPrompt, /पिछला सवाल\/संदर्भ/);
  assert.match(retryPrompt, /ग्रामीण विकास की चुनौतियाँ/);
  assert.match(retryPrompt, /आधुनिक शिक्षा की भूमिका/);
  assert.match(retryPrompt, /अभी का पूरा सवाल/);
  assert.match(retryPrompt, /सबका उत्तर दो/);
  assert.equal(retryBody.messages.length, 2, "compact retry should combine context into one user message");
  assert.equal(retryBody.max_tokens, 2200);
  const retrySystem = retryBody.messages?.[0]?.content || "";
  assert.match(retrySystem, /समाचार में केवल शीर्षक और स्रोत-अंश से पुष्ट तथ्य लिखो/);
  assert.match(retrySystem, /बंद हुआ या दिन का अंतिम स्तर मत लिखो/);
  assert.match(retrySystem, /समापन स्तर/);
  assert.ok(retrySystem.length < 1000, "413 retry must also compact the oversized system prompt");
  groqMode = "success";
});
await test("Groq repeated HTTP 413 preserves real search results without inventing a summary", async () => {
  groqMode = "413-always";
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज सोने और चांदी का भाव बताओ" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.providerStatus, 413);
  assert.equal(r.data.providerBusy, true);
  assert.equal(r.data.sources.length, 1, "duplicate pages from the same publisher should remain deduplicated");
  assert.match(r.data.reply, /HTTP 413/);
  assert.match(r.data.reply, /वास्तविक परिणाम/);
  assert.equal(calls.slice(before).filter(x => x.url.includes("api.groq.com")).length, 2);
  groqMode = "success";
});

await test("current news never shows a partial digest when Groq returns an empty completion", async () => {
  groqMode = "empty";
  exaMode = "success";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.success, true);
    assert.match(r.data.reply, /आज केवल 4 अलग-अलग, तारीख़-जाँचे समाचार स्रोत मिले|आज 5 तारीख़-जाँचे समाचार परिणाम मिले/);
    assert.doesNotMatch(r.data.reply, /प्रकाशकों के मूल शीर्षक/);
    assert.doesNotMatch(r.data.reply, /खबर [1-5]:/);
    assert.ok(r.data.sources.length > 1, "date-checked search results should be preserved");
    assert.equal(calls.slice(before).filter(x => x.url.includes("api.groq.com")).length, 1);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("general learning chat retries a provider 429 with the secondary Groq model", async () => {
  groqMode = "general-429-fallback-success";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "न्यूटन का पहला नियम आसान हिंदी में समझाओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.success, true);
    assert.match(r.data.reply, /जड़त्व/);
    const groqCalls = calls.slice(before).filter(x => x.url.includes("api.groq.com"));
    assert.equal(groqCalls.length, 2, "one primary request and one secondary-model retry are expected");
    assert.equal(JSON.parse(groqCalls[0].init.body).model, "openai/gpt-oss-20b");
    const fallbackBody = JSON.parse(groqCalls[1].init.body);
    assert.equal(fallbackBody.model, "qwen/qwen3.8-27b");
    assert.equal(fallbackBody.max_tokens, 2200);
    assert.match(fallbackBody.messages.at(-1).content, /न्यूटन का पहला नियम/);
    assert.match(fallbackBody.messages[0].content, /तारीख या समय सीधे न पूछा हो/);
  } finally {
    groqMode = "success";
  }
});

await test("daily encouragement prompt is not intercepted by the date shortcut", async () => {
  groqMode = "success";
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "आज का दिन अच्छा बनाने के लिए मुझे तीन अच्छी आदतें बताओ।" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.success, true);
  assert.equal(calls.slice(before).filter(x => x.url.includes("api.groq.com")).length, 1, "the question should reach the chat model instead of the date shortcut");
});

await test("current news retries one provider rate limit with compact source context", async () => {
  groqMode = "429-once";
  groq429Count = 0;
  exaMode = "success";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.sources.length, 4);
    assert.doesNotMatch(r.data.reply, /AI सेवा व्यस्त थी/);
    const groqCalls = calls.slice(before).filter(x => x.url.includes("api.groq.com"));
    assert.ok(groqCalls.length >= 2, "a compact retry should follow the initial HTTP 429");
    const retryBody = JSON.parse(groqCalls[1].init.body);
    assert.equal(retryBody.max_tokens, 1000);
    assert.match(retryBody.messages.at(-1).content, /लेख-अंश/);
    assert.match(retryBody.messages.at(-1).content, /\nप्रकाशक:/, "compact retry context must use real line breaks");
    assert.doesNotMatch(retryBody.messages.at(-1).content, /\\nप्रकाशक:/, "compact retry must not send literal backslash-n text");
    assert.ok((r.data.reply.match(/सार:/g) || []).length > 0 && (r.data.reply.match(/सार:/g) || []).length < 5,
      "a four-source retry may show only individually validated summaries and must not claim five stories");
    assert.match(r.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("current news automatically switches to a secondary Groq model when the primary stays rate-limited", async () => {
  groqMode = "primary-429-fallback-success";
  exaMode = "success";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.sources.length, 4);
    assert.ok((r.data.reply.match(/सार:/g) || []).length < 5,
      "secondary-model output must never claim five stories unless all five pass validation");
    const groqCalls = calls.slice(before).filter(x => x.url.includes("api.groq.com"));
    assert.ok(groqCalls.some(x => JSON.parse(x.init.body).model === "openai/gpt-oss-20b"));
    assert.ok(groqCalls.some(x => JSON.parse(x.init.body).model === "qwen/qwen3.8-27b"), "secondary model must be attempted after primary HTTP 429");
    const secondaryBody = JSON.parse(groqCalls.find(x => JSON.parse(x.init.body).model === "qwen/qwen3.8-27b").init.body);
    assert.equal(secondaryBody.max_tokens, 1200);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("current news accepts concise Hindi summaries without the literal सार label", async () => {
  groqMode = "news-plain-summary";
  exaMode = "success";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.sources.length, 4);
    assert.ok((r.data.reply.match(/सार:/g) || []).length > 0 && (r.data.reply.match(/सार:/g) || []).length < 5,
      "plain Hindi summaries may be shown individually when supported by three distinct dated sources");
    assert.match(r.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("current news keeps valid summaries when one generated item adds an unsupported cause", async () => {
  groqMode = "news-unsupported-cause";
  exaMode = "success";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.sources.length, 4);
    assert.ok((r.data.reply.match(/सार:/g) || []).length < 5,
      "the unsupported causal claim must be omitted without discarding other valid summaries");
    assert.doesNotMatch(r.data.reply, /दिवाली के कारण दिल्ली की हवा खराब हुई/);
    assert.match(r.data.reply, /अपुष्ट खबरें नहीं जोड़ी गईं/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("current news retries malformed Hindi summary with secondary model", async () => {
  groqMode = "malformed-news-secondary";
  exaMode = "success";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की ताजा खबरें बताओ" }]
    }, token);
    assert.equal(r.status, 200);
    assert.ok(r.data.sources.length > 0, "real dated source results must be preserved during fallback");
    assert.doesNotMatch(r.data.reply, /IMD issues|Supreme Court permits|Delhi air quality update/i,
      "unvalidated English headlines must not be presented as Hindi summaries");
    const groqCalls = calls.slice(before).filter(x => x.url.includes("api.groq.com"));
    assert.ok(groqCalls.some(x => JSON.parse(x.init.body).model === "qwen/qwen3.8-27b"),
      "secondary model must retry when the primary model's summary format is invalid");
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("current news refuses headline-only output when Groq returns malformed summary text", async () => {
  groqMode = "malformed-news";
  exaMode = "success";
  const before = calls.length;
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "आज की भारत की 5 अलग-अलग ताज़ा खबरें बताओ।" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.success, true);
    assert.ok(r.data.sources.length > 1, "date-checked search results should remain available");
    assert.match(r.data.reply, /आज केवल 4 अलग-अलग, तारीख़-जाँचे समाचार स्रोत मिले|आज 5 तारीख़-जाँचे समाचार परिणाम मिले/);
    assert.doesNotMatch(r.data.reply, /प्रकाशकों के मूल शीर्षक|प्रकाशित:|खबर [1-5]:/);
    assert.doesNotMatch(r.data.reply, /\\\\n\\\\n/, "fallback text must contain real line breaks, not visible escape sequences");
    assert.doesNotMatch(r.data.reply, /कृपया थोड़ी देर बाद फिर पूछें/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("bullion rates are extracted from city article sections when Groq is busy", async () => {
  groqMode = "429";
  exaMode = "bullion-city-article-sections";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "दिल्ली में आज 24 कैरेट और 22 कैरेट सोने तथा चाँदी का भाव बताओ" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.providerBusy, true);
    assert.match(r.data.reply, /24 कैरेट सोना: ₹145,510 प्रति 10 ग्राम/);
    assert.match(r.data.reply, /22 कैरेट सोना: ₹133,384 प्रति 10 ग्राम/);
    assert.match(r.data.reply, /999 चाँदी: ₹190,570 प्रति किलोग्राम/);
    assert.doesNotMatch(r.data.reply, /145,600|133,467|190,730/, "Mumbai values must not leak into Delhi output");
    assert.match(r.data.reply, /mint\.example\.net/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("bullion rates are extracted from same-city table rows when Groq is busy", async () => {
  groqMode = "429";
  exaMode = "bullion-city-busy";
  try {
    const r = await request("/api/chat", "POST", {
      messages: [{ role: "user", content: "दिल्ली में आज 24 कैरेट और 22 कैरेट सोने तथा चाँदी का भाव बताओ" }]
    }, token);
    assert.equal(r.status, 200);
    assert.equal(r.data.providerBusy, true);
    assert.match(r.data.reply, /दिल्ली/);
    assert.match(r.data.reply, /24 कैरेट सोना: ₹1,39,850 प्रति 10 ग्राम/);
    assert.match(r.data.reply, /22 कैरेट सोना: ₹1,27,683 प्रति 10 ग्राम/);
    assert.match(r.data.reply, /999 चाँदी: ₹1,77,940 प्रति किलोग्राम/);
    assert.match(r.data.reply, /example\.com/);
    assert.match(r.data.reply, /silver\.example\.net/);
  } finally {
    groqMode = "success";
    exaMode = "success";
  }
});

await test("Groq 429 preserves available web results with an honest fallback", async () => {
  groqMode = "429";
  exaMode = "success";
  const r = await request("/api/chat", "POST", {
    webSearch: true,
    messages: [{ role: "user", content: "आज सोने का भाव इंटरनेट पर खोजो" }]
  }, token);
  assert.equal(r.status, 200);
  assert.equal(r.data.success, true);
  assert.equal(r.data.providerBusy, true);
  assert.match(r.data.reply, /AI सेवा इस समय व्यस्त है/);
  assert.match(r.data.reply, /वास्तविक परिणाम अलग से दिए गए हैं/);
  assert.match(r.data.reply, /प्रकाशन-तारीख देखकर मूल खबर पढ़ें/);
  assert.ok(r.data.sources.length >= 1, "at least one verified source should be preserved");
  assert.match(r.data.searchWarning, /AI सेवा व्यस्त थी/);
  groqMode = "success";
});
await test("Groq 429 without search results remains a clear retryable error", async () => {
  groqMode = "429";
  exaMode = "429";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 429);
  assert.equal(r.data.retryable, true);
  groqMode = "success";
  exaMode = "success";
});
await test("Groq 5xx is handled as a provider outage", async () => {
  groqMode = "500";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 502);
  groqMode = "success";
});
await test("Groq timeout returns a clear retryable gateway timeout", async () => {  groqMode = "timeout";
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: "भारत का इतिहास बताओ" }] }, token);
  assert.equal(r.status, 504);
  assert.equal(r.data.retryable, true);
  assert.equal(r.data.providerStatus, 504);
  assert.match(r.data.error, /समय अधिक लगा/);
  groqMode = "success";
});
await test("empty question is rejected", async () => {
  const r = await request("/api/chat", "POST", { messages: [{ role: "user", content: " " }] }, token);
  assert.equal(r.status, 400);
});
await test("oversized user question is rejected before provider calls", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: "क".repeat(12001) }]
  }, token);
  assert.equal(r.status, 400);
  assert.equal(calls.length, before, "oversized input must not reach Exa or Groq");
});
await test("non-text user message is rejected as an empty question", async () => {
  const before = calls.length;
  const r = await request("/api/chat", "POST", {
    messages: [{ role: "user", content: { text: "भारत का इतिहास" } }]
  }, token);
  assert.equal(r.status, 400);
  assert.equal(calls.length, before, "non-text content must not reach providers");
});
await test("media-disabled status is honest and explicit", async () => {
  const r = await request("/api/media/image", "POST", { prompt: "test" }, token);
  assert.equal(r.status, 503);
  assert.equal(r.data.zeroCostMode, true);
});
console.log(`\nSarathi Worker self-test: ${passed}/${passed} passed (mock provider mode; no real API credits used).`);