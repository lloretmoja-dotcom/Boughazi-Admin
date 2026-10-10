package tv.boughazi.admin

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * El panel de administración de Boughazi es una página web (HTML/CSS/JS)
 * que ya funciona bien en el navegador. En vez de reescribirla entera en
 * Kotlin, esta aplicación simplemente la mete dentro de un WebView a
 * pantalla completa — así se puede instalar como una app normal, con su
 * icono, sin tener que abrir Chrome y buscar la página cada vez.
 *
 * Los archivos (index.html, css, js) van guardados dentro de la propia
 * aplicación (en la carpeta "assets"), así que funciona en cuanto se
 * abre, sin depender de ninguna web aparte — solo necesita internet para
 * hablar con Supabase, igual que la página web de siempre.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    // Mientras la página espera a que el usuario elija un archivo (botón
    // "Seleccionar archivo"), guardamos aquí el "aviso" que hay que avisar
    // cuando el usuario termine de elegirlo.
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback
            filePathCallback = null
            if (callback == null) return@registerForActivityResult
            val data = result.data
            val uris: Array<Uri>? =
                if (result.resultCode == RESULT_OK && data?.data != null) {
                    arrayOf(data.data!!)
                } else {
                    null
                }
            callback.onReceiveValue(uris)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.adminWebView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        // Necesario para que Supabase pueda recordar la sesión iniciada
        // (si no, habría que volver a entrar con el correo cada vez que
        // se abre la aplicación).
        webView.settings.databaseEnabled = true

        // "Importar desde un enlace": la página pide a Android que descargue
        // la lista, porque el WebView no la deja leer listas de otras webs
        // que no lo autorizan (CORS). Solo descarga texto de enlaces
        // http/https, como mucho 20 MB.
        webView.addJavascriptInterface(NativeBridge(), "BoughaziNative")

        webView.webViewClient = object : WebViewClient() {
            // Las páginas propias de la aplicación (index.html y demás)
            // se quedan abriéndose aquí dentro, con normalidad. Pero si
            // se toca un enlace que lleva a otro sitio (como "ver enlace"
            // de un canal, que es la dirección de un vídeo), lo abrimos
            // con el navegador normal del móvil: este WebView no es un
            // navegador de verdad, no sabe reproducir vídeo ni abrir
            // bien direcciones sin cifrar ("http"), y antes eso daba un
            // error en pantalla en vez de abrir nada.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                if (url.scheme == "file") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Sin esto, tocar "Seleccionar archivo" en la página no hacía
            // nada: hay que decirle a Android explícitamente que abra el
            // selector de archivos del móvil y avisar a la página cuando
            // el usuario elige uno.
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    fileChooserLauncher.launch(fileChooserParams.createIntent())
                    true
                } catch (_: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        webView.loadUrl("file:///android_asset/index.html")
    }

    private inner class NativeBridge {
        @JavascriptInterface
        fun downloadText(id: Int, url: String) {
            Thread {
                val (ok, payload) = try {
                    true to downloadList(url)
                } catch (e: Exception) {
                    false to (e.message ?: "error desconocido")
                }
                val js = "window.onNativeDownload($id, $ok, ${JSONObject.quote(payload)})"
                runOnUiThread { webView.evaluateJavascript(js, null) }
            }.start()
        }

        // "Comprobar señal": mira si el enlace de un canal responde de
        // verdad (sin CORS, que en el WebView bloquea casi todos). Se
        // contesta con window.onNativeStreamCheck(id, ok, motivo).
        @JavascriptInterface
        fun checkStream(id: Int, url: String) {
            streamCheckPool.execute {
                val reason = try {
                    probeStream(url)
                } catch (e: Exception) {
                    e.message ?: e.javaClass.simpleName
                }
                val ok = reason == null
                val js = "window.onNativeStreamCheck($id, $ok, ${JSONObject.quote(reason ?: "")})"
                runOnUiThread { webView.evaluateJavascript(js, null) }
            }
        }
    }

    // Varias comprobaciones a la vez, pero no cientos: así no se satura
    // la conexión del móvil.
    private val streamCheckPool = Executors.newFixedThreadPool(12)

    /**
     * Devuelve null si el canal emite, o el motivo si no. Solo se leen
     * los primeros 64 KB: un canal en directo no termina nunca.
     * Una lista HLS (.m3u8) tiene que empezar por #EXTM3U y traer al
     * menos una línea que no sea un comentario (un trozo de vídeo o
     * una calidad); si llega vacía, el canal no está emitiendo.
     */
    private fun probeStream(start: String): String? {
        var current = start
        repeat(5) {
            val url = URL(current)
            if (url.protocol != "http" && url.protocol != "https") return "enlace no válido"
            val conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 8_000
            conn.readTimeout = 8_000
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) BoughaziAdmin")
            try {
                val code = conn.responseCode
                if (code in 300..399) {
                    val location = conn.getHeaderField("Location") ?: return "redirección sin destino"
                    current = URL(url, location).toString()
                    return@repeat
                }
                if (code !in 200..299) return "error $code"
                val out = ByteArrayOutputStream()
                conn.inputStream.use { input ->
                    val buf = ByteArray(8 * 1024)
                    while (out.size() < 64 * 1024) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                    }
                }
                if (out.size() == 0) return "no envía nada"
                val head = out.toString("UTF-8").trimStart('\uFEFF', ' ', '\r', '\n')
                if (head.startsWith("#EXTM3U")) {
                    val hasContent = head.lineSequence().any { line ->
                        val t = line.trim()
                        t.isNotEmpty() && !t.startsWith("#")
                    }
                    return if (hasContent) null else "lista vacía"
                }
                if (head.startsWith("<")) return "contesta una página web, no vídeo"
                return null
            } finally {
                conn.disconnect()
            }
        }
        return "demasiadas redirecciones"
    }

    private fun downloadList(start: String): String {
        var current = start
        // Se siguen a mano las redirecciones (también de http a https),
        // como mucho 5.
        repeat(5) {
            val url = URL(current)
            if (url.protocol != "http" && url.protocol != "https") {
                throw IllegalArgumentException("el enlace tiene que empezar por http:// o https://")
            }
            val conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("User-Agent", "BoughaziAdmin")
            try {
                val code = conn.responseCode
                if (code in 300..399) {
                    val location = conn.getHeaderField("Location")
                        ?: throw IllegalStateException("redirección sin destino")
                    current = URL(url, location).toString()
                    return@repeat
                }
                if (code !in 200..299) {
                    throw IllegalStateException("el servidor ha contestado con el error $code")
                }
                val out = ByteArrayOutputStream()
                conn.inputStream.use { input ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > MAX_LIST_BYTES) {
                            throw IllegalStateException("la lista es demasiado grande (más de 20 MB)")
                        }
                    }
                }
                return out.toString("UTF-8")
            } finally {
                conn.disconnect()
            }
        }
        throw IllegalStateException("demasiadas redirecciones")
    }

    companion object {
        private const val MAX_LIST_BYTES = 20 * 1024 * 1024
    }

    // Si la persona está navegando dentro del panel (por ejemplo, en la
    // pantalla de cambiar la contraseña) y toca "atrás", primero
    // retrocede dentro de la propia página, en vez de cerrar la app de
    // golpe.
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
