"use strict";

/* Local project organizer. Project files remain in this browser's local storage. */
(() => {
  const KEY = "sarathi_project_workspace_v1";
  const $ = id => document.getElementById(id);
  let projects = [];
  let activeId = "";

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "[]");
      projects = Array.isArray(value) ? value : [];
    } catch { projects = []; }
    render();
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(projects));
      return true;
    } catch {
      $("projectStatus").textContent = "स्टोरेज भर गया है। कुछ बड़ी फाइलें हटाएँ।";
      return false;
    }
  }
  function current() { return projects.find(item => item.id === activeId); }
  function render() {
    const select = $("projectSelect");
    if (!select) return;
    select.replaceChildren(new Option("प्रोजेक्ट चुनें", ""));
    projects.forEach(project => select.add(new Option(project.name, project.id)));
    select.value = activeId;
    const project = current();
    const list = $("projectFileList");
    list.replaceChildren();
    if (!project) return;
    Object.keys(project.files || {}).sort().forEach(name => {
      const row = document.createElement("div");
      row.className = "project-file-row";
      const open = document.createElement("button");
      open.type = "button"; open.textContent = name;
      open.addEventListener("click", () => {
        $("projectFileName").value = name;
        $("projectFileContent").value = project.files[name];
      });
      row.append(open);
      list.append(row);
    });
  }
  function create() {
    const name = $("projectName").value.trim();
    if (!name) { $("projectStatus").textContent = "प्रोजेक्ट का नाम लिखें।"; return; }
    const project = {
      id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.slice(0, 70),
      description: $("projectDescription").value.trim().slice(0, 240),
      files: { "README.md": "# " + name + "\n\n" + $("projectDescription").value.trim() },
      updatedAt: Date.now()
    };
    projects.unshift(project); activeId = project.id;
    if (save()) {
      $("projectStatus").textContent = "प्रोजेक्ट बन गया और इस डिवाइस पर सेव है।";
      $("projectName").value = ""; $("projectDescription").value = "";
      $("projectFileName").value = "README.md";
      $("projectFileContent").value = project.files["README.md"];
      render();
    }
  }
  function saveFile() {
    const project = current();
    const name = $("projectFileName").value.trim();
    if (!project) { $("projectStatus").textContent = "पहले प्रोजेक्ट चुनें।"; return; }
    if (!/^[\w .()\-]{1,90}\.[a-zA-Z0-9]{1,10}$/.test(name)) {
      $("projectStatus").textContent = "फाइल का नाम सही लिखें, जैसे index.html या notes.md।"; return;
    }
    project.files[name] = $("projectFileContent").value;
    project.updatedAt = Date.now();
    if (save()) {
      $("projectStatus").textContent = name + " प्रोजेक्ट में सेव हो गई।";
      render();
    }
  }
  function importLatestReply() {
    const chat = typeof activeChat === "function" ? activeChat() : null;
    const latest = chat && [...chat.messages].reverse().find(message => message.role === "assistant" && typeof message.content === "string");
    if (!latest) { $("projectStatus").textContent = "इस चैट में अभी सारथी का कोई जवाब नहीं है।"; return; }
    const fileName = $("projectFileName").value.trim() || "sarathi-notes.md";
    $("projectFileName").value = fileName;
    $("projectFileContent").value = latest.content;
    $("projectStatus").textContent = "आखिरी AI जवाब एडिटर में आ गया है। सेव करें दबाकर प्रोजेक्ट में रखें।";
  }
  function downloadFile() {
    const name = $("projectFileName").value.trim();
    const content = $("projectFileContent").value;
    if (!name) { $("projectStatus").textContent = "फाइल का नाम लिखें।"; return; }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function remove() {
    const project = current();
    if (!project || !confirm("क्या यह प्रोजेक्ट और इसकी सेव की गई फाइलें हटानी हैं?")) return;
    projects = projects.filter(item => item.id !== activeId);
    activeId = projects[0]?.id || "";
    save(); render();
    $("projectFileName").value = ""; $("projectFileContent").value = "";
    $("projectStatus").textContent = "प्रोजेक्ट हटाया गया।";
  }
  document.addEventListener("DOMContentLoaded", () => {
    load();
    $("projectStudioOpen")?.addEventListener("click", () => $("projectStudioDialog").showModal());
    $("projectStudioClose")?.addEventListener("click", () => $("projectStudioDialog").close());
    $("projectCreate")?.addEventListener("click", create);
    $("projectSaveFile")?.addEventListener("click", saveFile);
    $("projectImportReply")?.addEventListener("click", importLatestReply);
    $("projectDownloadFile")?.addEventListener("click", downloadFile);
    $("projectDelete")?.addEventListener("click", remove);
    $("projectSelect")?.addEventListener("change", event => {
      activeId = event.target.value;
      const project = current();
      const first = project && Object.keys(project.files || {}).sort()[0];
      $("projectFileName").value = first || "";
      $("projectFileContent").value = first ? project.files[first] : "";
      render();
    });
  });
})();
