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
    public static final String ACTION_PAUSE = "com.sarathi.ai.WAKE_PAUSE";
    public static final String ACTION_RESUME = "com.sarathi.ai.WAKE_RESUME";
    public static final String ACTION_CAPTURE_COMMAND = "com.sarathi.ai.WAKE_CAPTURE_COMMAND";
    public static final String ACTION_END_CONVERSATION = "com.sarathi.ai.WAKE_END_CONVERSATION";
    private static final String CHANNEL = "sarathi_wake_channel";
    private static final int NOTIFICATION_ID = 771;
    private static final String MODEL_NAME = "vosk-model-small-hi-0.22";
    private static final long MAX_MODEL_ARCHIVE_BYTES = 100L * 1024L * 1024L;
    private static final long MAX_MODEL_EXPANDED_BYTES = 300L * 1024L * 1024L;
    private static final int MAX_MODEL_ARCHIVE_ENTRIES = 20000;
    private static final String MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip";
    private static final String WAKE_GRAMMAR = "[\"सारथी\",\"सारथी जी\",\"हेलो सारथी\",\"हैलो सारथी\",\"नमस्ते सारथी\",\"हे सारथी\",\"ठीक है सारथी\",\"अच्छा है सारथी\",\"ओके सारथी\",\"बाय सारथी\",\"बस सारथी\",\"धन्यवाद सारथी\",\"अलविदा सारथी\",\"ठीक है बाय\",\"अच्छा है बाय\",\"सरथी\",\"सारथि\",\"hello sarathi\",\"helo sarathi\",\"hey sarathi\",\"hi sarathi\",\"namaste sarathi\",\"sarathi\",\"sarthi\",\"bye sarathi\",\"ok sarathi\",\"okay sarathi\",\"[unk]\"]";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean running = false;
    private volatile boolean speaking = false;
    private volatile boolean retryScheduled = false;
    private volatile boolean awaitingCommand = false;
    private volatile boolean commandMode = false;
    private volatile boolean commandDelivered = false;
    private volatile boolean conversationMode = false;
    private Runnable commandTimeout;
    private int retryAttempt = 0;
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
            getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_PAUSE.equals(intent.getAction())) {
            if (!running) {
                stopSelf();
                return START_NOT_STICKY;
            }
            awaitingCommand = true;
            if (speechService != null) speechService.setPause(true);
            scheduleCommandTimeout(60000L);
            return START_STICKY;
        }
        if (intent != null && ACTION_END_CONVERSATION.equals(intent.getAction())) {
            if (running) {
                // Tear down the continuous-conversation recognizer and create
                // a fresh wake-phrase recognizer, just like a spoken stop phrase.
                endConversationAndResumeWakeWord();
            } else {
                conversationMode = false;
                awaitingCommand = false;
                commandMode = false;
                commandDelivered = true;
                if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
                commandTimeout = null;
                getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
                stopSelf();
                return START_NOT_STICKY;
            }
            return START_STICKY;
        }
        if (intent != null && ACTION_CAPTURE_COMMAND.equals(intent.getAction())) {
            if (running) beginCommandCapture();
            return START_STICKY;
        }
        if (intent != null && ACTION_RESUME.equals(intent.getAction())) {
            if (running) {
                awaitingCommand = false;
                if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
                commandTimeout = null;
                resumeListening();
                if (conversationMode && speechService == null && model != null) {
                    if (worker == null || worker.isShutdown()) worker = Executors.newSingleThreadExecutor();
                    worker.execute(() -> {
                        try { startConversationRecognition(); }
                        catch (Exception error) { scheduleListeningRetry("लगातार सुनना फिर शुरू नहीं हो सका"); }
                    });
                }
                return START_STICKY;
            }
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent == null) {
            // Android may recreate a sticky microphone foreground service after
            // process death while the app is in the background. Android 14+
            // restricts starting microphone FGS without a visible activity.
            // Do not attempt a forbidden background restart; require the user
            // to reopen Sarathi and explicitly enable wake listening again.
            prefs.edit().putBoolean("enabled", false).apply();
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
            try {
                startForeground(NOTIFICATION_ID, buildNotification("पहली बार हिंदी मॉडल डाउनलोड हो रहा है…"));
            } catch (SecurityException error) {
                // Permission can be revoked between the microphone check and
                // foreground promotion. Fail closed instead of crashing the service.
                prefs.edit().putBoolean("enabled", false).apply();
                running = false;
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }
            running = true;
            if (worker == null || worker.isShutdown()) worker = Executors.newSingleThreadExecutor();
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
                File stagingDir = new File(modelsDir, MODEL_NAME + ".staging");
                try {
                    downloadModel(zipFile);
                    if (!running) return;
                    updateStatus("हिंदी मॉडल तैयार किया जा रहा है…");
                    deleteModelFiles(stagingDir);
                    unzipModel(zipFile, stagingDir);
                    if (!running) return;
                    File stagedMarker = new File(stagingDir, MODEL_NAME + "/am/final.mdl");
                    if (!stagedMarker.isFile()) throw new Exception("हिंदी मॉडल ZIP अधूरा है");
                    deleteModelFiles(modelDir);
                    if (!stagingDir.renameTo(modelDir)) throw new Exception("तैयार मॉडल सुरक्षित रूप से सेव नहीं हुआ");
                } finally {
                    zipFile.delete();
                    if (stagingDir.exists()) deleteModelFiles(stagingDir);
                }
            }
            if (!running) return;
            if (!marker.isFile()) throw new Exception("हिंदी मॉडल अधूरा है");
            model = new Model(modelDir.getAbsolutePath());
            startWakeRecognition();
        } catch (Exception error) {
            scheduleListeningRetry("मॉडल या माइक्रोफ़ोन तैयार नहीं हुआ; सारथी फिर कोशिश करेगा");
        }
    }

    private void startWakeRecognition() throws Exception {
        commandMode = false;
        recognizer = createWakeRecognizer();
        speechService = new SpeechService(recognizer, 16000.0f);
        speechService.startListening(new RecognitionListener() {
            @Override public void onPartialResult(String hypothesis) { }
            @Override public void onResult(String result) { handleRecognition(result); }
            @Override public void onFinalResult(String result) { handleRecognition(result); }
            @Override public void onError(Exception exception) {
                if (commandMode) finishCommand("{}");
                else scheduleListeningRetry("माइक्रोफ़ोन में अस्थायी समस्या आई है");
            }
            @Override public void onTimeout() {
                if (commandMode) finishCommand("{}");
                else scheduleListeningRetry("आवाज़ पहचान दोबारा शुरू की जा रही है");
            }
        });
        if (awaitingCommand) speechService.setPause(true);
        updateStatus("सारथी ऑफ़लाइन हिंदी में सुन रहा है — बंद करने तक");
    }

    private void beginCommandCapture() {
        if (!running || commandMode) return;
        awaitingCommand = false;
        commandMode = true;
        commandDelivered = false;
        if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
        commandTimeout = () -> finishCommand("{}");
        handler.postDelayed(commandTimeout, 15000L);
        updateStatus("बोलिए, सारथी आपका हिंदी आदेश ऑफ़लाइन सुन रहा है…");
        if (worker == null || worker.isShutdown()) worker = Executors.newSingleThreadExecutor();
        worker.execute(() -> {
            try {
                if (speechService != null) {
                    speechService.cancel();
                    speechService.shutdown();
                    speechService = null;
                }
                if (recognizer != null) {
                    recognizer.close();
                    recognizer = null;
                }
                if (!running || !commandMode || model == null) return;
                recognizer = new Recognizer(model, 16000.0f);
                speechService = new SpeechService(recognizer, 16000.0f);
                speechService.startListening(new RecognitionListener() {
                    @Override public void onPartialResult(String hypothesis) { }
                    @Override public void onResult(String result) { finishCommand(result); }
                    @Override public void onFinalResult(String result) { finishCommand(result); }
                    @Override public void onError(Exception exception) { finishCommand("{}"); }
                    @Override public void onTimeout() { finishCommand("{}"); }
                });
            } catch (Exception error) {
                finishCommand("{}");
            }
        });
    }

    private void finishCommand(String json) {
        if (!running || !commandMode || commandDelivered) return;
        commandDelivered = true;
        if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
        commandTimeout = null;
        String command = "";
        try { command = new JSONObject(json == null ? "{}" : json).optString("text", "").trim(); }
        catch (Exception ignored) { }
        // Always notify the Activity, including an empty result. Otherwise the
        // UI can remain stuck on "बोलिए" and the user gets no explanation.
        if (!command.isEmpty()) {
            getSharedPreferences("sarathi_wake_settings", MODE_PRIVATE).edit()
                    .putString("pending_command", command).apply();
            Intent result = new Intent(MainActivity.ACTION_WAKE_RESULT);
            result.setPackage(getPackageName());
            result.putExtra(MainActivity.EXTRA_WAKE_TEXT, command);
            sendBroadcast(result);
            showCommandReadyNotification(command);
            updateStatus("आदेश सुन लिया गया। सारथी ऐप खोलकर जवाब देखिए।");
        } else {
            updateStatus("आवाज़ समझ नहीं आई। कृपया फिर से ‘सारथी’ बोलें।");
        }
        // Keep the active conversation alive after every utterance.
        // It ends only when the user says a supported stop phrase.
        if (worker == null || worker.isShutdown()) worker = Executors.newSingleThreadExecutor();
        worker.execute(() -> {
            try {
                if (speechService != null) {
                    speechService.cancel();
                    speechService.shutdown();
                    speechService = null;
                }
                if (recognizer != null) {
                    recognizer.close();
                    recognizer = null;
                }
                if (running) {
                    if (conversationMode) startConversationRecognition();
                    else startWakeRecognition();
                }
            } catch (Exception error) {
                scheduleListeningRetry("आवाज़ पहचान दोबारा शुरू नहीं हो सकी");
            }
        });
    }

    private boolean isConversationEndPhrase(String recognized) {
        if (recognized == null) return false;
        String normalized = recognized.toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}]+", " ").trim().replaceAll("\\s+", " ");
        normalized = normalized.replace("सारथि", "सारथी").replace("सरथी", "सारथी");
        String compact = normalized.replaceAll("[^\\p{L}\\p{N}]", "");
        return normalized.equals("ठीक है सारथी")
                || normalized.equals("अच्छा है सारथी")
                || normalized.equals("ओके सारथी")
                || normalized.equals("बाय सारथी")
                || normalized.equals("बस सारथी")
                || normalized.equals("धन्यवाद सारथी")
                || normalized.equals("अलविदा सारथी")
                || normalized.equals("ठीक है बाय")
                || normalized.equals("अच्छा है बाय")
                || normalized.equals("बाय")
                || normalized.equals("bye")
                || normalized.equals("अलविदा")
                || normalized.equals("ok sarathi")
                || normalized.equals("okay sarathi")
                || normalized.equals("bye sarathi")
                || compact.equals("ठीकहैसारथी")
                || compact.equals("ओकेसारथी")
                || compact.equals("बायसारथी")
                || compact.equals("बससारथी")
                || compact.equals("धन्यवादसारथी")
                || compact.equals("अलविदासारथी")
                || compact.equals("ठीकहैबाय")
                || compact.equals("अच्छाहैबाय")
                || compact.equals("बाय")
                || compact.equals("अलविदा");
    }

    private void endConversationAndResumeWakeWord() {
        commandDelivered = true;
        commandMode = false;
        conversationMode = false;
        awaitingCommand = false;
        if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
        commandTimeout = null;
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
        updateStatus("बातचीत बंद। दोबारा शुरू करने के लिए ‘हेलो सारथी’ कहें।");
        if (worker == null || worker.isShutdown()) worker = Executors.newSingleThreadExecutor();
        worker.execute(() -> {
            try {
                if (speechService != null) {
                    speechService.cancel();
                    speechService.shutdown();
                    speechService = null;
                }
                if (recognizer != null) {
                    recognizer.close();
                    recognizer = null;
                }
                if (running) startWakeRecognition();
            } catch (Exception error) {
                scheduleListeningRetry("वेक-वर्ड सुनना फिर शुरू नहीं हो सका");
            }
        });
    }

    private void handleConversationUtterance(String json) {
        if (!running || !conversationMode || awaitingCommand || commandDelivered || json == null) return;
        String text = "";
        try { text = new JSONObject(json).optString("text", "").trim(); }
        catch (Exception ignored) { }
        if (text.isEmpty()) return;
        if (isConversationEndPhrase(text)) {
            endConversationAndResumeWakeWord();
            return;
        }
        commandMode = true;
        finishCommand(json);
    }

    private void startConversationRecognition() throws Exception {
        if (!running || !conversationMode || model == null) return;
        commandMode = false;
        // Each new utterance in an active conversation is a fresh command.
        // Without resetting this flag, only the first spoken request is handled.
        commandDelivered = false;
        recognizer = new Recognizer(model, 16000.0f);
        speechService = new SpeechService(recognizer, 16000.0f);
        speechService.startListening(new RecognitionListener() {
            @Override public void onPartialResult(String hypothesis) { }
            @Override public void onResult(String result) { handleConversationUtterance(result); }
            @Override public void onFinalResult(String result) { handleConversationUtterance(result); }
            @Override public void onError(Exception exception) {
                if (running && conversationMode && !awaitingCommand) {
                    scheduleListeningRetry("लगातार आवाज़ पहचान में समस्या आई");
                }
            }
            @Override public void onTimeout() {
                if (running && conversationMode && !awaitingCommand) {
                    scheduleListeningRetry("सुनना फिर शुरू किया जा रहा है");
                }
            }
        });
        if (awaitingCommand) speechService.setPause(true);
        updateStatus(awaitingCommand
                ? "सारथी जवाब बोल रहा है…"
                : "सारथी लगातार सुन रहा है — बातचीत खत्म करने के लिए ‘बाय सारथी’ कहें।");
    }

    private void scheduleListeningRetry(String message) {
        if (!running || retryScheduled) return;
        retryScheduled = true;
        int attempt = Math.min(retryAttempt++, 6);
        long delayMs = Math.min(5000L << attempt, 300000L);
        updateStatus(message + "। " + Math.max(1, delayMs / 1000) + " सेकंड बाद फिर कोशिश होगी।");
        handler.postDelayed(() -> {
            retryScheduled = false;
            if (!running) return;
            if (worker == null || worker.isShutdown()) worker = Executors.newSingleThreadExecutor();
            worker.execute(() -> {
                try {
                    if (speechService != null) {
                        speechService.cancel();
                        speechService.shutdown();
                        speechService = null;
                    }
                    if (recognizer != null) {
                        recognizer.close();
                        recognizer = null;
                    }
                    if (model == null) {
                        prepareModelAndListen();
                        return;
                    }
                    if (conversationMode) startConversationRecognition();
                    else startWakeRecognition();
                    retryAttempt = 0;
                    updateStatus(conversationMode
                            ? "सारथी लगातार सुन रहा है — बातचीत खत्म करने के लिए ‘बाय सारथी’ कहें।"
                            : "सारथी ऑफ़लाइन हिंदी में सुन रहा है — बंद करने तक");
                } catch (Exception error) {
                    scheduleListeningRetry("आवाज़ पहचान फिर शुरू नहीं हो सकी");
                }
            });
        }, delayMs);
    }

    private void downloadModel(File destination) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(false);
        File temp = new File(destination.getParentFile(), destination.getName() + ".part");
        boolean completed = false;
        try {
            connection.connect();
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new Exception("मॉडल डाउनलोड नहीं हुआ");
            long expectedBytes = connection.getContentLengthLong();
            if (expectedBytes > MAX_MODEL_ARCHIVE_BYTES) throw new SecurityException("मॉडल फ़ाइल तय सीमा से बड़ी है");
            long downloadedBytes = 0L;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[16384];
                int count;
                while (running && (count = input.read(buffer)) != -1) {
                    downloadedBytes += count;
                    if (downloadedBytes > MAX_MODEL_ARCHIVE_BYTES) {
                        throw new SecurityException("मॉडल डाउनलोड तय सीमा से बड़ा हो गया");
                    }
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if (!running) return;
            if (downloadedBytes == 0L || (expectedBytes >= 0L && downloadedBytes != expectedBytes)) {
                throw new Exception("मॉडल डाउनलोड अधूरा है");
            }
            if (!temp.renameTo(destination)) throw new Exception("डाउनलोड फ़ाइल सेव नहीं हुई");
            completed = true;
        } finally {
            connection.disconnect();
            if (!completed && temp.exists()) temp.delete();
        }
    }

    private void unzipModel(File zipFile, File destination) throws Exception {
        if (!destination.exists() && !destination.mkdirs()) throw new Exception("अस्थायी मॉडल फ़ोल्डर नहीं बन पाया");
        String root = destination.getCanonicalPath() + File.separator;
        long expandedBytes = 0L;
        int entryCount = 0;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[16384];
            while (running && (entry = zip.getNextEntry()) != null) {
                if (++entryCount > MAX_MODEL_ARCHIVE_ENTRIES) {
                    throw new SecurityException("मॉडल ZIP में बहुत अधिक फ़ाइलें हैं");
                }
                File output = new File(destination, entry.getName());
                if (!output.getCanonicalPath().startsWith(root)) throw new SecurityException("Invalid model archive path");
                if (entry.isDirectory()) {
                    if (!output.exists() && !output.mkdirs()) throw new Exception("मॉडल फ़ोल्डर नहीं बन पाया");
                } else {
                    File parent = output.getParentFile();
                    if (!parent.exists() && !parent.mkdirs()) throw new Exception("मॉडल फ़ोल्डर नहीं बन पाया");
                    try (FileOutputStream stream = new FileOutputStream(output)) {
                        int count;
                        while (running && (count = zip.read(buffer)) != -1) {
                            expandedBytes += count;
                            if (expandedBytes > MAX_MODEL_EXPANDED_BYTES) {
                                throw new SecurityException("खुला हुआ मॉडल तय स्टोरेज सीमा से बड़ा है");
                            }
                            stream.write(buffer, 0, count);
                        }
                    }
                }
                zip.closeEntry();
                if (!running) throw new InterruptedException("मॉडल extraction रोक दिया गया");
            }
            if (!running) throw new InterruptedException("मॉडल extraction रोक दिया गया");
            if (entryCount == 0) throw new Exception("मॉडल ZIP खाली है");
        }
    }

    private void deleteModelFiles(File file) throws Exception {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new Exception("पुराना मॉडल फ़ोल्डर साफ़ नहीं हो पाया");
            for (File child : children) deleteModelFiles(child);
        }
        if (!file.delete()) throw new Exception("पुराना मॉडल डेटा साफ़ नहीं हो पाया");
    }

    private Recognizer createWakeRecognizer() throws Exception {
        try {
            return new Recognizer(model, 16000.0f, WAKE_GRAMMAR);
        } catch (Exception grammarError) {
            // Fall back to the full Hindi model if this model build rejects dynamic grammar.
            return new Recognizer(model, 16000.0f);
        }
    }

    private void handlePartialRecognition(String json) {
        if (!running || speaking || awaitingCommand || json == null) return;
        try {
            String partial = new JSONObject(json).optString("partial", "");
            if (!partial.trim().isEmpty()) checkWakePhrase(partial);
        } catch (Exception ignored) {}
    }

    private void handleRecognition(String json) {
        if (!running || speaking || awaitingCommand || json == null) return;
        try {
            String recognized = new JSONObject(json).optString("text", "");
            if (!recognized.trim().isEmpty()) checkWakePhrase(recognized);
        } catch (Exception ignored) {}
    }

    private void checkWakePhrase(String recognized) {
        if (!running || speaking || awaitingCommand || recognized == null) return;
        String normalized = recognized.toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}]+", " ").trim().replaceAll("\\s+", " ");
        // Hindi Vosk small models sometimes split a familiar wake word into
        // fragments such as "स रथ" or "ह ल स रथ". Keep the original words for
        // exact matching, and also compare a compact form for these common splits.
        normalized = normalized.replace("सारथि", "सारथी")
                .replace("सरथी", "सारथी")
                ;
        String compact = normalized.replaceAll("[^\\p{L}\\p{N}]", "");
        boolean quietCommand = isConversationEndPhrase(recognized);
        if (quietCommand) {
            // Use the same teardown path as app-triggered and conversation-mode
            // stop phrases so flags, timeout, and the secondary notification stay in sync.
            endConversationAndResumeWakeWord();
            return;
        }
        boolean hindiWake = normalized.equals("सारथी")
                || normalized.equals("सारथी जी")
                || normalized.endsWith(" सारथी")
                || normalized.endsWith(" सारथी जी")
                || normalized.matches("(?:हेलो|हैलो|नमस्ते|हे)\\s+सारथी")
                || compact.equals("सरथ")
                || compact.equals("हलसरथ")
                || compact.equals("हेलोसरथ")
                || compact.equals("हैलोसरथ")
                || compact.endsWith("सारथी")
                || compact.endsWith("सरथ");
        boolean englishWake = normalized.matches("(?:hello|helo|hi|namaste|hey)\\s+(?:sarathi|sarthi)")
                || normalized.equals("sarathi")
                || normalized.equals("sarthi");
        if (hindiWake || englishWake) {
            conversationMode = true;
            showWakeNotification();
            // Speak immediately; opening the notification then starts command capture.
            handler.post(this::speakWakeReply);
        }
        // Ignore unrelated/garbled Vosk guesses. Showing each guess as a notification
        // status made the screen look as if Sarathi was transcribing the user's speech.
    }

    private void speakWakeReply() {
        if (!running || speaking) return;
        speaking = true;
        if (speechService != null) speechService.setPause(true);
        if (textToSpeech == null) {
            textToSpeech = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                    int languageStatus = textToSpeech.setLanguage(new Locale("hi", "IN"));
                    if (languageStatus == TextToSpeech.LANG_MISSING_DATA
                            || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
                        updateStatus("फ़ोन में हिंदी बोलने की आवाज़ उपलब्ध नहीं है; Text-to-Speech में हिंदी आवाज़ जोड़ें");
                        resumeAfterSpeechFailure();
                        return;
                    }
                    speakGreeting();
                } else {
                    updateStatus("फ़ोन की बोलने वाली सेवा शुरू नहीं हुई; Text-to-Speech जाँचें");
                    resumeAfterSpeechFailure();
                }
            });
        } else speakGreeting();
    }

    private void speakGreeting() {
        if (!running || textToSpeech == null) { resumeAfterSpeechFailure(); return; }
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) {
                handler.postDelayed(() -> {
                    if (running && awaitingCommand) {
                        speaking = false;
                        awaitingCommand = false;
                        beginCommandCapture();
                    } else {
                        resumeListening();
                    }
                }, 350);
            }
            @Override public void onError(String id) { handler.post(WakeWordService.this::resumeAfterSpeechFailure); }
        });
        int result = textToSpeech.speak("जी, बताइए।", TextToSpeech.QUEUE_FLUSH, null, "sarathi_wake_reply");
        if (result == TextToSpeech.ERROR) {
            updateStatus("सारथी का जवाब बोलना शुरू नहीं हुआ; फ़ोन की TTS आवाज़ जाँचें");
            resumeAfterSpeechFailure();
        }
    }

    // If TTS cannot speak, do not leave the wake-word recognizer paused
    // until the 20-second command timeout. Return directly to wake listening.
    private void resumeAfterSpeechFailure() {
        speaking = false;
        awaitingCommand = false;
        if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
        commandTimeout = null;
        if (running) {
            getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
            resumeListening();
        }
    }

    private void resumeListening() {
        speaking = false;
        if (running && speechService != null) {
            if (awaitingCommand) {
                updateStatus("सारथी ने आवाज़ सुनी। आदेश सुनने के लिए सूचना दबाएँ।");
                return;
            }
            speechService.reset();
            speechService.setPause(false);
            updateStatus("सारथी ऑफ़लाइन हिंदी में सुन रहा है — बंद करने तक");
        }
    }

    private void scheduleCommandTimeout(long delayMs) {
        if (commandTimeout != null) handler.removeCallbacks(commandTimeout);
        commandTimeout = () -> {
            commandTimeout = null;
            if (running && commandMode) finishCommand("{}");
            else if (running && awaitingCommand) {
                awaitingCommand = false;
                resumeListening();
            }
        };
        handler.postDelayed(commandTimeout, delayMs);
    }

    private void showWakeNotification() {
        awaitingCommand = true;
        if (speechService != null) speechService.setPause(true);
        scheduleCommandTimeout(20000L);

        Intent open = new Intent(this, MainActivity.class);
        open.setAction(MainActivity.ACTION_WAKE_COMMAND);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 772, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID + 1,
                builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("सारथी ने आपकी आवाज़ सुनी")
                        .setContentText("सारथी खोलने के लिए यहाँ दबाएँ।").setContentIntent(pending).setAutoCancel(true).build());
    }

    private void showCommandReadyNotification(String command) {
        Intent open = new Intent(this, MainActivity.class);
        open.setAction(MainActivity.ACTION_WAKE_COMMAND);
        open.putExtra(MainActivity.EXTRA_WAKE_TEXT, command);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 773, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID + 1,
                builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("सारथी ने आदेश सुन लिया")
                        .setContentText("जवाब पाने के लिए सूचना दबाकर सारथी खोलें।")
                        .setContentIntent(pending).setAutoCancel(true).build());
    }

    private void stopListening() {
        running = false;
        awaitingCommand = false;
        commandMode = false;
        commandDelivered = true;
        retryScheduled = false;
        commandTimeout = null;
        handler.removeCallbacksAndMessages(null);
        if (worker != null) worker.shutdownNow();
        if (speechService != null) { speechService.cancel(); speechService.shutdown(); speechService = null; }
        if (recognizer != null) { recognizer.close(); recognizer = null; }
        if (model != null) { model.close(); model = null; }
        if (textToSpeech != null) { textToSpeech.stop(); textToSpeech.shutdown(); textToSpeech = null; }
    }

    @Override public void onDestroy() {
        stopListening();
        // This notification is independent of the foreground-service notification.
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
