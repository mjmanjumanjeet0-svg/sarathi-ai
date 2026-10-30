package com.sarathi.ai;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.Locale;

public class WakeWordService extends Service {
    public static final String ACTION_START = "com.sarathi.ai.WAKE_START";
    public static final String ACTION_STOP = "com.sarathi.ai.WAKE_STOP";
    private static final String CHANNEL = "sarathi_wake_channel";
    private static final int NOTIFICATION_ID = 771;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean running = false;
    private TextToSpeech textToSpeech;
    private boolean speaking = false;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        android.content.SharedPreferences prefs =
                getSharedPreferences("sarathi_wake_settings", MODE_PRIVATE);
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            prefs.edit().putBoolean("enabled", false).apply();
            stopListening();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent == null && !prefs.getBoolean("enabled", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            prefs.edit().putBoolean("enabled", true).apply();
        }
        if (!running) {
            if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                prefs.edit().putBoolean("enabled", false).apply();
                stopSelf();
                return START_NOT_STICKY;
            }
            startForeground(NOTIFICATION_ID, buildNotification("सारथी वेक-वर्ड चालू है — बंद करने तक सुनता रहेगा"));
            running = true;
            beginRecognition();
        }
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "सारथी वेक-वर्ड", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("आपके कहने पर 'सारथी' शब्द पहचानने के लिए माइक्रोफ़ोन सेवा");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 771, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("सारथी AI").setContentText(text)
                .setContentIntent(pending).setOngoing(true).build();
    }

    private void beginRecognition() {
        if (!running) return;
        try {
            if (recognizer != null) { recognizer.destroy(); recognizer = null; }
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(android.os.Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onError(int error) { scheduleRestart(900); }
                @Override public void onResults(android.os.Bundle results) {
                    ArrayList<String> words = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (words != null) {
                        for (String word : words) {
                            String normalized = word.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}]", "");
                            if (normalized.contains("सारथी") || normalized.contains("sarathi")) {
                                showWakeNotification();
                                speakWakeReply();
                                return;
                            }
                        }
                    }
                    scheduleRestart(500);
                }
                @Override public void onPartialResults(android.os.Bundle partialResults) {}
                @Override public void onEvent(int eventType, android.os.Bundle params) {}
            });
            Intent request = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            request.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            request.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
            request.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            request.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            recognizer.startListening(request);
        } catch (Exception ignored) { scheduleRestart(2000); }
    }

    private void speakWakeReply() {
        if (!running || speaking) return;
        speaking = true;
        if (textToSpeech == null) {
            textToSpeech = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                    int language = textToSpeech.setLanguage(new Locale("hi", "IN"));
                    if (language == TextToSpeech.LANG_MISSING_DATA
                            || language == TextToSpeech.LANG_NOT_SUPPORTED) {
                        speaking = false;
                        scheduleRestart(700);
                        return;
                    }
                    speakGreeting();
                } else {
                    speaking = false;
                    scheduleRestart(700);
                }
            });
        } else {
            speakGreeting();
        }
    }

    private void speakGreeting() {
        if (!running || textToSpeech == null) {
            speaking = false;
            return;
        }
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String utteranceId) {}
            @Override public void onDone(String utteranceId) {
                handler.post(() -> {
                    speaking = false;
                    scheduleRestart(350);
                });
            }
            @Override public void onError(String utteranceId) {
                handler.post(() -> {
                    speaking = false;
                    scheduleRestart(700);
                });
            }
        });
        if (Build.VERSION.SDK_INT >= 21) {
            textToSpeech.speak("जी, बताइए।", TextToSpeech.QUEUE_FLUSH, null, "sarathi_wake_reply");
        } else {
            textToSpeech.speak("जी, बताइए।", TextToSpeech.QUEUE_FLUSH, null);
        }
    }

    private void scheduleRestart(long delay) {
        handler.postDelayed(() -> { if (running && !speaking) beginRecognition(); }, delay);
    }

    private void showWakeNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID + 1, buildWakeNotification());
    }

    private Notification buildWakeNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 772, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("सारथी ने आपकी आवाज़ सुनी")
                .setContentText("सारथी खोलने के लिए यहाँ दबाएँ।")
                .setContentIntent(pending).setAutoCancel(true).build();
    }

    private void stopListening() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
        if (textToSpeech != null) { textToSpeech.stop(); textToSpeech.shutdown(); textToSpeech = null; }
    }

    @Override public void onDestroy() { stopListening(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
