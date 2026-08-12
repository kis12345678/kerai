package com.kerai.omniai.assistant

import android.content.Intent
import android.speech.RecognitionService

/**
 * A VoiceInteractionService is only accepted as an assistant if its config names a
 * RecognitionService. Kerai does its speech-to-text inside the web app (and, for hands-free, in
 * WakeWordService), not through this API, so this is a valid-but-inert implementation that exists
 * purely to satisfy that requirement. Each callback reports "unavailable" rather than pretending
 * to recognise.
 */
class AssistantRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
        listener?.error(android.speech.SpeechRecognizer.ERROR_RECOGNIZER_BUSY)
    }
    override fun onCancel(listener: Callback?) {}
    override fun onStopListening(listener: Callback?) {}
}
