package com.sarathi.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.Context;
import android.content.pm.PackageManager;
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
import android.webkit.JsPromptResult;
import android.widget.EditText;
import android.text.InputType;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;

import org.json.JSONObject;
import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    private static final int REQUEST_RECORD_AUDIO = 1201;
    private static final int REQUEST_SPEECH_ACTIVITY = 1204;
    private boolean speechActivityFallbackLaunched = false;
    // Online speech permission is remembered only for the current user-started voice session.
    private boolean voiceSessionOnlineConsent = false;
    private boolean voiceConversationActive = false;
    private boolean voiceRequestInProgress = false;
    // Preserve an active hands-free session when another app (for example YouTube) temporarily covers Sarathi.
    private boolean nativeListeningPausedForAppPause = false;
    private int voiceRecognitionRetryAttempt = 0;
    private Runnable voiceRecognitionRetry;
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
    private boolean nativeStopRequested = false;
    private String selectedSpeechLanguage = "hi-IN";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // The app shell is hosted on GitHub Pages; avoid stale cached JavaScript
        // after web fixes are published.
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
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
                                    && (localHindiVoice == null || voice.getQuality() > localHindiVoice.getQuality())) {
                                localHindiVoice = voice;
                            } else if ("en".equalsIgnoreCase(locale.getLanguage())
                                    && ("IN".equalsIgnoreCase(locale.getCountry()) || "US".equalsIgnoreCase(locale.getCountry())
                                    || locale.getCountry().isEmpty())
                                    && (localEnglishVoice == null || voice.getQuality() > localEnglishVoice.getQuality())) {
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
            public boolean onJsPrompt(WebView view, String url, String message,
                    String defaultValue, JsPromptResult result) {
                Uri pageUri = Uri.parse(url == null ? "" : url);
                if (!"https".equalsIgnoreCase(pageUri.getScheme())
                        || !APP_HOST.equalsIgnoreCase(pageUri.getHost())) {
                    result.cancel();
                    return true;
                }
                EditText passwordInput = new EditText(MainActivity.this);
                passwordInput.setSingleLine(true);
                passwordInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
                passwordInput.setHint("लॉगिन पासवर्ड");
                new android.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle("सारथी AI लॉगिन")
                        .setMessage(message == null ? "अपना लॉगिन पासवर्ड लिखें:" : message)
                        .setView(passwordInput)
                        .setPositiveButton("लॉगिन", (dialog, which) ->
                                result.confirm(passwordInput.getText().toString()))
                        .setNegativeButton("रद्द करें", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

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
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if ("https".equalsIgnoreCase(scheme) && APP_HOST.equalsIgnoreCase(host)) {
                    return false;
                }
                // बाहरी लिंक से दूसरे ऐप/ब्राउज़र को अपने-आप नहीं खोलते।
                return true;
            }
        });

        webView.loadUrl("https://" + APP_HOST + "/sarathi-ai/");
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
        nativeListeningPausedForAppPause = false;
        voiceRequestInProgress = false;
        voiceConversationActive = true;
        // Prepare (but pause) the foreground microphone service while this
        // Activity is visible. It can take over only when another app opens.
        prepareBackgroundConversationService();
        voiceRecognitionRetryAttempt = 0;
        if (voiceRecognitionRetry != null) mainHandler.removeCallbacks(voiceRecognitionRetry);
        voiceRecognitionRetry = null;
        // After the user has explicitly approved online recognition once in this
        // voice conversation, reuse that choice for subsequent turns without
        // showing the consent dialog after every spoken question.
        if (voiceSessionOnlineConsent) {
            startRecognition(true);
            return;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            selectedSpeechLanguage = "auto";
            beginListeningWithSelectedLanguage();
            return;
        }
        selectedSpeechLanguage = "hi-IN";
        beginListeningWithSelectedLanguage();
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
                .setPositiveButton("हाँ, इस बातचीत में इस्तेमाल करें", (dialog, which) -> {
                    voiceSessionOnlineConsent = true;
                    startRecognition(true);
                })
                .setNegativeButton("रद्द करें", (dialog, which) -> {
                    notifyVoice("onError", "ऑनलाइन आवाज़ पहचान रद्द कर दी गई। आपकी आवाज़ नहीं सुनी गई।");
                    })
                .setOnCancelListener(dialog -> {
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

    private void launchSystemSpeechActivity() {
        speechActivityFallbackLaunched = true;
        SpeechRecognizer current = speechRecognizer;
        speechRecognizer = null;
        if (current != null) {
            try { current.cancel(); } catch (Exception ignored) {}
            try { current.destroy(); } catch (Exception ignored) {}
        }
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,
                    "auto".equals(selectedSpeechLanguage) ? "hi-IN" : selectedSpeechLanguage);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "सारथी के लिए बोलिए");
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            startActivityForResult(intent, REQUEST_SPEECH_ACTIVITY);
        } catch (Exception error) {
            speechActivityFallbackLaunched = false;
            notifyVoice("onError", "फ़ोन की आवाज़ पहचान विंडो नहीं खुल सकी। Google ऐप या Speech Services की अनुमति जाँचें।");
            }
    }

    // Pause only the current recognition request while Sarathi prepares a reply.
    // Keep the voice session and its consent alive for the next conversational turn.
    private void pauseNativeListeningForReply() {
        nativeStopRequested = true;
        SpeechRecognizer current = speechRecognizer;
        speechRecognizer = null;
        if (current != null) {
            try { current.cancel(); } catch (Exception ignored) {}
            try { current.destroy(); } catch (Exception ignored) {}
        }
    }

    private void stopNativeListening() {
        nativeListeningPausedForAppPause = false;
        voiceConversationActive = false;
        voiceSessionOnlineConsent = false;
        voiceRecognitionRetryAttempt = 0;
        if (voiceRecognitionRetry != null) mainHandler.removeCallbacks(voiceRecognitionRetry);
        voiceRecognitionRetry = null;
        nativeStopRequested = true;
        SpeechRecognizer current = speechRecognizer;
        speechRecognizer = null;
        if (current != null) {
            try { current.cancel(); } catch (Exception ignored) {}
            try { current.destroy(); } catch (Exception ignored) {}
        }
}

    private void scheduleVoiceRecognitionRetry(boolean online) {
        if (!voiceConversationActive || isFinishing()) return;
        if (voiceRecognitionRetry != null) mainHandler.removeCallbacks(voiceRecognitionRetry);
        voiceRecognitionRetryAttempt = Math.min(voiceRecognitionRetryAttempt + 1, 6);
        long delayMs = Math.min(900L * voiceRecognitionRetryAttempt, 5000L);
        notifyVoice("onStatus", "सारथी सुन रहा है। आवाज़ साफ़ नहीं मिली तो अपने-आप फिर कोशिश करेगा…");
        voiceRecognitionRetry = () -> {
            voiceRecognitionRetry = null;
            if (!voiceConversationActive || isFinishing()) return;
            startRecognition(online);
        };
        mainHandler.postDelayed(voiceRecognitionRetry, delayMs);
    }

    private boolean hasMicrophonePermission() {
        return Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void startRecognition(boolean useOnlineService) {
        nativeStopRequested = false;
        try {
            // Re-check permission immediately before starting the speech service.
            if (!hasMicrophonePermission()) {
                pendingListen = true;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
                return;
            }
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                if (voiceConversationActive && useOnlineService) {
                    notifyVoice("onStatus", "फ़ोन की आवाज़ सेवा अभी उपलब्ध नहीं है। सारथी फिर कोशिश करेगा…");
                    scheduleVoiceRecognitionRetry(true);
                } else {
                    notifyVoice("onError", "इस फ़ोन में कोई आवाज़ पहचान सेवा उपलब्ध नहीं मिली। Google ऐप या Speech Services इंस्टॉल/अपडेट करें और फिर कोशिश करें।");
                    }
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

            final SpeechRecognizer recognizerForSession = speechRecognizer;
            recognizerForSession.setRecognitionListener(new RecognitionListener() {
                private boolean isCurrentRecognizer() {
                    return speechRecognizer == recognizerForSession && !nativeStopRequested;
                }
                @Override public void onReadyForSpeech(Bundle params) {
                    if (!isCurrentRecognizer()) return;
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
                    if (!isCurrentRecognizer()) return;
                    notifyVoice("onStatus", "आवाज़ समझी जा रही है…");
                }
                @Override public void onError(int error) {
                    if (!isCurrentRecognizer()) return;
                    if (nativeStopRequested) {
                        nativeStopRequested = false;
                        return;
                    }
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                            && !hasMicrophonePermission()) {
                        pendingListen = false;
                        notifyVoice("onError", "Android ने माइक्रोफ़ोन अनुमति नहीं दी। सेटिंग में Sarathi AI → माइक्रोफ़ोन → केवल ऐप इस्तेमाल करते समय अनुमति चुनें।");
                        } else if (!useOnlineService) {
                        // If the offline provider fails (including provider-side error 9),
                        // offer the normal recognizer only after explicit per-use consent.
                        mainHandler.post(() -> showOnlineVoiceConsent(
                                error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                                        ? "Sarathi AI को माइक्रोफ़ोन अनुमति मिली है, लेकिन फ़ोन की ऑफ़लाइन स्पीच सेवा ने अनुमति त्रुटि (कोड 9) दी। क्या आप इस बार इंटरनेट के माध्यम से आवाज़ पहचान इस्तेमाल करना चाहते हैं?"
                                        : "इस फ़ोन की ऑफ़लाइन हिंदी आवाज़ पहचान अभी काम नहीं कर पाई। क्या आप इस बार इंटरनेट के माध्यम से आवाज़ पहचान इस्तेमाल करना चाहते हैं?"
                        ));
                    } else if (voiceConversationActive && useOnlineService
                            && error != SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        // No-match, silence, network hiccups and provider restarts must
                        // never terminate an active hands-free conversation.
                        notifyVoice("onStatus", error == SpeechRecognizer.ERROR_NO_MATCH
                                || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                                ? "आवाज़ साफ़ नहीं मिली। सारथी फिर सुन रहा है…"
                                : "आवाज़ सेवा में थोड़ी रुकावट आई। सारथी फिर सुन रहा है…");
                        scheduleVoiceRecognitionRetry(true);
                    } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                            && useOnlineService && !speechActivityFallbackLaunched) {
                        // Some Android speech providers reject direct app-bound recognition
                        // with error 9 even when RECORD_AUDIO is granted. Fall back to the
                        // system recognition UI, which delegates capture to the provider's
                        // own activity. This path is reached only after per-use online consent.
                        launchSystemSpeechActivity();
                    } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        notifyVoice("onError", "Android की स्पीच सेवा ने अनुमति त्रुटि (कोड 9) दी। सारथी की ऐप अनुमति चालू है, फिर भी फ़ोन की पहचान सेवा ने सीधे सुनने की अनुमति नहीं दी।");
                        } else {
                        notifyVoice("onError", getSpeechErrorMessage(error, true));
                        }
                    if (speechRecognizer == recognizerForSession) {
                        recognizerForSession.destroy();
                        speechRecognizer = null;
                    }
                }
                @Override public void onResults(Bundle results) {
                    if (!isCurrentRecognizer()) return;
                    if (nativeStopRequested) {
                        nativeStopRequested = false;
                        return;
                    }
                    ArrayList<String> matches = results == null ? null
                        : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        notifyVoice("onResult", matches.get(0));
                    } else if (voiceConversationActive && useOnlineService) {
                        notifyVoice("onStatus", "आवाज़ साफ़ नहीं मिली। सारथी फिर सुन रहा है…");
                        scheduleVoiceRecognitionRetry(true);
                    } else {
                        notifyVoice("onError", "आवाज़ से शब्द समझ नहीं आए। फिर बोलकर देखें।");
                    }
                    if (voiceConversationActive && useOnlineService) {
                        // Keep the active foreground voice session ready for its next turn.
                        if (matches != null && !matches.isEmpty()) voiceRecognitionRetryAttempt = 0;
                    } else {
                        voiceRecognitionRetryAttempt = 0;
                        }
                    if (speechRecognizer == recognizerForSession) {
                        recognizerForSession.destroy();
                        speechRecognizer = null;
                    }
                }
                @Override public void onPartialResults(Bundle partialResults) {
                    if (!isCurrentRecognizer()) return;
                }
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
            if (voiceConversationActive && useOnlineService) {
                notifyVoice("onStatus", "माइक्रोफ़ोन फिर से शुरू किया जा रहा है…");
                scheduleVoiceRecognitionRetry(true);
            } else {
                notifyVoice("onError", "माइक्रोफ़ोन शुरू नहीं हो सका।");
                }
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
            } else {
                pendingListen = false;
                notifyVoice("onError", "माइक्रोफ़ोन अनुमति नहीं मिली। अनुमति के बिना आवाज़ नहीं सुनी जाएगी।");
            }
        }
    }

    private class SarathiBridge {
        @JavascriptInterface
        public void startListening() {
            runOnUiThread(() -> {
                MainActivity.this.startListening();
            });
        }

        @JavascriptInterface
        public void setVoiceRequestInProgress(boolean inProgress) {
            runOnUiThread(() -> voiceRequestInProgress = inProgress);
        }

        @JavascriptInterface
        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(MainActivity.this::pauseNativeListeningForReply);
        }

        @JavascriptInterface
        public void endVoiceConversation() {
            runOnUiThread(MainActivity.this::stopNativeListening);
        }

        @JavascriptInterface
        public void speak(String text) {
            String safeText = text == null ? "" : text.trim();
            if (safeText.isEmpty()) return;
            if (safeText.length() > 2500) safeText = safeText.substring(0, 2500);
            final String toSpeak = safeText;
            runOnUiThread(() -> {
                voiceRequestInProgress = false;
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
                        if (voiceConversationActive) notifyVoice("onSpeechComplete", "");
                        else MainActivity.this.return;
                    }

                    Voice selectedVoice = hindiText ? localHindiVoice : localEnglishVoice;
                    if (selectedVoice != null) {
                        textToSpeech.setVoice(selectedVoice);
                    }
                    // Slightly slower pacing and a gentle pitch lift can make the
                    // built-in Android voice less rushed and more conversational.
                    textToSpeech.setSpeechRate(0.94f);
                    textToSpeech.setPitch(1.04f);

                    textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String utteranceId) {}
                        @Override public void onDone(String utteranceId) {
                            mainHandler.post(() -> {
                                if (voiceConversationActive) {
                                    notifyVoice("onSpeechComplete", "");
                                } else {
                                    MainActivity.this.}
                            });
                        }
                        @Override public void onError(String utteranceId) {
                            mainHandler.post(() -> {
                                if (voiceConversationActive) {
                                    notifyVoice("onStatus", "जवाब की आवाज़ में रुकावट आई। अब आप बोल सकते हैं।");
                                    notifyVoice("onSpeechComplete", "");
                                } else {
                                    notifyVoice("onError", "जवाब बोलने में समस्या हुई। फ़ोन की Text-to-Speech आवाज़ और मीडिया वॉल्यूम जाँचें।");
                                    }
                            });
                        }
                        @Override public void onStop(String utteranceId, boolean interrupted) {
                            mainHandler.post(() -> {
                                if (voiceConversationActive) notifyVoice("onSpeechComplete", "");
                                else MainActivity.this.});
                        }
                    });
                    int result = textToSpeech.speak(toSpeak, TextToSpeech.QUEUE_FLUSH, null, "sarathi-local-voice");
                    if (result == TextToSpeech.ERROR) {
                        notifyVoice("onError", "जवाब बोलना शुरू नहीं हुआ। फ़ोन की Text-to-Speech सेटिंग जाँचें।");
                        if (voiceConversationActive) notifyVoice("onSpeechComplete", "");
                        else }
                } catch (Exception error) {
                    if (voiceConversationActive) notifyVoice("onSpeechComplete", "");
                    else notifyVoice("onError", "जवाब बोलना शुरू नहीं हो सका। फ़ोन की Text-to-Speech सेटिंग जाँचें।");
                }
            });
        }
        @JavascriptInterface
        public String getInstalledApps() {
            JSONArray apps = new JSONArray();
            try {
                Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
                launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                for (android.content.pm.ResolveInfo info : getPackageManager().queryIntentActivities(launcherIntent, 0)) {
                    if (info == null || info.activityInfo == null) continue;
                    String packageName = info.activityInfo.packageName;
                    if (packageName == null || packageName.equals(getPackageName())) continue;
                    JSONObject item = new JSONObject();
                    item.put("label", String.valueOf(info.loadLabel(getPackageManager())));
                    item.put("packageName", packageName);
                    apps.put(item);
                }
            } catch (Exception ignored) {}
            return apps.toString();
        }

        @JavascriptInterface
        public void openAppPackage(String requestedPackage) {
            final String packageName = requestedPackage == null ? "" : requestedPackage.trim();
            if (!packageName.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+")) {
                notifyVoice("onError", "ऐप का नाम मान्य नहीं है।");
                return;
            }
            runOnUiThread(() -> {
                try {
                    Intent launch = getPackageManager().getLaunchIntentForPackage(packageName);
                    if (launch == null) {
                        notifyVoice("onError", "यह ऐप फ़ोन में इंस्टॉल नहीं है या खुल नहीं सका।");
                        return;
                    }
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                    notifyVoice("onStatus", "ऐप खोला जा रहा है।");
                } catch (Exception error) {
                    notifyVoice("onError", "ऐप नहीं खुल सका।");
                }
            });
        }

        @JavascriptInterface
        public void openPhone() {
            runOnUiThread(() -> {
                try {
                    Intent dial = new Intent(Intent.ACTION_DIAL);
                    dial.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(dial);
                    notifyVoice("onStatus", "फ़ोन डायलर खोला जा रहा है।");
                } catch (Exception error) {
                    notifyVoice("onError", "फ़ोन डायलर नहीं खुल सका।");
                }
            });
        }

        @JavascriptInterface
        public void openApp(String appKey) {
            final String key = appKey == null ? "" : appKey.trim().toLowerCase(Locale.ROOT);
            runOnUiThread(() -> {
                String packageName;
                switch (key) {
                    case "youtube": packageName = "com.google.android.youtube"; break;
                    case "chatgpt": packageName = "com.openai.chatgpt"; break;
                    case "whatsapp": packageName = "com.whatsapp"; break;
                    case "chrome": packageName = "com.android.chrome"; break;
                    case "maps": packageName = "com.google.android.apps.maps"; break;
                    case "gmail": packageName = "com.google.android.gm"; break;
                    case "instagram": packageName = "com.instagram.android"; break;
                    case "telegram": packageName = "org.telegram.messenger"; break;
                    default:
                        notifyVoice("onError", "यह ऐप खोलने की अनुमति सूची में नहीं है।");
                        return;
                }
                try {
                    Intent launch = getPackageManager().getLaunchIntentForPackage(packageName);
                    if (launch == null) {
                        notifyVoice("onError", "यह ऐप फ़ोन में इंस्टॉल नहीं है या खुल नहीं सका।");
                        return;
                    }
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                    notifyVoice("onStatus", "ऐप खोला जा रहा है।");
                } catch (Exception error) {
                    notifyVoice("onError", "ऐप नहीं खुल सका। फ़ोन में ऐप की उपलब्धता जाँचें।");
                }
            });
        }

        @JavascriptInterface
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
        if (nativeListeningPausedForAppPause && voiceConversationActive) {
            nativeListeningPausedForAppPause = false;
            if (!voiceRequestInProgress) startListening();
        }
    }

    @Override
    protected void onPause() {
        if (voiceConversationActive && !speechActivityFallbackLaunched) {
            nativeListeningPausedForAppPause = true;
            if (voiceRecognitionRetry != null) mainHandler.removeCallbacks(voiceRecognitionRetry);
            voiceRecognitionRetry = null;
            pauseNativeListeningForReply();
        }
        super.onPause();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_SPEECH_ACTIVITY) {
            speechActivityFallbackLaunched = false;
            ArrayList<String> matches = resultCode == RESULT_OK && data != null
                    ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
            if (matches != null && !matches.isEmpty() && matches.get(0) != null
                    && !matches.get(0).trim().isEmpty()) {
                notifyVoice("onResult", matches.get(0).trim());
            } else {
                notifyVoice("onError", resultCode == RESULT_CANCELED
                        ? "आवाज़ पहचान रद्द कर दी गई।" : "आवाज़ से शब्द नहीं मिले। फिर कोशिश करें।");
            }
            return;
        }
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
