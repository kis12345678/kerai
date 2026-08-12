package com.kerai.omniai

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * One-time pairing: the user pastes the server URL and the device token minted in the dashboard,
 * then enables the accessibility service. Built entirely in code so the app needs no layout XML
 * or AndroidX. Reachable from MainActivity's menu; also the fallback screen when the poll service
 * finds it isn't paired yet.
 */
class SetupActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE)

        val ink = Color.parseColor("#0B0F14")
        val accent = Color.parseColor("#22D3EE")
        val fog = Color.parseColor("#8B98A5")

        fun label(text: String) = TextView(this).apply {
            this.text = text; setTextColor(fog); textSize = 13f
            setPadding(0, 24, 0, 6)
        }

        val serverField = EditText(this).apply {
            setText(prefs.getString(AgentService.KEY_SERVER, "https://openai.kerai.in"))
            setTextColor(Color.WHITE); hint = "https://your-server"
            setHintTextColor(fog)
        }
        val tokenField = EditText(this).apply {
            setText(prefs.getString(AgentService.KEY_TOKEN, ""))
            setTextColor(Color.WHITE); hint = "device token from the dashboard"
            setHintTextColor(fog)
        }

        val save = Button(this).apply {
            text = "Save & start agent"
            setOnClickListener {
                val server = serverField.text.toString().trim()
                val token = tokenField.text.toString().trim()
                if (!server.startsWith("https://") && !server.startsWith("http://")) {
                    Toast.makeText(this@SetupActivity, "Server must start with http(s)://", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                if (token.length < 20) {
                    Toast.makeText(this@SetupActivity, "That token looks too short", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                prefs.edit().putString(AgentService.KEY_SERVER, server).putString(AgentService.KEY_TOKEN, token).apply()
                AgentService.start(this@SetupActivity)
                Toast.makeText(this@SetupActivity, "Saved. Agent starting.", Toast.LENGTH_SHORT).show()
            }
        }

        val enableAccessibility = Button(this).apply {
            text = "Enable control (Accessibility)"
            setOnClickListener {
                Toast.makeText(
                    this@SetupActivity,
                    "Find 'Kerai AI' under Installed apps and turn it on",
                    Toast.LENGTH_LONG
                ).show()
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }

        val talk = Button(this).apply {
            text = "Talk to Kerai now (voice)"
            setOnClickListener { startActivity(Intent(this@SetupActivity, VoiceActivity::class.java)) }
        }

        val setAssistant = Button(this).apply {
            text = "Set Kerai as default assistant"
            setOnClickListener {
                Toast.makeText(
                    this@SetupActivity,
                    "Under Digital assistant app, choose Kerai AI",
                    Toast.LENGTH_LONG
                ).show()
                // Deep-link to the assistant picker; fall back to app settings if the OEM hides it.
                val intent = Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
                if (intent.resolveActivity(packageManager) != null) startActivity(intent)
                else startActivity(Intent(Settings.ACTION_SETTINGS))
            }
        }

        val wakeWord = Button(this).apply {
            text = "Start “Hey Kerai” wake word"
            setOnClickListener {
                WakeWordService.start(this@SetupActivity)
                Toast.makeText(this@SetupActivity, "Wake word listening (uses battery).", Toast.LENGTH_LONG).show()
            }
        }

        val stop = Button(this).apply {
            text = "Stop agent & wake word"
            setOnClickListener {
                AgentService.stop(this@SetupActivity)
                WakeWordService.stop(this@SetupActivity)
                Toast.makeText(this@SetupActivity, "Stopped.", Toast.LENGTH_SHORT).show()
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ink)
            setPadding(48, 72, 48, 48)
            gravity = Gravity.TOP

            addView(TextView(this@SetupActivity).apply {
                text = "Pair this phone"; setTextColor(Color.WHITE); textSize = 22f
            })
            addView(TextView(this@SetupActivity).apply {
                text = "In the assistant's dashboard, register a device to get a token, then paste it here."
                setTextColor(fog); textSize = 13f; setPadding(0, 8, 0, 8)
            })
            addView(label("Server URL")); addView(serverField)
            addView(label("Device token")); addView(tokenField)
            addView(save.withTopMargin())
            addView(talk.withTopMargin())
            addView(enableAccessibility.withTopMargin())
            addView(setAssistant.withTopMargin())
            addView(wakeWord.withTopMargin())
            addView(stop.withTopMargin())
        }
        setContentView(root, LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    }

    private fun Button.withTopMargin(): Button = apply {
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = 28 }
    }
}
