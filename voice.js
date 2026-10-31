(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let active = false;
  let speaking = false;
  let restarting = false;

  function show(activeNow, hint) {
    ["voicePanel", "voiceWave", "voiceActiveNote"].forEach(id => $(id)?.classList.toggle("hidden", !activeNow));
    $("micBtn")?.classList.toggle("active", activeNow);
    $("micBtn")?.setAttribute("aria-pressed", String(activeNow));
    if ($("voiceTitle")) $("voiceTitle").textContent = activeNow ? "सारथी सुन रहा है..." : "सारथी बंद है";
    if ($("voiceHint")) $("voiceHint").textContent = hint || "अब आप मुझसे कुछ भी पूछ सकते हैं या बात कर सकते हैं।";
  }

  function startRecognition() {
    if (!active || speaking || !recognition || restarting) return;
    restarting = true;
    try { recognition.start(); } catch (_) {}
    setTimeout(() => { restarting = false; }, 350);
  }

  function stop() {
    active = false;
    speaking = false;
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch (_) {}
      recognition = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (window.SarathiNative?.stopSpeaking) window.SarathiNative.stopSpeaking();
    if (window.SarathiNative?.stopWakeWord) window.SarathiNative.stopWakeWord();
    show(false);
    const status = $("status");
    if (status) status.textContent = "सारथी की आवाज़ बंद कर दी गई है।";
  }

  function speak(text) {
    const answer = String(text || "").replaceAll("*", " ").replaceAll("#", " ").slice(0, 4500);
    if (!active || !answer) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      if (window.SarathiNative?.speak) {
        speaking = true;
        window.SarathiNative.speak(answer);
        setTimeout(() => { speaking = false; startRecognition(); }, Math.min(30000, Math.max(2500, answer.length * 65)));
      } else {
        const status = $("status");
        if (status) status.textContent = "इस ब्राउज़र में आवाज़ में जवाब उपलब्ध नहीं है।";
      }
      return;
    }
    speaking = true;
    try { recognition?.stop(); } catch (_) {}
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.lang = /[अ-ह]/.test(answer) ? "hi-IN" : "en-IN";
    utterance.rate = 0.96;
    utterance.onend = utterance.onerror = () => {
      speaking = false;
      startRecognition();
    };
    window.speechSynthesis.speak(utterance);
  }

  function start() {
    if (!Recognition) {
      const status = $("status");
      if (status) status.textContent = "माइक इस ब्राउज़र में उपलब्ध नहीं है। Chrome में खोलकर माइक्रोफोन अनुमति दें।";
      return;
    }
    if (active) return;
    active = true;
    const engine = new Recognition();
    recognition = engine;
    engine.lang = "hi-IN";
    engine.continuous = true;
    engine.interimResults = true;
    engine.maxAlternatives = 1;
    engine.onstart = () => {
      show(true, "अब बोलिए। सारथी आपकी बात सुनेगा और जवाब देगा।");
      const status = $("status");
      if (status) status.textContent = "माइक्रोफोन चालू है — सारथी सुन रहा है।";
    };
    engine.onresult = event => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0]?.transcript?.trim() || "";
        if (event.results[i].isFinal) finalText += (finalText ? " " : "") + part;
        else interim += part;
      }
      if (interim && $("voiceHint")) $("voiceHint").textContent = "आप: " + interim;
      if (finalText.trim()) {
        try { engine.stop(); } catch (_) {}
        if (typeof window.sendMessage === "function") window.sendMessage(finalText.trim());
        else if ($("messageInput")) {
          $("messageInput").value = finalText.trim();
          $("chatForm")?.requestSubmit();
        }
      }
    };
    engine.onerror = event => {
      if (!active) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        const status = $("status");
        if (status) status.textContent = "माइक्रोफोन अनुमति नहीं मिली। साइट सेटिंग्स में माइक्रोफोन Allow करें।";
        stop();
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        const status = $("status");
        if (status) status.textContent = "आवाज़ पहचानने में समस्या हुई। फिर से बोलिए।";
      }
    };
    engine.onend = () => {
      if (active && !speaking) setTimeout(startRecognition, 500);
    };
    try { engine.start(); }
    catch (_) {
      active = false;
      recognition = null;
      show(false);
      const status = $("status");
      if (status) status.textContent = "माइक्रोफोन शुरू नहीं हुआ। अनुमति जाँचें और फिर प्रयास करें।";
    }
  }

  window.SarathiVoice = window.SarathiVoice || {};
  window.SarathiVoice.speak = speak;
  window.SarathiVoice.stop = stop;
  window.SarathiVoice.start = start;

  document.addEventListener("DOMContentLoaded", () => {
    $("micBtn")?.addEventListener("click", () => active ? stop() : start());
    $("voiceStop")?.addEventListener("click", stop);
    document.querySelectorAll("[data-nav]").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll("[data-nav]").forEach(item => item.classList.toggle("active", item === button));
      if (button.dataset.nav === "settings") $("settingsBtn")?.click();
      if (button.dataset.nav === "chat") $("messageInput")?.focus();
      if (button.dataset.nav === "search") $("webToggle")?.click();
      if (button.dataset.nav === "home") {
        $("chatArea")?.scrollTo({ top: 0, behavior: "smooth" });
      }
    }));
  });
})();