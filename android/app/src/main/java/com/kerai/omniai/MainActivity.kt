package com.kerai.omniai

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * A native shell around the Kerai AI web app.
 *
 * The reason this exists rather than just installing the PWA: Android's PWA container is
 * unreliable for exactly the features this app depends on. getUserMedia permission prompts
 * behave inconsistently, and a suspended tab silently kills the wake-word listener. A real
 * Activity holds the runtime permissions itself and forwards them to the page.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    /** Held while the page's getUserMedia request waits on an Android runtime prompt. */
    private var pendingWebPermission: PermissionRequest? = null

    companion object {
        private const val APP_URL = "https://openai.kerai.in"
        private const val REQ_RUNTIME_PERMS = 1001
        private const val REQ_FILE_CHOOSER = 1002
        private const val MENU_PAIR = 1
        private const val MENU_TALK = 2
        // Set when launched by the assistant gesture or wake word: opens the web app straight
        // into voice mode via a query param the page reads.
        const val EXTRA_START_LISTENING = "start_listening"
    }

    private fun urlForLaunch(intent: Intent?): String =
        if (intent?.getBooleanExtra(EXTRA_START_LISTENING, false) == true) "$APP_URL/dashboard?assist=1" else APP_URL

    private val MATCH = ViewGroup.LayoutParams.MATCH_PARENT

    /** A round-ish floating overlay button, built in code (no AndroidX FAB dependency). */
    private fun floatingButton(glyph: String, gravity: Int, slot: Int, onClick: () -> Unit): android.widget.Button {
        val density = resources.displayMetrics.density
        val margin = (16 * density).toInt()
        val size = (52 * density).toInt()
        return android.widget.Button(this).apply {
            text = glyph
            textSize = 20f
            setTextColor(android.graphics.Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(android.graphics.Color.parseColor(if (slot == 0) "#22D3EE" else "#1B2530"))
            }
            elevation = 8f
            setOnClickListener { onClick() }
            layoutParams = android.widget.FrameLayout.LayoutParams(size, size, gravity).apply {
                setMargins(margin, margin + slot * (size + margin), margin, margin)
            }
        }
    }

    private fun showLoadError(description: String) {
        val html = """
            <html><body style="background:#0B0F14;color:#E6EDF3;font-family:sans-serif;
            display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:24px">
            <div><h2 style="color:#22D3EE">Can't reach Kerai AI</h2>
            <p>${APP_URL} didn't load.</p>
            <p style="color:#8B98A5;font-size:14px">$description</p>
            <p style="color:#8B98A5;font-size:14px">Check that your PC is on and running the server,
            and that this phone has internet. Tap 🎙 to talk instead — that works over the paired connection.</p>
            </div></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)

        // Overlay the web view with always-visible controls. The app's theme has no action bar,
        // so the options menu never rendered — these floating buttons are the reliable way to
        // reach the native voice screen (which actually works, unlike in-page voice) and pairing.
        val root = android.widget.FrameLayout(this)
        root.addView(webView, android.widget.FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(floatingButton("🎙", android.view.Gravity.BOTTOM or android.view.Gravity.END, 0) {
            startActivity(Intent(this, VoiceActivity::class.java))
        })
        root.addView(floatingButton("⚙", android.view.Gravity.TOP or android.view.Gravity.END, 1) {
            startActivity(Intent(this, SetupActivity::class.java))
        })
        setContentView(root, ViewGroup.LayoutParams(MATCH, MATCH))

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Without this, TTS audio and the mic won't start until the user taps something,
            // which defeats hands-free wake-word operation.
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT
            // The page is remote and trusted; local file access buys nothing and only widens
            // what a compromised page could reach.
            allowFileAccess = false
            allowContentAccess = false
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val scheme = url.scheme?.lowercase()
                // Keep the assistant's own host inside the app; hand everything else
                // (mailto:, tel:, other sites) to the system so it opens properly.
                return if (scheme == "https" && url.host == Uri.parse(APP_URL).host) {
                    false
                } else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    true
                }
            }

            // Without this, a failed load leaves a blank screen and no idea why. Show what went
            // wrong — almost always the PC isn't running the server, or the phone has no network.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (!request.isForMainFrame) return
                showLoadError(error.description?.toString() ?: "Unknown error")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebPermission(request) }
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return runCatching {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER)
                    true
                }.getOrElse {
                    fileCallback = null
                    false
                }
            }
        }

        requestRuntimePermissions()
        if (savedInstanceState != null) webView.restoreState(savedInstanceState) else webView.loadUrl(urlForLaunch(intent))
    }

    // singleTask: an assist/wake invocation while the app is already open arrives here rather
    // than through onCreate, so re-navigate into listening mode.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_START_LISTENING, false)) webView.loadUrl(urlForLaunch(intent))
    }

    // A long-press anywhere opens pairing. The app is a fullscreen WebView with no chrome, so
    // this is the discoverable-but-out-of-the-way way in to device control setup.
    override fun onCreateOptionsMenu(menu: android.view.Menu): Boolean {
        menu.add(0, MENU_TALK, 0, "Talk to Kerai (voice)")
        menu.add(0, MENU_PAIR, 1, "Pair for phone control")
        return true
    }

    override fun onOptionsItemSelected(item: android.view.MenuItem): Boolean {
        return when (item.itemId) {
            MENU_TALK -> { startActivity(Intent(this, VoiceActivity::class.java)); true }
            MENU_PAIR -> { startActivity(Intent(this, SetupActivity::class.java)); true }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun requestRuntimePermissions() {
        val needed = listOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isNotEmpty()) requestPermissions(needed.toTypedArray(), REQ_RUNTIME_PERMS)
    }

    /**
     * Bridges the page's permission request to Android's. A WebView can only grant the page
     * what the app itself already holds, so an ungranted resource is denied here and the
     * Android prompt raised instead — the page can ask again once the user has answered.
     */
    private fun handleWebPermission(request: PermissionRequest) {
        val granted = request.resources.filter { resource ->
            when (resource) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                    checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                else -> false
            }
        }

        if (granted.size == request.resources.size) {
            request.grant(granted.toTypedArray())
        } else {
            pendingWebPermission = request
            request.deny()
            requestRuntimePermissions()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_RUNTIME_PERMS) {
            // The denied request can't be resumed, so prompt the page to ask again by
            // reloading only if something was actually granted this time.
            val anyGranted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
            pendingWebPermission = null
            if (anyGranted) webView.reload()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE_CHOOSER) {
            val callback = fileCallback ?: return
            fileCallback = null
            callback.onReceiveValue(
                if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                else null
            )
        }
    }

    // OnBackPressedDispatcher is the modern replacement, but it lives in AndroidX and this app
    // deliberately has no dependencies. On a plain Activity this override is still the API.
    @Deprecated("Superseded by OnBackPressedDispatcher, which would require AndroidX")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // In-app history first; only leave the app once there's nothing to go back to.
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        // Keeps audio (TTS playback) alive when the screen turns off, rather than the WebView
        // being frozen mid-utterance.
        if (isFinishing) webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) webView.destroy()
        super.onDestroy()
    }
}
