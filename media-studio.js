"use strict";

/* Local-first photo/poster editor and browser-supported video trimmer.
   Media stays on this device; exports are created only after user action. */
(() => {
  const $ = id => document.getElementById(id);
  let image = null;
  let videoUrl = "";
  let exportBusy = false;

  function drawImage() {
    const canvas = $("mediaCanvas");
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    const scale = Math.min(1200 / image.width, 900 / image.height, 1);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const filter = $("mediaFilter")?.value || "none";
    const filters = {
      none: "none", contrast: "contrast(1.22) saturate(1.12)",
      bright: "brightness(1.15) saturate(1.08)", mono: "grayscale(1) contrast(1.12)",
      warm: "sepia(.28) saturate(1.2)", cool: "hue-rotate(12deg) saturate(1.08)"
    };
    ctx.filter = filters[filter] || "none";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";

    const title = ($("mediaTitle")?.value || "").trim();
    const subtitle = ($("mediaSubtitle")?.value || "").trim();
    if (title || subtitle) {
      const w = canvas.width, h = canvas.height;
      const bandHeight = Math.min(h * .34, Math.max(100, h * .25));
      const gradient = ctx.createLinearGradient(0, h - bandHeight, 0, h);
      gradient.addColorStop(0, "rgba(3,12,28,.48)");
      gradient.addColorStop(1, "rgba(3,12,28,.92)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, h - bandHeight, w, bandHeight);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,.65)";
      ctx.shadowBlur = Math.max(2, w * .006);
      if (title) {
        ctx.font = "bold " + Math.max(22, Math.round(w * .055)) + "px sans-serif";
        ctx.fillText(title.slice(0, 90), w / 2, h - bandHeight * .62, w * .9);
      }
      if (subtitle) {
        ctx.font = "600 " + Math.max(15, Math.round(w * .027)) + "px sans-serif";
        ctx.fillText(subtitle.slice(0, 140), w / 2, h - bandHeight * .27, w * .9);
      }
      ctx.shadowBlur = 0;
    }
  }

  function downloadCanvas() {
    if (!image) return status("पहले फोटो चुनें।");
    const canvas = $("mediaCanvas");
    canvas.toBlob(blob => {
      if (!blob) return status("फोटो एक्सपोर्ट नहीं हो सकी।");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "sarathi-edited-photo.jpg"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      status("एडिट की गई फोटो डाउनलोड हो गई।");
    }, "image/jpeg", .94);
  }

  function status(message) {
    const el = $("status") || $("videoStatus");
    if (el) el.textContent = message;
  }

  async function generateAiImage() {
    const prompt = ($("mediaPrompt")?.value || "").trim();
    const statusEl = $("mediaAiStatus");
    if (!prompt) { if (statusEl) statusEl.textContent = "पहले फोटो का विवरण लिखें।"; return; }
    const button = $("mediaGenerateImage");
    button.disabled = true;
    if (statusEl) statusEl.textContent = "AI फोटो तैयार हो रही है…";
    try {
      if (typeof getAuthToken !== "function" || typeof getWorkerUrl !== "function") {
        throw new Error("सारथी लॉगिन सेवा उपलब्ध नहीं है।");
      }
      const token = await getAuthToken();
      const response = await fetch(getWorkerUrl() + "/api/media/image", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.image) {
        throw new Error(data.error || "AI फोटो नहीं बन पाई।");
      }
      const next = new Image();
      next.onload = () => {
        image = next;
        $("mediaFilter").value = "none";
        $("mediaTitle").value = "";
        $("mediaSubtitle").value = "";
        drawImage();
        if (statusEl) statusEl.textContent = "AI फोटो तैयार है। अब टेक्स्ट/फिल्टर लगाकर डाउनलोड कर सकते हैं।";
      };
      next.onerror = () => { throw new Error("AI से मिली फोटो पढ़ी नहीं जा सकी।"); };
      next.src = "data:image/jpeg;base64," + data.image;
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || "AI फोटो सेवा में समस्या है।";
    } finally {
      button.disabled = false;
    }
  }

  function openStudio() {
    const dialog = $("mediaStudioDialog");
    if (dialog && !dialog.open) dialog.showModal();
  }

  function selectTab(tab) {
    $("mediaImagePanel").hidden = tab !== "image";
    $("mediaVideoPanel").hidden = tab !== "video";
    $("mediaGeneratePanel").hidden = tab !== "image";
    $("mediaProjectPanel").hidden = tab !== "project";
  }

  let generatedImageUrl = "";
  async function generateAIImage() {
    const prompt = ($("aiImagePrompt")?.value || "").trim();
    if (!prompt) { $("aiImageStatus").textContent = "पहले फोटो का विवरण लिखें।"; return; }
    const base = String(JSON.parse(localStorage.getItem("sarathi_ai_settings_v1") || "{}").workerUrl || "").trim().replace(/\\/+$/, "");
    if (!base) { $("aiImageStatus").textContent = "पहले सेटिंग्स में Worker URL भरें।"; return; }
    $("aiImageGenerate").disabled = true;
    $("aiImageStatus").textContent = "AI फोटो बनाई जा रही है…";
    try {
      let token = localStorage.getItem("sarathi_ai_auth_token_v1");
      if (!token) {
        const password = window.prompt("अपना Sarathi AI लॉगिन पासवर्ड लिखें:");
        if (!password) throw new Error("लॉगिन पासवर्ड जरूरी है।");
        const login = await fetch(base + "/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({password}) });
        const loginData = await login.json();
        if (!login.ok || !loginData.token) throw new Error(loginData.error || "लॉगिन नहीं हो सका।");
        token = loginData.token;
        localStorage.setItem("sarathi_ai_auth_token_v1", token);
      }
      const response = await fetch(base + "/api/image", {
        method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
        body:JSON.stringify({prompt})
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.image) throw new Error(data.error || "फोटो नहीं बन सकी।");
      if (generatedImageUrl) URL.revokeObjectURL(generatedImageUrl);
      const binary = atob(data.image);
      const bytes = new Uint8Array(binary.length);
      for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
      generatedImageUrl = URL.createObjectURL(new Blob([bytes], {type:data.mimeType || "image/jpeg"}));
      $("aiImageResult").src = generatedImageUrl;
      $("aiImageResult").hidden = false;
      $("aiImageDownload").hidden = false;
      $("aiImageStatus").textContent = "फोटो तैयार है।";
    } catch(error) {
      $("aiImageStatus").textContent = error.message || "AI फोटो सेवा उपलब्ध नहीं है।";
    } finally { $("aiImageGenerate").disabled = false; }
  }

  function saveProjectFile() {
    const name = ($("projectFileName").value || "project.txt").trim().replace(/[\\\\/:*?"<>|]/g, "_").slice(0,100);
    const content = $("projectCode").value || "";
    if (!name || !content) { $("projectStatus").textContent = "फाइल का नाम और सामग्री लिखें।"; return; }
    const blob = new Blob([content], {type:"text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=name; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    $("projectStatus").textContent = "फाइल आपके डिवाइस में सेव करने के लिए डाउनलोड हुई।";
  }

  function loadVideo(file) {
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(file);
    const video = $("mediaVideo");
    video.src = videoUrl;
    video.onloadedmetadata = () => {
      $("videoStart").value = "0";
      $("videoEnd").value = String(Math.max(.1, video.duration));
      $("videoEnd").max = String(video.duration);
      $("videoStatus").textContent = "वीडियो तैयार है। शुरुआत और अंत का समय चुनें।";
    };
  }

  async function exportVideoClip() {
    const video = $("mediaVideo");
    const start = Number($("videoStart").value);
    const end = Number($("videoEnd").value);
    if (!video.src || !Number.isFinite(video.duration)) return status("पहले वीडियो चुनें।");
    if (!(start >= 0 && end > start && end <= video.duration)) return status("वीडियो का समय सही चुनें।");
    if (!video.captureStream || !window.MediaRecorder) return status("इस ब्राउज़र में वीडियो एक्सपोर्ट समर्थित नहीं है।");
    if (exportBusy) return;
    exportBusy = true;
    $("videoExport").disabled = true;
    try {
      video.pause();
      video.currentTime = start;
      await new Promise((resolve, reject) => {
        video.onseeked = resolve;
        video.onerror = reject;
      });
      const stream = video.captureStream();
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const finished = new Promise((resolve, reject) => {
        recorder.onerror = () => reject(new Error("वीडियो रिकॉर्डिंग असफल हुई।"));
        recorder.onstop = resolve;
      });
      recorder.start(250);
      video.ontimeupdate = () => {
        if (video.currentTime >= end) {
          video.pause();
          if (recorder.state !== "inactive") recorder.stop();
        }
      };
      await video.play();
      await finished;
      stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: "video/webm" });
      if (!blob.size) throw new Error("वीडियो फ़ाइल खाली बनी।");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "sarathi-trimmed-video.webm"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      $("videoStatus").textContent = "चुना हुआ वीडियो हिस्सा WebM में सेव हो गया।";
    } catch (error) {
      $("videoStatus").textContent = error.message || "वीडियो एक्सपोर्ट नहीं हो सका।";
    } finally {
      exportBusy = false;
      $("videoExport").disabled = false;
      video.ontimeupdate = null;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("mediaStudioOpen")?.addEventListener("click", openStudio);
    $("mediaGenerateImage")?.addEventListener("click", generateAiImage);
    $("mediaStudioClose")?.addEventListener("click", () => $("mediaStudioDialog")?.close());
    document.querySelectorAll("[data-media-tab]").forEach(button =>
      button.addEventListener("click", () => selectTab(button.dataset.mediaTab)));
    $("mediaImageInput")?.addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      const url = URL.createObjectURL(file);
      const next = new Image();
      next.onload = () => { image = next; drawImage(); URL.revokeObjectURL(url); };
      next.onerror = () => { URL.revokeObjectURL(url); status("फोटो पढ़ी नहीं जा सकी।"); };
      next.src = url;
    });
    ["mediaFilter", "mediaTitle", "mediaSubtitle"].forEach(id =>
      $(id)?.addEventListener("input", drawImage));
    $("mediaReset")?.addEventListener("click", () => {
      $("mediaFilter").value = "none"; $("mediaTitle").value = ""; $("mediaSubtitle").value = ""; drawImage();
    });
    $("mediaDownload")?.addEventListener("click", downloadCanvas);
    $("aiImageGenerate")?.addEventListener("click", generateAIImage);
    $("aiImageDownload")?.addEventListener("click", () => {
      if (!generatedImageUrl) return;
      const a=document.createElement("a"); a.href=generatedImageUrl; a.download="sarathi-ai-image.jpg"; a.click();
    });
    $("projectNew")?.addEventListener("click", () => { $("projectFileName").value="new-project.txt"; $("projectCode").value=""; $("projectStatus").textContent="नई फाइल तैयार है।"; });
    $("projectSave")?.addEventListener("click", saveProjectFile);
    $("mediaVideoInput")?.addEventListener("change", event => loadVideo(event.target.files?.[0]));
    $("videoExport")?.addEventListener("click", exportVideoClip);
  });
})();
