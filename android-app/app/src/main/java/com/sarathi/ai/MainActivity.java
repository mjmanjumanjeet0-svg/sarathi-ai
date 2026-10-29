package com.sarathi.ai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.provider.AlarmClock;
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
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    private static final int REQUEST_RECORD_AUDIO = 1201;
    private static final String APP_HOST = "mjmanjumanjeet0-svg.github.io";
    private WebView webView;
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech textToSpeech;
    private Voice localHindiVoice;
    private boolean pendingListen = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

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
                try {
                    Set<Voice> voices = textToSpeech.getVoices();
                    if (voices != null) {
                        for (Voice voice : voices) {
                            Locale locale = voice.getLocale();
                            if (locale != null
                                    && "hi".equalsIgnoreCase(locale.getLanguage())
                                    && ("IN".equalsIgnoreCase(locale.getCountry()) || locale.getCountry().isEmpty())
                                    && !voice.isNetworkConnectionRequired()) {
                                localHindiVoice = voice;
                                textToSpeech.setVoice(voice);
                                break;
                            }
                        }
                    }
                } catch (Exception ignored) {
                    localHindiVoice = null;
                }
            }
        });

        webView.addJavascriptInterface(new SarathiBridge(), "SarathiNative");
        webView.setWebViewClient(new WebViewClient() {
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
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingListen = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            notifyVoice("onError", "इस Android संस्करण पर सुरक्षित ऑफ़लाइन आवाज़ पहचान उपलब्ध नहीं है। आवाज़ इंटरनेट पर भेजने के बजाय इसे बंद रखा गया है।");
            return;
        }

        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
            notifyVoice("onError", "ऑफ़लाइन हिंदी आवाज़ पहचान उपलब्ध नहीं है। फ़ोन में हिंदी का ऑफ़लाइन भाषा पैक उपलब्ध होने पर फिर कोशिश करें।");
            return;
        }

        try {
            if (speechRecognizer != null) {
                speechRecognizer.cancel();
                speechRecognizer.destroy();
            }
            speechRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    notifyVoice("onStatus", "बोलिए, सारथी फ़ोन पर ही सुन रहा है…");
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {
                    notifyVoice("onStatus", "आवाज़ समझी जा रही है…");
                }
                @Override public void onError(int error) {
                    notifyVoice("onError", "आवाज़ पहचान नहीं हो सकी। हिंदी का ऑफ़लाइन भाषा पैक और माइक्रोफ़ोन अनुमति जाँचें।");
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> matches = results == null ? null
                        : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        notifyVoice("onResult", matches.get(0));
                    } else {
                        notifyVoice("onError", "आवाज़ से शब्द समझ नहीं आए। फिर बोलकर देखें।");
                    }
                }
                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            speechRecognizer.startListening(intent);
        } catch (Exception error) {
            notifyVoice("onError", "माइक्रोफ़ोन शुरू नहीं हो सका।");
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_RECORD_AUDIO) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && pendingListen) {
                pendingListen = false;
                startListening();
            } else {
                pendingListen = false;
                notifyVoice("onError", "माइक्रोफ़ोन अनुमति नहीं मिली। अनुमति के बिना आवाज़ नहीं सुनी जाएगी।");
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
            if (safeText.length() > 2500) safeText = safeText.substring(0, 2500);
            final String toSpeak = safeText;
            runOnUiThread(() -> {
                if (textToSpeech == null || localHindiVoice == null) {
                    notifyVoice("onError", "फ़ोन में ऑफ़लाइन हिंदी आवाज़ उपलब्ध नहीं है। कुछ भी इंटरनेट पर भेजकर नहीं सुनाया गया।");
                    return;
                }
                textToSpeech.speak(toSpeak, TextToSpeech.QUEUE_FLUSH, null, "sarathi-local-voice");
            });
        }

        @JavascriptInterface
        public void openDialer(String phone) {
            String number = cleanPhone(phone);
            if (number == null) {
                notifyVoice("onError", "कॉल के लिए 7 से 15 अंकों का फ़ोन नंबर चाहिए।");
                return;
            }
            runOnUiThread(() -> launchExternalIntent(
                new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)),
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
                case "youtube":
                    intent = getPackageManager().getLaunchIntentForPackage("com.google.android.youtube");
                    break;
                case "whatsapp":
                    intent = getPackageManager().getLaunchIntentForPackage("com.whatsapp");
                    break;
                default:
                    notifyVoice("onError", "यह ऐप अभी सुरक्षित सूची में नहीं है।");
                    return;
            }
            final Intent launch = intent;
            runOnUiThread(() -> {
                if (launch == null) {
                    notifyVoice("onError", "यह ऐप फ़ोन में इंस्टॉल नहीं है या खुल नहीं सका।");
                } else {
                    launchExternalIntent(launch, "ऐप नहीं खुल सका।");
                }
            });
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
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (textToSpeech != null) textToSpeech.stop();
            });
        }
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
        if (webView != null) {
            webView.removeJavascriptInterface("SarathiNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
