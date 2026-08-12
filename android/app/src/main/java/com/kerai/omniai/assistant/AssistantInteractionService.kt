package com.kerai.omniai.assistant

import android.service.voice.VoiceInteractionService

/**
 * Registers Kerai as a candidate for Android's "Digital assistant app" role. Once the user
 * selects it in Settings, the assist gesture — long-press Home, or the S24 side-key shortcut —
 * launches this instead of Bixby or Google.
 *
 * The heavy lifting is delegated: this class only exists so the framework has something to bind
 * for the assistant role. The actual session (what appears when invoked) lives in
 * AssistantSessionService, wired via res/xml/interaction_service.xml.
 */
class AssistantInteractionService : VoiceInteractionService()
