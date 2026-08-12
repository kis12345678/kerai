package com.kerai.omniai

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.DataOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The native voice loop.
 *
 * The web app's voice needs the browser SpeechRecognition API, which an Android WebView does not
 * implement, so voice here is native. It used to also use the *phone's* engines to hear and speak,
 * which worked but pinned the assistant to English-ish recognition and a robotic voice. Now the
 * phone only captures and plays audio, and the server does both ends properly:
 *
 *   record mic audio -> POST /api/stt (Groq whisper-large-v3, ~90 languages, auto-detected)
 *     -> POST /api/voice/agent (the brain: a spoken reply plus any phone actions to run)
 *     -> POST /api/tts (ElevenLabs, a human voice, multilingual) -> play it -> record again
 *
 * So you can speak Hindi, Gujarati, Tamil or English and be answered in the same language, in a
 * real voice. The phone's own TextToSpeech is kept purely as a fallback for when the server's
 * voice is unreachable — losing the nice voice beats going silent.
 *
 * The whole loop runs sequentially on one worker thread, which is also what kills the old echo
 * bug: the mic is simply not open while a reply is playing, so the assistant cannot hear and
 * answer itself. Opened by the assistant gesture, the wake word, or the app menu.
 */
class VoiceActivity : Activity(), TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var loop: Thread? = null
    private lateinit var status: TextView
    private lateinit var transcript: TextView
    private var server: String? = null
    private var token: String? = null
    @Volatile private var ttsReady = false
    @Volatile private var destroyed = false
    @Volatile private var speechLatch: CountDownLatch? = null

    companion object {
        private const val REQ_MIC = 2001
        private const val UTTERANCE_ID = "kerai-reply"

        // Capture tuned for speech recognition: 16 kHz mono is what Whisper wants anyway, and at
        // 32 kbps AAC a normal sentence uploads in well under a second on wifi.
        private const val SAMPLE_RATE = 16_000
        private const val BIT_RATE = 32_000

        private const val POLL_MS = 100L
        /** First readings after start() are meaningless, so ignore them. */
        private const val WARMUP_MS = 300L
        /** Then sample the room to learn its noise floor, so a noisy room doesn't self-trigger. */
        private const val FLOOR_MS = 500L
        private const val MIN_THRESHOLD = 1_800
        /** Silence this long after speech began ends the utterance. */
        private const val END_OF_SPEECH_MS = 1_200L
        /** Too short to be a sentence — probably a cough or a door. */
        private const val MIN_SPEECH_MS = 350L
        private const val MAX_UTTERANCE_MS = 25_000L
        /** Nobody said anything — stop the take and start a fresh one. */
        private const val SILENCE_TIMEOUT_MS = 12_000L
        private const val MIN_AUDIO_BYTES = 2_000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE)
        server = prefs.getString(AgentService.KEY_SERVER, null)?.trimEnd('/')
        token = prefs.getString(AgentService.KEY_TOKEN, null)

        status = TextView(this).apply { setTextColor(Color.parseColor("#22D3EE")); textSize = 16f; gravity = Gravity.CENTER }
        transcript = TextView(this).apply { setTextColor(Color.WHITE); textSize = 20f; gravity = Gravity.CENTER; setPadding(0, 40, 0, 0) }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0B0F14"))
            setPadding(48, 48, 48, 48)
            addView(TextView(this@VoiceActivity).apply { text = "Kerai AI"; setTextColor(Color.WHITE); textSize = 26f; gravity = Gravity.CENTER })
            addView(status)
            addView(transcript)
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        if (server.isNullOrBlank() || token.isNullOrBlank()) {
            status.text = "Not paired yet — open the app menu and pair this phone first."
            return
        }

        // Only the fallback voice; the real one comes from the server.
        tts = TextToSpeech(this, this)

        // Mic is required to work at all; the others (call/contacts/SMS) let voice actions run
        // directly instead of falling back to opening the dialer/messaging app. Ask for the lot
        // up front; missing ones just degrade an action, they don't block listening.
        val wanted = listOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.SEND_SMS,
        ).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

        if (wanted.isEmpty()) startLoop() else requestPermissions(wanted.toTypedArray(), REQ_MIC)
    }

    override fun onInit(statusCode: Int) {
        ttsReady = statusCode == TextToSpeech.SUCCESS
        if (ttsReady) {
            tts?.language = Locale.getDefault()
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { speechLatch?.countDown() }
                // Both overloads release the latch: the one-arg form is the abstract one and must
                // be implemented, the two-arg form is what the platform actually calls. A missed
                // callback here would park the loop for the full await timeout.
                @Suppress("OVERRIDE_DEPRECATION") // the abstract one; deprecated but still required
                override fun onError(utteranceId: String?) { speechLatch?.countDown() }
                override fun onError(utteranceId: String?, errorCode: Int) { speechLatch?.countDown() }
            })
        }
    }

    @Deprecated("Superseded by the Activity Result API, which lives in AndroidX; this app uses none")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            // Only the mic gates listening; the call/contacts/SMS grants are optional niceties.
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startLoop()
            else status.text = "Microphone permission is needed to talk."
        }
    }

    private fun ui(block: () -> Unit) = runOnUiThread { if (!destroyed) block() }

    private fun startLoop() {
        if (loop != null || destroyed) return
        loop = Thread { runLoop() }.also { it.start() }
    }

    /**
     * One turn per iteration, each step blocking the next. Sequential on purpose: it makes the
     * "never listen while speaking" rule structural rather than something enforced with flags and
     * delays, and a turn is inherently serial anyway.
     */
    private fun runLoop() {
        try {
            loopTurns()
        } catch (e: InterruptedException) {
            // onDestroy interrupted a blocking wait — that's the signal to stop.
        } catch (e: Exception) {
            // An uncaught throw on a worker thread takes the whole app down with it; report it on
            // screen instead and let the loop end.
            ui { status.text = "Voice stopped: ${e.message ?: "unexpected error"}" }
        }
    }

    private fun loopTurns() {
        val srv = server ?: return
        val tok = token ?: return

        while (!destroyed) {
            val audio = recordUtterance() ?: continue
            if (destroyed) return

            ui { status.text = "Thinking…" }
            val heard = try {
                transcribe(srv, tok, audio)
            } catch (e: Exception) {
                null
            } finally {
                audio.delete()
            }
            if (destroyed) return
            if (heard == null || heard.text.isBlank()) continue
            ui { transcript.text = "“${heard.text}”" }

            val result = try {
                requestAgent(srv, tok, heard.text)
            } catch (e: Exception) {
                AgentResult("Couldn't reach your assistant. ${e.message ?: ""}", emptyList(), null)
            }
            if (destroyed) return

            // Errors are spoken after the reply so the user isn't told "Calling Mom" when the
            // call didn't actually start.
            val errors = runActions(result.actions)
            val spoken = if (errors.isEmpty()) result.reply else result.reply + " " + errors.joinToString(" ")
            ui { transcript.text = spoken; status.text = "Speaking…" }
            speak(srv, tok, spoken, result.voiceId, heard.language)
        }
    }

    @Suppress("DEPRECATION") // MediaRecorder(Context) is API 31+; this app supports 26.
    private fun newRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else MediaRecorder()

    /**
     * Records until the speaker stops, and returns the file — or null if the take held no speech.
     *
     * Endpointing is amplitude-based rather than a VAD model: MediaRecorder.getMaxAmplitude() is
     * free, needs no dependency (this app deliberately has none), and "speech started, then went
     * quiet for a beat" is a good enough rule for a push-to-talk-ish assistant screen. The noise
     * floor is measured per take so a loud room raises the bar instead of triggering constantly.
     */
    private fun recordUtterance(): File? {
        val file = File(cacheDir, "utterance.m4a")
        file.delete()

        val rec = try {
            newRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioChannels(1)
                setAudioSamplingRate(SAMPLE_RATE)
                setAudioEncodingBitRate(BIT_RATE)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
        } catch (e: Exception) {
            // Usually another app holding the mic. Back off before the caller tries again, or the
            // loop spins as fast as the failure repeats.
            ui { status.text = "Couldn't open the microphone — retrying." }
            Thread.sleep(1_000)
            return null
        }
        recorder = rec
        ui { status.text = "Listening…" }

        var floor = 0
        var startedSpeakingAt = 0L
        var lastLoudAt = 0L
        var complete = false
        val began = SystemClock.elapsedRealtime()

        try {
            while (!destroyed) {
                Thread.sleep(POLL_MS)
                val now = SystemClock.elapsedRealtime()
                val elapsed = now - began
                val amplitude = rec.maxAmplitude

                if (elapsed < WARMUP_MS) continue
                if (elapsed < WARMUP_MS + FLOOR_MS) {
                    floor = maxOf(floor, amplitude)
                    continue
                }

                if (amplitude > maxOf(MIN_THRESHOLD, (floor * 2.5).toInt())) {
                    if (startedSpeakingAt == 0L) startedSpeakingAt = now
                    lastLoudAt = now
                }

                if (startedSpeakingAt == 0L) {
                    if (elapsed > SILENCE_TIMEOUT_MS) break // nothing said — take a fresh one
                } else {
                    val speaking = now - startedSpeakingAt
                    if (speaking > MAX_UTTERANCE_MS) { complete = true; break }
                    if (now - lastLoudAt > END_OF_SPEECH_MS && speaking > MIN_SPEECH_MS) { complete = true; break }
                }
            }
        } catch (e: InterruptedException) {
            // Teardown interrupted the loop; fall through and release the recorder.
        }

        // stop() throws when the recording was too short to produce a valid file — treat that the
        // same as silence rather than letting it kill the loop.
        var stopped = false
        try {
            rec.stop()
            stopped = true
        } catch (e: Exception) {
            // no usable recording — too short, or teardown released it underneath us
        }
        try { rec.release() } catch (e: Exception) { /* already released */ }
        recorder = null

        if (!complete || !stopped || destroyed || file.length() < MIN_AUDIO_BYTES) {
            file.delete()
            return null
        }
        return file
    }

    private data class Heard(val text: String, val language: String?)

    /** Uploads the take to the server's multilingual speech-to-text. */
    private fun transcribe(server: String, token: String, audio: File): Heard? {
        val boundary = "----KeraiVoice${System.currentTimeMillis()}"
        val conn = (URL("$server/api/stt").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connectTimeout = 15_000
            readTimeout = 60_000
            doOutput = true
        }
        try {
            DataOutputStream(conn.outputStream.buffered()).use { out ->
                out.writeBytes("--$boundary\r\n")
                // The extension matters: the server passes the filename through, and the
                // transcriber picks its decoder from it.
                out.writeBytes("Content-Disposition: form-data; name=\"file\"; filename=\"utterance.m4a\"\r\n")
                out.writeBytes("Content-Type: audio/mp4\r\n\r\n")
                audio.inputStream().use { it.copyTo(out) }
                out.writeBytes("\r\n--$boundary--\r\n")
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) return null
            val json = JSONObject(body)
            val text = json.optString("text").trim()
            val language = json.optString("language").takeIf { it.isNotBlank() && it != "null" }
            return if (text.isBlank()) null else Heard(text, language)
        } finally {
            conn.disconnect()
        }
    }

    private data class AgentResult(
        val reply: String,
        val actions: List<Pair<String, JSONObject>>,
        val voiceId: String?,
    )

    private fun requestAgent(server: String, token: String, text: String): AgentResult {
        val conn = (URL("$server/api/voice/agent").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            connectTimeout = 15_000
            readTimeout = 120_000
            doOutput = true
        }
        try {
            conn.outputStream.use { it.write(JSONObject().put("text", text).toString().toByteArray()) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code == 401) return AgentResult("This phone isn't authorised. Re-pair it with a fresh token.", emptyList(), null)
            val json = JSONObject(body)
            val reply = json.optString("reply", json.optString("error", "No response."))
            val actions = mutableListOf<Pair<String, JSONObject>>()
            json.optJSONArray("actions")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val a = arr.getJSONObject(i)
                    actions.add(a.getString("name") to (a.optJSONObject("args") ?: JSONObject()))
                }
            }
            return AgentResult(reply, actions, json.optString("voiceId").takeIf { it.isNotBlank() })
        } finally {
            conn.disconnect()
        }
    }

    /** Runs the phone actions on the main thread and waits, collecting anything that failed. */
    private fun runActions(actions: List<Pair<String, JSONObject>>): List<String> {
        if (actions.isEmpty()) return emptyList()
        val errors = mutableListOf<String>()
        val done = CountDownLatch(1)
        runOnUiThread {
            try {
                for ((name, args) in actions) PhoneActionExecutor.run(this, name, args)?.let { errors.add(it) }
            } finally {
                done.countDown()
            }
        }
        done.await()
        return errors
    }

    /** Server voice first; the phone's own engine only if that fails, so a reply is never lost. */
    private fun speak(server: String, token: String, text: String, voiceId: String?, language: String?) {
        val audio = try {
            synthesize(server, token, text, voiceId)
        } catch (e: Exception) {
            null
        }
        val played = audio != null && play(audio)
        audio?.delete()
        if (!played && !destroyed) speakLocally(text, language)
    }

    private fun synthesize(server: String, token: String, text: String, voiceId: String?): File? {
        val conn = (URL("$server/api/tts").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            connectTimeout = 15_000
            readTimeout = 60_000
            doOutput = true
        }
        try {
            val payload = JSONObject().put("text", text)
            if (voiceId != null) payload.put("voiceId", voiceId)
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) return null
            // A JSON body here means the server reported an error instead of sending audio.
            val type = conn.contentType.orEmpty()
            if (!type.startsWith("audio/")) return null
            val file = File(cacheDir, if (type.contains("wav")) "reply.wav" else "reply.mp3")
            conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            if (file.length() <= 0) {
                file.delete()
                return null
            }
            return file
        } finally {
            conn.disconnect()
        }
    }

    /** Plays the reply and blocks until it finishes. Returns false if it couldn't be played. */
    private fun play(file: File): Boolean {
        val done = CountDownLatch(1)
        var ok = true
        val mp = MediaPlayer()
        return try {
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            mp.setDataSource(file.absolutePath)
            mp.setOnCompletionListener { done.countDown() }
            mp.setOnErrorListener { _, _, _ -> ok = false; done.countDown(); true }
            mp.prepare()
            player = mp
            mp.start()
            done.await()
            ok
        } catch (e: Exception) {
            false
        } finally {
            player = null
            try { mp.release() } catch (e: Exception) { /* already released */ }
        }
    }

    /**
     * Whisper reports the language it heard; the phone's engine is asked for that language so the
     * fallback at least reads Hindi as Hindi rather than as mangled English.
     *
     * The server reports an English *name* ("Hindi", "English"), not a tag — so the name lookup is
     * the main path, and a tag is only accepted for short values. Passing a name to
     * forLanguageTag() is the trap here: "hindi" is a syntactically legal 5-letter subtag, so it
     * returns a locale with language="hindi" instead of failing, which no TTS engine can match.
     */
    private fun localeFor(language: String?): Locale? {
        val name = language?.trim()?.lowercase() ?: return null
        if (name.isEmpty()) return null
        if (name.length <= 3 || name.contains('-')) {
            val tagged = Locale.forLanguageTag(name)
            if (tagged.language.isNotEmpty()) return tagged
        }
        return Locale.getAvailableLocales().firstOrNull {
            it.getDisplayLanguage(Locale.ENGLISH).equals(name, ignoreCase = true)
        }
    }

    private fun speakLocally(text: String, language: String?) {
        val engine = tts?.takeIf { ttsReady } ?: return
        localeFor(language)?.let { locale ->
            if (engine.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) engine.language = locale
        }
        val done = CountDownLatch(1)
        speechLatch = done
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
        // Bounded: a listener callback that never arrives must not strand the loop forever.
        done.await(60, TimeUnit.SECONDS)
        speechLatch = null
    }

    override fun onResume() {
        super.onResume()
        // The always-on "Hey Kerai" service runs its own recogniser; two things fighting for the
        // mic is a second source of doubled/garbled audio. Silence it while this screen owns the
        // mic. (It's restarted from Setup when the user wants hands-free again.)
        WakeWordService.stop(this)
    }

    override fun onDestroy() {
        destroyed = true
        loop?.interrupt()
        loop = null
        // Release the latches the worker may be parked on so it can see `destroyed` and exit.
        speechLatch?.countDown()
        try { recorder?.release() } catch (e: Exception) { /* already gone */ }
        recorder = null
        try { player?.release() } catch (e: Exception) { /* already gone */ }
        player = null
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}
