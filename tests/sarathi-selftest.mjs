import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Load the exact Worker source without changing its Cloudflare module format.
const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

// Groq reasoning controls are model-specific: GPT-OSS rejects reasoning_format.
assert.match(source, /model\.startsWith\("openai\/gpt-oss-"\)[\s\S]*include_reasoning: false[\s\S]*reasoning_format: "hidden"/, "GPT-OSS must use include_reasoning=false while non-GPT-OSS reasoning models use reasoning_format=hidden");
assert.match(source, /reasoning_effort: reasoningEffort/, "reasoning effort must remain enabled when requested");
assert.ok(appSource.includes('replyText.includes("खबर 1:")') && appSource.includes('replyText.includes("प्रकाशक:")') && appSource.includes('replyText.includes("प्रकाशित:")'), "inline Hindi news summaries must not render a duplicate source panel");
const busyFallbackStart = appSource.indexOf("if ((data.providerBusy === true || data.newsSummaryUnverified === true) &&");
const busyFallbackEnd = appSource.indexOf("\n    }", busyFallbackStart);
assert.ok(busyFallbackStart >= 0 && busyFallbackEnd > busyFallbackStart, "provider-busy fallback must exist");
const busyFallback = appSource.slice(busyFallbackStart, busyFallbackEnd);
assert.match(busyFallback, /आसान हिंदी शीर्षक और दो-वाक्यीय सार सत्यापित नहीं हो पाए/, "busy fallback must explain that Hindi headlines and summaries were not verified");
assert.doesNotMatch(busyFallback, /source\.title/, "busy fallback must not print raw English headlines");
assert.match(busyFallback, /title: "मूल समाचार खोलें/, "busy fallback source links must use a Hindi link label");
assert.match(appSource, /data\.providerBusy !== true && data\.newsSummaryUnverified !== true && isCurrentNewsPrompt && !hasUsableInlineNewsUrl/, "unverified-news fallback must not append a second inline source list");
assert.match(appSource, /data\.newsSummaryUnverified === true/, "unverified-news fallback must use a distinct validation message and sanitize source labels");
assert.match(source, /newsSummaryUnverified: isCurrentNewsReply && !formattedNewsReply/, "Worker must mark current-news replies whose Hindi summaries fail validation");
assert.match(source, /title: isCurrentNewsReply\s*\?\s*"मूल समाचार खोलें — "\s*\+\s*\(item\.publisher \|\| new URL\(item\.url\)\.hostname\)/, "current-news source cards must never expose raw English article headlines");
assert.match(source, /const claimsCause = .*test\(generatedText\)/, "news summaries must detect unsupported causal claims");
assert.match(source, /sourceExplicitlyStatesCause.*test\(sourceEvidence\)/, "causal claims must be backed by the same source");
const numericGuardStart = source.indexOf("function hasUnsupportedNumericClaim(");
const numericGuardEnd = source.indexOf("\nfunction hasMixedScriptToken", numericGuardStart);
assert.ok(numericGuardStart >= 0 && numericGuardEnd > numericGuardStart, "news numeric-claim validator must exist");
const hasUnsupportedNumericClaim = new Function(source.slice(numericGuardStart, numericGuardEnd) + "\nreturn hasUnsupportedNumericClaim;")();
assert.equal(hasUnsupportedNumericClaim("दोनों पक्षों ने अलग-अलग बयान दिए।", "दोनों पक्षों ने बयान दिए।"), false, "Hindi word 'दोनों' must not be mistaken for numeric two");
assert.equal(hasUnsupportedNumericClaim("दो पक्षों ने बयान दिए।", "पक्षों ने बयान दिए।"), true, "standalone unsupported Hindi number words must still be rejected");
assert.equal(hasUnsupportedNumericClaim("यह एक महत्वपूर्ण फैसला है।", "Supreme Court decision"), false, "the common Hindi article एक must not be mistaken for a numeric claim");
assert.equal(hasUnsupportedNumericClaim("This is one important decision.", "Supreme Court decision"), false, "the common English article one must not be mistaken for a numeric claim");
assert.equal(hasUnsupportedNumericClaim("नौकरी के नए अवसरों पर चर्चा हुई।", "रोजगार के अवसरों पर चर्चा हुई।"), false, "the prefix नौ inside नौकरी must not be mistaken for numeric nine");
assert.equal(hasUnsupportedNumericClaim("नौ लोगों ने याचिका दायर की।", "लोगों ने याचिका दायर की।"), true, "standalone unsupported Hindi nine must still be rejected");

assert.match(source, /स्रोत में न दिया कारण.*जिम्मेदार व्यक्ति/, "news prompt must forbid invented causes and responsibility");
assert.match(source, /प्रवेश की पुरानी तारीख.*आगे के प्रवास के लिए वीज़ा/, "immigration news summaries must distinguish past entry date from current visa requirement");
assert.match(source, /मौखिक उल्लेख.*जल्दी सूचीबद्ध करने पर सहमति.*याचिका स्वीकार/, "court news summaries must distinguish procedural listing from accepting a petition or deciding the case");
assert.match(source, /Prefer headline evidence; snippets may mention unrelated topics incidentally/, "news categories must prioritize headline evidence over incidental snippet mentions");
assert.match(source, /only the headline may assign a category/, "five-category classification must not fall back to incidental snippet keywords");
assert.match(source, /air quality\\|air pollution\\|pollution\\|weather\\|forecast\\|वायु गुणवत्ता\\|वायु प्रदूषण\\|प्रदूषण\\|मौसम\\|पूर्वानुमान/, "AQI and weather headlines must not be misclassified as science");
assert.match(source, /stocks\? in news\\|stocks\? to watch\\|shares\? in focus\\|pre-market\\|market watch/, "generic stock watchlists must not fill the economy category");
assert.match(source, /const requireTwoSentenceNews = \/2\\s\*/, "two-sentence request detector must use real whitespace matching");
assert.match(source, /ठीक दो छोटे, सीधे हिंदी वाक्य/, "news prompt must request two sentences when the user explicitly asks for them");
const categoryStart = source.indexOf("function classifyRequestedNewsCategory(item) {");
const categoryEnd = source.indexOf("\nfunction selectNewsForRequestedCategories", categoryStart);
assert.ok(categoryStart >= 0 && categoryEnd > categoryStart, "news category classifier must exist");
const cleanTextForCategoryTest = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const classifyRequestedNewsCategory = new Function("cleanText", source.slice(categoryStart, categoryEnd) + "\nreturn classifyRequestedNewsCategory;")(cleanTextForCategoryTest);
assert.equal(classifyRequestedNewsCategory({ title: "Delhi's AQI ‘Very Poor’ for 4th day in a row, to be ‘Severe’ on Diwali weekend | Delhi News - The Indian Express" }), "", "Delhi AQI/pollution report must not fill science category");
assert.equal(classifyRequestedNewsCategory({ title: "Stocks in news: Bharti Airtel, LIC, Titan, ONGC and other shares" }), "", "generic stock watchlist must not fill economy category");
assert.equal(classifyRequestedNewsCategory({ title: "ISRO launches new earth observation satellite" }), "विज्ञान", "a genuine ISRO satellite launch must qualify as science");
assert.equal(classifyRequestedNewsCategory({ title: "CSIR researchers develop a new low-cost water purification material" }), "विज्ञान", "Indian CSIR research headlines must qualify as science");
assert.equal(classifyRequestedNewsCategory({ title: "Joint CSIR-UGC NET December 2026: NTA records 2.36 lakh registrations as application deadline extended" }), "", "CSIR-UGC NET exam registration notices must not fill the science category");
assert.equal(classifyRequestedNewsCategory({ title: "IISc team reports a breakthrough in quantum materials research" }), "विज्ञान", "Indian scientific institution and research headlines must qualify as science");
assert.equal(classifyRequestedNewsCategory({ title: "RBI keeps repo rate unchanged after policy review" }), "अर्थव्यवस्था", "an RBI rate decision must qualify as economy");
assert.equal(classifyRequestedNewsCategory({ title: "Supreme Court orders release in unlawful detention case" }), "अदालत", "a Supreme Court ruling must qualify as court");
const courtHelperStart = source.indexOf("function isSpecificCourtNewsQuery(text) {");
const courtHelperEnd = source.indexOf("\nfunction classifyRequestedNewsCategory", courtHelperStart);
assert.ok(courtHelperStart >= 0 && courtHelperEnd > courtHelperStart, "focused court-news query helpers must exist");
const courtHelpers = new Function("isCurrentNewsQuery", "cleanText",
  source.slice(courtHelperStart, courtHelperEnd) + "\nreturn { isSpecificCourtNewsQuery, isSingleRequestedNewsStory, isSubstantiveCourtNewsItem };")(
    value => /(?:खबर|समाचार|news|court|कोर्ट|न्यायालय|अदालत)/i.test(String(value || "")),
    value => String(value || "").replace(/\s+/g, " ").trim()
  );
assert.equal(courtHelpers.isSpecificCourtNewsQuery("पिछले 48 घंटों में भारत के सुप्रीम कोर्ट की खबर बताओ"), true,
  "a focused recent Supreme Court query must use the court-only route");
assert.equal(courtHelpers.isSpecificCourtNewsQuery("पिछले 48 घंटों में भारत की पाँच महत्वपूर्ण खबरें सरकार अदालत विज्ञान खेल अर्थव्यवस्था से बताओ"), false,
  "the five-category digest must keep its existing route");
assert.equal(courtHelpers.isSingleRequestedNewsStory("पिछले 48 घंटों में भारत के सुप्रीम कोर्ट की एक महत्वपूर्ण खबर बताओ"), true,
  "a court query explicitly asking for one important story must request only one source");
assert.equal(courtHelpers.isSingleRequestedNewsStory("पिछले 48 घंटों में भारत के हाई कोर्ट की पाँच खबरें बताओ"), false,
  "a multi-story court query must retain its multiple results");
assert.equal(courtHelpers.isSubstantiveCourtNewsItem({ title: "Supreme Court orders release in unlawful detention case" }), true,
  "a substantive Supreme Court order must qualify");
assert.equal(courtHelpers.isSubstantiveCourtNewsItem({ title: "Bomb threat to Bombay High Court and BSE" }), false,
  "a threat mentioning a High Court must not qualify as judicial news");
const newsCountStart = source.indexOf("function formatHindiNewsCount(");
const newsCountEnd = source.indexOf("\nfunction formatCurrentNewsSummaryReply", newsCountStart);
assert.ok(newsCountStart >= 0 && newsCountEnd > newsCountStart, "Hindi news count and note helpers must exist");
const newsFormatHelpers = new Function(source.slice(newsCountStart, newsCountEnd) + "\nreturn { formatHindiNewsCount, buildNewsDigestNote };")();
assert.equal(newsFormatHelpers.formatHindiNewsCount(1), "आज 1 अलग, तारीख़-जाँची खबर मिली:", "one story must use singular Hindi grammar");
assert.equal(newsFormatHelpers.formatHindiNewsCount(3), "आज 3 अलग-अलग, तारीख़-जाँची खबरें मिलीं:", "multiple stories must use plural Hindi grammar");
assert.equal(newsFormatHelpers.formatHindiNewsCount(5), "आज की 5 अलग-अलग, तारीख़-जाँची खबरें:", "five stories must retain the full-digest heading");
const combinedNote = newsFormatHelpers.buildNewsDigestNote("अपुष्ट खबरें नहीं जोड़ी गईं।");
assert.equal((combinedNote.match(/ध्यान दें:/g) || []).length, 1, "digest must show one combined note heading");
assert.match(combinedNote, /लेख-अंश पर आधारित/);
assert.match(combinedNote, /अपुष्ट खबरें नहीं जोड़ी गईं/);

const courtOutcomeStart = source.indexOf("function hasUnsupportedCourtDisposition(");
const courtOutcomeEnd = source.indexOf("\nfunction formatCurrentNewsSummaryReply", courtOutcomeStart);
assert.ok(courtOutcomeStart >= 0 && courtOutcomeEnd > courtOutcomeStart, "court disposition guard must exist");
const hasUnsupportedCourtDisposition = new Function("cleanText", source.slice(courtOutcomeStart, courtOutcomeEnd) + "\nreturn hasUnsupportedCourtDisposition;")(
  value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim()
);
assert.equal(hasUnsupportedCourtDisposition("मद्रास हाई कोर्ट ने याचिका खारिज कर दी", "Madras High Court closes plea to regulate gold loans"), true,
  "a summary must not turn a court's closure/disposal into dismissal");
assert.equal(hasUnsupportedCourtDisposition("मद्रास हाई कोर्ट ने याचिका बंद की", "Madras High Court closes plea to regulate gold loans"), false,
  "a summary may describe a closure when the source itself says the plea was closed");
assert.match(source, /India court and judiciary news.*published within the last 48 hours/s,
  "focused court queries must use a judiciary-specific search query");

assert.equal(classifyRequestedNewsCategory({ title: "Home Ministry announces new visa policy" }), "सरकार", "a ministry policy announcement must qualify as government");
assert.equal(classifyRequestedNewsCategory({ title: "Delhi govt urges citizens to burst only green crackers" }), "सरकार", "govt abbreviations must be classified as government, not left for an unrelated category");
assert.equal(classifyRequestedNewsCategory({ title: "PM Modi asks new NITI Aayog team to craft ideas to improve lives of India’s poorest" }), "सरकार", "NITI Aayog policy direction must be classified as government, not economy");
assert.match(source, /India court and judiciary news.*published within the last 48 hours/s, "five-category search must deliberately seek recent court coverage");
assert.equal(classifyRequestedNewsCategory({ title: "Indian athlete Parvez Khan faces doping ban" }), "खेल", "an athlete doping story must qualify as sports");
assert.equal(classifyRequestedNewsCategory({ title: "Daily roundup of national headlines", snippet: "Sports officials and athletes discuss the latest tournament" }), "", "incidental sports terms in a snippet must not fill the sports category");

const selectStart = source.indexOf("function selectNewsForRequestedCategories(results, query) {");
const selectEnd = source.indexOf("\nfunction isCurrentNewsQuery", selectStart);
assert.ok(selectStart >= 0 && selectEnd > selectStart, "five-category selector must exist");
const isFiveCategoryNewsQuery = value => /(?:पाँच|पांच|5)[^\n]{0,45}?(?:खबर|समाचार|news)/i.test(value) &&
  ["सरकार","अर्थव्यवस्था","अदालत","विज्ञान","खेल"].every(word => value.includes(word));
const selectNewsForRequestedCategories = new Function("classifyRequestedNewsCategory", "cleanText", "isFiveCategoryNewsQuery",
  source.slice(selectStart, selectEnd) + "\nreturn selectNewsForRequestedCategories;")(
    classifyRequestedNewsCategory, cleanTextForCategoryTest, isFiveCategoryNewsQuery
  );
const categoryFixture = [
  { title: "Home Ministry announces new visa policy", url: "https://example.com/gov", requestedCategory: "खेल" },
  { title: "RBI keeps repo rate unchanged after policy review", url: "https://example.com/economy", requestedCategory: "सरकार" },
  { title: "Supreme Court orders release in unlawful detention case", url: "https://example.com/court", requestedCategory: "विज्ञान" },
  { title: "ISRO launches new earth observation satellite", url: "https://example.com/science", requestedCategory: "खेल" },
  { title: "Indian athlete faces doping ban", url: "https://example.com/sports", requestedCategory: "अदालत" },
  { title: "Daily roundup of national headlines", snippet: "Sports officials discuss tournament", url: "https://example.com/roundup", requestedCategory: "खेल" }
];
const fiveCategorySelection = selectNewsForRequestedCategories(categoryFixture,
  "आज भारत की पाँच ताज़ा खबरें: सरकार, अर्थव्यवस्था, अदालत, विज्ञान और खेल");
assert.deepEqual(fiveCategorySelection.map(item => item.requestedCategory),
  ["सरकार","अर्थव्यवस्था","अदालत","विज्ञान","खेल"],
  "selector must return exactly one headline-grounded item per requested category in requested order");
assert.deepEqual(fiveCategorySelection.map(item => item.url),
  ["https://example.com/gov","https://example.com/economy","https://example.com/court","https://example.com/science","https://example.com/sports"],
  "selector must ignore stale category metadata and snippet-only roundup matches");

const missingQueryStart = source.indexOf("function buildMissingCategoryNewsQueries(results, query) {");
const missingQueryEnd = source.indexOf("\nfunction selectNewsForRequestedCategories", missingQueryStart);
assert.ok(missingQueryStart >= 0 && missingQueryEnd > missingQueryStart, "missing-category search planner must exist");
const buildMissingCategoryNewsQueries = new Function("classifyRequestedNewsCategory", "isFiveCategoryNewsQuery",
  source.slice(missingQueryStart, missingQueryEnd) + "\nreturn buildMissingCategoryNewsQueries;")(
    classifyRequestedNewsCategory, isFiveCategoryNewsQuery
  );
assert.deepEqual(buildMissingCategoryNewsQueries(categoryFixture.slice(0, 2),
  "आज भारत की पाँच ताज़ा खबरें: सरकार, अर्थव्यवस्था, अदालत, विज्ञान और खेल").map(item => item.category),
  ["अदालत","विज्ञान","खेल"],
  "targeted discovery must search only the categories missing from the broad result set");
assert.deepEqual(buildMissingCategoryNewsQueries(fiveCategorySelection,
  "आज भारत की पाँच ताज़ा खबरें: सरकार, अर्थव्यवस्था, अदालत, विज्ञान और खेल"),
  [],
  "targeted discovery must not make extra searches when all five categories already exist");
assert.match(source, /async function searchInternet\(query, env, maxResults = null, searchOptions = \{\}/, "search must support scoped official-domain searches");
assert.match(source, /searchOptions\.news === false/, "official record searches must be able to bypass the news-only publisher filter");
assert.ok(source.indexOf("const courtOfficialSearch = isSpecificCourtNewsQuery") < source.indexOf("const search = await searchInternet(searchQuery, env)"), "official court portals must be searched before newsroom results");
assert.match(source, /officialRecordStatus: "मिला"/, "only stories with a matched official record may enter the verified court-news digest");
assert.match(source, /आधिकारिक अदालत रिकॉर्ड: आधिकारिक पोर्टल की खोज में/, "missing official records must be disclosed in the user-facing digest");
assert.match(source, /previouslyUsedAssistantNewsUrls\(messages\)/, "previously surfaced court-news links must be excluded from repeat results");
assert.match(source, /पिछले उत्तर में दी गई अदालत की खबर को दोहराने के बजाय/, "if no new court story is found, Sarathi must say so instead of repeating one");

const courtRecordHelpersStart = source.indexOf("const OFFICIAL_INDIAN_COURT_DOMAINS =");
const courtRecordHelpersEnd = source.indexOf("function isSubstantiveCourtNewsItem(item)", courtRecordHelpersStart);
assert.ok(courtRecordHelpersStart >= 0 && courtRecordHelpersEnd > courtRecordHelpersStart, "court official-record and repeat-filter helpers must exist");
const courtRecordHelpers = new Function("URL", "cleanText", source.slice(courtRecordHelpersStart, courtRecordHelpersEnd) + "\nreturn { canonicalNewsUrl, previouslyUsedAssistantNewsUrls, isOfficialIndianCourtRecord, courtRecordMatchesStory };")(URL, value => String(value || "").replace(/\s+/g, " ").trim());
assert.equal(courtRecordHelpers.canonicalNewsUrl("https://thehindu.com/story/123?utm_source=test#top"), "https://thehindu.com/story/123", "canonical URL comparison must ignore tracking and fragments");
const priorUrls = courtRecordHelpers.previouslyUsedAssistantNewsUrls([
  { role: "assistant", content: "खबर 1 (अदालत): पुरानी खबर\nमूल लिंक: https://thehindu.com/story/old" },
  { role: "assistant", content: "सामान्य जानकारी: https://example.com/unrelated" },
  { role: "user", content: "पिछले 48 घंटों की एक अदालत खबर बताओ" }
]);
assert.equal(priorUrls.has("https://thehindu.com/story/old"), true, "previous court-news article links must be remembered during the conversation");
assert.equal(priorUrls.has("https://example.com/unrelated"), false, "unrelated assistant links must not suppress court-news results");
assert.equal(courtRecordHelpers.isOfficialIndianCourtRecord({ url: "https://main.sci.gov.in/judgments" }), true, "Supreme Court official domain must be accepted");
assert.equal(courtRecordHelpers.isOfficialIndianCourtRecord({ url: "https://thehindu.com/courts/story" }), false, "news publishers must not be treated as official court records");
const goldStory = { title: "Madras High Court gold loan and pledged jewellery PIL WP(C) 55 of 2025", snippet: "RBI auction regulation petition" };
assert.equal(courtRecordHelpers.courtRecordMatchesStory({ title: "Madras High Court PIL on gold loan and pledged jewellery auction WP(C) 55/2025; RBI", snippet: "public interest petition" }, goldStory), true, "matching official court records must share multiple distinctive story anchors and the same case reference");
assert.equal(courtRecordHelpers.courtRecordMatchesStory({ title: "Madras High Court unrelated service matter", snippet: "appointment case" }, goldStory), false, "unrelated court records must not be attached to a news story");
const rekhaStory = { title: "Woman with low vision Rekha Sharma awaits judicial appointment", snippet: "Supreme Court case WP(C) 733 of 2024 and Rajasthan Civil Judge appointment" };
assert.equal(courtRecordHelpers.courtRecordMatchesStory({ title: "WP(C) 733/2024 Rekha Sharma", snippet: "Rajasthan Civil Judge appointment and low vision" }, rekhaStory), true, "a matching named case record must match a court-news story");
assert.equal(courtRecordHelpers.courtRecordMatchesStory({ title: "Supreme Court order on unrelated service matter", snippet: "appointment petition" }, rekhaStory), false, "generic court words must not falsely match an unrelated official record");
assert.equal(courtRecordHelpers.courtRecordMatchesStory({ title: "Rekha Sharma Rajasthan Civil Judge appointment", snippet: "low vision judicial appointment" }, rekhaStory), false, "matching names and subject without the same explicit case number must not verify a court story");
assert.equal(courtRecordHelpers.courtRecordMatchesStory({ title: "WP(C) 733/2024 unrelated applicant", snippet: "Rajasthan Civil Judge appointment" }, rekhaStory), false, "matching case number and one generic subject anchor without the party identity must not verify a court story");
assert.match(source, /Fail closed: a newsroom article without a matching official court[\s\S]*?is not published as verified court news/, "court stories without a matching official record must be blocked");
assert.match(source, /Limit only after verification/, "a single-story limit must not discard a later officially verified result");

console.log("\nSarathi Worker self-test: court-news regression checks passed.");