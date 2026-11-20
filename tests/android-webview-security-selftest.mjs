import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activity = await readFile(new URL("../android-app/app/src/main/java/com/sarathi/ai/MainActivity.java", import.meta.url), "utf8");

assert.match(activity, /private boolean isTrustedAppUrl\(Uri uri\)/, "Android WebView must centralize trusted-origin validation");
assert.match(activity, /!"https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/, "only HTTPS app URLs may be trusted");
assert.match(activity, /APP_HOST\.equalsIgnoreCase\(uri\.getHost\(\)\)/, "only the exact GitHub Pages host may be trusted");
assert.match(activity, /uri\.getPort\(\) != -1 && uri\.getPort\(\) != 443/, "unexpected ports must be rejected");
assert.match(activity, /uri\.getUserInfo\(\) != null/, "userinfo URL tricks must be rejected");
assert.match(activity, /"\/sarathi-ai"\.equals\(path\)[\s\S]*"\/sarathi-ai\/"\.equals\(path\)[\s\S]*"\/sarathi-ai\/index\.html"\.equals\(path\)/, "only the app entry paths may be trusted");
assert.match(activity, /onJsPrompt[\s\S]*?if \(!isTrustedAppUrl\(pageUri\)\)/, "password prompts must be limited to the trusted app origin");
assert.match(activity, /onJsConfirm[\s\S]*?if \(!isTrustedAppUrl\(Uri\.parse\(url == null \? "" : url\)\)\)/, "JavaScript confirmation dialogs must be limited to the trusted app origin");
assert.match(activity, /onPageStarted[\s\S]*?if \(!isTrustedAppUrl\(uri\)\)[\s\S]*?view\.stopLoading\(\)/, "unexpected top-level navigation and redirects must be stopped");
assert.match(activity, /shouldOverrideUrlLoading[\s\S]*?return !isTrustedAppUrl\(request\.getUrl\(\)\)/, "untrusted navigations must be blocked");

console.log("Android WebView origin-security self-test passed.");
