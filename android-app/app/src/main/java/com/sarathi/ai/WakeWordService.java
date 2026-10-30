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
import android.content.pm.PackageManager;
import android.Manifest;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.SpeechService;
import org.vosk.android.RecognitionListener;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class WakeWordService extends Service {
    public static final String ACTION_START = "com.sarathi.ai.WAKE_START";
    public static final String ACTION_STOP = "com.sarathi.ai.WAKE_STOP";
    private static final String CHANNEL = "sarathi_wake_channel";
    private static final int NOTIFICATION_ID = 771;
    private static final String MODEL_NAME = "vosk-model-small-hi-0.22";
    private static final String MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean running = false;
    private volatile boolean speaking = false;
    private Model model;
    private Recognizer recognizer;
    private SpeechService speechService;
    private TextToSpeech textToSpeech;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        android.content.SharedPreferences prefs = getSharedPreferences("sarathi_wake_settings", MODE_PRIVATE);
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
        if (intent != null && ACTION_START.equals(intent.getAction())) prefs.edit().putBoolean("enabled", true).apply();
        if (!running) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                prefs.edit().putBoolean("enabled", false).apply();
                stopSelf();
                return START_NOT_STICKY;
            }
            startForeground(NOTIFICATION_ID, buildNotification("पहली बार हिंदी मॉडल डाउनलोड हो रहा है…"));
            running = true;
            worker.execute(this::prepareModelAndListen);
        }
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "सारथी वेक-वर्ड", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("सारथी का ऑफ़लाइन हिंदी वेक-वर्ड");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 771, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("सारथी AI")
                .setContentText(text).setContentIntent(pending).setOngoing(true).build();
    }

    private void updateStatus(String message) {
        if (!running) return;
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification(message));
    }

    private void prepareModelAndListen() {
        try {
            File modelsDir = new File(getFilesDir(), "models");
            if (!modelsDir.exists() && !modelsDir.mkdirs()) throw new Exception("मॉडल फ़ोल्डर नहीं बन पाया");
            File modelDir = new File(modelsDir, MODEL_NAME);
            File marker = new File(modelDir, "am/final.mdl");
            if (!marker.isFile()) {
                updateStatus("हिंदी मॉडल डाउनलोड हो रहा है (लगभग 42 MB)…");
                File zipFile = new File(modelsDir, MODEL_NAME + ".zip");
                downloadModel(zipFile);
                updateStatus("हिंदी मॉडल तैयार किया जा रहा है…");
                unzipModel(zipFile, modelsDir);
                zipFile.delete();
            }
            if (!running) return;
            if (!marker.isFile()) throw new Exception("हिंदी मॉडल अधूरा है");
            model = new Model(modelDir.getAbsolutePath());
            recognizer = new Recognizer(model, 16000.0f);
            speechService = new SpeechService(recognizer, 16000.0f);
            updateStatus("सारथी ऑफ़लाइन हिंदी में सुन रहा है — बंद करने तक");
            speechService.startListening(new RecognitionListener() {
                @Override public void onPartialResult(String hypothesis) { handleRecognition(hypothesis); }
                @Override public void onResult(String result) { handleRecognition(result); }
                @Override public void onFinalResult(String result) { handleRecognition(result); }
                @Override public void onError(Exception exception) {
                    if (running) updateStatus("माइक्रोफ़ोन में समस्या: अनुमति जाँचें और दोबारा चालू करें");
                }
                @Override public void onTimeout() {}
            });
        } catch (Exception error) {
            handler.post(() -> {
                if (running) {
                    updateStatus("मॉडल तैयार नहीं हुआ। इंटरनेट और खाली जगह जाँचें; फिर दोबारा चालू करें।");
                    getSharedPreferences("sarathi_wake_settings", MODE_PRIVATE).edit().putBoolean("enabled", false).apply();
                    stopListening();
                    stopForeground(true);
                    stopSelf();
                }
            });
        }
    }

    private void downloadModel(File destination) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        connection.connect();
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new Exception("मॉडल डाउनलोड नहीं हुआ");
            File temp = new File(destination.getParentFile(), destination.getName() + ".part");
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[16384];
                int count;
                while (running && (count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.getFD().sync();
            }
            if (!running) { temp.delete(); return; }
            if (!temp.renameTo(destination)) throw new Exception("डाउनलोड फ़ाइल सेव नहीं हुई");
        } finally {
            connection.disconnect();
        }
    }

    private void unzipModel(File zipFile, File destination) throws Exception {
        String root = destination.getCanonicalPath() + File.separator;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[16384];
            while (running && (entry = zip.getNextEntry()) != null) {
                File output = new File(destination, entry.getName());
                if (!output.getCanonicalPath().startsWith(root)) throw new SecurityException("Invalid model archive path");
                if (entry.isDirectory()) {
                    if (!output.exists() && !output.mkdirs()) throw new Exception("मॉडल फ़ोल्डर नहीं बन पाया");
                } else {
                    File parent = output.getParentFile();
                    if (!parent.exists() && !parent.mkdirs()) throw new Exception("मॉडल फ़ोल्डर नहीं बन पाया");
                    try (FileOutputStream stream = new FileOutputStream(output)) {
                        int count;
                        while ((count = zip.read(buffer)) != -1) stream.write(buffer, 0, count);
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private void handleRecognition(String json) {
        if (!running || speaking || json == null) return;
        try {
            String text = new JSONObject(json).optString("text", "").toLowerCase(Locale.ROOT);
            String normalized = text.replaceAll("[^\\p{L}]", "");
            boolean wakeDetected = normalized.contains("सारथी")
                    || normalized.contains("सारथ")
                    || normalized.contains("सरथी")
                    || normalized.contains("sarathi")
                    || normalized.contains("sarthi");
            if (wakeDetected) {
                showWakeNotification();
                speakWakeReply();
            }
        } catch (Exception ignored) {}
    }

    private void speakWakeReply() {
        if (!running || speaking) return;
        speaking = true;
        if (speechService != null) speechService.setPause(true);
        if (textToSpeech == null) {
            textToSpeech = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                    textToSpeech.setLanguage(new Locale("hi", "IN"));
                    speakGreeting();
                } else resumeListening();
            });
        } else speakGreeting();
    }

    private void speakGreeting() {
        if (!running || textToSpeech == null) { resumeListening(); return; }
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { handler.postDelayed(WakeWordService.this::resumeListening, 350); }
            @Override public void onError(String id) { handler.post(WakeWordService.this::resumeListening); }
        });
        textToSpeech.speak("जी, बताइए।", TextToSpeech.QUEUE_FLUSH, null, "sarathi_wake_reply");
    }

    private void resumeListening() {
        speaking = false;
        if (running && speechService != null) {
            speechService.reset();
            speechService.setPause(false);
            updateStatus("सारथी ऑफ़लाइन हिंदी में सुन रहा है — बंद करने तक");
        }
    }

    private void showWakeNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 772, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID + 1,
                builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("सारथी ने आपकी आवाज़ सुनी")
                        .setContentText("सारथी खोलने के लिए यहाँ दबाएँ।").setContentIntent(pending).setAutoCancel(true).build());
    }

    private void stopListening() {
        running = false;
        worker.shutdownNow();
        if (speechService != null) { speechService.cancel(); speechService.shutdown(); speechService = null; }
        if (recognizer != null) { recognizer.close(); recognizer = null; }
        if (model != null) { model.close(); model = null; }
        if (textToSpeech != null) { textToSpeech.stop(); textToSpeech.shutdown(); textToSpeech = null; }
    }

    @Override public void onDestroy() { stopListening(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
