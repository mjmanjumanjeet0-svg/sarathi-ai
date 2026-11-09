import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const voice = await readFile(new URL("voice.js", root), "utf8");
const css = await readFile(new URL("style.css", root), "utf8");
const worker = await readFile(new URL("worker.js", root), "utf8");
const relevantFilterStart = worker.indexOf("function filterRelevantSearchResults(query, results, allowGlobalNews = false) {");
const relevantFilterEnd = worker.indexOf("\n}\n", relevantFilterStart);
assert.ok(relevantFilterStart >= 0 && relevantFilterEnd > relevantFilterStart, "search relevance filter must exist");
const filterRelevantSearchResults = new Function(worker.slice(relevantFilterStart, relevantFilterEnd + 3) + "\nreturn filterRelevantSearchResults;")();
const globalNewsFilterStart = worker.indexOf("function filterRelevantSearchResults(query, results, allowGlobalNews = false) {");
assert.ok(globalNewsFilterStart >= 0, "global-news relevance mode must exist");
const worldOnlyResults = [
  { title: "Major earthquake response announced in Japan", url: "https://www.reuters.com/world/asia-pacific/japan-earthquake-response/", snippet: "Japan announces emergency response after earthquake." },
  { title: "India cabinet approves rural programme", url: "https://indianexpress.com/article/india/cabinet-rural-programme/", snippet: "The Union Cabinet approved a new programme." }
];
assert.equal(filterRelevantSearchResults("देश दुनिया की ताज़ा खबरें", worldOnlyResults, true).length, 2, "global digest mode must retain both international and India news from trusted publishers");
assert.match(worker, /if \(!searchOptions\.globalNews\) requestBody\.userLocation = "IN";/, "global news search must not be geographically restricted to India");
assert.match(worker, /All major news published today in India and around the world/, "global digest must explicitly search same-day national and international news");
assert.ok(worker.includes("formatCurrentNewsSummaryReply(normalizeNewsSummaryRepairText(repairText.trim()), searchResults, requireTwoSentenceNews, isFiveCategoryNewsQuery(userText), isGlobalNewsQuery(userText))"), "fallback summary validation must preserve global-news mode");
assert.ok(worker.includes("(!isGlobalNewsQuery(query) && !isIndiaFocusedNewsItem(item))"), "global-news headline fallback must retain international stories");
assert.ok(worker.includes("publishedAt < getIndiaDayStartTimestamp(now)"), "both final news display paths must reject articles from earlier India-local dates");
assert.ok(worker.includes("const earliestAllowed = getIndiaDayStartTimestamp(now);"), "news freshness and category selection must use India-local midnight, not a rolling 48-hour window");
const indiaDayStartStart = worker.indexOf("function getIndiaDayStartTimestamp(now = Date.now()) {");
const indiaDayStartEnd = worker.indexOf("\n}\n", indiaDayStartStart);
assert.ok(indiaDayStartStart >= 0 && indiaDayStartEnd > indiaDayStartStart, "India-local day boundary helper must exist");
const getIndiaDayStartTimestamp = new Function("INDIA_TIME_ZONE", worker.slice(indiaDayStartStart, indiaDayStartEnd + 3) + "\nreturn getIndiaDayStartTimestamp;")("Asia/Kolkata");
const sampleNow = Date.parse("2026-11-08T18:00:00.000Z");
assert.equal(new Date(getIndiaDayStartTimestamp(sampleNow)).toISOString(), "2026-11-07T18:30:00.000Z", "India news day must begin at midnight IST");
const freshFilterStart = worker.indexOf("function filterFreshNewsResults(results, now = Date.now()) {");
const freshFilterEnd = worker.indexOf("\n}\n", freshFilterStart);
assert.ok(freshFilterStart >= 0 && freshFilterEnd > freshFilterStart, "same-day news filter must exist");
const filterFreshNewsResults = new Function("getIndiaDayStartTimestamp", worker.slice(freshFilterStart, freshFilterEnd + 3) + "\nreturn filterFreshNewsResults;")(getIndiaDayStartTimestamp);
const sampleFreshnessNow = Date.parse("2026-11-08T18:00:00.000Z");
assert.deepEqual(filterFreshNewsResults([
  { id: "today", publishedAt: "2026-11-08T17:00:00.000Z" },
  { id: "yesterday", publishedAt: "2026-11-07T17:00:00.000Z" },
  { id: "future", publishedAt: "2026-11-08T19:00:00.000Z" },
  { id: "undated" }
], sampleFreshnessNow).map(item => item.id), ["today"], "only articles published today in India may pass the news freshness filter");
const currentNewsStart = worker.indexOf("function isCurrentNewsQuery(text) {");
const currentNewsEnd = worker.indexOf("\n}", currentNewsStart);
assert.ok(currentNewsStart >= 0 && currentNewsEnd > currentNewsStart, "current-news query detector must exist");
const isCurrentNewsQuery = new Function("isGlobalNewsQuery", worker.slice(currentNewsStart, currentNewsEnd + 3) + "\nreturn isCurrentNewsQuery;")(value => /देश.*दुनिया|भारत.*दुनिया|world news|global news|international news/i.test(String(value || "")));
assert.equal(isCurrentNewsQuery("देश दुनिया की सारी खबरें बताओ"), true, "natural country-and-world news requests must trigger current news search");

const metalResults = [
  { title: "24K gold rate today", url: "https://example.com/gold", snippet: "Gold price" },
  { title: "Silver price today", url: "https://example.com/silver", snippet: "Silver rate" },
  { title: "Weather forecast", url: "https://example.com/weather", snippet: "Weather" }
];
assert.deepEqual(filterRelevantSearchResults("gold 22K and silver price", metalResults).map(item => item.title), ["24K gold rate today", "Silver price today"], "combined gold and silver searches must retain both metal result types and exclude unrelated results");

const numericGuardStart = worker.indexOf("function hasUnsupportedNumericClaim(generatedText, sourceEvidence, returnDetails = false) {");
const numericGuardEnd = worker.indexOf("\n}\n", numericGuardStart);
assert.ok(numericGuardStart >= 0 && numericGuardEnd > numericGuardStart, "news numeric-claim guard must exist");
const hasUnsupportedNumericClaim = new Function(worker.slice(numericGuardStart, numericGuardEnd + 3) + "\nreturn hasUnsupportedNumericClaim;")();
assert.equal(hasUnsupportedNumericClaim("यह एक महत्वपूर्ण फैसला है।", "Supreme Court decision on green crackers"), false, "the common Hindi article 'एक' must not be mistaken for an unsupported numeric claim");
assert.equal(hasUnsupportedNumericClaim("This is one important decision.", "Supreme Court decision on green crackers"), false, "the common English article 'one' must not be mistaken for an unsupported numeric claim");
assert.equal(hasUnsupportedNumericClaim("अदालत ने दो व्यक्तियों को दोषी ठहराया।", "The court convicted people in the case"), true, "explicit Hindi number words must still be checked when they add an unsupported count");
assert.deepEqual(hasUnsupportedNumericClaim("834 रन और छह पारियों में रिकॉर्ड", "834 runs in six innings", true), [], "Hindi number words and grouped source numerals should match their English source equivalents");
assert.deepEqual(hasUnsupportedNumericClaim("कुल 6000 करोड़ रुपये", "Rs 6000 crore investment", true), [], "currency and scale claims already stated in the source must pass");
assert.deepEqual(hasUnsupportedNumericClaim("अदालत ने दो लोगों को दोषी ठहराया", "The court convicted people", true), ["2"], "diagnostic mode must return only unsupported normalized numeric tokens");
const certaintyGuardStart = worker.indexOf("function hasUnsupportedCertaintyClaim(generatedText, sourceEvidence) {");
const certaintyGuardEnd = worker.indexOf("\n}\n", certaintyGuardStart);
assert.ok(certaintyGuardStart >= 0 && certaintyGuardEnd > certaintyGuardStart, "news certainty guard must exist");
const hasUnsupportedCertaintyClaim = new Function(worker.slice(certaintyGuardStart, certaintyGuardEnd + 3) + "\nreturn hasUnsupportedCertaintyClaim;")();
const tentativeDelhiSource = "Delhi government is considering artificial rain after Diwali; no official announcement is expected before Diwali.";
assert.equal(hasUnsupportedCertaintyClaim("दिल्ली सरकार ने कृत्रिम बारिश कराने का निर्णय लिया।", tentativeDelhiSource), true, "a tentative proposal must not be upgraded into a confirmed decision");
assert.equal(hasUnsupportedCertaintyClaim("दिल्ली सरकार कृत्रिम बारिश कराने पर विचार कर रही है।", tentativeDelhiSource), false, "a summary that preserves the source's tentative status must pass");
assert.equal(hasUnsupportedCertaintyClaim("दिल्ली सरकार ने कृत्रिम बारिश कराने का निर्णय लिया।", "Delhi government approved the artificial rain plan."), false, "a confirmed decision must not be rejected when the source confirms approval");
assert.equal(hasUnsupportedCertaintyClaim("दिल्ली सरकार ने कृत्रिम वर्षा की योजना बनाई है।", "Sources say the government plans artificial rain if pollution worsens; no official announcement is expected."), true, "conditional reporting must not be upgraded into a confirmed government plan");
assert.equal(hasUnsupportedCertaintyClaim("प्रदूषण बढ़ने पर कृत्रिम वर्षा कराने पर विचार किया जा रहा है।", "Sources say the government plans artificial rain if pollution worsens; no official announcement is expected."), false, "conditional plans must remain conditional");

const headlineMixStart = worker.indexOf("function hasUnsupportedNewsHeadlineMix(");
const headlineMixEnd = worker.indexOf("\n}\n", headlineMixStart);
assert.ok(headlineMixStart >= 0 && headlineMixEnd > headlineMixStart, "headline-mix guard must exist");
const hasUnsupportedNewsHeadlineMix = new Function("cleanText", worker.slice(headlineMixStart, headlineMixEnd + 3) + "\nreturn hasUnsupportedNewsHeadlineMix;")(value => String(value || "").replace(/\s+/g, " ").trim());
assert.equal(hasUnsupportedNewsHeadlineMix("रोनाल्डो संन्यास लेते हैं; चांदनी चौक में इमारत गिरी", "चांदनी चौक में निर्माणाधीन इमारत गिरी"), true, "a foreign sports headline must not be joined to an India story");
assert.equal(hasUnsupportedNewsHeadlineMix("चांदनी चौक में इमारत गिरी", "चांदनी चौक में निर्माणाधीन इमारत गिरी"), false, "a single source-grounded India headline must pass");
const aqiGuardStart = worker.indexOf("function hasIncorrectOverallAqiCategory(");
const aqiGuardEnd = worker.indexOf("\n}\n", aqiGuardStart);
assert.ok(aqiGuardStart >= 0 && aqiGuardEnd > aqiGuardStart, "AQI category guard must exist");
const hasIncorrectOverallAqiCategory = new Function(worker.slice(aqiGuardStart, aqiGuardEnd + 3) + "\nreturn hasIncorrectOverallAqiCategory;")();
assert.equal(hasIncorrectOverallAqiCategory("दिल्ली का AQI 370 गंभीर श्रेणी में है।"), true, "AQI 370 must not be labelled severe");
assert.equal(hasIncorrectOverallAqiCategory("दिल्ली का AQI 370 है; 10 स्टेशन गंभीर श्रेणी में हैं।"), false, "severe readings at individual stations must not be confused with the city-wide AQI");



const indiaFilterStart = worker.indexOf("function isIndiaFocusedNewsItem(item) {");
const indiaFilterEnd = worker.indexOf("\n}\n", indiaFilterStart);
assert.ok(indiaFilterStart >= 0 && indiaFilterEnd > indiaFilterStart, "India-focused news filter must exist");
const isIndiaFocusedNewsItem = new Function(
  "cleanText",
  worker.slice(indiaFilterStart, indiaFilterEnd + 3) + "\nreturn isIndiaFocusedNewsItem;"
)(value => String(value || "").replace(/\s+/g, " ").trim());
const categoryClassifierStart = worker.indexOf("function classifyRequestedNewsCategory(item) {");
const categoryClassifierEnd = worker.indexOf("\n}\n", categoryClassifierStart);
assert.ok(categoryClassifierStart >= 0 && categoryClassifierEnd > categoryClassifierStart, "news category classifier must exist");
const classifyRequestedNewsCategory = new Function(
  "cleanText",
  worker.slice(categoryClassifierStart, categoryClassifierEnd + 3) + "\nreturn classifyRequestedNewsCategory;"
)(value => String(value || "").replace(/\s+/g, " ").trim());
const newsFormatterStart = worker.indexOf("function formatCurrentNewsSummaryReply(rawReply, results, requireTwoSentences = false, requireFiveCategories = false, allowGlobalNews = false) {");
const newsFormatterEnd = worker.indexOf("\n}\n", newsFormatterStart);
assert.ok(newsFormatterStart >= 0 && newsFormatterEnd > newsFormatterStart, "daily-news formatter must exist");
const untranslatedHeadlineStart = worker.indexOf("function hasUntranslatedEnglishHeadline(text, sourceEvidence = \"\") {");
const untranslatedHeadlineEnd = worker.indexOf("\n}\n", untranslatedHeadlineStart);
assert.ok(untranslatedHeadlineStart >= 0 && untranslatedHeadlineEnd > untranslatedHeadlineStart, "untranslated English headline guard must exist");
const hasUntranslatedEnglishHeadline = new Function(worker.slice(untranslatedHeadlineStart, untranslatedHeadlineEnd + 3) + "\nreturn hasUntranslatedEnglishHeadline;")();
assert.equal(hasUntranslatedEnglishHeadline("Visa must for undocumented six communities"), true, "English headline words must be rejected");
assert.equal(hasUntranslatedEnglishHeadline("छह समुदायों के लिए वीज़ा अनिवार्य"), false, "Hindi headline must pass");
assert.equal(hasUntranslatedEnglishHeadline("CSIR-NEERI की प्रयोगशाला में जाँच"), false, "recognized institutional acronyms may remain in Latin script");
assert.equal(hasUntranslatedEnglishHeadline("सुप्रीम कोर्ट ने Azam Khan की जमानत याचिका पर विचार किया।", "Supreme Court considers Azam Khan bail plea"), false, "source-grounded proper names may remain in Latin script in Hindi headlines");
assert.equal(hasUntranslatedEnglishHeadline("सुप्रीम कोर्ट ने Azam Khan की याचिका सुनी।", "Supreme Court considers a plea"), true, "ungrounded Latin-script names must be rejected");

const knownFactGuardStart = worker.indexOf("function hasKnownContradictedNewsFact(text) {");
const knownFactGuardEnd = worker.indexOf("\n}\n", knownFactGuardStart);
assert.ok(knownFactGuardStart >= 0 && knownFactGuardEnd > knownFactGuardStart, "known-fact contradiction guard must exist");
const hasKnownContradictedNewsFact = new Function(
  "cleanText",
  worker.slice(knownFactGuardStart, knownFactGuardEnd + 3) + "\nreturn hasKnownContradictedNewsFact;"
)(value => String(value || "").replace(/\s+/g, " ").trim());
const newsCountStart = worker.indexOf("function formatHindiNewsCount(");
const newsCountEnd = worker.indexOf("\nfunction formatCurrentNewsSummaryReply", newsCountStart);
assert.ok(newsCountStart >= 0 && newsCountEnd > newsCountStart, "Hindi news count and note helpers must exist");
const newsFormatHelpers = new Function(worker.slice(newsCountStart, newsCountEnd) + "\nreturn { formatHindiNewsCount, buildNewsDigestNote };")();

const formatCurrentNewsSummaryReply = new Function(
  "formatHindiNewsCount", "buildNewsDigestNote",
  "dedupeNewsResults", "cleanText", "formatNewsPublishedAt",
  "hasMixedScriptToken", "hasUnsupportedNumericClaim", "hasUnsupportedCertaintyClaim",
  "hasUnsupportedNewsHeadlineMix", "hasUntranslatedEnglishHeadline", "hasIncorrectOverallAqiCategory", "isIndiaFocusedNewsItem", "hasKnownContradictedNewsFact", "hasUnsupportedCourtDisposition",
  "classifyRequestedNewsCategory", "getIndiaDayStartTimestamp",
  worker.slice(newsFormatterStart, newsFormatterEnd + 3) + "\nreturn formatCurrentNewsSummaryReply;"
)(
  newsFormatHelpers.formatHindiNewsCount,
  newsFormatHelpers.buildNewsDigestNote,
  results => results,
  value => String(value || "").replace(/\s+/g, " ").trim(),
  () => "05 नवंबर 2026 (भारतीय समय)",
  () => false,
  () => false,
  hasUnsupportedCertaintyClaim,
  new Function("cleanText", worker.slice(worker.indexOf("function hasUnsupportedNewsHeadlineMix("), worker.indexOf("\n}\n", worker.indexOf("function hasUnsupportedNewsHeadlineMix(")) + 3) + "\nreturn hasUnsupportedNewsHeadlineMix;")(value => String(value || "").replace(/\s+/g, " ").trim()),
  new Function(worker.slice(worker.indexOf("function hasUntranslatedEnglishHeadline("), worker.indexOf("\n}\n", worker.indexOf("function hasUntranslatedEnglishHeadline(")) + 3) + "\nreturn hasUntranslatedEnglishHeadline;")(),
  new Function(worker.slice(worker.indexOf("function hasIncorrectOverallAqiCategory("), worker.indexOf("\n}\n", worker.indexOf("function hasIncorrectOverallAqiCategory(")) + 3) + "\nreturn hasIncorrectOverallAqiCategory;")(),
  isIndiaFocusedNewsItem,
  hasKnownContradictedNewsFact,
  () => false,
  classifyRequestedNewsCategory,
  getIndiaDayStartTimestamp
);
const groupNewsStart = worker.indexOf("function groupNewsByEvent(results) {");
const groupNewsEnd = worker.indexOf("\n}\n", groupNewsStart);
assert.ok(groupNewsStart >= 0 && groupNewsEnd > groupNewsStart, "cross-publisher news event grouping must exist");
const groupNewsByEvent = new Function(
  "cleanText", "isSameIndianMarketEvent", "isSameIndianNewsEvent",
  worker.slice(groupNewsStart, groupNewsEnd + 3) + "\nreturn groupNewsByEvent;"
)(
  value => String(value || "").replace(/\\s+/g, " ").trim(),
  () => false,
  () => false
);
const sameCourtEvent = groupNewsByEvent([
  {
    title: "Tamil Nadu seeks urgent oral mentioning in Supreme Court over Cauvery water issue",
    url: "https://www.thehindu.com/news/cauvery-water-case",
    publisher: "The Hindu",
    snippet: "Tamil Nadu asks the Supreme Court to hear the Cauvery water dispute."
  },
  {
    title: "Cauvery water release: Tamil Nadu moves Supreme Court against Karnataka",
    url: "https://indianexpress.com/article/cauvery-water-release-tamil-nadu-supreme-court/",
    publisher: "The Indian Express",
    snippet: "The state seeks urgent hearing over the Cauvery water release."
  }
]);
assert.equal(sameCourtEvent.length, 1, "same event with different publisher headline wording should be grouped");
assert.equal(sameCourtEvent[0].corroboratingSources.length, 1, "second publisher report should be retained as corroborating evidence");
assert.equal(sameCourtEvent[0].corroboratingSources[0].publisher, "The Indian Express", "corroborating publisher metadata must be preserved");
const unrelatedCourtEvents = groupNewsByEvent([
  { title: "Supreme Court hears Cauvery water dispute in Tamil Nadu", url: "https://a.example/cauvery", publisher: "A" },
  { title: "Supreme Court grants bail in Tamil Nadu election case", url: "https://b.example/election", publisher: "B" }
]);
assert.equal(unrelatedCourtEvents.length, 2, "different court events must not be grouped based only on generic court/state words");
const samePublisherCopies = groupNewsByEvent([
  { title: "Cauvery water dispute reaches Supreme Court in Tamil Nadu", url: "https://thehindu.com/cauvery-one", publisher: "The Hindu" },
  { title: "Tamil Nadu moves Supreme Court over Cauvery water dispute", url: "https://thehindu.com/cauvery-two", publisher: "The Hindu" }
]);
assert.equal(samePublisherCopies.length, 1, "same-publisher updates must not count as independent corroboration");
assert.equal(samePublisherCopies[0].corroboratingSources.length, 0, "same-publisher copies must not appear as independent corroborators");

const fiveNewsCategories = ["सरकार", "अर्थव्यवस्था", "अदालत", "विज्ञान", "खेल"];
const fiveNewsSources = Array.from({ length: 5 }, (_, index) => ({
  requestedCategory: fiveNewsCategories[index],
  title: [
    "भारत सरकार की अलग समाचार घटना",
    "भारत की अर्थव्यवस्था की अलग समाचार घटना",
    "भारत के सुप्रीम कोर्ट की अलग समाचार घटना",
    "भारत के वैज्ञानिकों की अलग समाचार घटना",
    "भारत के खेल की अलग समाचार घटना"
  ][index],
  url: "https://publisher" + (index + 1) + ".example/news-" + (index + 1),
  publishedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  snippet: "आज की अलग घटना का विवरण उपलब्ध है।"
}));
const fiveNewsDraft = fiveNewsSources.map((_, index) =>
  "खबर " + (index + 1) + ": अलग समाचार घटना " + (index + 1) +
  "\nसार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।"
).join("\n");
const completeFiveNewsReply = formatCurrentNewsSummaryReply(fiveNewsDraft, fiveNewsSources, true, true);
const normalizeNewsSummaryRepairText = new Function(
  "cleanText",
  worker.slice(worker.indexOf("function normalizeNewsSummaryRepairText("), worker.indexOf("\n}\n", worker.indexOf("function normalizeNewsSummaryRepairText(")) + 3) + "\nreturn normalizeNewsSummaryRepairText;"
)(value => String(value || "").replace(/\\s+/g, " ").trim());
const wrappedJsonNews = normalizeNewsSummaryRepairText(JSON.stringify({
  data: { stories: fiveNewsSources.map((source, index) => ({
    number: index + 1, category: fiveNewsCategories[index],
    title: "अलग समाचार घटना " + (index + 1),
    summary: ["यह पहली पुष्ट जानकारी है।", "यह दूसरी पुष्ट जानकारी है।"]
  })) }
}));
assert.equal([...formatCurrentNewsSummaryReply(wrappedJsonNews, fiveNewsSources, true, true).matchAll(/खबर [1-5](?: \([^)]*\))?:/g)].length, 5, "nested JSON envelopes and sentence-array summaries must normalize into all five checked stories");
const wrappedJsonHindiDigits = normalizeNewsSummaryRepairText(JSON.stringify({
  stories: fiveNewsSources.map((source, index) => ({
    number: "०१२३४५"[index + 1], category: fiveNewsCategories[index],
    headline: "अलग समाचार घटना " + (index + 1),
    summary: "यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।"
  }))
}));
assert.equal([...formatCurrentNewsSummaryReply(wrappedJsonHindiDigits, fiveNewsSources, true, true).matchAll(/खबर [1-5](?: \([^)]*\))?:/g)].length, 5, "Hindi Devanagari story numbers must normalize and preserve all five checked stories");
assert.match(worker, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/, "compact news requests must enable Groq JSON mode");
assert.match(completeFiveNewsReply, /आज की 5 अलग-अलग, तारीख़-जाँची खबरें:/, "five-category request must return all five stories only when all five summaries pass");

const olympicsNewsSource = {
  requestedCategory: "खेल",
  title: "Indian athletes: IndianOil launches scholarship for Olympic and Asian Games",
  url: "https://sport.example/scholarship",
  publishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  snippet: "Indian athletes prepare for the 2028 Olympics and 2026 Asian Games."
};
const wrongOlympicsCityReply = formatCurrentNewsSummaryReply(
  "खबर 1 (खेल): खिलाड़ियों को ओलंपिक छात्रवृत्ति\nसार: यह योजना 2028 एथेंस ओलंपिक के खिलाड़ियों को सहायता देगी। खिलाड़ियों को प्रशिक्षण सहायता मिलेगी।",
  [olympicsNewsSource], true, true
);
assert.doesNotMatch(wrongOlympicsCityReply, /एथेंस|Athens/i,
  "a sports summary must be rejected if it invents Athens as the 2028 Olympic host city");



assert.equal(hasKnownContradictedNewsFact("यह योजना 2028 एथेंस ओलंपिक के खिलाड़ियों को सहायता देगी।"), true,
  "a false claim that the 2028 Olympics are in Athens must be rejected");
assert.equal(hasKnownContradictedNewsFact("यह योजना 2028 लॉस एंजिल्स ओलंपिक के खिलाड़ियों को सहायता देगी।"), false,
  "the correct 2028 Olympic host city must not be rejected");
assert.equal(hasKnownContradictedNewsFact("खिलाड़ियों को 2028 ओलंपिक की तैयारी में सहायता मिलेगी।"), false,
  "a summary that does not name a host city must remain acceptable");
const splitHeadlineDraft = fiveNewsDraft.replace(/खबर ([1-5]): (.+)\\nसार:/g, "खबर $1\\nशीर्षक: $2\\nसार:");
const splitHeadlineReply = formatCurrentNewsSummaryReply(splitHeadlineDraft, fiveNewsSources, true, true);
assert.match(splitHeadlineReply, /आज की 5 अलग-अलग, तारीख़-जाँची खबरें:/, "parser must accept category models that put the headline on a separate line");
const fiveNewsSourcesWithoutTransientTags = fiveNewsSources.map(({ requestedCategory, ...item }) => item);
const recoveredCategoryReply = formatCurrentNewsSummaryReply(
  fiveNewsDraft,
  fiveNewsSourcesWithoutTransientTags,
  true,
  true
);
assert.match(recoveredCategoryReply, /आज की 5 अलग-अलग, तारीख़-जाँची खबरें:/, "final validation must re-derive missing category tags from the article title and snippet");
const incompleteFiveCategoryReply = formatCurrentNewsSummaryReply(fiveNewsDraft.replace("खबर 5:", "खबर 4:"), fiveNewsSources, true, true);
assert.match(incompleteFiveCategoryReply, /आज 4 अलग-अलग, तारीख़-जाँची खबरें मिलीं/, "five-category request must retain the four individually verified stories when one generated entry is missing");
assert.match(incompleteFiveCategoryReply, /इन श्रेणियों की खबर स्रोत-जाँच में सफल नहीं हुई: खेल/, "partial five-category output must name the category whose story failed validation");
assert.equal([...incompleteFiveCategoryReply.matchAll(/खबर [1-5]/g)].length, 4, "an incomplete five-category response must never be padded with an unverified fifth story");
const staleCourtNewsSources = fiveNewsSources.map((item, index) => index === 2
  ? { ...item, publishedAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString() }
  : item);
const staleCourtNewsReply = formatCurrentNewsSummaryReply(fiveNewsDraft, staleCourtNewsSources, true, true);
assert.match(staleCourtNewsReply, /आज 4 अलग-अलग, तारीख़-जाँची खबरें मिलीं/, "five-category request must retain the four eligible stories when the court source is older than 48 hours");
assert.match(staleCourtNewsReply, /इन श्रेणियों की खबर स्रोत-जाँच में सफल नहीं हुई: अदालत/, "five-category request must explicitly disclose that the stale court story is unavailable");
assert.doesNotMatch(staleCourtNewsReply, /खबर \\d+ \\(अदालत\\):/, "a court story older than the requested 48-hour window must never be displayed");
assert.deepEqual([...completeFiveNewsReply.matchAll(/खबर (\d+)(?: \([^)]*\))?:/g)].map(match => Number(match[1])), [1, 2, 3, 4, 5], "daily-news numbering must always be continuous from 1 through 5");
const fiveCategoryDetectorStart = worker.indexOf("function isFiveCategoryNewsQuery(text) {");
const fiveCategoryDetectorEnd = worker.indexOf("\n}\n", fiveCategoryDetectorStart);
assert.ok(fiveCategoryDetectorStart >= 0 && fiveCategoryDetectorEnd > fiveCategoryDetectorStart, "five-category news detector must exist");
const isFiveCategoryNewsQuery = new Function(
  "isCurrentNewsQuery",
  worker.slice(fiveCategoryDetectorStart, fiveCategoryDetectorEnd + 3) + "\nreturn isFiveCategoryNewsQuery;"
)(value => /आज.{0,60}(?:खबर|समाचार)/i.test(String(value || "")));
assert.equal(isFiveCategoryNewsQuery("आज भारत की पाँच ताज़ा और महत्वपूर्ण खबरें बताओ। सरकार, अर्थव्यवस्था, अदालत, विज्ञान और खेल से एक-एक अलग खबर शामिल करो।"), true, "natural five-category wording with freshness adjectives must activate the all-five rule");
const mixedMetadataDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है। मूल स्रोत: fake.example; सीधा लिंक: https://fake.example/story"
);
const mixedMetadataReply = formatCurrentNewsSummaryReply(mixedMetadataDraft, fiveNewsSources, true, true);
assert.doesNotMatch(mixedMetadataReply, /fake\.example|https:\/\/fake\.example/, "model-generated source metadata must never be shown; only matched search-result metadata is trusted");
const partialFourNewsReply = formatCurrentNewsSummaryReply(fiveNewsDraft, fiveNewsSources.slice(0, 4), true);
assert.match(partialFourNewsReply, /आज 4 अलग-अलग, तारीख़-जाँची खबरें मिलीं:/, "four verified stories should be shown with an explicit shortfall notice");
assert.doesNotMatch(partialFourNewsReply, /आपने 5 माँगी थीं/, "generic shortfall wording must not assume a five-story request");
assert.equal([...partialFourNewsReply.matchAll(/खबर (\d+)(?: \([^)]*\))?:/g)].length, 4, "only four available validated stories should be displayed");
const incompleteFiveNewsDraft = fiveNewsDraft.replace("सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।", "सार: ");
const incompleteFiveNewsReply = formatCurrentNewsSummaryReply(incompleteFiveNewsDraft, fiveNewsSources, true);
assert.equal([...incompleteFiveNewsReply.matchAll(/खबर (\d+)(?: \([^)]*\))?:/g)].length, 4, "a story without a valid summary must be omitted while other verified stories remain");
const initialsNewsDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: ISRO के अध्यक्ष वी. नारायणन ने बताया। उपग्रह पूरी तरह स्वस्थ है।"
);
const initialsNewsReply = formatCurrentNewsSummaryReply(initialsNewsDraft, fiveNewsSources, true);
assert.equal([...initialsNewsReply.matchAll(/खबर (\d+)(?: \([^)]*\))?:/g)].length, 5, "initials such as V. must not be counted as extra sentence endings");

const oneSentenceNewsDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: यह केवल एक वाक्य का सार है।"
);
const oneSentenceNewsReply = formatCurrentNewsSummaryReply(oneSentenceNewsDraft, fiveNewsSources, true);
assert.equal([...oneSentenceNewsReply.matchAll(/खबर (\d+)(?: \([^)]*\))?:/g)].length, 4, "a one-sentence item must be omitted without discarding other valid summaries");

const boilerplateNewsDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: उपलब्ध स्रोत-अंश इस कारण की पुष्टि नहीं करता; इसलिए कारण के बारे में निष्कर्ष नहीं निकाला जा सकता।"
);
assert.equal([...formatCurrentNewsSummaryReply(boilerplateNewsDraft, fiveNewsSources, false).matchAll(/खबर \d+(?: \([^)]*\))?:/g)].length, 4, "a generic disclaimer must be omitted while other validated stories remain");

const unsupportedCauseDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: प्रदूषण निर्माण कार्यों के कारण बढ़ा। यह दूसरी पुष्ट जानकारी है।"
);
assert.equal([...formatCurrentNewsSummaryReply(unsupportedCauseDraft, fiveNewsSources, true).matchAll(/खबर \d+(?: \([^)]*\))?:/g)].length, 4, "an unsupported causal explanation must reject only that story");

const tentativeSources = fiveNewsSources.map(item => ({ ...item }));
tentativeSources[0] = {
  ...tentativeSources[0],
  title: "Delhi government considers artificial rain after Diwali",
  snippet: "The government is considering cloud seeding after Diwali; no official announcement is expected before Diwali."
};
const tentativeDraft = fiveNewsDraft.replace(
  "खबर 1: अलग समाचार घटना 1",
  "खबर 1: दिल्ली सरकार ने कृत्रिम बारिश कराने का निर्णय लिया"
);
assert.equal([...formatCurrentNewsSummaryReply(tentativeDraft, tentativeSources, true).matchAll(/खबर \d+(?: \([^)]*\))?:/g)].length, 4, "a tentative source must be omitted without discarding other valid stories");
const preservedTentativeDraft = fiveNewsDraft.replace(
  "खबर 1: अलग समाचार घटना 1",
  "खबर 1: दिल्ली सरकार कृत्रिम बारिश कराने पर विचार कर रही है"
);
assert.match(formatCurrentNewsSummaryReply(preservedTentativeDraft, tentativeSources, true), /खबर 1(?: \([^)]*\))?: दिल्ली सरकार कृत्रिम बारिश कराने पर विचार कर रही है/, "a summary that preserves tentative status should pass");

const unsupportedGeopoliticsDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: पश्चिम एशिया में संघर्ष के समाधान की उम्मीद से बाजार में तेजी आई। यह दूसरी पुष्ट जानकारी है।"
);
assert.equal([...formatCurrentNewsSummaryReply(unsupportedGeopoliticsDraft, fiveNewsSources, true).matchAll(/खबर \d+(?: \([^)]*\))?:/g)].length, 4, "an unsupported geopolitical claim must reject only its own story");

const midtermDraft = fiveNewsDraft.replace(
  "सार: यह पहली पुष्ट जानकारी है। यह दूसरी पुष्ट जानकारी है।",
  "सार: अमेरिकी मध्यमार्गीय चुनावों के बाद बाजार में तेजी आई। यह दूसरी पुष्ट जानकारी है।"
);
assert.match(formatCurrentNewsSummaryReply(midtermDraft, fiveNewsSources, true), /अमेरिकी मध्यावधि चुनाव/, "midterm elections must use the correct Hindi translation");




const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], [], "HTML must not contain duplicate IDs");

const requiredIds = [
  "sidebar", "newChatBtn", "historyList", "settingsBtn", "menuBtn",
  "topNewBtn", "moreBtn", "moreMenu", "chatArea", "welcome", "messages",
  "status", "voicePanel", "voiceTitle", "voiceHint", "voiceStop",
  "voiceWave", "voiceActiveNote", "webToggle", "chatForm", "attachBtn",
  "messageInput", "micBtn", "sendBtn", "fileInput", "attachmentPreview",
  "settingsDialog", "workerUrl", "assistantName", "findDialog", "findInput",
  "findNext", "findResult"
];
for (const id of requiredIds) {
  assert.ok(ids.includes(id), "Required interface element missing: #" + id);
}

assert.ok(html.includes('accept="image/*,.pdf,.txt,.docx,.csv,.md,.json"'), "attachment picker must expose photos and supported document formats without video");
assert.ok(html.indexOf('id="attachmentPreview"') < html.indexOf('id="messageInput"'), "attachment tray must appear inside the composer above the message input");
assert.ok(app.includes('preview.classList.toggle("hidden", !hasAttachments)'), "attachment preview must remove the hidden class when files are selected");
assert.ok(app.includes("attachment-thumbnail"), "selected photos must show a local thumbnail");
assert.ok(app.includes("URL.revokeObjectURL(objectUrl)"), "removed photo previews must release local object URLs");
assert.doesNotMatch(html, /वीडियो|video\//i, "attachment picker must not expose video");
assert.ok(html.includes("PDF, DOCX, TXT, CSV, MD और JSON"), "attachment instructions must list every supported document format");

const scriptFiles = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(src => !/^(https?:)?\/\//i.test(src));
for (const src of scriptFiles) {
  assert.ok(!src.includes(".."), "Local script must stay inside the site root: " + src);
  await readFile(new URL(src, root), "utf8");
}
const sourceHelperStart = app.indexOf("function shouldShowSearchSources(data) {");
const sourceHelperEnd = app.indexOf("\n}\n", sourceHelperStart);
assert.ok(sourceHelperStart >= 0 && sourceHelperEnd > sourceHelperStart, "automatic-search source visibility helper must exist");
const shouldShowSearchSources = new Function(
  "safeSourceUrl",
  app.slice(sourceHelperStart, sourceHelperEnd + 3) + "\nreturn shouldShowSearchSources;"
)(value => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
});
assert.equal(shouldShowSearchSources({ searchAttempted: true, sources: [{ title: "Official notice", url: "https://example.gov.in/notice" }] }), true, "sources from automatic Worker search must be shown even when the web toggle is off");
assert.equal(shouldShowSearchSources({ searchAttempted: false, sources: [{ title: "Unrequested", url: "https://example.com" }] }), false, "sources must not be shown when the Worker did not search");
assert.equal(shouldShowSearchSources({ searchAttempted: true, sources: [] }), false, "empty search results must not create an empty source list");
assert.equal(shouldShowSearchSources({ searchAttempted: true, reply: "खबर 1: भारत की खबर\\nप्रकाशक: example.com\\nमूल लिंक:", sources: [{ title: "India news", url: "https://example.com/india" }] }), true, "show source cards if inline news links are missing");
assert.equal(shouldShowSearchSources({ searchAttempted: true, reply: "खबर 1: भारत की खबर\\nप्रकाशक: example.com\\nप्रकाशित: आज\\nमूल लिंक: https://example.com/india", sources: [{ title: "India news", url: "https://example.com/india" }] }), false, "avoid duplicate source cards when inline news links are present");
const escapeStart = app.indexOf("function escapeHTML(value) {");
const escapeEnd = app.indexOf("\n}\n", escapeStart);
const safeUrlStart = app.indexOf("function safeSourceUrl(value) {");
const safeUrlEnd = app.indexOf("\n}\n", safeUrlStart);
const inlineStart = app.indexOf("function formatInline(text) {");
const inlineEnd = app.indexOf("\n}\n", inlineStart);
assert.ok(escapeStart >= 0 && safeUrlStart >= 0 && inlineStart >= 0, "safe link formatting helpers must exist");
const formatInline = new Function(
  app.slice(escapeStart, escapeEnd + 3) +
  app.slice(safeUrlStart, safeUrlEnd + 3) +
  app.slice(inlineStart, inlineEnd + 3) +
  "\nreturn formatInline;"
)();
const renderedArticleLink = formatInline("मूल लिंक: https://example.com/article?x=1।");
assert.match(renderedArticleLink, /<a href="https:\/\/example\.com\/article\?x=1"/, "plain HTTPS news URLs must become clickable links");
assert.match(renderedArticleLink, /noopener noreferrer/, "external article links must use safe target attributes");
assert.match(renderedArticleLink, /<\/a>।$/, "Hindi sentence punctuation must remain outside the clickable URL");
assert.doesNotMatch(formatInline("लिंक: javascript:alert(1)"), /<a\s/i, "unsafe non-HTTPS URLs must never become links");
const warningHelperStart = app.indexOf("function shouldShowSearchWarning(data) {");
const warningHelperEnd = app.indexOf("\n}\n", warningHelperStart);
assert.ok(warningHelperStart >= 0 && warningHelperEnd > warningHelperStart, "search warning visibility helper must exist");
const shouldShowSearchWarning = new Function(app.slice(warningHelperStart, warningHelperEnd + 3) + "\nreturn shouldShowSearchWarning;")();
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "Exa से वास्तविक वेब परिणाम मिले।", sources: [{ title: "Verified", url: "https://example.com" }] }), false, "successful search must not show a warning");
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "Exa service unavailable", searchUnavailable: true, sources: [] }), true, "unavailable search must show its warning");
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "AI provider busy", providerBusy: true, sources: [{ title: "Real result", url: "https://example.com" }] }), true, "provider fallback must explain that a generated summary was unavailable");
assert.equal(shouldShowSearchWarning({ searchAttempted: true, searchWarning: "No fresh articles", sources: [] }), true, "rejected or empty search results must explain why no sources are shown");
assert.equal(shouldShowSearchWarning({ searchAttempted: false, searchWarning: "No search attempted", sources: [] }), false, "non-search replies must not show search warnings");
const safeSourceStart = app.indexOf("function safeSourceUrl(value) {");
const safeSourceEnd = app.indexOf("\n}\n", safeSourceStart);
assert.ok(safeSourceStart >= 0 && safeSourceEnd > safeSourceStart, "safe source URL helper must exist");
const safeSourceUrl = new Function("URL", app.slice(safeSourceStart, safeSourceEnd + 3) + "\nreturn safeSourceUrl;")(URL);
assert.equal(safeSourceUrl("https://example.com/article#section"), "https://example.com/article", "HTTPS links should be normalized");
assert.equal(safeSourceUrl("http://example.com/article"), "", "HTTP links must be rejected");
assert.equal(safeSourceUrl(["java", "script:"].join("") + "alert(1)"), "", "non-web protocols must be rejected");
assert.equal(safeSourceUrl("https://user:pass@example.com/"), "", "URLs containing credentials must be rejected");
assert.equal(safeSourceUrl("not a URL"), "", "malformed source URLs must be rejected");
assert.equal(safeSourceUrl("https://thehindu.com/news/article-xxxxxx"), "", "placeholder article IDs must be rejected");
assert.equal(safeSourceUrl("https://example.com/placeholder/story"), "", "placeholder path segments must be rejected");
assert.equal(safeSourceUrl("https://example.com/real-article-2026"), "https://example.com/real-article-2026", "realistic article paths must remain valid");
const sanitizerStart = app.indexOf("function sanitizeSourceRecords(sources, limit = 8) {");
const sanitizerEnd = app.indexOf("\n}\n", sanitizerStart);
assert.ok(sanitizerStart >= 0 && sanitizerEnd > sanitizerStart, "source record sanitizer must exist");
const sanitizeSourceRecords = new Function("URL", app.slice(safeSourceStart, sanitizerEnd + 3) + "\nreturn sanitizeSourceRecords;")(URL);
const safeRecords = sanitizeSourceRecords([
  { title: "First", url: "https://example.com/story#top" },
  { title: "Duplicate", url: "https://example.com/story" },
  { title: "Insecure", url: "http://example.org/story" },
  { title: "", url: "https://example.net/story" },
  null
]);
assert.equal(safeRecords.length, 1, "only unique titled HTTPS sources should remain");
assert.equal(safeRecords[0].url, "https://example.com/story");

assert.ok(app.includes("shouldShowSearchSources(data) ? filterSourcesForPrompt"), "assistant messages must display sources returned by automatic search");
assert.ok(app.includes("if (shouldShowSearchWarning(data))"), "only meaningful search failures must be surfaced in status");
const providerBusyStart = app.indexOf('if ((data.providerBusy === true || data.newsSummaryUnverified === true) &&');
const providerBusyEnd = app.indexOf('    // Recover a known truncated news-fallback prefix', providerBusyStart);
assert.ok(providerBusyStart >= 0 && providerBusyEnd > providerBusyStart, "provider-busy news fallback must exist");
const providerBusyFallback = app.slice(providerBusyStart, providerBusyEnd);
assert.match(providerBusyFallback, /आसान हिंदी शीर्षक और दो-वाक्यीय सार सत्यापित नहीं हो पाए/, "provider-busy fallback must clearly say the Hindi digest is unavailable");
assert.doesNotMatch(providerBusyFallback, /source\.title/, "provider-busy fallback must not expose raw English headlines");
assert.match(providerBusyFallback, /title: "मूल समाचार खोलें/, "provider-busy source links must use a Hindi label");
assert.match(app, /data\.providerBusy !== true && data\.newsSummaryUnverified !== true && isCurrentNewsPrompt && !hasUsableInlineNewsUrl/, "unverified-news fallback must not append duplicate inline source links");


const scriptPaths = scriptFiles.map(src => src.split("?")[0]);
assert.ok(scriptPaths.indexOf("app.js") >= 0, "Main app script must be loaded");
assert.ok(scriptPaths.indexOf("voice.js") > scriptPaths.indexOf("app.js"), "Voice integration must load after app.js");
assert.match(html, /data-voice-action=["']start["']/, "Welcome voice action must be present");
assert.match(app, /data-voice-action/, "Main app must wire the welcome voice action");
assert.match(voice, /window\.SarathiVoice\.start = start/, "Voice start API must be exposed");
assert.ok(voice.includes("let activeBrowserUtterance = null;"), "browser TTS must track the active utterance");
assert.ok(voice.includes("if (activeBrowserUtterance !== utterance) return;"), "stale browser TTS callbacks must not restart microphone during a newer reply");
assert.ok(voice.indexOf("activeBrowserUtterance = null;") < voice.indexOf("if (window.speechSynthesis) window.speechSynthesis.cancel();"), "stopping voice must invalidate pending browser TTS callbacks before cancellation");

for (const selector of [".message-content", ".message-body", ".composer", ".send-btn", ".mic-btn", ".bottom-nav"]) {
  assert.ok(css.includes(selector), "Required layout styling missing: " + selector);
}

const quizParserStart = app.indexOf("function parseSarathiQuiz(raw) {");
const quizParserEnd = app.indexOf("\n}\n", quizParserStart);
assert.ok(quizParserStart >= 0 && quizParserEnd > quizParserStart, "MCQ parser must exist");
const parseSarathiQuiz = new Function(app.slice(quizParserStart, quizParserEnd + 3) + "\nreturn parseSarathiQuiz;")();
const validQuiz = {
  title: "अभ्यास",
  questions: Array.from({ length: 3 }, (_, i) => ({
    question: "प्रश्न " + (i + 1),
    options: ["विकल्प A", "विकल्प B", "विकल्प C", "विकल्प D"],
    answer: 1,
    explanation: "कारण"
  }))
};
assert.equal(parseSarathiQuiz(JSON.stringify(validQuiz)).questions.length, 3, "valid four-option MCQ questions should parse");
assert.equal(parseSarathiQuiz("not JSON"), null, "invalid MCQ JSON must be rejected");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.slice(0, 2) })), null, "too few MCQ questions must be rejected");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.map((q, i) => i ? q : { ...q, answer: null }) })), null, "null answer must not be treated as option A");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.map((q, i) => i ? q : { ...q, options: ["A", "", "C", "D"] }) })), null, "empty MCQ options must be rejected");
assert.equal(parseSarathiQuiz(JSON.stringify({ ...validQuiz, questions: validQuiz.questions.map((q, i) => i ? q : { ...q, answer: 4 }) })), null, "out-of-range MCQ answers must be rejected");

const studyActions = [...html.matchAll(/data-study="([^"]+)"/g)].map(match => match[1]);
assert.equal(studyActions.length, 14, "SARATHI LEARNING must expose all 14 study actions");
assert.equal(new Set(studyActions).size, 14, "SARATHI LEARNING action IDs must be unique");
const studySectionStart = app.indexOf("function runStudyAction(action) {");
const studySectionEnd = app.indexOf("function bindEvents()", studySectionStart);
assert.ok(studySectionStart >= 0 && studySectionEnd > studySectionStart, "study action handler and progress logic must exist");
const studySection = app.slice(studySectionStart, studySectionEnd);
for (const action of studyActions) {
  assert.ok(studySection.includes(action + ":"), "study action must have a task prompt: " + action);
}
assert.ok(studySection.includes('addEventListener("input", saveProfile)'), "study topic must autosave while typing");
assert.ok(studySection.includes('addEventListener("change", saveProfile)'), "study profile fields must save after editing");
assert.ok(studySection.includes('progress.lastDate !== today'), "study progress must prevent duplicate daily session counts");
assert.ok(studySection.includes('localStorage.removeItem(STUDY_PROGRESS_KEY)'), "study progress reset must clear the saved progress");
assert.ok(studySection.includes("पहले एक प्रश्न पूछो"), "flashcards must be delivered one question at a time");
assert.ok(studySection.includes("मेरा उत्तर आने पर सही उत्तर"), "flashcards must wait for the learner's response before revealing the answer");
assert.ok(studySection.includes("उपलब्ध आधिकारिक पेपर के स्रोत बताओ"), "old-paper help must point to available official sources");
assert.ok(studySection.includes("पेपर न मिले तो साफ कहो"), "old-paper help must not pretend an unavailable paper exists");
assert.ok(app.includes('submit.disabled = quiz.questions.some((_, i) => !Number.isInteger(chosen[i]))'), "MCQ test must require every answer before submission");
assert.ok(app.includes('quiz.score = quiz.questions.reduce'), "MCQ test must calculate a score from selected answers");
assert.ok(app.includes('quiz.submitted = true'), "MCQ test must lock answers after submission");



const sendMessageStart = app.indexOf("async function sendMessage(text) {");
const sendMessageEnd = app.indexOf("\n}\n", sendMessageStart);
assert.ok(sendMessageStart >= 0 && sendMessageEnd > sendMessageStart, "message sending flow must exist");
const sendMessageSource = app.slice(sendMessageStart, sendMessageEnd + 3);
assert.ok(sendMessageSource.includes("चुनी गई फाइलों से निकाला गया पाठ इंटरनेट के जरिए AI सेवा को भेजा जाएगा"), "selected file content must require explicit consent");
assert.ok(sendMessageSource.indexOf("चुनी गई फाइलों से निकाला गया पाठ इंटरनेट के जरिए AI सेवा को भेजा जाएगा") < sendMessageSource.indexOf("extractAttachmentsText(state.attachments)"), "file content must not be extracted before consent");
assert.ok(!sendMessageSource.includes("extractVideoFrames") && !sendMessageSource.includes("requestSarathiMediaUnderstanding"), "video analysis must remain removed");
assert.doesNotMatch(sendMessageSource, /requestSarathiImage|\/api\/media\/image/, "chat sending must not upload photos to image generation");
assert.ok(sendMessageSource.includes("asksForImageCreation") && sendMessageSource.includes("AI फोटो बनाना या एडिट करना अभी उपलब्ध नहीं है"), "image creation/edit requests must be answered locally as disabled");
assert.ok(sendMessageSource.indexOf("क्या भेजना है?") < sendMessageSource.indexOf("extractAttachmentsText(state.attachments)"), "document text must not be extracted for sending before consent");
const attachmentStart = app.indexOf("function addFiles(fileList) {");
const attachmentEnd = app.indexOf("\n}\n", attachmentStart);
assert.ok(attachmentStart >= 0 && attachmentEnd > attachmentStart, "attachment selection filter must exist");
const attachmentSource = app.slice(attachmentStart, attachmentEnd + 3);
for (const extension of ["pdf", "docx", "txt", "csv", "md", "json"]) {
  assert.ok(attachmentSource.includes(extension), "attachment picker must allow ." + extension);
}
assert.ok(attachmentSource.includes('file.name.toLowerCase().endsWith(".pdf")'), "PDF files with a missing or generic MIME type must still be selectable by extension");
assert.ok(attachmentSource.includes("/\\.(png|jpe?g|webp)$/i.test(file.name)"), "JPG/PNG/WEBP files with generic MIME types must still be selectable by extension");
assert.ok(attachmentSource.includes("20 * 1024 * 1024"), "attachment picker must enforce the 20 MB per-file limit");
assert.ok(attachmentSource.includes("const tooLarge = selected.filter"), "oversized files must be counted and explained");
assert.ok(attachmentSource.includes("const unsupported = selected.filter"), "unsupported files must be counted and explained");
assert.ok(attachmentSource.includes("const skippedByLimit = eligible.length - files.length"), "files beyond the five-file cap must be reported");
assert.ok(attachmentSource.includes("20 MB से बड़ी होने के कारण नहीं जोड़ी गईं"), "the user must be told when a file exceeds 20 MB");
assert.ok(attachmentSource.includes("अधिकतम 5 फाइलें"), "the user must be told when the attachment count limit is reached");

const extractorStart = app.indexOf("async function extractOneFile(file) {");
const extractorEnd = app.indexOf("\n}\n", extractorStart);
assert.ok(extractorStart >= 0 && extractorEnd > extractorStart, "file text extraction function must exist");
const extractorSource = app.slice(extractorStart, extractorEnd + 3);
assert.ok(app.includes("function limitExtractedFileText(value)"), "file extraction must explicitly mark per-file text truncation");
assert.ok(app.includes("delete window.__sarathiScriptPromises[src]"), "failed CDN script loads must be cleared so users can retry after network recovery");
assert.ok(app.includes("script.remove()"), "failed external library script elements must be removed before retry");
assert.ok(app.includes("PDF पढ़ने की लाइब्रेरी डाउनलोड नहीं हो सकी"), "PDF CDN failures must show a clear Hindi retry message");

assert.ok(app.includes("केवल शुरुआती 8,500 अक्षर पढ़े गए"), "users must be told when a single file is truncated");
assert.ok(app.includes("let limited = limitExtractedFileText(readablePages.join"), "PDF extraction must use the visible text truncation warning");
assert.ok(app.includes("इस PDF के कुल "), "PDFs over the page limit must disclose that later pages were not read");
assert.ok(app.includes("const pagesNeedingOcr = []"), "mixed PDFs must identify pages that need OCR even when other pages contain text");
assert.ok(app.includes('const pageTexts = Array(pageLimit).fill("")'), "mixed PDF text and OCR results must be stored by page number");
assert.ok(app.includes("pageTexts[pageNo - 1]"), "scanned PDF text must be restored to its original page position");
assert.ok(app.includes("const readablePages = pageTexts.filter(Boolean)"), "PDF output must preserve original page order while omitting unreadable pages");
assert.ok(app.includes("PDF पृष्ठ पढ़ने के लिए कैनवास उपलब्ध नहीं है।"), "PDF OCR must report unavailable canvas context instead of failing silently");
assert.ok(app.includes("पृष्ठों से पढ़ने योग्य टेक्स्ट नहीं मिला।"), "empty or unreadable PDFs must return a clear notice");

assert.ok(app.includes("pagesNeedingOcr.slice(0, ocrLimit)"), "OCR work on scanned PDF pages must remain bounded");
assert.ok(app.includes("स्कैन/चित्र वाले पृष्ठ OCR की सीमा"), "users must be told when scanned PDF pages were not OCR-processed");


assert.ok(app.includes("कुल 9,500 अक्षरों की सीमा"), "users must be told when combined attachment text is truncated");
assert.ok(app.includes("आगे की फाइलें इस संदेश में शामिल नहीं हुईं"), "users must be told when later attachments are skipped due to text limits");
assert.ok(app.includes("const combinedPrompt = prompt +"), "attachment content must be combined before the final request-length check");
assert.ok(app.includes("अनुरोध की कुल लंबाई सीमा के कारण कुछ सामग्री शामिल नहीं हुई"), "users must be told if the final prompt limit removes attachment content");


for (const extension of ["txt", "csv", "md", "json", "pdf", "docx"]) {
  assert.ok(extractorSource.includes(extension), "file text extraction must support ." + extension);
}
assert.ok(extractorSource.includes("/\\.(png|jpe?g|webp)$/i.test(name)"), "OCR must recognize image files by extension when MIME type is generic");
assert.ok(worker.includes('reply: "इस ऐप सारथी AI को manju manjeet ने बनाया है।"'), "creator questions must return the exact Sarathi maker attribution without asking the model");
assert.ok(worker.includes("asksWhoMadeSarathi"), "creator question intent must be handled deterministically before model fallback");
assert.ok(worker.includes("भरोसेमंद बहुभाषी सहायक"), "Sarathi must be configured as a multilingual assistant");
assert.ok(worker.includes("उर्दू, বাংলা, தமிழ், తెలుగు"), "language instructions must cover supported non-Hindi languages");
assert.ok(worker.includes("Roman Urdu"), "Roman-script language input must be identified by meaning, not assumed to be English");

assert.ok(worker.includes('zeroCostMode: true'), "disabled media APIs must clearly identify zero-cost mode");
assert.ok(worker.includes('"/api/media/image"') && worker.includes('"/api/media/understand"'), "media API routes must be explicit and auditable");
assert.ok(worker.includes("if (!env.EXA_API_KEY)"), "web search must report a missing configured Exa key rather than silently assuming search is available");


// Search APIs may omit publishedDate while the original publisher exposes it.
const dateExtractorStart = worker.indexOf("function extractNewsPublishedDateFromHtml(html, now = Date.now()) {");
const dateExtractorEnd = worker.indexOf("\n}\n", dateExtractorStart);
assert.ok(dateExtractorStart >= 0 && dateExtractorEnd > dateExtractorStart, "publisher publication-date extractor must exist");
const extractNewsPublishedDateFromHtml = new Function(worker.slice(dateExtractorStart, dateExtractorEnd + 3) + "\nreturn extractNewsPublishedDateFromHtml;")();
const htmlPublished = '<meta property="article:published_time" content="2026-11-09T01:08:00+05:30"><meta property="article:modified_time" content="2026-11-09T05:00:00+05:30">';
assert.equal(extractNewsPublishedDateFromHtml(htmlPublished, Date.parse("2026-11-09T05:38:00+05:30")), "2026-11-08T19:38:00.000Z", "published date must be recovered from original publisher metadata");
const htmlModifiedOnly = '<meta property="article:modified_time" content="2026-11-09T05:00:00+05:30">';
assert.equal(extractNewsPublishedDateFromHtml(htmlModifiedOnly, Date.parse("2026-11-09T05:38:00+05:30")), "", "modified date alone must not qualify an old article as newly published");
assert.match(worker, /searchResults = await enrichNewsArticleEvidence\(searchResults\.slice\(0, globalNewsDigest \? 20 : 12\), globalNewsDigest \? 20 : 12\);[\s\S]{0,500}filterFreshNewsResults\(searchResults\)/, "global news must enrich a wider balanced candidate pool before the strict same-day filter");
assert.ok(worker.includes("Interleave feeds instead of concatenating them"), "RSS fallback must interleave publisher feeds so national items cannot crowd out world coverage");

console.log("WEB SMOKE SELF-TEST: " + requiredIds.length + " required IDs, duplicate-ID check, local scripts, voice wiring and core styles passed");


// Free fallback regression checks: Exa HTTP 402 must not end all current-news
// searches when the public GDELT news index is reachable.
assert.ok(worker.includes("async function searchFreeNewsFallback(searchOptions = {})"), "public GDELT fallback helper must exist");
assert.ok(worker.includes("async function searchPublisherRssFallback()"), "publisher RSS fallback helper must exist");
assert.ok(worker.includes("indianexpress.com/section/india/feed/") && worker.includes("thehindu.com/news/national/feeder/default.rss"), "RSS fallback must include established Indian publisher feeds");
assert.ok(worker.includes("pib.gov.in/RssMain.aspx"), "RSS fallback must include official PIB releases");
assert.ok(worker.includes("fallbackFeedDiagnostics: fallback.feedDiagnostics || []"), "RSS feed-level diagnostics must be exposed");
assert.ok(worker.includes('fallbackProvider: fallback.provider || "GDELT"'), "fallback provider diagnostics must identify RSS sources when used");
assert.ok(worker.includes("feedPublishedAt: new Date(timestamp).toISOString()"), "RSS publication timestamps must be retained as publisher-provided evidence");
assert.ok(worker.includes("maxItemsPerFeed") && worker.includes("for (const feed of settled)"), "RSS fallback must round-robin feeds to preserve international and specialist coverage");
assert.ok(worker.includes("https://feeds.bbci.co.uk/news/world/rss.xml") && worker.includes("https://feeds.bbci.co.uk/news/world/asia/rss.xml"), "RSS fallback must include BBC international feeds");
assert.ok(worker.includes('publisher === "bbc.co.uk"') && worker.includes("bbc\\\\.co\\\\.uk"), "BBC UK articles must pass trusted publisher validation");
assert.ok(worker.includes("function selectDiverseGlobalNewsResults") && worker.includes("(counts.get(publisher) || 0) >= 2"), "global news must cap each publisher at two stories");
assert.ok(worker.includes("globalCoverageMissing") && worker.includes("globalPublishers.size < 2"), "global digest must fail closed without an international-feed story and two independent publishers");


assert.ok(worker.includes('response.status === 402 && isNewsQuery && searchOptions.news !== false'), "GDELT fallback must be limited to Exa credit exhaustion on news queries");
assert.ok(worker.includes('fetch("https://api.gdeltproject.org/api/v2/doc/doc?'), "GDELT fallback must use its public DOC API");
assert.ok(worker.includes('primaryProvider: "Exa"') && worker.includes('primaryHttpStatus: 402'), "fallback diagnostics must preserve the primary Exa failure");
assert.ok(worker.includes("fallbackAttempted: true") && worker.includes("fallbackHttpStatus: fallback.httpStatus ?? null"), "GDELT attempt status must be returned even when no articles are found");
assert.ok(worker.includes("वैकल्पिक खोज") && worker.includes("fallbackErrorCode: search.fallbackErrorCode ?? null"), "empty news diagnostics must disclose the GDELT attempt and failure code");
assert.ok(worker.includes("indexedAt: String(article?.seendate || \"\""), "GDELT observation time must be kept separate from publisher publication time");
assert.ok(worker.includes("searchResults = await enrichNewsArticleEvidence(searchResults.slice(0, globalNewsDigest ? 20 : 12), globalNewsDigest ? 20 : 12);"), "GDELT candidates must still pass original publisher date enrichment with a wider pool for global digests");
assert.ok(worker.includes("filterFreshNewsResults(searchResults)"), "GDELT candidates must still pass the strict India-day publication filter");
