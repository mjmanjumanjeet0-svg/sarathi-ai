:root {
  --bg: #04102a;
  --panel: #071a3d;
  --panel2: #0b2450;
  --blue: #087cff;
  --cyan: #00d9ff;
  --text: #f5f8ff;
  --muted: #a9c3e9;
  --border: rgba(0, 207, 255, 0.35);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Arial, "Noto Sans Devanagari", sans-serif;
}

button,
textarea,
input {
  font: inherit;
}

button {
  color: inherit;
  cursor: pointer;
}

button:focus-visible,
textarea:focus-visible,
input:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

.app {
  display: flex;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background:
    radial-gradient(ellipse at center, #0a2455 0%, #04102a 75%);
}

/* बाईं साइडबार */

.sidebar {
  width: 300px;
  flex-shrink: 0;
  padding: 18px;
  display: flex;
  flex-direction: column;
  background: rgba(3, 15, 39, 0.97);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.brand-icon,
.mini-logo {
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(145deg, #086dff, #00d9ff);
  box-shadow: 0 0 18px rgba(0, 190, 255, 0.35);
}

.brand-icon {
  width: 52px;
  height: 52px;
  font-size: 29px;
}

.brand h2 {
  margin: 0;
  font-size: 22px;
}

.brand p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.new-chat {
  width: 100%;
  padding: 14px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(100deg, #087cff, #00bde9);
  font-weight: bold;
  font-size: 17px;
}

.new-chat:hover,
.primary-button:hover {
  filter: brightness(1.12);
}

.history-title {
  margin: 27px 0 12px;
  font-size: 16px;
}

.chat-history {
  flex: 1;
  min-height: 100px;
}

.history-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 12px 8px;
  margin-bottom: 5px;
  border: 1px solid transparent;
  border-bottom-color: rgba(130, 175, 240, 0.15);
  border-radius: 8px;
  background: transparent;
}

.history-item:hover,
.history-item.active {
  background: #102a54;
  border-color: var(--border);
}

.history-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear-history {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #0a1d40;
}

.sidebar-note {
  color: var(--muted);
  text-align: center;
  line-height: 1.7;
  font-size: 12px;
  margin: 18px 0 0;
}

/* मुख्य हिस्सा */

.main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  min-height: 76px;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--border);
  background: rgba(4, 17, 43, 0.9);
}

.top-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.top-brand strong {
  display: block;
  font-size: 18px;
}

.top-brand small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
}

.mini-logo {
  width: 43px;
  height: 43px;
  font-size: 23px;
}

.icon-button {
  min-width: 42px;
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: #0a1d40;
  font-size: 23px;
}

.icon-button:hover,
.bottom-tools button:hover {
  background: #12396f;
}

.top-actions {
  display: flex;
  gap: 8px;
}

.popup-menu {
  display: none;
  position: absolute;
  z-index: 10;
  top: 65px;
  right: 14px;
  width: 225px;
  padding: 8px;
  background: #071a3d;
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 35px #0009;
}

.popup-menu.open {
  display: block;
}

.popup-menu button {
  width: 100%;
  padding: 12px;
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
}

.popup-menu button:hover {
  background: #12396f;
}

.popup-menu hr {
  border: 0;
  border-top: 1px solid var(--border);
}

/* बातचीत का क्षेत्र */

.chat-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 18px;
}

.welcome {
  max-width: 850px;
  margin: 15px auto 30px;
  text-align: center;
}

.welcome-logo {
  font-size: 70px;
  margin-bottom: 10px;
  filter: drop-shadow(0 0 16px #008dff);
}

.welcome h1 {
  font-size: clamp(23px, 4vw, 34px);
  margin: 10px 0;
}

.welcome h2 {
  margin: 8px 0 15px;
  color: var(--cyan);
  font-size: clamp(23px, 4vw, 34px);
}

.welcome p {
  color: var(--muted);
  line-height: 1.8;
}

.suggestions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 26px;
}

.suggestion {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 17px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 15px;
  background: rgba(4, 24, 59, 0.85);
}

.suggestion:hover {
  border-color: var(--cyan);
  transform: translateY(-1px);
}

.suggestion strong {
  font-size: 16px;
}

.suggestion span {
  color: var(--muted);
  line-height: 1.6;
  font-size: 13px;
}

/* संदेश */

.messages {
  max-width: 900px;
  margin: 0 auto;
}

.message {
  margin: 14px 0;
  display: flex;
}

.message.user {
  justify-content: flex-end;
}

.message-bubble {
  max-width: min(85%, 720px);
  padding: 13px 16px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: #0b2450;
}

.message.user .message-bubble {
  background: linear-gradient(120deg, #0758ba, #087cff);
  border-color: #168fff;
}

.message-bubble pre {
  max-width: 100%;
  overflow-x: auto;
  padding: 12px;
  background: #020916;
  border-radius: 8px;
}

.message-bubble code {
  font-family: monospace;
}

.status {
  min-height: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

/* नीचे लिखने का बॉक्स */

.composer-area {
  padding: 10px 18px 12px;
  background: linear-gradient(transparent, #04102a 20%);
}

.composer {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 950px;
  margin: 0 auto;
  padding: 8px;
  border: 1px solid var(--cyan);
  border-radius: 28px;
  background: #071a3d;
  box-shadow: 0 0 15px #008cff24;
}

.mic-button,
.send-button {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  font-size: 23px;
}

.mic-button {
  background: #0758c8;
}

.mic-button.listening {
  background: #c42654;
  box-shadow: 0 0 15px #ff4775;
}

.send-button {
  background: linear-gradient(145deg, #087cff, #00c8ff);
  font-size: 26px;
}

.composer textarea {
  flex: 1;
  min-width: 0;
  max-height: 160px;
  resize: none;
  padding: 12px 4px;
  border: 0;
  outline: none;
  color: white;
  background: transparent;
  line-height: 1.5;
}

.composer textarea::placeholder {
  color: #aac2e8;
}

.small-button {
  border: 0;
  background: transparent;
  font-size: 21px;
}

.bottom-tools {
  max-width: 950px;
  margin: 8px auto 0;
  display: flex;
  gap: 8px;
}

.bottom-tools button {
  min-width: 43px;
  height: 39px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: #0a1d40;
}

.disclaimer {
  margin: 8px 0 0;
  color: #8ca8d1;
  font-size: 11px;
  text-align: center;
}

/* सेटिंग विंडो */

.modal-backdrop {
  display: none;
  position: fixed;
  z-index: 20;
  inset: 0;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: #000a;
}

.modal-backdrop.open {
  display: flex;
}

.modal {
  position: relative;
  width: 100%;
  max-width: 440px;
  padding: 25px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: #071a3d;
}

.modal h2 {
  margin-top: 0;
}

.modal label {
  display: block;
  margin: 20px 0 8px;
}

.modal input {
  width: 100%;
  padding: 12px;
  color: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #04102a;
}

.modal p {
  color: var(--muted);
  line-height: 1.7;
  font-size: 13px;
}

.modal-close {
  position: absolute;
  right: 12px;
  top: 10px;
  border: 0;
  background: transparent;
  font-size: 25px;
}

.primary-button {
  width: 100%;
  margin-top: 14px;
  padding: 12px;
  border: 0;
  border-radius: 9px;
  background: linear-gradient(100deg, #087cff, #00bde9);
  font-weight: bold;
}

.close-sidebar {
  display: none;
}

/* फोन के लिए */

@media (max-width: 760px) {
  .sidebar {
    position: fixed;
    z-index: 30;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(320px, 88vw);
    transform: translateX(-105%);
    transition: transform 0.22s ease;
    box-shadow: 10px 0 30px #0008;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .close-sidebar {
    display: block;
    margin-left: auto;
  }

  .topbar {
    min-height: 65px;
    padding: 9px;
    gap: 8px;
  }

  .top-actions {
    gap: 5px;
  }

  .icon-button {
    min-width: 36px;
    height: 36px;
    font-size: 19px;
  }

  .mini-logo {
    width: 36px;
    height: 36px;
    font-size: 20px;
  }

  .top-brand strong {
    font-size: 15px;
  }

  .top-brand small {
    font-size: 11px;
  }

  .chat-area {
    padding: 15px 10px;
  }

  .suggestions {
    gap: 8px;
  }

  .suggestion {
    padding: 12px;
  }

  .suggestion strong {
    font-size: 14px;
  }

  .suggestion span {
    font-size: 12px;
  }

  .composer-area {
    padding: 8px;
  }

  .composer {
    gap: 5px;
    padding: 5px;
  }

  .mic-button,
  .send-button {
    width: 40px;
    height: 40px;
  }

  .small-button {
    display: none;
  }

  .message-bubble {
    max-width: 92%;
  }
}

@media (max-width: 380px) {
  .suggestions {
    grid-template-columns: 1fr;
  }

  .top-actions .icon-button {
    min-width: 32px;
  }
}
