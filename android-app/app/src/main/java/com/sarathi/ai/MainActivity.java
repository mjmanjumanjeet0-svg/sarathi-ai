package com.sarathi.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.provider.AlarmClock;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    public static final String ACTION_WAKE_COMMAND = "com.sarathi.ai.WAKE_COMMAND";
    public static final String ACTION_WAKE_DETECTED = "com.sarathi.ai.WAKE_DETECTED";
    public static final String ACTION_WAKE_RESULT = "com.sarathi.ai.WAKE_RESULT";
    public static final String EXTRA_WAKE_TEXT = "wake_text";
    private static final int REQUEST_RECORD_AUDIO = 1201;
    private static final String APP_HOST = "mjmanjumanjeet0-svg.github.io";
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int REQUEST_FILE_CHOOSER = 1202;
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech textToSpeech;
    private boolean ttsReady = false;
    private String pendingSpeechText = null;
    private Voice localHindiVoice;
    private Voice localEnglishVoice;
    private boolean pendingListen = false;
    private boolean pendingWakeStart = false;
    private boolean pageLoaded = false;
    private boolean appInForeground = false;
    private boolean wakeReceiverRegistered = false;
    private final BroadcastReceiver wakeDetectedReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!appInForeground || intent == null) return;
            if (ACTION_WAKE_RESULT.equals(intent.getAction())) {
                String command = intent.getStringExtra(EXTRA_WAKE_TEXT);
                wakeCommandSession = false;
                notifyVoice("onWakeCommandResult", command == null ? "" : command);
                return;
            }
            if (!ACTION_WAKE_DETECTED.equals(intent.getAction())) return;
            pendingWakeCommand = true;
            wakeCommandSession = true;
            if (pageLoaded) {
                pendingWakeCommand = false;
                startWakeCommandCapture();
            }
        }
    };
    private boolean pendingWakeCommand = false;
    private boolean wakeCommandSession = false;
    private String selectedSpeechLanguage = "hi-IN";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);
        IntentFilter wakeFilter = new IntentFilter();
        wakeFilter.addAction(ACTION_WAKE_DETECTED);
        wakeFilter.addAction(ACTION_WAKE_RESULT);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(wakeDetectedReceiver, wakeFilter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(wakeDetectedReceiver, wakeFilter);
        wakeReceiverRegistered = true;

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        textToSpeech = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                ttsReady = true;
                try {
                    Set<Voice> voices = textToSpeech.getVoices();
                    if (voices != null) {
                        for (Voice voice : voices) {
                            Locale locale = voice.getLocale();
                            if (locale == null || voice.isNetworkConnectionRequired()) continue;
                            if ("hi".equalsIgnoreCase(locale.getLanguage())
                                    && ("IN".equalsIgnoreCase(locale.getCountry()) || locale.getCountry().isEmpty())
                                    && localHindiVoice == null) {
                                localHindiVoice = voice;
                            } else if ("en".equalsIgnoreCase(locale.getLanguage())
                                    && ("IN".equalsIgnoreCase(locale.getCountry()) || "US".equalsIgnoreCase(locale.getCountry())
                                    || locale.getCountry().isEmpty())
                                    && localEnglishVoice == null) {
                                localEnglishVoice = voice;
                            }
                        }
                        if (localHindiVoice != null) textToSpeech.setVoice(localHindiVoice);
                    }
                } catch (Exception ignored) {
                    localHindiVoice = null;
                    localEnglishVoice = null;
                }
                if (pendingSpeechText != null && !pendingSpeechText.trim().isEmpty()) {
                    String queuedText = pendingSpeechText;
                    pendingSpeechText = null;
                    new SarathiBridge().speak(queuedText);
                }
            } else {
                ttsReady = false;
                notifyVoice("onError", "फ़ोन की Text-to-Speech सेवा शुरू नहीं हो सकी। Android में टेक्स्ट-टू-स्पीच इंजन जाँचें।");
            }
        });

        webView.addJavascriptInterface(new SarathiBridge(), "SarathiNative");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle("सारथी AI की अनुमति")
                        .setMessage(message == null ? "क्या यह कार्रवाई करनी है?" : message)
                        .setPositiveButton("हाँ, आगे बढ़ें", (dialog, which) -> result.confirm())
                        .setNegativeButton("रद्द करें", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (Exception error) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    notifyVoice("onError", "फ़ाइल चुनने की विंडो नहीं खुली। फ़ाइल की सामग्री अपने-आप कहीं नहीं भेजी गई।");
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                if (pendingWakeCommand) {
                    pendingWakeCommand = false;
                    startWakeCommandCapture();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("https".equalsIgnoreCase(scheme) && APP_HOST.equalsIgnoreCase(host)) {
                    return false;
                }
                if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                        Toast.makeText(MainActivity.this, "यह लिंक नहीं खुल सका।", Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }
        });

        webView.loadUrl("https://" + APP_HOST + "/sarathi-ai/");
        handleWakeCommandIntent(getIntent());
    }

    private void handleWakeCommandIntent(Intent intent) {
        if (intent != null && ACTION_WAKE_COMMAND.equals(intent.getAction())) {
            intent.setAction(null);
            pendingWakeCommand = true;
            wakeCommandSession = true;
            if (pageLoaded) {
                pendingWakeCommand = false;
                startWakeCommandCapture();
            }
        }
    }

    private void startWakeWordService() {
        try {
            Intent service = new Intent(this, WakeWordService.class);
            service.setAction(WakeWordService.ACTION_START);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
            else startService(service);
            notifyVoice("onStatus", "हिंदी ऑफ़लाइन मॉडल तैयार किया जा रहा है। पहली बार इंटरनेट से लगभग 42 MB डाउनलोड होगा; इसके बाद आवाज़ पहचान फ़ोन पर ही होगी।");
        } catch (Exception error) {
            notifyVoice("onError", "वेक-वर्ड सेवा शुरू नहीं हो सकी।");
        }
    }

    private void pauseWakeWordForCommand() {
        Intent service = new Intent(this, WakeWordService.class);
        service.setAction(WakeWordService.ACTION_PAUSE);
        try { startService(service); } catch (Exception ignored) {}
    }

    private void resumeWakeWordAfterCommand() {
        Intent service = new Intent(this, WakeWordService.class);
        service.setAction(WakeWordService.ACTION_RESUME);
        try { startService(service); } catch (Exception ignored) {}
    }

    private void notifyVoice(String callback, String message) {
        if (webView == null) return;
        String safeMessage = JSONObject.quote(message == null ? "" : message);
        mainHandler.post(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                    "window.SarathiVoice && window.SarathiVoice." + callback + "(" + safeMessage + ");",
                    null
                );
            }
        });
    }

    private void startListening() {
        pauseWakeWordForCommand();
        if (Build.VERSION.SDK_INT >= 34) {
            selectedSpeechLanguage = "auto";
            beginListeningWithSelectedLanguage();
            return;
        }
        selectedSpeechLanguage = "hi-IN";
        beginListeningWithSelectedLanguage();
    }

    private void startWakeCommandCapture() {
        // Reuse the Vosk service that detected the wake word. This avoids
        // opening a second recognizer and avoids the provider error 9 path.
        Intent service = new Intent(this, WakeWordService.class);
        service.setAction(WakeWordService.ACTION_CAPTURE_COMMAND);
        try {
            startService(service);
            notifyVoice("onStatus", "बोलिए, सारथी ऑफ़लाइन हिंदी में सुन रहा है…");
        } catch (Exception error) {
            notifyVoice("onError", "ऑफ़लाइन आदेश पहचान शुरू नहीं हो सकी।");
        }
    }

    private void beginListeningWithSelectedLanguage() {
        if (!hasMicrophonePermission()) {
            pendingListen = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            return;
        }

        boolean offlineAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(this);
        if (offlineAvailable) {
            startRecognition(false);
            return;
        }

        // Never send microphone audio to an online recognition service without a clear, per-use choice.
        showOnlineVoiceConsent("इस फ़ोन पर चुनी हुई भाषा की ऑफ़लाइन आवाज़ पहचान उपलब्ध नहीं है। अगर आप आगे बढ़ते हैं, तो आपकी आवाज़ पहचानने के लिए इंटरनेट के ज़रिए फ़ोन की स्पीच सेवा को भेजी जा सकती है। क्या आप इस बार ऑनलाइन पहचान इस्तेमाल करना चाहते हैं?");
    }

    private void showOnlineVoiceConsent(String message) {
        new android.app.AlertDialog.Builder(this)
                .setTitle("आवाज़ पहचान")
                .setMessage(message)
                .setPositiveButton("हाँ, इस बार इस्तेमाल करें", (dialog, which) -> startRecognition(true))
                .setNegativeButton("रद्द करें", (dialog, which) -> {
                    wakeCommandSession = false;
                    notifyVoice("onError", "ऑनलाइन आवाज़ पहचान रद्द कर दी गई। आपकी आवाज़ नहीं सुनी गई।");
                    resumeWakeWordAfterCommand();
                })
                .setOnCancelListener(dialog -> {
                    wakeCommandSession = false;
                    resumeWakeWordAfterCommand();
                })
                .setCancelable(true)
                .show();
    }

    private String getSpeechErrorMessage(int error, boolean online) {
        switch (error) {
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "आवाज़ पहचान सेवा तक नेटवर्क नहीं पहुँच रहा। मोबाइल डेटा चालू करके फिर कोशिश करें। (त्रुटि " + error + ")";
            case SpeechRecognizer.ERROR_SERVER:
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
                return "Google/फ़ोन की आवाज़ पहचान सेवा ने जवाब नहीं दिया। Google ऐप और Speech Services को अपडेट करें। (त्रुटि " + error + ")";
            case SpeechRecognizer.ERROR_CLIENT:
                return "फ़ोन की स्पीच सेवा शुरू नहीं हो सकी। डिफ़ॉल्ट डिजिटल असिस्टेंट/स्पीच सेवा जाँचें। (त्रुटि " + error + ")";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "आवाज़ साफ़ नहीं मिली। माइक्रोफ़ोन के पास धीरे और स्पष्ट बोलकर फिर कोशिश करें। (त्रुटि " + error + ")";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                return "फ़ोन की स्पीच सेवा में हिंदी (भारत) उपलब्ध नहीं है। Google ऐप या Speech Services में हिंदी भाषा जोड़ें। (त्रुटि " + error + ")";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "माइक्रोफ़ोन अनुमति नहीं मिली। फ़ोन की ऐप सेटिंग में अनुमति दें।";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "आवाज़ पहचान पहले से चल रही है। कुछ सेकंड बाद फिर कोशिश करें। (त्रुटि " + error + ")";
            default:
                return (online ? "ऑनलाइन" : "ऑफ़लाइन") + " आवाज़ पहचान विफल हुई। Google ऐप/Speech Services, हिंदी भाषा और नेटवर्क जाँचें। (त्रुटि " + error + ")";
        }
    }

    private boolean hasMicrophonePermission() {
        return Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void startRecognition(boolean useOnlineService) {
        try {
            // Re-check permission immediately before starting the speech service.
            if (!hasMicrophonePermission()) {
                pendingListen = true;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                wakeCommandSession = false;
                notifyVoice("onError", "इस फ़ोन में कोई आवाज़ पहचान सेवा उपलब्ध नहीं मिली। Google ऐप या Speech Services इंस्टॉल/अपडेट करें और फिर कोशिश करें।");
                resumeWakeWordAfterCommand();
                return;
            }
            if (speechRecognizer != null) {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
                speechRecognizer = null;
            }

            if (useOnlineService) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            } else {
                notifyVoice("onError", "ऑफ़लाइन आवाज़ पहचान उपलब्ध नहीं है।");
                return;
            }

            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    String languageLabel = "en-IN".equals(selectedSpeechLanguage)
                            ? "English" : ("auto".equals(selectedSpeechLanguage) ? "हिन्दी + English" : "हिन्दी");
                    notifyVoice("onStatus", useOnlineService
                            ? "बोलिए, ऑनलाइन " + languageLabel + " आवाज़ पहचान चालू है…"
                            : "बोलिए, ऑफ़लाइन " + languageLabel + " आवाज़ पहचान चालू है…");
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {
                    notifyVoice("onStatus", "आवाज़ समझी जा रही है…");
                }
                @Override public void onError(int error) {
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                            && !hasMicrophonePermission()) {
                        pendingListen = false;
                        wakeCommandSession = false;
                        notifyVoice("onError", "Android ने माइक्रोफ़ोन अनुमति नहीं दी। सेटिंग में Sarathi AI → माइक्रोफ़ोन → केवल ऐप इस्तेमाल करते समय अनुमति चुनें।");
                        resumeWakeWordAfterCommand();
                    } else if (!useOnlineService) {
                        // If the offline provider fails (including provider-side error 9),
                        // offer the normal recognizer only after explicit per-use consent.
                        mainHandler.post(() -> showOnlineVoiceConsent(
                                error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                                        ? "Sarathi AI को माइक्रोफ़ोन अनुमति मिली है, लेकिन फ़ोन की ऑफ़लाइन स्पीच सेवा ने अनुमति त्रुटि (कोड 9) दी। क्या आप इस बार इंटरनेट के माध्यम से आवाज़ पहचान इस्तेमाल करना चाहते हैं?"
                                        : "इस फ़ोन की ऑफ़लाइन हिंदी आवाज़ पहचान अभी काम नहीं कर पाई। क्या आप इस बार इंटरनेट के माध्यम से आवाज़ पहचान इस्तेमाल करना चाहते हैं?"
                        ));
                    } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        wakeCommandSession = false;
                        notifyVoice("onError", "Sarathi AI की माइक्रोफ़ोन अनुमति चालू है, लेकिन फ़ोन की ऑनलाइन स्पीच सेवा ने अनुमति त्रुटि (कोड 9) दी। यह स्पीच सेवा/फ़ोन की समस्या है; आवाज़ इंटरनेट पर भेजने की अनुमति देने से भी यह सेवा ठीक होना निश्चित नहीं है।");
                        resumeWakeWordAfterCommand();
                    } else {
                        wakeCommandSession = false;
                        notifyVoice("onError", getSpeechErrorMessage(error, true));
                        resumeWakeWordAfterCommand();
                    }
                    if (speechRecognizer != null) {
                        speechRecognizer.destroy();
                        speechRecognizer = null;
                    }
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results == null ? null
                        : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        if (wakeCommandSession) {
                            wakeCommandSession = false;
                            notifyVoice("onWakeCommandResult", matches.get(0));
                        } else {
                            notifyVoice("onResult", matches.get(0));
                        }
                    } else {
                        wakeCommandSession = false;
                        notifyVoice("onError", "आवाज़ से शब्द समझ नहीं आए। फिर बोलकर देखें।");
                    }
                    resumeWakeWordAfterCommand();
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,
                    "auto".equals(selectedSpeechLanguage) ? "hi-IN" : selectedSpeechLanguage);
            // Android 14+ providers may detect Hindi and English automatically.
            if (Build.VERSION.SDK_INT >= 34 && "auto".equals(selectedSpeechLanguage)) {
                intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION, true);
                intent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES,
                    new String[]{"hi-IN", "en-IN"}
                );
            }
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, !useOnlineService);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            speechRecognizer.startListening(intent);
        } catch (Exception error) {
            wakeCommandSession = false;
            notifyVoice("onError", "माइक्रोफ़ोन शुरू नहीं हो सका।");
            resumeWakeWordAfterCommand();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_RECORD_AUDIO) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && pendingListen) {
                pendingListen = false;
                beginListeningWithSelectedLanguage();
            } else if (granted && pendingWakeStart) {
                pendingWakeStart = false;
                startWakeWordService();
            } else {
                pendingListen = false;
                pendingWakeStart = false;
                wakeCommandSession = false;
                notifyVoice("onError", "माइक्रोफ़ोन अनुमति नहीं मिली। अनुमति के बिना आवाज़ नहीं सुनी जाएगी।");
                resumeWakeWordAfterCommand();
            }
        }
    }

    private class SarathiBridge {
        @JavascriptInterface
        public void startListening() {
            runOnUiThread(() -> MainActivity.this.startListening());
        }

        @JavascriptInterface
        public void speak(String text) {
            String safeText = text == null ? "" : text.trim();
            if (safeText.isEmpty()) return;
            if (safeText.length() > 2500) safeText = safeText.substring(0, 2500);
            final String toSpeak = safeText;
            runOnUiThread(() -> {
                if (textToSpeech == null || !ttsReady) {
                    pendingSpeechText = toSpeak;
                    notifyVoice("onStatus", "सारथी की आवाज़ सेवा तैयार हो रही है; जवाब तैयार होते ही बोलूँगी।");
                    return;
                }
                try {
                    boolean hindiText = toSpeak.matches("(?s).*[ऀ-ॿ].*");
                    Locale language = hindiText ? new Locale("hi", "IN") : new Locale("en", "IN");

                    // Do not require a pre-discovered offline Voice object. Many Android
                    // devices expose a working default TTS voice through setLanguage().
                    int languageResult = textToSpeech.setLanguage(language);
                    if (languageResult == TextToSpeech.LANG_MISSING_DATA
                            || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                        notifyVoice("onError", hindiText
                                ? "फ़ोन में हिंदी बोलने की आवाज़ उपलब्ध नहीं है। Android की Text-to-Speech सेटिंग में हिंदी आवाज़ इंस्टॉल करें।"
                                : "फ़ोन में English बोलने की आवाज़ उपलब्ध नहीं है। Android की Text-to-Speech सेटिंग में English आवाज़ इंस्टॉल करें।");
                        return;
                    }

                    Voice selectedVoice = hindiText ? localHindiVoice : localEnglishVoice;
                    if (selectedVoice != null) {
                        textToSpeech.setVoice(selectedVoice);
                    }

                    pauseWakeWordForCommand();
                    textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String utteranceId) {}
                        @Override public void onDone(String utteranceId) {
                            mainHandler.post(MainActivity.this::resumeWakeWordAfterCommand);
                        }
                        @Override public void onError(String utteranceId) {
                            mainHandler.post(() -> {
                                notifyVoice("onError", "जवाब बोलने में समस्या हुई। फ़ोन की Text-to-Speech आवाज़ और मीडिया वॉल्यूम जाँचें।");
                                resumeWakeWordAfterCommand();
                            });
                        }
                        @Override public void onStop(String utteranceId, boolean interrupted) {
                            mainHandler.post(MainActivity.this::resumeWakeWordAfterCommand);
                        }
                    });
                    int result = textToSpeech.speak(toSpeak, TextToSpeech.QUEUE_FLUSH, null, "sarathi-local-voice");
                    if (result == TextToSpeech.ERROR) {
                        notifyVoice("onError", "जवाब बोलना शुरू नहीं हुआ। फ़ोन की Text-to-Speech सेटिंग जाँचें।");
                        resumeWakeWordAfterCommand();
                    }
                } catch (Exception error) {
                    resumeWakeWordAfterCommand();
                    notifyVoice("onError", "जवाब बोलना शुरू नहीं हो सका। फ़ोन की Text-to-Speech सेटिंग जाँचें।");
                }
            });
        }
        @JavascriptInterface
        public void openDialer(String phone) {
            String raw = phone == null ? "" : phone.trim();
            String number = raw.isEmpty() ? "" : cleanPhone(raw);
            if (!raw.isEmpty() && number == null) {
                notifyVoice("onError", "कॉल के लिए 7 से 15 अंकों का सही फ़ोन नंबर चाहिए।");
                return;
            }
            Intent dialIntent = number.isEmpty()
                    ? new Intent(Intent.ACTION_DIAL)
                    : new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null));
            runOnUiThread(() -> launchExternalIntent(
                dialIntent,
                "डायलर नहीं खुल सका।"
            ));
        }

        @JavascriptInterface
        public void composeSms(String phone, String body) {
            String number = cleanPhone(phone);
            String message = body == null ? "" : body.trim();
            if (number == null || message.isEmpty() || message.length() > 4000) {
                notifyVoice("onError", "SMS के लिए सही नंबर और 1 से 4000 अक्षर का संदेश चाहिए।");
                return;
            }
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", number, null));
                intent.putExtra("sms_body", message);
                launchExternalIntent(intent, "SMS ऐप नहीं खुला। संदेश अपने-आप नहीं भेजा गया।");
            });
        }

        @JavascriptInterface
        public void composeEmail(String email, String subject, String body) {
            String address = email == null ? "" : email.trim();
            String title = subject == null ? "" : subject.trim();
            String message = body == null ? "" : body.trim();
            if (!address.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
                    ) || address.length() > 254 || message.length() > 8000) {
                notifyVoice("onError", "ईमेल पता सही नहीं है या संदेश बहुत लंबा है।");
                return;
            }
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", address, null));
                intent.putExtra(Intent.EXTRA_SUBJECT, title);
                intent.putExtra(Intent.EXTRA_TEXT, message);
                launchExternalIntent(intent, "ईमेल ऐप नहीं खुला। ईमेल अपने-आप नहीं भेजा गया।");
            });
        }

        @JavascriptInterface
        public void setAlarm(int hour, int minute, String label) {
            if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                notifyVoice("onError", "अलार्म का समय सही नहीं है।");
                return;
            }
            String safeLabel = label == null ? "सारथी अलार्म" : label.trim();
            if (safeLabel.length() > 80) safeLabel = safeLabel.substring(0, 80);
            final String alarmLabel = safeLabel;
            runOnUiThread(() -> {
                Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
                intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
                intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
                intent.putExtra(AlarmClock.EXTRA_MESSAGE, alarmLabel);
                intent.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
                launchExternalIntent(intent, "घड़ी ऐप अलार्म सेट नहीं कर सका।");
            });
        }

        @JavascriptInterface
        public void searchYouTube(String searchText) {
            String query = searchText == null ? "" : searchText.trim();
            if (query.isEmpty() || query.length() > 200) {
                notifyVoice("onError", "YouTube खोज के लिए 1 से 200 अक्षर का नाम लिखें।");
                return;
            }
            Uri searchUri = Uri.parse("https://www.youtube.com/results")
                    .buildUpon().appendQueryParameter("search_query", query).build();
            runOnUiThread(() -> launchExternalIntent(
                    new Intent(Intent.ACTION_VIEW, searchUri),
                    "YouTube खोज नहीं खुल सकी।"
            ));
        }

        @JavascriptInterface
        public void openApp(String appName) {
            String key = appName == null ? "" : appName.trim().toLowerCase(Locale.ROOT);
            Intent intent = null;
            switch (key) {
                case "browser":
                    intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_BROWSER);
                    break;
                case "messages":
                    intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MESSAGING);
                    break;
                case "email":
                    intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_EMAIL);
                    break;
                case "calendar":
                    intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALENDAR);
                    break;
                case "contacts":
                    intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CONTACTS);
                    break;
                case "maps":
                    intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MAPS);
                    break;
                case "settings":
                    intent = new Intent(android.provider.Settings.ACTION_SETTINGS);
                    break;
                case "phone":
                case "dialer":
                    intent = new Intent(Intent.ACTION_DIAL);
                    break;
                case "youtube":
                    intent = getPackageManager().getLaunchIntentForPackage("com.google.android.youtube");
                    if (intent == null) intent = findInstalledAppIntent("YouTube");
                    break;
                case "whatsapp":
                    intent = getPackageManager().getLaunchIntentForPackage("com.whatsapp");
                    if (intent == null) intent = findInstalledAppIntent("WhatsApp");
                    break;
                default:
                    intent = findInstalledAppIntent(appName);
                    break;
            }
            final Intent launch = intent;
            runOnUiThread(() -> {
                if (launch == null) {
                    notifyVoice("onError", "इस नाम का ऐप फ़ोन में नहीं मिला। ऐप का नाम जाँचकर फिर बोलें।");
                } else {
                    launchExternalIntent(launch, "ऐप नहीं खुल सका।");
                }
            });
        }

        private Intent findInstalledAppIntent(String requestedName) {
            String wanted = normalizeAppName(requestedName);
            if (wanted.isEmpty()) return null;

            Intent launcherQuery = new Intent(Intent.ACTION_MAIN);
            launcherQuery.addCategory(Intent.CATEGORY_LAUNCHER);
            try {
                for (ResolveInfo info : getPackageManager().queryIntentActivities(launcherQuery, 0)) {
                    if (info.activityInfo == null) continue;
                    CharSequence label = info.loadLabel(getPackageManager());
                    if (label != null && wanted.equals(normalizeAppName(label.toString()))) {
                        Intent launch = new Intent(Intent.ACTION_MAIN);
                        launch.addCategory(Intent.CATEGORY_LAUNCHER);
                        launch.setClassName(info.activityInfo.packageName, info.activityInfo.name);
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        return launch;
                    }
                }
            } catch (Exception ignored) {
                return null;
            }
            return null;
        }

        private String normalizeAppName(String value) {
            return value == null ? "" : value.toLowerCase(Locale.ROOT)
                    .replaceAll("[^\\p{L}\\p{N}]", "");
        }

        private String cleanPhone(String value) {
            String number = value == null ? "" : value.replaceAll("[^0-9+]", "");
            return number.matches("^\\+?[0-9]{7,15}$") ? number : null;
        }

        private void launchExternalIntent(Intent intent, String errorMessage) {
            try {
                startActivity(intent);
            } catch (Exception ignored) {
                notifyVoice("onError", errorMessage);
            }
        }

        @JavascriptInterface
        public void startWakeWord() {
            runOnUiThread(() -> {
                if (!hasMicrophonePermission()) {
                    pendingWakeStart = true;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
                    notifyVoice("onStatus", "वेक-वर्ड चालू करने के लिए माइक्रोफ़ोन अनुमति दें।");
                    return;
                }
                startWakeWordService();
            });
        }

        @JavascriptInterface
        public void stopWakeWord() {
            Intent service = new Intent(MainActivity.this, WakeWordService.class);
            service.setAction(WakeWordService.ACTION_STOP);
            startService(service);
            notifyVoice("onStatus", "वेक-वर्ड सेवा बंद करने का अनुरोध भेजा गया।");
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (textToSpeech != null) textToSpeech.stop();
            });
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        appInForeground = true;
    }

    @Override
    protected void onPause() {
        appInForeground = false;
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWakeCommandIntent(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = resultCode == RESULT_OK && data != null
                ? WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                : null;
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        appInForeground = false;
        if (wakeReceiverRegistered) {
            try { unregisterReceiver(wakeDetectedReceiver); } catch (Exception ignored) {}
            wakeReceiverRegistered = false;
        }
        if (speechRecognizer != null) {
            speechRecognizer.cancel();
            speechRecognizer.destroy();
            speechRecognizer = null;
        }
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        resumeWakeWordAfterCommand();
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("SarathiNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
