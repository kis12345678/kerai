package com.kerai.omniai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Always-on "Hey Kerai" listening.
 *
 * HONEST LIMITATION: Samsung and Google reserve the phone's low-power hotword DSP for "Hi Bixby"
 * / "Hey Google", so a third-party app cannot get the battery-free always-on detection they have.
 * This runs Android's SpeechRecognizer in a restart loop instead — it works, but it keeps the mic
 * and CPU active, so it costs battery, and on some devices the recognizer needs network or a
 * downloaded language pack. It is best-effort, not a peer of Bixby's wake engine. The button/
 * gesture assistant path (AssistantInteractionService) is the reliable, zero-cost trigger.
 *
 * On hearing the wake phrase it launches the app in listening mode; the real conversation then
 * happens in the web voice stack, same as a button invocation.
 */
class WakeWordService : Service() {

    private var recognizer: SpeechRecognizer? = null
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var running = false

    companion object {
        private const val CHANNEL_ID = "omniai_wake"
        private const val NOTIF_ID = 43
        private val WAKE_PHRASES = listOf("hey kerai", "kerai", "hey k rai", "hey karai")

        fun start(context: Context) {
            val intent = Intent(context, WakeWordService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) = context.stopService(Intent(context, WakeWordService::class.java))
    }

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, notification("Listening for “Hey Kerai”"))
        if (!running) {
            running = true
            main.post { startListening() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        main.post {
            recognizer?.destroy()
            recognizer = null
        }
        super.onDestroy()
    }

    private fun startListening() {
        if (!running) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            updateNotification("Speech recognition unavailable on this device")
            return
        }
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(listener)
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            // Ask for offline where supported so it doesn't depend on a network round trip.
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
        try {
            recognizer?.startListening(intent)
        } catch (_: Exception) {
            scheduleRestart()
        }
    }

    /** Recognizer sessions are short-lived; restart to approximate continuous listening. */
    private fun scheduleRestart() {
        if (!running) return
        main.postDelayed({ startListening() }, 600)
    }

    private fun onHeard(texts: List<String>) {
        val matched = texts.any { t ->
            val lower = t.lowercase()
            WAKE_PHRASES.any { lower.contains(it) }
        }
        if (matched) {
            updateNotification("Heard you — opening Kerai")
            startActivity(Intent(this, VoiceActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
    }

    private val listener = object : RecognitionListener {
        override fun onResults(results: Bundle?) {
            results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.let(::onHeard)
            scheduleRestart()
        }
        override fun onPartialResults(partial: Bundle?) {
            partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.let(::onHeard)
        }
        override fun onError(error: Int) {
            // ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT are the normal "nothing said" outcomes.
            scheduleRestart()
        }
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun notification(text: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Wake word", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID) else @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setContentTitle("Kerai AI")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(text))
    }
}
