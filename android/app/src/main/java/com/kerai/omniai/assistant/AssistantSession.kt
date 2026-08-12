package com.kerai.omniai.assistant

import android.content.Context
import android.content.Intent
import android.service.voice.VoiceInteractionSession
import com.kerai.omniai.VoiceActivity

/**
 * What happens when the user invokes the assistant. It opens the native voice screen — phone STT
 * in, phone TTS out — so "press the key, talk, hear the answer" works without the WebView, whose
 * missing SpeechRecognition API was why voice failed before.
 *
 * onShow fires for every invocation (gesture, side-key, lock-screen assist); we launch and then
 * immediately hide the session's own (empty) window so only the voice screen is visible.
 */
class AssistantSession(context: Context) : VoiceInteractionSession(context) {

    override fun onShow(args: android.os.Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        val intent = Intent(context, VoiceActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        startAssistantActivity(intent)
        hide()
    }
}
