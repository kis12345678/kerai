package com.kerai.omniai

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executor

/**
 * The hands and eyes on the phone. Everything the remote agent can do to the device flows
 * through here: it taps and swipes with dispatchGesture (no root needed), reads the live view
 * hierarchy, and — on Android 11+ — captures the screen without the MediaProjection permission
 * dance, since an AccessibilityService can screenshot directly.
 *
 * AgentService (the network loop) calls these on a background thread and blocks on the async
 * callbacks with a latch. That is safe here because the loop's thread is not the main thread;
 * the gesture/screenshot callbacks themselves arrive on the main thread and just release it.
 */
class ControlService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: ControlService? = null

        /** Global actions are the only "keys" an accessibility service can synthesise. */
        private val GLOBAL_ACTIONS = mapOf(
            "BACK" to GLOBAL_ACTION_BACK,
            "HOME" to GLOBAL_ACTION_HOME,
            "RECENTS" to GLOBAL_ACTION_RECENTS,
            "APP_SWITCH" to GLOBAL_ACTION_RECENTS,
            "NOTIFICATIONS" to GLOBAL_ACTION_NOTIFICATIONS,
            "QUICK_SETTINGS" to GLOBAL_ACTION_QUICK_SETTINGS,
            "POWER_DIALOG" to GLOBAL_ACTION_POWER_DIALOG
        )
    }

    override fun onServiceConnected() {
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Command-driven, not event-driven — nothing to do per event.
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // --- Gestures -----------------------------------------------------------------------------

    private fun runGesture(path: Path, durationMs: Long): Boolean {
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtLeast(1))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        var ok = false
        val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(d: GestureDescription?) { ok = true; latch.countDown() }
            override fun onCancelled(d: GestureDescription?) { ok = false; latch.countDown() }
        }, null)
        if (!dispatched) return false
        latch.await(durationMs + 5000, TimeUnit.MILLISECONDS)
        return ok
    }

    fun tap(x: Int, y: Int): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()); lineTo(x.toFloat(), y.toFloat()) }
        return runGesture(path, 50)
    }

    fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long): Boolean {
        val path = Path().apply { moveTo(x1.toFloat(), y1.toFloat()); lineTo(x2.toFloat(), y2.toFloat()) }
        return runGesture(path, durationMs)
    }

    // --- Reading the screen -------------------------------------------------------------------

    /** Flattens the active window's node tree into the same shape the adb UI-dump tool returns. */
    fun dumpUi(): JSONArray {
        val out = JSONArray()
        val root = rootInActiveWindow ?: return out
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.addLast(root)
        var visited = 0
        while (stack.isNotEmpty() && visited < 500) {
            val node = stack.removeLast()
            visited++
            val bounds = android.graphics.Rect().also { node.getBoundsInScreen(it) }
            if (bounds.width() > 0 && bounds.height() > 0) {
                val text = node.text?.toString()
                val desc = node.contentDescription?.toString()
                val id = node.viewIdResourceName
                if (!text.isNullOrBlank() || !desc.isNullOrBlank() || !id.isNullOrBlank() || node.isClickable) {
                    out.put(JSONObject().apply {
                        put("text", text ?: JSONObject.NULL)
                        put("desc", desc ?: JSONObject.NULL)
                        put("id", id ?: JSONObject.NULL)
                        put("type", node.className?.toString()?.substringAfterLast('.') ?: JSONObject.NULL)
                        put("clickable", node.isClickable)
                        put("cx", bounds.centerX())
                        put("cy", bounds.centerY())
                    })
                }
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { stack.addLast(it) }
        }
        return out
    }

    /** Finds a node by visible text / description / id and taps its centre. */
    fun tapText(query: String): Boolean {
        val needle = query.trim().lowercase()
        val root = rootInActiveWindow ?: return false
        val match = findNode(root) { node ->
            listOf(node.text?.toString(), node.contentDescription?.toString(), node.viewIdResourceName)
                .any { it?.lowercase()?.contains(needle) == true }
        } ?: return false
        val bounds = android.graphics.Rect().also { match.getBoundsInScreen(it) }
        // Prefer the node's own click action; fall back to a tap at its centre.
        if (match.isClickable && match.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        return tap(bounds.centerX(), bounds.centerY())
    }

    private fun findNode(
        node: AccessibilityNodeInfo,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        if (predicate(node)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findNode(child, predicate)?.let { return it }
        }
        return null
    }

    /** Types into the currently focused editable field. */
    fun typeText(text: String): Boolean {
        val focused = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun globalKey(key: String): Boolean {
        val action = GLOBAL_ACTIONS[key.uppercase()] ?: return false
        return performGlobalAction(action)
    }

    // --- Screenshot (Android 11+; no MediaProjection permission needed) ------------------------

    fun screenshotBase64(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        val latch = CountDownLatch(1)
        var encoded: String? = null
        val executor = Executor { it.run() }
        takeScreenshot(android.view.Display.DEFAULT_DISPLAY, executor,
            object : TakeScreenshotCallback {
                override fun onSuccess(result: ScreenshotResult) {
                    try {
                        val bitmap = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                        val software = bitmap?.copy(Bitmap.Config.ARGB_8888, false)
                        result.hardwareBuffer.close()
                        if (software != null) {
                            val stream = ByteArrayOutputStream()
                            software.compress(Bitmap.CompressFormat.PNG, 100, stream)
                            encoded = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                        }
                    } catch (_: Throwable) {
                    } finally {
                        latch.countDown()
                    }
                }
                override fun onFailure(errorCode: Int) { latch.countDown() }
            })
        latch.await(8, TimeUnit.SECONDS)
        return encoded
    }
}
