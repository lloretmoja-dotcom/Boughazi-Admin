package tv.boughazi.admin

import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
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

        // Las páginas se abren dentro de la misma aplicación (no en
        // Chrome), y los mensajes de JavaScript (como "alert") funcionan
        // con normalidad.
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()

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
