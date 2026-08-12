package com.kerai.omniai

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.Settings
import android.telephony.SmsManager
import android.view.KeyEvent
import org.json.JSONObject

/**
 * Runs the phone actions the voice brain (/api/voice/agent) decides on. Each maps a validated
 * action to a standard Android API or intent — the robust, low-permission set. Anything not built
 * yet (answering calls, reading notifications) returns a spoken "not yet" rather than failing
 * silently.
 *
 * Every method returns null on success, or a short spoken error string on failure, so VoiceActivity
 * can tell the user when something didn't work (contact not found, app missing, permission denied).
 */
object PhoneActionExecutor {

    @Volatile private var torchOn = false

    fun run(context: Context, name: String, args: JSONObject): String? = try {
        when (name) {
            "callContact" -> callContact(context, args.optString("contact"))
            "sendSms" -> sendSms(context, args.optString("contact"), args.optString("message"))
            "sendWhatsApp" -> whatsApp(context, args.optString("contact"), args.optString("message"))
            "openApp" -> openApp(context, args.optString("app"), args.optString("query", ""))
            "mediaControl" -> media(context, args.optString("action"))
            "toggleHardware" -> hardware(context, args.optString("target"), args.optString("action", "toggle"))
            "controlCall", "readNotifications" ->
                "That one needs the phone connected to your PC to finish setting up."
            else -> "I don't know how to do that yet."
        }
    } catch (e: SecurityException) {
        "I need permission for that — check the app's permissions."
    } catch (e: Exception) {
        "That didn't work: ${e.message}"
    }

    private fun has(context: Context, perm: String) =
        context.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

    /** Resolves a spoken name or a raw number to a dialable number. */
    private fun lookupNumber(context: Context, who: String): String? {
        val trimmed = who.trim()
        if (trimmed.matches(Regex("[+0-9][0-9 ()\\-]{4,}"))) return trimmed.filter { it.isDigit() || it == '+' }
        if (!has(context, Manifest.permission.READ_CONTACTS)) return null
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$trimmed%"),
            null
        )?.use { if (it.moveToFirst()) return it.getString(0) }
        return null
    }

    private fun startExternally(context: Context, intent: Intent) {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun callContact(context: Context, contact: String): String? {
        if (contact.isBlank()) return "Who should I call?"
        val number = lookupNumber(context, contact) ?: return "I couldn't find $contact in your contacts."
        // Direct call needs CALL_PHONE; without it, open the dialer pre-filled so a tap completes.
        val action = if (has(context, Manifest.permission.CALL_PHONE)) Intent.ACTION_CALL else Intent.ACTION_DIAL
        startExternally(context, Intent(action, Uri.parse("tel:$number")))
        return null
    }

    private fun sendSms(context: Context, contact: String, message: String): String? {
        if (message.isBlank()) return "What should the message say?"
        val number = lookupNumber(context, contact) ?: return "I couldn't find $contact."
        if (has(context, Manifest.permission.SEND_SMS)) {
            val sms = context.getSystemService(SmsManager::class.java)
            sms.sendTextMessage(number, null, message, null, null)
            return null
        }
        // No SEND_SMS: open the messaging app with the text pre-filled.
        startExternally(context, Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number")).putExtra("sms_body", message))
        return null
    }

    private fun whatsApp(context: Context, contact: String, message: String): String? {
        val number = lookupNumber(context, contact)?.filter { it.isDigit() }
            ?: return "I couldn't find $contact's number for WhatsApp."
        val uri = Uri.parse("https://api.whatsapp.com/send?phone=$number&text=${Uri.encode(message)}")
        startExternally(context, Intent(Intent.ACTION_VIEW, uri).setPackage("com.whatsapp"))
        return null
    }

    private val APP_PACKAGES = mapOf(
        "youtube" to "com.google.android.youtube",
        "spotify" to "com.spotify.music",
        "maps" to "com.google.android.apps.maps",
        "chrome" to "com.android.chrome",
        "whatsapp" to "com.whatsapp",
        "instagram" to "com.instagram.android",
        "gmail" to "com.google.android.gm",
    )

    private fun openApp(context: Context, app: String, query: String): String? {
        val key = app.trim().lowercase()
        // Deep-links that take a query, when one was given.
        if (query.isNotBlank()) {
            val deep: Uri? = when (key) {
                "youtube" -> Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")
                "maps" -> Uri.parse("geo:0,0?q=${Uri.encode(query)}")
                "spotify" -> Uri.parse("spotify:search:${Uri.encode(query)}")
                "chrome", "browser" -> Uri.parse("https://www.google.com/search?q=${Uri.encode(query)}")
                else -> null
            }
            if (deep != null) {
                val intent = Intent(Intent.ACTION_VIEW, deep)
                APP_PACKAGES[key]?.let { if (isInstalled(context, it)) intent.setPackage(it) }
                startExternally(context, intent)
                return null
            }
        }
        if (key == "settings") { startExternally(context, Intent(Settings.ACTION_SETTINGS)); return null }

        val pkg = APP_PACKAGES[key]
        val launch = pkg?.let { context.packageManager.getLaunchIntentForPackage(it) }
        if (launch != null) { startExternally(context, launch); return null }
        return "I couldn't find $app installed."
    }

    private fun isInstalled(context: Context, pkg: String): Boolean = try {
        context.packageManager.getLaunchIntentForPackage(pkg) != null
    } catch (_: Exception) { false }

    private fun media(context: Context, action: String): String? {
        val code = when (action) {
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "toggle" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return "I didn't get which media control."
        }
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        return null
    }

    private fun hardware(context: Context, target: String, action: String): String? {
        return when (target) {
            "flashlight" -> torch(context, action)
            // Since Android 10 an app can't flip Wi-Fi/Bluetooth directly, so open the panel.
            "wifi" -> { startExternally(context, Intent(Settings.Panel.ACTION_WIFI)); null }
            "bluetooth" -> { startExternally(context, Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); null }
            "location" -> { startExternally(context, Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)); null }
            "hotspot" -> { startExternally(context, Intent(Settings.ACTION_WIRELESS_SETTINGS)); null }
            else -> "I can't control that hardware."
        }
    }

    private fun torch(context: Context, action: String): String? {
        val cm = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return "This phone has no flashlight I can reach."
        val on = when (action) { "on" -> true; "off" -> false; else -> !torchOn }
        cm.setTorchMode(id, on)
        torchOn = on
        return null
    }
}
