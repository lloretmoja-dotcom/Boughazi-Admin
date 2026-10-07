package tv.boughazi.admin

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

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
