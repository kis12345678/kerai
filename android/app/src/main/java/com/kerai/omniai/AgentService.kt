package com.kerai.omniai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * The always-on link between this phone and the user's server.
 *
 * A foreground service (not a background one) because the whole point is to stay reachable while
 * the app isn't in front — Android kills background work aggressively, and a persistent
 * notification is the price of not being killed. The loop long-polls /api/android-agent/poll,
 * runs whatever command comes back through ControlService, and posts the result to
 * /api/android-agent/result. Every request carries the pairing token; without it the server
 * returns 401 and this service can do nothing.
 */
class AgentService : Service() {

    @Volatile private var running = false
    private var worker: Thread? = null

    companion object {
        private const val CHANNEL_ID = "omniai_agent"
        private const val NOTIF_ID = 42
        const val PREFS = "omniai_agent_prefs"
        const val KEY_SERVER = "server_url"
        const val KEY_TOKEN = "device_token"

        fun start(context: Context) {
            val intent = Intent(context, AgentService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification("Connecting…"))
        if (!running) {
            running = true
            worker = Thread { pollLoop() }.also { it.start() }
        }
        // START_STICKY: if Android reclaims us under memory pressure, restart when it can.
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        super.onDestroy()
    }

    private fun pollLoop() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val server = prefs.getString(KEY_SERVER, null)?.trimEnd('/')
        val token = prefs.getString(KEY_TOKEN, null)
        if (server.isNullOrBlank() || token.isNullOrBlank()) {
            updateNotification("Not paired — open the app to set up")
            stopSelf()
            return
        }

        var backoffMs = 1000L
        while (running) {
            try {
                val command = poll(server, token)
                backoffMs = 1000L // a clean poll resets the backoff
                if (command != null) {
                    updateNotification("Connected — running ${command.optString("action")}")
                    val result = execute(command)
                    postResult(server, token, command.getString("id"), result)
                    updateNotification("Connected")
                } else {
                    updateNotification("Connected")
                }
            } catch (_: InterruptedException) {
                break
            } catch (e: Exception) {
                updateNotification("Reconnecting…")
                // Exponential backoff so a server that's down doesn't become a request flood.
                try { Thread.sleep(backoffMs) } catch (_: InterruptedException) { break }
                backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            }
        }
    }

    /** Long-poll; returns the next command JSON, or null if the window elapsed with none. */
    private fun poll(server: String, token: String): JSONObject? {
        val conn = (URL("$server/api/android-agent/poll").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Authorization", "Bearer $token")
            connectTimeout = 15_000
            readTimeout = 40_000
        }
        try {
            if (conn.responseCode == 401) throw IllegalStateException("Unauthorized — token rejected")
            if (conn.responseCode != 200) throw IllegalStateException("poll HTTP ${conn.responseCode}")
            val body = conn.inputStream.bufferedReader().use(BufferedReader::readText)
            val json = JSONObject(body)
            return if (json.isNull("command")) null else json.getJSONObject("command")
        } finally {
            conn.disconnect()
        }
    }

    private fun postResult(server: String, token: String, commandId: String, result: JSONObject) {
        val payload = JSONObject().put("commandId", commandId).put("result", result).toString()
        val conn = (URL("$server/api/android-agent/result").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json")
            connectTimeout = 15_000
            readTimeout = 15_000
            doOutput = true
        }
        try {
            conn.outputStream.use { it.write(payload.toByteArray()) }
            conn.responseCode // force the request to flush
        } finally {
            conn.disconnect()
        }
    }

    /** Maps a command to a ControlService call. Result shape matches the server's CommandResult. */
    private fun execute(command: JSONObject): JSONObject {
        val service = ControlService.instance
            ?: return fail("Accessibility service is not enabled on the phone")
        val action = command.optString("action")
        val p = command.optJSONObject("params") ?: JSONObject()

        return try {
            when (action) {
                "tap" -> ok(service.tap(p.getInt("x"), p.getInt("y")))
                "swipe" -> ok(service.swipe(p.getInt("x1"), p.getInt("y1"), p.getInt("x2"), p.getInt("y2"), p.optLong("durationMs", 300)))
                "tapText" -> ok(service.tapText(p.getString("query")))
                "typeText" -> ok(service.typeText(p.getString("text")))
                "key" -> ok(service.globalKey(p.getString("key")))
                "dumpUi" -> okData(JSONObject().put("elements", service.dumpUi()))
                "screenshot" -> {
                    val b64 = service.screenshotBase64()
                    if (b64 == null) fail("Screenshot unavailable (needs Android 11+)") else okData(JSONObject().put("pngBase64", b64))
                }
                "openUrl" -> {
                    startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(p.getString("url")))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    ok(true)
                }
                "launch" -> {
                    val launch = packageManager.getLaunchIntentForPackage(p.getString("packageName"))
                        ?: return fail("App not installed: ${p.getString("packageName")}")
                    startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    ok(true)
                }
                else -> fail("Unknown action: $action")
            }
        } catch (e: Exception) {
            fail(e.message ?: "command failed")
        }
    }

    private fun ok(success: Boolean): JSONObject =
        if (success) JSONObject().put("ok", true).put("data", JSONObject.NULL)
        else fail("action reported failure (element not found, or field not focused)")

    private fun okData(data: JSONObject): JSONObject = JSONObject().put("ok", true).put("data", data)
    private fun fail(message: String): JSONObject = JSONObject().put("ok", false).put("error", message)

    // --- Notification (required for a foreground service) -------------------------------------

    private fun buildNotification(text: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Kerai AI Agent", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Keeps the phone reachable by your assistant"
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
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
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(text))
    }
}
