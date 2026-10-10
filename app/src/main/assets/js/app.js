/* Boughazi-TV — Panel de administración
   Todo el código de esta página en un único archivo, comentado en
   español para que sea fácil de seguir. */

const el = (id) => document.getElementById(id);

/* Cuántas filas se pintan de golpe en la tabla de canales (y en la vista
   previa de importar). Con miles de canales, pintarlos todos a la vez
   dejaba el panel congelado unos segundos; ahora se pintan los primeros
   y un botón "Mostrar más" añade otra tanda. */
const CHANNEL_PAGE = 300;
const IMPORT_PAGE = 500;

const state = {
  channels: [],
  selectedIds: new Set(),
  statsTimer: null,
  statsStale: false,
  importItems: [],
  importRenderLimit: IMPORT_PAGE,
  channelSearch: "",
  channelRenderLimit: CHANNEL_PAGE,
  editingChannelId: null,
  userSearch: "",
  pairings: [],
  autoSources: [],
  editingAutoId: null,
  countries: null,
};

/* ------------------------------------------------------------ */
/* Banderas por país (para la lista de canales). Si un país no está
   en esta lista (por ejemplo "Deportes", que no es un país), se
   usa un icono genérico en vez de dar error. */
/* ------------------------------------------------------------ */

const FLAGS = {
  "marruecos": "🇲🇦", "argelia": "🇩🇿", "tunez": "🇹🇳", "túnez": "🇹🇳",
  "egipto": "🇪🇬", "libia": "🇱🇾", "mauritania": "🇲🇷", "sudan": "🇸🇩", "sudán": "🇸🇩",
  "arabia saudita": "🇸🇦", "arabia saudi": "🇸🇦", "emiratos": "🇦🇪",
  "catar": "🇶🇦", "qatar": "🇶🇦", "kuwait": "🇰🇼", "bahrein": "🇧🇭", "bahréin": "🇧🇭",
  "oman": "🇴🇲", "omán": "🇴🇲", "jordania": "🇯🇴", "libano": "🇱🇧", "líbano": "🇱🇧",
  "siria": "🇸🇾", "irak": "🇮🇶", "iraq": "🇮🇶", "palestina": "🇵🇸", "yemen": "🇾🇪",
  "turquia": "🇹🇷", "turquía": "🇹🇷", "iran": "🇮🇷", "irán": "🇮🇷",
  "espana": "🇪🇸", "españa": "🇪🇸", "francia": "🇫🇷", "reino unido": "🇬🇧",
  "alemania": "🇩🇪", "italia": "🇮🇹", "portugal": "🇵🇹", "belgica": "🇧🇪", "bélgica": "🇧🇪",
  "paises bajos": "🇳🇱", "países bajos": "🇳🇱", "holanda": "🇳🇱",
  "estados unidos": "🇺🇸", "canada": "🇨🇦", "canadá": "🇨🇦",
  "senegal": "🇸🇳", "mali": "🇲🇱", "somalia": "🇸🇴", "yibuti": "🇩🇯", "comoras": "🇰🇲",
};

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/* Bandera a partir del código del país ("MA" → 🇲🇦): son dos letras
   especiales que el móvil dibuja juntas como una bandera. */
function flagFromCode(code) {
  const cc = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "📺";
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/* Nombre del país en español a partir de su código ("MA" → "Marruecos"),
   usando los nombres que ya trae el propio móvil. Si el móvil no los
   tiene, devuelve null y se usa el nombre en inglés. */
let regionNamesEs = null;
try {
  regionNamesEs = new Intl.DisplayNames(["es"], { type: "region" });
} catch (_err) {
  regionNamesEs = null;
}
function spanishCountryName(code) {
  if (!regionNamesEs) return null;
  try {
    const name = regionNamesEs.of(String(code).toUpperCase());
    return name && name.toUpperCase() !== String(code).toUpperCase() ? name : null;
  } catch (_err) {
    return null;
  }
}

/* Además de la lista de arriba, cualquier país del mundo escrito en
   español ("Japón", "Brasil"…) recibe su bandera. Se calcula una vez. */
const FLAGS_ALL = (() => {
  const map = {};
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of letters) {
    for (const b of letters) {
      const name = spanishCountryName(a + b);
      if (name) map[normalizeText(name)] = flagFromCode(a + b);
    }
  }
  return map;
})();

/* Código ISO del país (MA, ES…) a partir de su nombre en español. */
const ISO_ALL = (() => {
  const map = {};
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of letters) {
    for (const b of letters) {
      const name = spanishCountryName(a + b);
      if (name) map[normalizeText(name)] = a + b;
    }
  }
  return map;
})();

function isoFor(category) {
  return ISO_ALL[normalizeText(category)] || "";
}

function flagFor(category) {
  const key = normalizeText(category);
  return FLAGS[key] || FLAGS_ALL[key] || "📺";
}

/* ------------------------------------------------------------ */
/* Sesión / login                                                */
/* ------------------------------------------------------------ */

async function init() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    await tryEnterDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  el("login-screen").classList.remove("hidden");
  el("dashboard").classList.add("hidden");
}

async function tryEnterDashboard() {
  // Comprobamos en el servidor si esta cuenta es administradora.
  const { data: isAdmin, error } = await supabaseClient.rpc("bt_is_admin");
  if (error || !isAdmin) {
    el("login-error").textContent = "Esta cuenta no tiene permiso de administrador.";
    el("login-error").classList.remove("hidden");
    await supabaseClient.auth.signOut();
    showLogin();
    return;
  }
  el("login-screen").classList.add("hidden");
  el("dashboard").classList.remove("hidden");
  // Los canales, las listas automáticas (están en la misma sección, que es
  // la que se abre al entrar) y las estadísticas se piden a la vez.
  await Promise.all([loadChannels(), loadAutoSources(), refreshStats(), refreshRobot()]);
  startStatsTimer();
}

/* El contador de "viendo ahora" se refresca cada 15 segundos. Antes de
   arrancarlo se para el que hubiera, para que al cerrar sesión y volver a
   entrar no se queden dos (o más) contadores funcionando a la vez. */
function startStatsTimer() {
  stopStatsTimer();
  state.statsTimer = setInterval(refreshStats, 15000);
}

function stopStatsTimer() {
  if (state.statsTimer) clearInterval(state.statsTimer);
  state.statsTimer = null;
  state.statsStale = false;
}

function loginErrorText(error) {
  const msg = String(error && error.message || "");
  const code = String(error && (error.code || "") || "");
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
    return "Correo o contraseña incorrectos.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) {
    return "Este correo todavía no está confirmado. Confírmalo en Supabase → Authentication → Users.";
  }
  if (/rate limit|too many/i.test(msg) || error.status === 429) {
    return "Demasiados intentos seguidos. Espera unos minutos y prueba otra vez.";
  }
  if (/failed to fetch|network|load failed/i.test(msg) || !error.status) {
    return "No se puede conectar con el servidor. Comprueba la conexión a internet. (" + msg + ")";
  }
  return "No se pudo entrar: " + msg + (error.status ? " (error " + error.status + ")" : "");
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("login-error").classList.add("hidden");
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    // Se dice el motivo real: antes cualquier fallo (sin internet, correo
    // sin confirmar, demasiados intentos…) salía como "contraseña
    // incorrecta" y no había forma de saber qué pasaba.
    el("login-error").textContent = loginErrorText(error);
    el("login-error").classList.remove("hidden");
    return;
  }
  await tryEnterDashboard();
});

el("logout-btn").addEventListener("click", async () => {
  stopStatsTimer();
  // Que no se queden a la vista contraseñas de Xtream escritas en los formularios.
  el("pair-form").reset();
  el("import-xtream-pass").value = "";
  await supabaseClient.auth.signOut();
  showLogin();
});

/* ------------------------------------------------------------ */
/* Pestañas                                                       */
/* ------------------------------------------------------------ */

/* El panel tiene cuatro secciones: Códigos, Canales y métodos, Centro de
   control y Rendimiento. "Códigos" lleva dentro tres apartados más
   pequeños (vincular por código, códigos de acceso y usuarios). Cada
   sección pide sus datos a Supabase al abrirla, no antes. */

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    el("tab-" + btn.dataset.tab).classList.remove("hidden");
    if (btn.dataset.tab === "codes") loadSubtab(currentSubtab());
    if (btn.dataset.tab === "channels") loadAutoSources();
    if (btn.dataset.tab === "control") loadControl();
    if (btn.dataset.tab === "stats") refreshStats();
  });
});

function currentSubtab() {
  const active = document.querySelector(".subtab.active");
  return active ? active.dataset.subtab : "pairing";
}

function loadSubtab(name) {
  if (name === "pairing") loadPairings();
  if (name === "codes") loadCodes();
  if (name === "users") loadUsers();
}

document.querySelectorAll(".subtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".sub-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    el("sub-" + btn.dataset.subtab).classList.remove("hidden");
    loadSubtab(btn.dataset.subtab);
  });
});


/* ------------------------------------------------------------ */
/* Robot de canales                                               */
/* ------------------------------------------------------------ */
/* El robot (scripts/massive_indexer.js del repositorio de la tele) se
   ejecuta cada día en GitHub Actions. Aquí se ve:
   - si está trabajando ahora o cuándo terminó (lo dice GitHub),
   - las cifras de su última pasada (las guarda en bt_robot_runs),
   - cuántos canales activos y caídos hay ahora mismo en Supabase.
   El botón "Lanzar" le pide a GitHub que lo ejecute ya. Para eso hace
   falta una clave de GitHub, que se guarda solo en este móvil. */

const ROBOT_REPO = "lloretmoja-dotcom/Boughazi-SmartTV";
const ROBOT_WORKFLOW = "daily_indexer.yml";
const ROBOT_TOKEN_KEY = "bt_github_token";
let robotPollTimer = null;

function robotToken() {
  try {
    return localStorage.getItem(ROBOT_TOKEN_KEY) || "";
  } catch (_err) {
    return "";
  }
}

function githubHeaders() {
  const headers = { Accept: "application/vnd.github+json" };
  const token = robotToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

function setRobotState(text, dot) {
  el("robot-state").textContent = text;
  el("robot-dot").className = `robot-dot ${dot || ""}`;
}

async function fetchLatestRobotRun() {
  const res = await fetch(
    `https://api.github.com/repos/${ROBOT_REPO}/actions/workflows/${ROBOT_WORKFLOW}/runs?per_page=1`,
    { headers: githubHeaders() }
  );
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`GitHub ha contestado ${res.status}`);
  const data = await res.json();
  return { run: (data.workflow_runs || [])[0] || null };
}

async function refreshRobot() {
  const [ghRes, lastRes, activeRes, brokenRes] = await Promise.allSettled([
    fetchLatestRobotRun(),
    supabaseClient.from("bt_robot_runs").select("*").order("finished_at", { ascending: false }).limit(1),
    supabaseClient.from("bt_channels").select("id", { count: "exact", head: true }).not("is_broken", "is", true),
    supabaseClient.from("bt_channels").select("id", { count: "exact", head: true }).eq("is_broken", true),
  ]);

  const count = (r) => (r.status === "fulfilled" && !r.value.error ? r.value.count : null);
  const active = count(activeRes);
  const broken = count(brokenRes);
  el("robot-active").textContent = active == null ? "—" : active.toLocaleString("es");
  el("robot-broken").textContent = broken == null ? "—" : broken.toLocaleString("es");

  // Cifras de la última pasada (si la tabla bt_robot_runs ya existe).
  const lastRow =
    lastRes.status === "fulfilled" && !lastRes.value.error && lastRes.value.data ? lastRes.value.data[0] : null;
  el("robot-added").textContent = lastRow ? `+${Number(lastRow.added || 0).toLocaleString("es")}` : "—";
  el("robot-repaired").textContent = lastRow && lastRow.repaired ? `${lastRow.repaired} arreglados` : "";

  // Estado: lo que diga GitHub manda; si no se puede preguntar, lo que
  // guardó el robot en Supabase.
  const gh = ghRes.status === "fulfilled" ? ghRes.value : null;
  const run = gh && gh.run;
  if (gh && gh.missing) {
    setRobotState("😴 Sin instalar: falta fusionar el robot en GitHub", "");
  } else if (run && (run.status === "in_progress" || run.status === "queued" || run.status === "waiting")) {
    setRobotState("🟢 Robot activo · buscando y probando canales", "on");
  } else if (run && run.conclusion && run.conclusion !== "success") {
    setRobotState("⚠️ La última pasada terminó con error", "err");
  } else if (run && Date.now() - new Date(run.updated_at).getTime() < 26 * 3600 * 1000) {
    setRobotState(lastRow && lastRow.status === "ADVERTENCIA" ? "✅ Sincronizado (con avisos)" : "✅ Sincronizado con Supabase", lastRow && lastRow.status === "ADVERTENCIA" ? "warn" : "ok");
  } else if (run || lastRow) {
    setRobotState("😴 En reposo", "");
  } else {
    setRobotState(ghRes.status === "rejected" ? "No se pudo preguntar a GitHub" : "😴 En reposo · aún no ha hecho ninguna pasada", "");
  }

  const lastIso = (run && run.status === "completed" && run.updated_at) || (lastRow && lastRow.finished_at) || null;
  el("robot-last").textContent = lastIso ? formatDateTime(lastIso) : "—";
  el("robot-last-detail").textContent = lastIso ? timeAgo(lastIso) : "";

  el("robot-token-btn").textContent = robotToken() ? "🔑 GitHub conectado" : "🔑 Conectar con GitHub";

  // Mientras trabaja, se vuelve a mirar cada 30 segundos.
  clearTimeout(robotPollTimer);
  if (el("robot-dot").classList.contains("on")) robotPollTimer = setTimeout(refreshRobot, 30000);
}

el("robot-token-btn").addEventListener("click", () => {
  el("robot-token-box").classList.toggle("hidden");
  el("robot-token-input").value = "";
});

el("robot-token-save").addEventListener("click", () => {
  const token = el("robot-token-input").value.trim();
  if (!token) return;
  try {
    localStorage.setItem(ROBOT_TOKEN_KEY, token);
  } catch (_err) {
    el("robot-status").textContent = "No se pudo guardar la clave en este móvil.";
    return;
  }
  el("robot-token-box").classList.add("hidden");
  el("robot-status").textContent = "Clave guardada. Ya puedes lanzar el robot desde aquí.";
  refreshRobot();
});

el("robot-token-forget").addEventListener("click", () => {
  try {
    localStorage.removeItem(ROBOT_TOKEN_KEY);
  } catch (_err) {
    /* nada que borrar */
  }
  el("robot-token-box").classList.add("hidden");
  el("robot-status").textContent = "Clave borrada de este móvil.";
  refreshRobot();
});

el("robot-run-btn").addEventListener("click", async () => {
  if (!robotToken()) {
    el("robot-token-box").classList.remove("hidden");
    el("robot-status").textContent = "Para lanzarlo desde aquí, primero guarda tu clave de GitHub.";
    return;
  }
  const btn = el("robot-run-btn");
  btn.disabled = true;
  el("robot-status").textContent = "Pidiendo a GitHub que lance el robot…";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ROBOT_REPO}/actions/workflows/${ROBOT_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: { ...githubHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (res.status === 204) {
      el("robot-status").textContent =
        "Hecho: el robot ha arrancado. Tarda entre 10 y 40 minutos; al terminar te llega el informe por correo.";
      setRobotState("🟢 Robot activo · arrancando", "on");
      setTimeout(refreshRobot, 15000);
    } else if (res.status === 401 || res.status === 403) {
      el("robot-status").textContent =
        "GitHub no acepta la clave (caducada o sin el permiso \"Actions: Read and write\"). Vuelve a guardarla.";
    } else if (res.status === 404) {
      el("robot-status").textContent =
        "GitHub no encuentra el robot: falta fusionar su PR, o la clave no tiene acceso a Boughazi-SmartTV.";
    } else {
      el("robot-status").textContent = `GitHub ha contestado ${res.status}: ${(await res.text()).slice(0, 200)}`;
    }
  } catch (err) {
    el("robot-status").textContent = `No se pudo conectar con GitHub: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------------------ */
/* Estadísticas                                                   */
/* ------------------------------------------------------------ */

async function refreshStats() {
  // Con el panel en segundo plano (otra app delante, pantalla apagada…)
  // nadie está mirando los números, así que no se le pregunta nada a
  // Supabase. Se apunta que faltan datos y se ponen al día en cuanto el
  // panel vuelve a verse (ver "visibilitychange" más abajo).
  if (document.hidden) {
    state.statsStale = true;
    return;
  }
  state.statsStale = false;

  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();

  // Todas las preguntas se hacen A LA VEZ (antes iban una detrás de otra
  // y había que esperar la suma de todas).
  const [registeredRes, onlineRes, activeRes, lastCheckRes, hiddenRes, lastRunRes] = await Promise.all([
    supabaseClient
      .from("bt_viewers")
      .select("id", { count: "exact", head: true }),
    supabaseClient
      .from("bt_presence")
      .select("viewer_id", { count: "exact", head: true })
      .gte("last_ping", cutoff),
    supabaseClient
      .from("bt_channels")
      .select("id", { count: "exact", head: true })
      .eq("is_broken", false),
    // Prueba real de que la comprobación automática de canales se ha
    // ejecutado de verdad: se busca la fecha más reciente guardada en
    // "last_checked_at" (el sistema automático la pone en TODOS los
    // canales cada vez que se ejecuta, hayan cambiado de estado o no).
    // Así no hay que fiarse solo de que todo salga en verde.
    supabaseClient
      .from("bt_channels")
      .select("last_checked_at")
      .not("last_checked_at", "is", null)
      .order("last_checked_at", { ascending: false })
      .limit(1),
    // Canales ocultos en la app porque están caídos.
    supabaseClient
      .from("bt_channels")
      .select("id", { count: "exact", head: true })
      .eq("is_broken", true),
    // La última pasada TERMINADA de la vigilancia de cada hora, para saber
    // cuánto tardó. Si todavía no existe la tabla, simplemente sale "—".
    supabaseClient
      .from("bt_health_runs")
      .select("started_at, finished_at")
      .not("finished_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  el("stat-registered").textContent = registeredRes.count ?? "—";
  el("stat-online").textContent = onlineRes.count ?? "—";
  el("stat-channels").textContent = activeRes.count ?? "—";
  el("stat-hidden").textContent = hiddenRes.count ?? "—";

  // Porcentaje de canales que funcionan: activos / (activos + ocultos).
  const active = activeRes.count;
  const hidden = hiddenRes.count;
  el("stat-working-share").textContent =
    active != null && hidden != null && active + hidden > 0
      ? `${Math.round((active / (active + hidden)) * 100)} %`
      : "—";

  const lastRun = !lastRunRes.error && lastRunRes.data && lastRunRes.data[0];
  el("stat-check-duration").textContent = lastRun
    ? formatDuration(new Date(lastRun.finished_at) - new Date(lastRun.started_at))
    : isMissingSqlError(lastRunRes.error)
      ? "Falta activar el SQL"
      : "—";

  const lastCheckRows = lastCheckRes.data;
  el("stat-last-check").textContent = formatLastCheck(
    lastCheckRows && lastCheckRows[0] ? lastCheckRows[0].last_checked_at : null
  );
}

// Al volver al panel (si se saltó alguna actualización mientras estaba
// escondido) se refrescan los números una vez, sin esperar 15 segundos.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.statsTimer && state.statsStale) refreshStats();
});

/* "3 min 20 s", "45 s", "1 h 5 min"… */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${sec} s`;
  return `${sec} s`;
}

function formatLastCheck(iso) {
  if (!iso) return "Todavía no se ha comprobado ningún canal";
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "Hace un momento";
  if (diffMin < 60) return `Hace ${diffMin} minuto${diffMin === 1 ? "" : "s"}`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH} hora${diffH === 1 ? "" : "s"}`;
  const diffD = Math.round(diffH / 24);
  return `Hace ${diffD} día${diffD === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------ */
/* Canales                                                        */
/* ------------------------------------------------------------ */

async function loadChannels() {
  el("channels-status").textContent = "Cargando canales…";

  // Supabase solo entrega 1000 filas como máximo por cada petición.
  // Como ya hemos pasado de 1000 canales, pedimos la lista por partes
  // (de 1000 en 1000) hasta traerlos todos, en vez de una sola vez.
  // Se ordena también por "id": muchos canales comparten número (cada
  // país empieza en el 1) y, sin un orden fijo, una parte podía repetir
  // canales de la anterior y saltarse otros.
  const { data: all, error } = await fetchAllPages((from, to) =>
    supabaseClient
      .from("bt_channels")
      .select("*")
      .order("channel_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (error) {
    el("channels-status").textContent = "Error al cargar: " + error.message;
    return;
  }

  state.channels = all;
  state.selectedIds.clear();
  el("select-all").checked = false;
  updateBulkBar();
  renderChannels();
  el("channels-status").textContent = state.channels.length
    ? ""
    : "Todavía no has añadido ningún canal.";
}

/* Agrupa los canales por país/categoría. Cada grupo se numera él
   solo desde el 1 (el número que se ve en pantalla no depende del
   número guardado en la base de datos, así que un país nunca
   "hereda" los números de otro). Los grupos salen ordenados por
   nombre, y "Sin categoría" siempre va al final. */
function groupChannelsForDisplay(channels) {
  const byCategory = new Map();
  for (const c of channels) {
    const key = c.category && c.category.trim() ? c.category.trim() : "Sin categoría";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(c);
  }

  const categories = Array.from(byCategory.keys()).sort((a, b) => {
    if (a === "Sin categoría") return 1;
    if (b === "Sin categoría") return -1;
    return a.localeCompare(b, "es");
  });

  return categories.map((category) => {
    const items = byCategory.get(category).slice().sort((a, b) => {
      const an = a.channel_number ?? Number.MAX_SAFE_INTEGER;
      const bn = b.channel_number ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return (a.name || "").localeCompare(b.name || "", "es");
    });
    return { category, items };
  });
}

function matchesSearch(channel, needle) {
  if (!needle) return true;
  const haystack = normalizeText(
    `${channel.name || ""} ${channel.category || ""} ${channel.channel_number ?? ""}`
  );
  return haystack.includes(needle);
}

function renderChannels() {
  const needle = normalizeText(state.channelSearch);
  const filtered = state.channels.filter((c) => matchesSearch(c, needle));
  const groups = groupChannelsForDisplay(filtered);

  if (!groups.length) {
    el("channels-tbody").innerHTML = "";
    return;
  }

  // Solo se pintan las primeras "channelRenderLimit" filas. Las cabeceras
  // de cada país siguen diciendo cuántos canales tiene el país entero.
  const limit = state.channelRenderLimit;
  let shown = 0;
  const parts = [];
  for (const group of groups) {
    if (shown >= limit) break;
    parts.push(`
      <tr class="group-header">
        <td colspan="7">
          <div class="group-header-inner">
            <span class="group-flag">${flagFor(group.category)}</span>
            <span class="group-name" dir="auto">${escapeHtml(group.category)}</span>
            ${isoFor(group.category) ? `<span class="group-iso">${isoFor(group.category)}</span>` : ""}
            <span class="group-count">(${group.items.length} canal${group.items.length === 1 ? "" : "es"})</span>
            <button class="btn danger" data-delete-country="${escapeHtml(group.category)}">🗑 Borrar país entero</button>
          </div>
        </td>
      </tr>`);

    for (let idx = 0; idx < group.items.length && shown < limit; idx++) {
      const c = group.items[idx];
      shown += 1;
      const statusHtml = c.is_broken
        ? '<span class="status-broken">⚠ Caído</span>'
        : '<span class="status-ok">● OK</span>';
      // loading="lazy": con muchos canales, el navegador solo descarga
      // el logo cuando esa fila está a punto de verse en pantalla, en
      // vez de intentar cargar miles de imágenes todas a la vez (que
      // es lo que estaba poniendo lento/congelado el panel).
      const logoHtml = safeHttpUrl(c.logo_url)
        ? `<img class="channel-logo" loading="lazy" src="${escapeHtml(c.logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'channel-logo empty',textContent:'—'}))" />`
        : `<span class="channel-logo empty">—</span>`;

      parts.push(`
        <tr>
          <td><input type="checkbox" class="row-check" data-id="${escapeHtml(c.id)}" ${
        state.selectedIds.has(String(c.id)) ? "checked" : ""
      } /></td>
          <td>${idx + 1}</td>
          <td>${logoHtml}</td>
          <td class="name-cell" dir="auto">${escapeHtml(c.name)}</td>
          <td>${statusHtml}</td>
          <td>${
        safeHttpUrl(c.stream_url)
          ? `<a class="link-icon" href="${escapeHtml(c.stream_url)}" target="_blank" rel="noopener">ver enlace</a>`
          : '<span class="status-broken">enlace no válido</span>'
      }</td>
          <td>
            <button class="btn" data-edit="${escapeHtml(c.id)}">✏️ Editar</button>
            <button class="btn danger" data-delete="${escapeHtml(c.id)}">Borrar</button>
          </td>
        </tr>`);
    }
  }

  const remaining = filtered.length - shown;
  if (remaining > 0) {
    parts.push(`
      <tr class="load-more-row">
        <td colspan="7">
          <button class="btn" data-show-more>Mostrar más (quedan ${remaining})</button>
        </td>
      </tr>`);
  }

  el("channels-tbody").innerHTML = parts.join("");
}

/* Un solo "escuchador" para toda la tabla de canales, en vez de uno por
   cada botón y cada casilla. Antes, cada vez que se pintaba la tabla se
   le colgaban miles de escuchadores nuevos a las filas, y eso también
   hacía ir lento el panel. Ahora la tabla mira qué se ha tocado. */
el("channels-tbody").addEventListener("change", (e) => {
  const cb = e.target.closest(".row-check");
  if (!cb) return;
  if (cb.checked) state.selectedIds.add(cb.dataset.id);
  else state.selectedIds.delete(cb.dataset.id);
  updateBulkBar();
});

el("channels-tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if ("deleteCountry" in btn.dataset) {
    deleteWholeCountry(btn.dataset.deleteCountry);
  } else if ("delete" in btn.dataset) {
    if (!confirm("¿Borrar este canal? No se puede deshacer.")) return;
    deleteChannels([btn.dataset.delete]);
  } else if ("edit" in btn.dataset) {
    openEditChannel(btn.dataset.edit);
  } else if ("showMore" in btn.dataset) {
    state.channelRenderLimit += CHANNEL_PAGE;
    renderChannels();
  }
});

/* Marca o desmarca las casillas que ya están pintadas, sin volver a
   pintar toda la tabla. */
function syncRowChecks() {
  document.querySelectorAll("#channels-tbody .row-check").forEach((cb) => {
    cb.checked = state.selectedIds.has(cb.dataset.id);
  });
}

// La búsqueda espera a que se deje de escribir un momento (200 ms) antes
// de volver a pintar la lista: así no se repinta con cada letra.
const searchChannelsSoon = debounce(() => {
  state.channelSearch = el("channel-search").value;
  state.channelRenderLimit = CHANNEL_PAGE;
  renderChannels();
}, 200);
el("channel-search").addEventListener("input", searchChannelsSoon);

/* Solo se aceptan enlaces que empiecen por http:// o https://. Las listas
   M3U suelen venir de terceros: un enlace del tipo "javascript:..." metido
   en la lista podría ejecutar código dentro del panel con tu sesión de
   administrador (y desde aquí se puede borrar o cambiar todo). */
function safeHttpUrl(str) {
  try {
    const u = new URL(String(str || "").trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_err) {
    return false;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

/* Devuelve una versión de "fn" que solo se ejecuta cuando han pasado
   "ms" milisegundos sin volver a llamarla (por ejemplo, cuando se deja
   de escribir en un buscador). */
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* Supabase entrega como mucho 1000 filas por petición. Esta función pide
   una tabla entera por partes, de 1000 en 1000, hasta que no quedan más.
   "makeQuery(from, to)" tiene que devolver la consulta ya con su .range(). */
async function fetchAllPages(makeQuery, pageSize = 1000) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (data) all.push(...data);
    if (!data || data.length < pageSize) return { data: all, error: null };
    from += pageSize;
  }
}

/* "Vincular por código", "Listas automáticas" y el "Centro de control"
   usan tablas y funciones nuevas de Supabase. Si todavía no se ha
   ejecutado su archivo SQL, Supabase contesta que "no existen": en vez de
   enseñar ese error técnico, se explica qué hay que hacer. */
const SQL_MISSING_MSG =
  "Esta función necesita activar antes el archivo SQL en Supabase " +
  "(supabase/mejoras-subida-y-vinculacion.sql: cópialo en el SQL Editor y pulsa Run).";

function isMissingSqlError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(code)) return true;
  return /does not exist|could not find|schema cache/i.test(String(error.message || ""));
}

function friendlyDbError(error) {
  return isMissingSqlError(error) ? SQL_MISSING_MSG : String(error.message || error);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

el("select-all").addEventListener("change", (e) => {
  // Solo se marcan los canales que se ven ahora (los de la búsqueda).
  // Antes se marcaban TODOS aunque hubiera una búsqueda escrita, y
  // "Borrar seleccionados" borraba también canales que no se veían.
  const needle = normalizeText(state.channelSearch);
  // También se marcan los que todavía no se han pintado por "Mostrar más":
  // cuentan como visibles porque coinciden con la búsqueda.
  if (e.target.checked) {
    state.channels.filter((c) => matchesSearch(c, needle)).forEach((c) => state.selectedIds.add(String(c.id)));
  } else {
    state.selectedIds.clear();
  }
  syncRowChecks();
  updateBulkBar();
});

function updateBulkBar() {
  const n = state.selectedIds.size;
  el("bulk-bar").classList.toggle("hidden", n === 0);
  el("bulk-count").textContent = `${n} seleccionado${n === 1 ? "" : "s"}`;
}

el("bulk-clear-btn").addEventListener("click", () => {
  state.selectedIds.clear();
  el("select-all").checked = false;
  syncRowChecks();
  updateBulkBar();
});

el("bulk-delete-btn").addEventListener("click", async () => {
  const ids = Array.from(state.selectedIds);
  if (!ids.length) return;
  if (!confirm(`¿Borrar ${ids.length} canal(es) seleccionados? No se puede deshacer.`)) return;
  await deleteChannels(ids);
});

/* Borra de golpe todos los canales de un país (por ejemplo, si ya
   no quieres ofrecer ningún canal de ese país). Pide confirmación
   explícita, con el nombre del país y cuántos canales se van a
   perder, porque no se puede deshacer. */
async function deleteWholeCountry(category) {
  const items = state.channels.filter((c) => {
    const key = c.category && c.category.trim() ? c.category.trim() : "Sin categoría";
    return key === category;
  });
  if (!items.length) return;
  const seguro = confirm(
    `Vas a borrar TODO "${category}" (${items.length} canal${items.length === 1 ? "" : "es"}). Esto no se puede deshacer. ¿Seguro?`
  );
  if (!seguro) return;
  await deleteChannels(items.map((c) => String(c.id)));
}

async function deleteChannels(ids) {
  // Si son muchos canales (por ejemplo, todos de golpe con "Seleccionar
  // todos"), borrarlos en una sola petición puede fallar porque el
  // enlace se hace demasiado largo. Los borramos en tandas de 200 en
  // 200, mostrando el progreso, hasta terminar con todos.
  const chunkSize = 200;
  const btn = el("bulk-delete-btn");
  const originalLabel = btn.textContent;
  btn.disabled = true;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    btn.textContent = `Borrando… ${Math.min(i + chunkSize, ids.length)}/${ids.length}`;
    const { error } = await supabaseClient.from("bt_channels").delete().in("id", chunk);
    if (error) {
      alert("No se pudo borrar: " + error.message);
      btn.disabled = false;
      btn.textContent = originalLabel;
      await loadChannels();
      await refreshStats();
      return;
    }
  }

  btn.disabled = false;
  btn.textContent = originalLabel;
  ids.forEach((id) => state.selectedIds.delete(id));
  await loadChannels();
  await refreshStats();
}

/* ---- Añadir / editar canal ----
   El mismo formulario sirve para las dos cosas: si "editingChannelId"
   tiene un valor, se está corrigiendo un canal que ya existe; si está
   vacío, se está creando uno nuevo. */
el("new-channel-btn").addEventListener("click", () => {
  state.editingChannelId = null;
  el("channel-modal-title").textContent = "Añadir canal";
  el("channel-form").reset();
  el("channel-form-error").classList.add("hidden");
  el("channel-modal").classList.remove("hidden");
});

function openEditChannel(id) {
  const channel = state.channels.find((c) => String(c.id) === String(id));
  if (!channel) return;
  state.editingChannelId = id;
  el("channel-modal-title").textContent = "Editar canal";
  el("cf-number").value = channel.channel_number ?? "";
  el("cf-name").value = channel.name || "";
  el("cf-category").value = channel.category || "";
  el("cf-logo").value = channel.logo_url || "";
  el("cf-src").value = channel.stream_url || "";
  el("channel-form-error").classList.add("hidden");
  el("channel-modal").classList.remove("hidden");
}

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => el(btn.dataset.close).classList.add("hidden"));
});

/* Calcula el siguiente número dentro de un país (el más alto que
   ya exista en ese país, más uno). Si el país todavía no tiene
   ningún canal, empieza en 1. */
function nextNumberForCategory(category, excludingId) {
  const key = category && category.trim() ? category.trim() : "Sin categoría";
  const enEsePais = state.channels.filter((c) => {
    if (c.id === excludingId) return false;
    const ck = c.category && c.category.trim() ? c.category.trim() : "Sin categoría";
    return ck === key;
  });
  if (!enEsePais.length) return 1;
  return Math.max(...enEsePais.map((c) => c.channel_number || 0)) + 1;
}

el("channel-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const category = el("cf-category").value.trim() || null;
  const typedNumber = el("cf-number").value.trim();
  const payload = {
    name: el("cf-name").value.trim(),
    category,
    logo_url: el("cf-logo").value.trim() || null,
    stream_url: el("cf-src").value.trim(),
  };

  if (!safeHttpUrl(payload.stream_url)) {
    el("channel-form-error").textContent = "El enlace del canal tiene que empezar por http:// o https://";
    el("channel-form-error").classList.remove("hidden");
    return;
  }
  if (payload.logo_url && !safeHttpUrl(payload.logo_url)) payload.logo_url = null;

  if (typedNumber) {
    payload.channel_number = Number(typedNumber);
  } else if (!state.editingChannelId) {
    // Canal nuevo sin número escrito a mano: se le pone el siguiente
    // número disponible dentro de su propio país.
    payload.channel_number = nextNumberForCategory(category, null);
  }
  // Si se está editando y se deja el número en blanco, no se toca
  // (se queda con el número que ya tenía).

  let error;
  if (state.editingChannelId) {
    ({ error } = await supabaseClient
      .from("bt_channels")
      .update(payload)
      .eq("id", state.editingChannelId));
  } else {
    ({ error } = await supabaseClient.from("bt_channels").insert({ ...payload, is_broken: false }));
  }

  if (error) {
    el("channel-form-error").textContent = error.message;
    el("channel-form-error").classList.remove("hidden");
    return;
  }
  state.editingChannelId = null;
  el("channel-modal").classList.add("hidden");
  await loadChannels();
  await refreshStats();
});

/* ---- Verificar canales caídos ----
   Comprobación "best effort": muchos servidores de streaming
   bloquean estas peticiones desde el navegador (CORS), así que
   algunos canales que SÍ funcionan en la app pueden aparecer como
   "no comprobado". Es una ayuda, no una garantía al 100%.

   Los canales que fallan (respuesta HTTP con error, no un simple bloqueo
   de CORS) se MARCAN como caídos: la app de la tele deja de mostrarlos,
   pero no se pierden. Muchos fallan solo desde aquí (bloqueo por país o
   porque piden cabeceras especiales) y en la tele sí funcionan. La
   comprobación automática de cada noche es la que los borra de verdad
   cuando llevan 7 días seguidos caídos. Los canales duplicados (mismo
   enlace de vídeo que otro ya guardado) sí se borran aquí. */
el("check-channels-btn").addEventListener("click", async () => {
  const checkBtn = el("check-channels-btn");
  if (checkBtn.disabled) return;
  checkBtn.disabled = true;
  try {
    await checkChannels();
  } finally {
    checkBtn.disabled = false;
  }
});

async function deleteIdsInChunks(ids) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabaseClient.from("bt_channels").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }
}

async function updateIdsInChunks(ids, values) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabaseClient.from("bt_channels").update(values).in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }
}

async function checkChannels() {
  el("channels-status").textContent = "Comprobando canales, puede tardar un poco…";

  // 1) Duplicados exactos (mismo enlace de vídeo): se queda uno solo.
  const porEnlace = new Map();
  for (const c of state.channels) {
    // Sin pasar a minúsculas: dos enlaces que solo se distinguen en una
    // mayúscula (muy habitual en los códigos de acceso de los enlaces) son
    // canales distintos.
    const clave = (c.stream_url || "").trim();
    if (!clave) continue;
    if (!porEnlace.has(clave)) porEnlace.set(clave, []);
    porEnlace.get(clave).push(c);
  }
  const idsDuplicados = [];
  for (const grupo of porEnlace.values()) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort((a, b) => {
      const aTieneNumero = a.channel_number == null ? 1 : 0;
      const bTieneNumero = b.channel_number == null ? 1 : 0;
      if (aTieneNumero !== bTieneNumero) return aTieneNumero - bTieneNumero;
      return String(a.id).localeCompare(String(b.id));
    });
    for (const sobrante of ordenado.slice(1)) idsDuplicados.push(sobrante.id);
  }
  try {
    // En tandas de 200: con muchos duplicados, una sola petición era
    // demasiado larga y fallaba sin avisar.
    await deleteIdsInChunks(idsDuplicados);
  } catch (err) {
    el("channels-status").textContent = "No se pudieron borrar los duplicados: " + err.message;
    return;
  }
  const idsDuplicadosSet = new Set(idsDuplicados);
  const canalesAComprobar = state.channels.filter((c) => !idsDuplicadosSet.has(c.id));

  // 2) Comprobar cada canal restante y borrar de verdad los que fallan.
  //
  // ANTES: se comprobaba un canal, se esperaba la respuesta completa, y
  // SOLO ENTONCES se pasaba al siguiente — uno detrás de otro. Si tienes
  // miles de canales y algunos de ellos no responden nunca (un servidor
  // caído no suele dar error rápido, simplemente se queda callado), cada
  // uno de esos podía dejar el panel esperando mucho rato antes de poder
  // seguir con el siguiente, y con muchos así sumaba varios minutos.
  //
  // AHORA: se comprueban varios canales A LA VEZ (en tandas), y a cada
  // comprobación se le pone un límite de 8 segundos — si un canal no
  // contesta en ese tiempo, se da por "no comprobado" (no se borra solo
  // por tardar) y se sigue enseguida con los demás, sin quedarse esperando.
  const LIMITE_A_LA_VEZ = 20;
  const TIEMPO_MAXIMO_MS = 8000;
  const idsCaidos = [];
  const idsArreglados = [];
  let comprobados = 0;

  async function comprobarUno(c) {
    let broken = false;
    let comprobableDeVerdad = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIEMPO_MAXIMO_MS);
    try {
      const res = await fetch(c.stream_url, {
        method: "GET",
        mode: "cors",
        signal: controller.signal,
      });
      broken = !res.ok;
    } catch (_err) {
      // Bloqueo de CORS, o se agotó el tiempo de espera (8s): en ningún
      // caso lo sabemos con seguridad, así que no lo tocamos solo por eso.
      comprobableDeVerdad = false;
    } finally {
      clearTimeout(timeoutId);
      // Cortamos la descarga en cuanto llega la respuesta: un canal en
      // directo no termina nunca, y antes se quedaban 20 vídeos bajándose
      // a la vez (gastando datos del móvil) hasta cerrar el panel.
      controller.abort();
    }
    if (comprobableDeVerdad && broken && !c.is_broken) {
      idsCaidos.push(c.id);
    } else if (comprobableDeVerdad && !broken && c.is_broken) {
      idsArreglados.push(c.id);
    }
    comprobados += 1;
    el("channels-status").textContent =
      `Comprobando canales… ${comprobados}/${canalesAComprobar.length}`;
  }

  for (let i = 0; i < canalesAComprobar.length; i += LIMITE_A_LA_VEZ) {
    const tanda = canalesAComprobar.slice(i, i + LIMITE_A_LA_VEZ);
    await Promise.all(tanda.map((c) => comprobarUno(c)));
  }

  try {
    // Estaban marcados como caídos de una comprobación anterior y ahora
    // sí responden: se limpia la marca.
    await updateIdsInChunks(idsArreglados, { is_broken: false, last_checked_at: new Date().toISOString() });
    await updateIdsInChunks(idsCaidos, { is_broken: true });
  } catch (err) {
    el("channels-status").textContent = "No se pudo guardar el resultado: " + err.message;
    return;
  }

  el("channels-status").textContent =
    `Hecho: ${idsDuplicados.length} duplicados borrados, ${idsCaidos.length} canales marcados como caídos ` +
    `y ${idsArreglados.length} que vuelven a funcionar.`;
  await loadChannels();
  await refreshStats();
}

/* ---- Importar lista de canales (M3U / M3U8 / texto simple) ----
   Así no hay que añadir los canales uno a uno con un enlace: se
   sube el archivo entero y se rellenan todos de golpe. */

el("import-channels-btn").addEventListener("click", () => {
  el("import-file-input").value = "";
  el("import-url-input").value = "";
  el("import-xtream-server").value = "";
  el("import-xtream-user").value = "";
  el("import-xtream-pass").value = "";
  el("import-category-override").value = "";
  el("import-status").textContent = "";
  hideImportPreview();
  el("import-error").classList.add("hidden");
  state.importItems = [];
  el("import-modal").classList.remove("hidden");
});

function parseChannelList(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const items = [];
  let pending = null; // datos del #EXTINF que estamos esperando emparejar con su enlace

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith("#EXTINF")) {
      const commaIdx = firstCommaOutsideQuotes(line);
      const attrsPart = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const namePart = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "";
      const logoMatch = attrsPart.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = attrsPart.match(/group-title="([^"]*)"/i);
      pending = {
        name: namePart || `Canal ${items.length + 1}`,
        category: groupMatch ? groupMatch[1] : "",
        logoUrl: logoMatch ? logoMatch[1] : "",
      };
      continue;
    }

    if (line.startsWith("#")) continue; // otras etiquetas del M3U, se ignoran

    // Cualquier otra línea no vacía la tratamos como el enlace del canal.
    if (pending) {
      items.push({ ...pending, streamUrl: line });
      pending = null;
    } else {
      // Archivo de texto simple: un enlace por línea, sin #EXTINF.
      items.push({ name: `Canal ${items.length + 1}`, category: "", logoUrl: "", streamUrl: line });
    }
  }
  return items;
}

/* La coma que separa los datos del nombre en #EXTINF es la primera que
   NO está entre comillas: tvg-name="Noticias, 24h" lleva una coma dentro
   y antes cortaba el nombre del canal por ahí. */
function firstCommaOutsideQuotes(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === "," && !inQuotes) return i;
  }
  return -1;
}

el("import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showImportPreview(await file.text());
});

/* Descarga el texto de una lista. Dentro de la app del panel se usa la
   descarga de Android (window.BoughaziNative), porque el navegador
   interno no deja leer listas de webs que no lo autorizan (CORS). En un
   navegador normal se usa fetch. */
let nativeDownloadSeq = 0;
const nativeDownloads = new Map();
window.onNativeDownload = (id, ok, payload) => {
  const pending = nativeDownloads.get(id);
  if (!pending) return;
  nativeDownloads.delete(id);
  if (ok) pending.resolve(payload);
  else pending.reject(new Error(payload));
};

async function downloadListText(url) {
  if (window.BoughaziNative && window.BoughaziNative.downloadText) {
    const id = ++nativeDownloadSeq;
    return new Promise((resolve, reject) => {
      nativeDownloads.set(id, { resolve, reject });
      window.BoughaziNative.downloadText(id, url);
    });
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`el servidor ha contestado con el error ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("tarda demasiado (más de 1 minuto)");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* Importar desde un enlace: el panel descarga la lista él mismo, sin
   tener que guardarla antes como archivo en el móvil. */
el("import-url-btn").addEventListener("click", async () => {
  const url = el("import-url-input").value.trim();
  if (!safeHttpUrl(url)) {
    el("import-status").textContent = "El enlace de la lista tiene que empezar por http:// o https://";
    return;
  }
  const btn = el("import-url-btn");
  btn.disabled = true;
  el("import-status").textContent = "Descargando la lista…";
  try {
    showImportPreview(await downloadListText(url));
  } catch (err) {
    el("import-status").textContent = `No se pudo descargar la lista: ${err.message}`;
    hideImportPreview();
  } finally {
    btn.disabled = false;
  }
});

/* ---- Importar desde Xtream Codes ----
   Muchos proveedores no dan un enlace M3U sino tres datos: la dirección
   del servidor, un usuario y una contraseña. Con ellos se le pide al
   servidor (por su "player_api.php") la lista de categorías y la de
   canales en directo, y se convierten en canales normales del panel. */

/* Deja la dirección del servidor limpia: sin espacios, sin barra al final
   y sin "/player_api.php" o "/get.php" si se ha pegado el enlace entero.
   Tiene que empezar por http:// o https://; si no, devuelve null. */
function normalizeXtreamServer(str) {
  const raw = String(str || "").trim();
  if (!/^https?:\/\//i.test(raw) || !safeHttpUrl(raw)) return null;
  const u = new URL(raw);
  const path = u.pathname.replace(/\/(player_api|get|xmltv)\.php$/i, "").replace(/\/+$/, "");
  return u.origin + path;
}

function xtreamApiUrl(server, user, pass, action) {
  return (
    `${server}/player_api.php?username=${encodeURIComponent(user)}` +
    `&password=${encodeURIComponent(pass)}&action=${action}`
  );
}

/* Lee la respuesta del servidor Xtream. Si no es JSON, la dirección no es
   la de un servidor Xtream (o el servidor ha contestado con una página de
   error). Si trae "user_info.auth = 0", el usuario o la contraseña están mal. */
function parseXtreamResponse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    throw new Error(
      "el servidor no ha contestado como un servidor Xtream. Revisa la dirección, el usuario y la contraseña."
    );
  }
  if (data && !Array.isArray(data) && data.user_info && Number(data.user_info.auth) === 0) {
    throw new Error("el usuario o la contraseña no son correctos (el servidor no deja entrar).");
  }
  return data;
}

/* Convierte las listas del servidor Xtream en canales con el mismo formato
   que los de un M3U: { name, category, logoUrl, streamUrl }. */
function xtreamStreamsToItems(server, user, pass, categories, streams) {
  const categoryNames = new Map();
  for (const cat of Array.isArray(categories) ? categories : []) {
    if (cat && cat.category_id != null) {
      categoryNames.set(String(cat.category_id), String(cat.category_name || "").trim());
    }
  }
  return (Array.isArray(streams) ? streams : [])
    .filter((st) => st && st.stream_id != null && String(st.stream_id).trim() !== "")
    .map((st, i) => ({
      name: String(st.name || "").trim() || `Canal ${i + 1}`,
      category: categoryNames.get(String(st.category_id)) || "",
      logoUrl: String(st.stream_icon || "").trim(),
      streamUrl:
        `${server}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/` +
        `${encodeURIComponent(String(st.stream_id).trim())}.m3u8`,
    }));
}

async function downloadXtreamChannels(server, user, pass, onProgress) {
  onProgress("Conectando con el servidor Xtream…");
  // Primero las categorías: si el usuario o la contraseña están mal, se
  // sabe ya aquí y no se pierde tiempo bajando la lista de canales.
  const categories = parseXtreamResponse(
    await downloadListText(xtreamApiUrl(server, user, pass, "get_live_categories"))
  );
  onProgress("Descargando la lista de canales… (con listas grandes puede tardar un poco)");
  const streams = parseXtreamResponse(
    await downloadListText(xtreamApiUrl(server, user, pass, "get_live_streams"))
  );
  if (!Array.isArray(streams)) {
    throw new Error("el servidor ha contestado algo inesperado en vez de la lista de canales.");
  }
  return xtreamStreamsToItems(server, user, pass, categories, streams);
}

el("import-xtream-btn").addEventListener("click", async () => {
  const server = normalizeXtreamServer(el("import-xtream-server").value);
  const user = el("import-xtream-user").value.trim();
  const pass = el("import-xtream-pass").value.trim();
  if (!server) {
    el("import-status").textContent =
      "La dirección del servidor tiene que empezar por http:// o https:// (por ejemplo: http://servidor.com:8080)";
    return;
  }
  if (!user || !pass) {
    el("import-status").textContent = "Escribe el usuario y la contraseña de Xtream.";
    return;
  }
  const btn = el("import-xtream-btn");
  btn.disabled = true;
  try {
    const items = await downloadXtreamChannels(server, user, pass, (msg) => {
      el("import-status").textContent = msg;
    });
    showImportItems(items);
  } catch (err) {
    el("import-status").textContent = `No se pudo cargar la lista Xtream: ${err.message}`;
    hideImportPreview();
  } finally {
    btn.disabled = false;
  }
});

/* ---- Canales por país ----
   Se busca un país, se toca, y el panel descarga el catálogo completo
   de canales de ese país de la lista pública iptv-org (organizada por
   países). Luego se abre la ventana de importar con todos marcados y
   la categoría ya puesta con el nombre del país, así entran agrupados
   y con su bandera. Se sube con el mismo botón "Importar" de siempre,
   que no repite los canales que ya tienes. */

const IPTV_ORG_COUNTRIES = "https://iptv-org.github.io/api/countries.json";
const iptvOrgCountryList = (code) => `https://iptv-org.github.io/iptv/countries/${code.toLowerCase()}.m3u`;

/* Lista de países: primero se intenta la de iptv-org (solo países que
   tienen lista); si no se puede descargar, se usan todos los países
   que conoce el móvil. */
async function loadCountryList() {
  if (state.countries) return state.countries;
  let raw = [];
  try {
    const data = JSON.parse(await downloadListText(IPTV_ORG_COUNTRIES));
    if (Array.isArray(data)) raw = data.map((c) => ({ code: c.code, englishName: c.name }));
  } catch (_err) {
    raw = [];
  }
  if (!raw.length) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of letters) for (const b of letters) if (spanishCountryName(a + b)) raw.push({ code: a + b, englishName: "" });
  }
  state.countries = raw
    .filter((c) => /^[A-Za-z]{2}$/.test(String(c.code || "")))
    .map((c) => {
      const code = c.code.toUpperCase();
      const name = spanishCountryName(code) || c.englishName || code;
      return { code, name, englishName: c.englishName || "", flag: flagFromCode(code) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return state.countries;
}


/* ---- Más fuentes de canales en abierto ----
   Además de iptv-org, se consultan otras dos listas públicas de canales
   que se emiten gratis y en abierto:
   - TDTChannels (tdtchannels.com): canales de España y algunos de
     otros países, mantenida a mano y muy fiable.
   - Free-TV/IPTV (GitHub): solo canales gratuitos en abierto, ordenados
     por país.
   Las dos se descargan una vez y se guardan mientras el panel está
   abierto; luego, de cada una, se cogen los canales del país elegido. */

const TDTCHANNELS_JSON = "https://www.tdtchannels.com/lists/tv.json";
const FREE_TV_M3U = "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8";

// Nombres de país que estas listas escriben a su manera.
const COUNTRY_ALIASES = {
  uk: "GB", "united kingdom": "GB", england: "GB", usa: "US", "united states": "US",
  "south korea": "KR", korea: "KR", "north korea": "KP", russia: "RU",
  "czech republic": "CZ", holland: "NL", netherlands: "NL", "the netherlands": "NL",
  uae: "AE", "united arab emirates": "AE", "bosnia and herzegovina": "BA",
  "ivory coast": "CI", "vatican city": "VA", kosovo: "XK", "north macedonia": "MK",
  macedonia: "MK", "dominican republic": "DO", taiwan: "TW", "hong kong": "HK",
  palestine: "PS", vietnam: "VN", "viet nam": "VN", iran: "IR", syria: "SY",
  bolivia: "BO", venezuela: "VE", tanzania: "TZ", moldova: "MD", laos: "LA",
  "cape verde": "CV", eswatini: "SZ", turkey: "TR", turkiye: "TR",
};

/* Código del país ("ES") a partir de su nombre en español o en inglés. */
let countryCodeByNameCache = null;
function countryCodeFromName(name) {
  if (!countryCodeByNameCache) {
    countryCodeByNameCache = new Map();
    let regionNamesEn = null;
    try {
      regionNamesEn = new Intl.DisplayNames(["en"], { type: "region" });
    } catch (_err) {
      regionNamesEn = null;
    }
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of letters) {
      for (const b of letters) {
        const code = a + b;
        const es = spanishCountryName(code);
        if (es) countryCodeByNameCache.set(normalizeText(es), code);
        if (regionNamesEn) {
          try {
            const en = regionNamesEn.of(code);
            if (en && en !== code) countryCodeByNameCache.set(normalizeText(en), code);
          } catch (_err) {
            /* código que el móvil no conoce */
          }
        }
      }
    }
    for (const c of state.countries || []) {
      if (c.englishName) countryCodeByNameCache.set(normalizeText(c.englishName), c.code);
    }
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) countryCodeByNameCache.set(alias, code);
  }
  const key = normalizeText(name).replace(/^(the)\s+/, "");
  return countryCodeByNameCache.get(key) || null;
}

/* TDTChannels: { countries: [ { name, ambits: [ { name, channels: [
   { name, logo, options: [ { format, url } ] } ] } ] } ] }.
   Se lee con cuidado por si cambian algún campo: si no se entiende,
   esa fuente se salta y se sigue con las demás. */
function tdtChannelsToItems(data, code) {
  const items = [];
  const countries = data && Array.isArray(data.countries) ? data.countries : [];
  for (const country of countries) {
    if (countryCodeFromName(country && country.name) !== code) continue;
    for (const ambit of Array.isArray(country.ambits) ? country.ambits : []) {
      for (const ch of Array.isArray(ambit && ambit.channels) ? ambit.channels : []) {
        const options = Array.isArray(ch && ch.options) ? ch.options : [];
        // Se prefiere el enlace .m3u8 (el que la tele sabe reproducir).
        const option =
          options.find((o) => o && /m3u8/i.test(String(o.format || "")) && safeHttpUrl(o.url)) ||
          options.find((o) => o && /\.m3u8(\?|$)/i.test(String(o.url || "")) && safeHttpUrl(o.url));
        if (!option) continue;
        items.push({
          name: String(ch.name || "").trim() || `Canal ${items.length + 1}`,
          category: String((ambit && ambit.name) || ""),
          logoUrl: String(ch.logo || ""),
          streamUrl: String(option.url).trim(),
        });
      }
    }
  }
  return items;
}

/* Free-TV: una sola lista M3U con todos los países; el país va en
   group-title. */
function freeTvToItems(text, code) {
  return parseChannelList(text).filter((it) => countryCodeFromName(it.category) === code);
}

const sourceCache = new Map();
async function cachedDownload(url) {
  if (!sourceCache.has(url)) {
    const p = downloadListText(url);
    sourceCache.set(url, p);
    p.catch(() => sourceCache.delete(url)); // si falla, se reintenta la próxima vez
  }
  return sourceCache.get(url);
}

/* Descarga el país de todas las fuentes a la vez. Si una falla, no
   pasa nada: se usan las otras y se dice cuál no se pudo leer. */
async function downloadCountryFromAllSources(country) {
  const sources = [
    { name: "iptv-org", get: async () => parseChannelList(await downloadListText(iptvOrgCountryList(country.code))) },
    { name: "TDTChannels", get: async () => tdtChannelsToItems(JSON.parse(await cachedDownload(TDTCHANNELS_JSON)), country.code) },
    { name: "Free-TV", get: async () => freeTvToItems(await cachedDownload(FREE_TV_M3U), country.code) },
  ];
  const results = await Promise.allSettled(sources.map((src) => src.get()));
  const items = [];
  const counts = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...r.value);
      if (r.value.length) counts.push(`${r.value.length} de ${sources[i].name}`);
    } else {
      failed.push(sources[i].name);
    }
  });
  return { items, summary: counts.join(", ") || "sin canales", failed };
}

function renderCountryGrid() {
  const needle = normalizeText(el("country-search").value);
  const haveByCountry = new Map();
  for (const ch of state.channels) {
    const key = normalizeText(ch.category);
    haveByCountry.set(key, (haveByCountry.get(key) || 0) + 1);
  }
  const list = (state.countries || []).filter(
    (c) =>
      !needle ||
      normalizeText(c.name).includes(needle) ||
      normalizeText(c.englishName).includes(needle) ||
      normalizeText(c.code) === needle
  );
  el("country-grid").innerHTML = list.length
    ? list
        .map((c) => {
          const have = haveByCountry.get(normalizeText(c.name)) || 0;
          return `<button type="button" class="country-btn" data-country="${escapeHtml(c.code)}">
            <span class="country-flag">${c.flag}</span>
            <span dir="auto">${escapeHtml(c.name)}</span>
            ${have ? `<span class="country-have">${have} ya</span>` : ""}
          </button>`;
        })
        .join("")
    : `<p class="muted">No hay ningún país con ese nombre.</p>`;
}

el("country-channels-btn").addEventListener("click", async () => {
  el("country-search").value = "";
  el("country-status").textContent = "Cargando países…";
  el("country-grid").innerHTML = "";
  el("country-modal").classList.remove("hidden");
  await loadCountryList();
  el("country-status").textContent = `${state.countries.length} países. Toca uno para ver todos sus canales.`;
  renderCountryGrid();
  el("country-search").focus();
});

el("country-search").addEventListener("input", debounce(renderCountryGrid, 150));

el("country-grid").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-country]");
  if (!btn) return;
  const country = (state.countries || []).find((c) => c.code === btn.dataset.country);
  if (!country) return;

  const buttons = el("country-grid").querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  el("country-status").textContent = `Descargando los canales de ${country.flag} ${country.name}…`;
  const { items, summary, failed } = await downloadCountryFromAllSources(country);
  buttons.forEach((b) => (b.disabled = false));
  if (!items.length) {
    el("country-status").textContent =
      `Ninguna fuente tiene canales de ${country.flag} ${country.name} ahora mismo.` +
      (failed.length ? ` (No se pudo leer: ${failed.join(", ")}.)` : "");
    return;
  }

  // Se abre la ventana de importar ya preparada con todo el catálogo.
  el("import-file-input").value = "";
  el("import-url-input").value = "";
  el("import-xtream-server").value = "";
  el("import-xtream-user").value = "";
  el("import-xtream-pass").value = "";
  el("import-category-override").value = country.name;
  el("import-error").classList.add("hidden");
  state.importItems = [];
  el("country-modal").classList.add("hidden");
  el("import-modal").classList.remove("hidden");
  showImportItems(items);
  if (state.importItems.length) {
    el("import-status").textContent =
      `${country.flag} ${country.name} (${summary}): ` +
      el("import-status").textContent +
      (failed.length ? ` No se pudo leer: ${failed.join(", ")}.` : "");
  }
});

function hideImportPreview() {
  el("import-preview-wrap").classList.add("hidden");
  el("import-confirm-btn").classList.add("hidden");
}

/* Muestra la vista previa a partir del texto de un M3U (archivo o enlace). */
function showImportPreview(text) {
  showImportItems(parseChannelList(text));
}

/* Clave para reconocer el mismo canal aunque venga escrito un poco
   distinto: sin tildes, sin mayúsculas, sin "(1080p)", "[Geo-blocked]"
   ni "HD" al final. Los nombres genéricos ("Canal 12") no cuentan. */
function channelNameKey(name, category) {
  const clean = normalizeText(name)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(uhd|fhd|hd|sd|4k|tv hd)\b\s*$/g, " ")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
  if (!clean || /^canal \d+$/.test(clean)) return null;
  const cat = normalizeText(category && String(category).trim() ? category : "Sin categoría");
  return `${cat}|${clean}`;
}

/* Muestra la vista previa a partir de canales ya leídos, vengan de un M3U
   o de un servidor Xtream: { name, category, logoUrl, streamUrl }. */
function showImportItems(parsedItems) {
  const parsed = parsedItems.filter((it) => it.streamUrl);
  // Se descartan los enlaces que no son http:// ni https:// (ver safeHttpUrl).
  const valid = parsed.filter((it) => safeHttpUrl(it.streamUrl));
  const skipped = parsed.length - valid.length;
  // Y los que ya están en el panel o se repiten dentro de la misma lista,
  // para no llenar la lista de canales duplicados.
  // Se compara por enlace y también por nombre dentro del mismo país:
  // el mismo canal suele venir en varias fuentes con enlaces distintos
  // ("La 1", "La 1 HD", "La 1 (1080p)").
  const override = el("import-category-override").value.trim();
  const seen = new Set(state.channels.map((c) => String(c.stream_url || "").trim()));
  const seenNames = new Set(
    state.channels.map((c) => channelNameKey(c.name, c.category)).filter(Boolean)
  );
  const items = valid.filter((it) => {
    const key = it.streamUrl.trim();
    const nameKey = channelNameKey(it.name, override || it.category);
    if (seen.has(key) || (nameKey && seenNames.has(nameKey))) return false;
    seen.add(key);
    if (nameKey) seenNames.add(nameKey);
    return true;
  });
  const duplicates = valid.length - items.length;

  if (!items.length) {
    el("import-status").textContent = duplicates
      ? `Todos los canales de esta lista (${duplicates}) ya están en el panel.`
      : "No se ha encontrado ningún canal en esta lista. Comprueba que sea un M3U válido.";
    hideImportPreview();
    return;
  }

  state.importItems = items.map((it, i) => ({ ...it, id: i, selected: true }));
  state.importRenderLimit = IMPORT_PAGE;
  el("import-status").textContent =
    `${items.length} canal(es) nuevos encontrados. Quita el visto de los que no quieras subir y toca "Importar".` +
    (skipped ? ` (Se han descartado ${skipped} con un enlace no válido.)` : "") +
    (duplicates ? ` (Se han quitado ${duplicates} que ya estaban o se repetían.)` : "");
  renderImportPreview();
  el("import-preview-wrap").classList.remove("hidden");
  el("import-select-all").checked = true;
  el("import-confirm-btn").classList.remove("hidden");
  updateImportConfirmLabel();
}

/* Igual que en la tabla de canales: con listas de miles de canales (las de
   Xtream suelen serlo) solo se pintan los primeros y un "Mostrar más".
   La casilla de "todos" sigue marcando o desmarcando la lista ENTERA. */
function renderImportPreview() {
  const override = el("import-category-override").value.trim();
  const visible = state.importItems.slice(0, state.importRenderLimit);
  const remaining = state.importItems.length - visible.length;
  el("import-preview-tbody").innerHTML =
    visible
      .map(
        (it) => `
        <tr>
          <td><input type="checkbox" class="import-row-check" data-id="${it.id}" ${it.selected ? "checked" : ""} /></td>
          <td dir="auto">${escapeHtml(it.name)}</td>
          <td dir="auto">${escapeHtml(override || it.category || "")}</td>
        </tr>`
      )
      .join("") +
    (remaining > 0
      ? `<tr class="load-more-row"><td colspan="3"><button class="btn" type="button" data-show-more>Mostrar más (quedan ${remaining})</button></td></tr>`
      : "");
}

// Un solo escuchador para toda la vista previa (ver la tabla de canales).
el("import-preview-tbody").addEventListener("change", (e) => {
  const cb = e.target.closest(".import-row-check");
  if (!cb) return;
  const item = state.importItems[Number(cb.dataset.id)];
  if (item) item.selected = cb.checked;
  updateImportConfirmLabel();
});

el("import-preview-tbody").addEventListener("click", (e) => {
  if (!e.target.closest("[data-show-more]")) return;
  state.importRenderLimit += IMPORT_PAGE;
  renderImportPreview();
});

function updateImportConfirmLabel() {
  const n = state.importItems.filter((it) => it.selected).length;
  el("import-confirm-btn").textContent = `Importar ${n} canal${n === 1 ? "" : "es"}`;
}

el("import-select-all").addEventListener("change", (e) => {
  state.importItems.forEach((it) => (it.selected = e.target.checked));
  renderImportPreview();
  updateImportConfirmLabel();
});

el("import-category-override").addEventListener("input", () => {
  if (state.importItems.length) renderImportPreview();
});

/* ---- Comprobar la señal antes de subir ----
   Dentro de la app del panel lo hace Android (window.BoughaziNative),
   que puede abrir cualquier enlace. En un navegador normal se intenta
   con fetch, pero muchas webs no lo permiten (CORS): esos canales
   quedan "sin comprobar" y se suben igualmente, porque no se sabe si
   funcionan o no. */
let nativeStreamSeq = 0;
const nativeStreamChecks = new Map();
window.onNativeStreamCheck = (id, ok, reason) => {
  const done = nativeStreamChecks.get(id);
  if (!done) return;
  nativeStreamChecks.delete(id);
  done({ status: ok ? "ok" : "dead", reason });
};

async function checkStreamSignal(url) {
  if (window.BoughaziNative && window.BoughaziNative.checkStream) {
    const id = ++nativeStreamSeq;
    return new Promise((resolve) => {
      nativeStreamChecks.set(id, resolve);
      // Por si Android no contestara nunca.
      setTimeout(() => {
        if (nativeStreamChecks.delete(id)) resolve({ status: "unknown", reason: "sin respuesta" });
      }, 30000);
      window.BoughaziNative.checkStream(id, url);
    });
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", signal: controller.signal });
    return res.ok ? { status: "ok" } : { status: "dead", reason: `error ${res.status}` };
  } catch (_err) {
    return { status: "unknown", reason: "el navegador no deja comprobarlo" };
  } finally {
    clearTimeout(timeoutId);
    controller.abort(); // un directo no termina nunca: se corta aquí
  }
}

async function checkSignals(items, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await checkStreamSignal(items[i].streamUrl);
      done += 1;
      onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(12, items.length) }, worker));
  return results;
}

el("import-confirm-btn").addEventListener("click", async () => {
  let chosen = state.importItems.filter((it) => it.selected);
  if (!chosen.length) return;

  let signalNote = "";
  if (el("import-check-signal").checked) {
    el("import-confirm-btn").disabled = true;
    el("import-error").classList.add("hidden");
    const results = await checkSignals(chosen, (done, total) => {
      el("import-confirm-btn").textContent = `Comprobando señal… ${done}/${total}`;
    });
    const dead = chosen.filter((_it, i) => results[i].status === "dead").length;
    const unknown = chosen.filter((_it, i) => results[i].status === "unknown").length;
    chosen = chosen.filter((_it, i) => results[i].status !== "dead");
    signalNote =
      `${dead} sin señal no se han subido.` +
      (unknown ? ` ${unknown} no se pudieron comprobar y se han subido igualmente.` : "");
    el("import-confirm-btn").disabled = false;
    if (!chosen.length) {
      el("import-status").textContent = `Ninguno de los canales elegidos tiene señal ahora mismo. ${signalNote}`;
      updateImportConfirmLabel();
      return;
    }
  }

  const override = el("import-category-override").value.trim();

  // Cada país lleva su propia cuenta de números, empezando justo
  // donde se quedó ese país (no desde el máximo de TODOS los
  // canales, que es lo que mezclaba la numeración entre países).
  const contadores = new Map();
  const numeroSiguiente = (categoria) => {
    const key = categoria && categoria.trim() ? categoria.trim() : "Sin categoría";
    if (!contadores.has(key)) contadores.set(key, nextNumberForCategory(key, null));
    const n = contadores.get(key);
    contadores.set(key, n + 1);
    return n;
  };

  const rows = chosen.map((it) => {
    const categoriaFinal = override || it.category || null;
    return {
      channel_number: numeroSiguiente(categoriaFinal),
      name: it.name,
      category: categoriaFinal,
      logo_url: safeHttpUrl(it.logoUrl) ? it.logoUrl : null,
      stream_url: it.streamUrl,
      // Se marca "funciona" desde el principio: la app de la tele solo
      // enseña los canales que no están marcados como caídos.
      is_broken: false,
    };
  });

  el("import-confirm-btn").disabled = true;
  el("import-error").classList.add("hidden");

  // Se suben en tandas de 500: con listas de miles de canales, una sola
  // petición enorme podía fallar y no se subía ninguno.
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    el("import-confirm-btn").textContent = `Importando… ${Math.min(i + chunkSize, rows.length)}/${rows.length}`;
    const { error } = await supabaseClient.from("bt_channels").insert(rows.slice(i, i + chunkSize));
    if (error) {
      el("import-confirm-btn").disabled = false;
      el("import-error").textContent =
        `No se pudo importar a partir del canal ${i + 1}: ${error.message}` +
        (i ? ` (los ${i} primeros sí se han subido)` : "");
      el("import-error").classList.remove("hidden");
      updateImportConfirmLabel();
      await loadChannels();
      return;
    }
  }

  el("import-confirm-btn").disabled = false;

  el("import-modal").classList.add("hidden");
  await loadChannels();
  await refreshStats();
  el("channels-status").textContent =
    `Subidos ${rows.length} canal${rows.length === 1 ? "" : "es"}.` + (signalNote ? ` ${signalNote}` : "");
});

/* ------------------------------------------------------------ */
/* Códigos de acceso                                               */
/* ------------------------------------------------------------ */

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres confusos
  let out = "";
  // crypto.getRandomValues: aleatorio de verdad, no se puede adivinar.
  // 256 es múltiplo de 32 (las letras posibles), así que no hay sesgo.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function loadCodes() {
  // Por partes de 1000 en 1000, como los canales (ver fetchAllPages).
  const { data, error } = await fetchAllPages((from, to) =>
    supabaseClient
      .from("bt_access_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (error) {
    el("codes-tbody").innerHTML = `<tr><td colspan="5" class="error-text">Error al cargar: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  el("codes-tbody").innerHTML = data
    .map((code) => {
      const statusHtml = code.used_by_email
        ? '<span class="status-broken">Usado</span>'
        : '<span class="status-ok">Libre</span>';
      return `
        <tr>
          <td>${escapeHtml(code.code)}</td>
          <td>${escapeHtml(code.label || "")}</td>
          <td>${statusHtml}</td>
          <td>${escapeHtml(code.used_by_email || "—")}</td>
          <td><button class="btn danger" data-del-code="${escapeHtml(code.id)}">Borrar</button></td>
        </tr>`;
    })
    .join("");
}

el("codes-tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del-code]");
  if (!btn) return;
  if (!confirm("¿Borrar este código?")) return;
  const { error } = await supabaseClient.from("bt_access_codes").delete().eq("id", btn.dataset.delCode);
  if (error) alert("No se pudo borrar el código: " + error.message);
  loadCodes();
});

let pendingCodeId = null;

el("new-code-btn").addEventListener("click", async () => {
  const code = generateCode();
  const { data, error } = await supabaseClient
    .from("bt_access_codes")
    .insert({ code })
    .select()
    .single();
  if (error) {
    alert("No se pudo generar el código: " + error.message);
    return;
  }
  pendingCodeId = data.id;
  el("new-code-value").textContent = data.code;
  el("code-label-input").value = "";
  el("code-modal").classList.remove("hidden");
});

el("code-label-save").addEventListener("click", async () => {
  const label = el("code-label-input").value.trim();
  if (label && pendingCodeId) {
    await supabaseClient.from("bt_access_codes").update({ label }).eq("id", pendingCodeId);
  }
  el("code-modal").classList.add("hidden");
  loadCodes();
});

/* ------------------------------------------------------------ */
/* Usuarios registrados y caducidad de su acceso                  */
/* ------------------------------------------------------------ */

let allUsers = [];

async function loadUsers() {
  el("users-tbody").innerHTML = `<tr><td colspan="5" class="muted">Cargando usuarios…</td></tr>`;
  // Por partes de 1000 en 1000: con más de 1000 usuarios, antes solo se
  // veían los 1000 más recientes.
  const { data, error } = await fetchAllPages((from, to) =>
    supabaseClient
      .from("bt_viewers")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (error) {
    el("users-tbody").innerHTML = `<tr><td colspan="5" class="error-text">Error al cargar: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  allUsers = data || [];
  renderUsers();
}

function formatDateOnly(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function accessStatusHtml(expiresAt) {
  if (!expiresAt) return '<span class="access-unlimited">Sin caducidad</span>';
  const date = new Date(expiresAt);
  const diffDays = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (diffDays < 0) {
    return `<span class="access-expired">Caducado (${formatDateOnly(expiresAt)})</span>`;
  }
  return `<span class="access-active">Activo · caduca en ${diffDays} día${diffDays === 1 ? "" : "s"} (${formatDateOnly(expiresAt)})</span>`;
}

function renderUsers() {
  const needle = normalizeText(state.userSearch);
  const filtered = allUsers.filter((u) => !needle || normalizeText(u.email).includes(needle));

  if (!filtered.length) {
    el("users-tbody").innerHTML = `<tr><td colspan="5" class="muted">No hay usuarios que coincidan.</td></tr>`;
    return;
  }

  el("users-tbody").innerHTML = filtered
    .map(
      (u) => `
        <tr>
          <td dir="auto">${escapeHtml(u.email || "—")}</td>
          <td>${escapeHtml(formatDateOnly(u.created_at))}</td>
          <td>${escapeHtml(u.linked_code || "—")}</td>
          <td>${accessStatusHtml(u.access_expires_at)}</td>
          <td>
            <div class="user-time-actions">
              <button class="btn" data-add-month="${escapeHtml(u.id)}">+1 mes</button>
              <button class="btn" data-add-year="${escapeHtml(u.id)}">+1 año</button>
              <input type="date" data-date-input="${escapeHtml(u.id)}" />
              <button class="btn" data-set-date="${escapeHtml(u.id)}">Fijar fecha</button>
              <button class="btn" data-clear-expiry="${escapeHtml(u.id)}">Quitar caducidad</button>
            </div>
          </td>
        </tr>`
    )
    .join("");
}

// Un solo escuchador para toda la tabla de usuarios.
el("users-tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if ("addMonth" in btn.dataset) {
    addTimeToUser(btn.dataset.addMonth, 30);
  } else if ("addYear" in btn.dataset) {
    addTimeToUser(btn.dataset.addYear, 365);
  } else if ("setDate" in btn.dataset) {
    const input = btn.closest("tr").querySelector("[data-date-input]");
    if (!input || !input.value) {
      alert("Elige primero una fecha en la casilla de al lado.");
      return;
    }
    setUserExpiry(btn.dataset.setDate, new Date(input.value + "T23:59:59").toISOString());
  } else if ("clearExpiry" in btn.dataset) {
    if (!confirm("¿Quitar la caducidad? Esta persona tendrá acceso sin límite de tiempo.")) return;
    setUserExpiry(btn.dataset.clearExpiry, null);
  }
});

// Igual que en canales: se espera a que se deje de escribir (200 ms).
const searchUsersSoon = debounce(() => {
  state.userSearch = el("user-search").value;
  renderUsers();
}, 200);
el("user-search").addEventListener("input", searchUsersSoon);

/* Añade N días a partir de HOY (no a partir de la fecha que ya
   tuviera antes), para que "+1 mes" siempre signifique "un mes
   más desde ahora mismo" y sea fácil de entender. */
async function addTimeToUser(viewerId, days) {
  const nueva = new Date(Date.now() + days * 86400000).toISOString();
  await setUserExpiry(viewerId, nueva);
}

async function setUserExpiry(viewerId, isoOrNull) {
  const { error } = await supabaseClient
    .from("bt_viewers")
    .update({ access_expires_at: isoOrNull })
    .eq("id", viewerId);
  if (error) {
    alert("No se pudo guardar: " + error.message);
    return;
  }
  await loadUsers();
}

/* ------------------------------------------------------------ */
/* Listas: campos comunes (enlace M3U o Xtream Codes)             */
/* ------------------------------------------------------------ */
/* "Vincular por código" y "Listas automáticas" piden lo mismo: o un
   enlace M3U, o los tres datos de Xtream. Los campos de cada formulario
   se llaman igual cambiando solo el principio ("pair-…" o "auto-…"), así
   que estas funciones sirven para los dos. */

function updatePlaylistFields(prefix) {
  const isXtream = el(`${prefix}-type`).value === "xtream";
  el(`${prefix}-m3u-fields`).classList.toggle("hidden", isXtream);
  el(`${prefix}-xtream-fields`).classList.toggle("hidden", !isXtream);
}

["pair", "auto"].forEach((prefix) => {
  el(`${prefix}-type`).addEventListener("change", () => updatePlaylistFields(prefix));
});

/* Lee y comprueba los campos. Devuelve { error } si falta algo, o
   { type, url, server, username, password } con lo que no toca a null. */
function readPlaylistFields(prefix) {
  const type = el(`${prefix}-type`).value;
  if (type === "xtream") {
    const server = normalizeXtreamServer(el(`${prefix}-xtream-server`).value);
    const username = el(`${prefix}-xtream-user`).value.trim();
    const password = el(`${prefix}-xtream-pass`).value.trim();
    if (!server) {
      return { error: "La dirección del servidor tiene que empezar por http:// o https:// (por ejemplo: http://servidor.com:8080)" };
    }
    if (!username || !password) return { error: "Escribe el usuario y la contraseña de Xtream." };
    return { type, url: null, server, username, password };
  }
  const url = el(`${prefix}-url`).value.trim();
  if (!safeHttpUrl(url)) return { error: "El enlace de la lista tiene que empezar por http:// o https://" };
  return { type: "m3u", url, server: null, username: null, password: null };
}

function fillPlaylistFields(prefix, list) {
  el(`${prefix}-type`).value = list.type === "xtream" ? "xtream" : "m3u";
  el(`${prefix}-url`).value = list.url || "";
  el(`${prefix}-xtream-server`).value = list.server || "";
  el(`${prefix}-xtream-user`).value = list.username || "";
  el(`${prefix}-xtream-pass`).value = list.password || "";
  updatePlaylistFields(prefix);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_err) {
    return "—";
  }
}

/* Texto corto para las tablas. Nunca lleva la contraseña de Xtream, y del
   enlace M3U solo se enseña la web (muchos llevan el usuario y la
   contraseña metidos dentro del propio enlace). */
function describePlaylist(type, url, server, username) {
  if (type === "xtream") return `Xtream · ${username || "—"} @ ${hostOf(server)}`;
  if (type === "m3u") return `Enlace M3U · ${hostOf(url)}`;
  return "—";
}

/* ------------------------------------------------------------ */
/* Vincular por código                                            */
/* ------------------------------------------------------------ */
/* La tele enseña un código; aquí se escribe ese código junto con la lista
   que tiene que ver, y la tele la recibe sola en unos segundos. */

function setPairStatus(text, kind) {
  const p = el("pair-status");
  p.textContent = text;
  p.classList.toggle("error-text", kind === "error");
  p.classList.toggle("success-text", kind === "ok");
}

/* Los códigos van en mayúsculas y sin espacios ni guiones, aunque se
   escriban como "abcd-2345" o "ABCD 2345". */
function normalizePairCode(str) {
  return String(str || "").toUpperCase().replace(/[\s-]+/g, "").trim();
}

el("pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = normalizePairCode(el("pair-code").value);
  if (!code) {
    setPairStatus("Escribe el código que sale en la pantalla de la tele.", "error");
    return;
  }
  const list = readPlaylistFields("pair");
  if (list.error) {
    setPairStatus(list.error, "error");
    return;
  }
  const label = el("pair-label").value.trim() || null;

  const btn = el("pair-submit");
  btn.disabled = true;
  setPairStatus("Enviando la lista a la tele…");
  const { data: found, error } = await supabaseClient.rpc("bt_pairing_send", {
    p_code: code,
    p_playlist_type: list.type,
    p_playlist_url: list.url,
    p_xtream_server: list.server,
    p_xtream_username: list.username,
    p_xtream_password: list.password,
    p_label: label,
  });
  btn.disabled = false;

  if (error) {
    setPairStatus("No se pudo enviar: " + friendlyDbError(error), "error");
    return;
  }
  if (!found) {
    setPairStatus(
      `Código no encontrado o caducado (${code}). Comprueba que esté bien escrito; si la tele lleva más de 30 minutos con el mismo código, pide uno nuevo en la tele.`,
      "error"
    );
    return;
  }
  setPairStatus(`¡Hecho! La tele con el código ${code} recibirá la lista en unos segundos.`, "ok");
  el("pair-form").reset();
  updatePlaylistFields("pair");
  loadPairings();
});

async function loadPairings() {
  const tbody = el("pairings-tbody");
  tbody.innerHTML = `<tr><td colspan="5" class="muted">Cargando teles vinculadas…</td></tr>`;
  const { data, error } = await fetchAllPages((from, to) =>
    supabaseClient
      .from("bt_pairings")
      .select("*")
      .not("playlist_type", "is", null)
      .order("updated_at", { ascending: false })
      .order("code", { ascending: true })
      .range(from, to)
  );
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="error-text">${escapeHtml(friendlyDbError(error))}</td></tr>`;
    return;
  }
  state.pairings = data;
  renderPairings();
}

function renderPairings() {
  const tbody = el("pairings-tbody");
  if (!state.pairings.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Todavía no hay ninguna tele vinculada por código.</td></tr>`;
    return;
  }
  // Ojo: aquí no se pinta NUNCA la contraseña de Xtream.
  tbody.innerHTML = state.pairings
    .map(
      (p) => `
        <tr>
          <td class="code-cell">${escapeHtml(p.code)}</td>
          <td dir="auto">${escapeHtml(p.label || "—")}</td>
          <td>${escapeHtml(describePlaylist(p.playlist_type, p.playlist_url, p.xtream_server, p.xtream_username))}</td>
          <td>${escapeHtml(formatDateTime(p.updated_at))}</td>
          <td>
            <button class="btn" data-pair-edit="${escapeHtml(p.code)}">Cambiar lista</button>
            <button class="btn danger" data-pair-unlink="${escapeHtml(p.code)}">Desvincular</button>
          </td>
        </tr>`
    )
    .join("");
}

el("pairings-tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if ("pairEdit" in btn.dataset) {
    // Rellena el formulario de arriba con lo que tiene ahora esa tele, para
    // cambiar solo lo necesario y volver a enviarlo con el mismo código.
    const p = state.pairings.find((row) => row.code === btn.dataset.pairEdit);
    if (!p) return;
    el("pair-code").value = p.code;
    el("pair-label").value = p.label || "";
    fillPlaylistFields("pair", {
      type: p.playlist_type,
      url: p.playlist_url,
      server: p.xtream_server,
      username: p.xtream_username,
      password: p.xtream_password,
    });
    setPairStatus(`Cambia lo que necesites y pulsa "Enviar lista a la tele" para actualizar la tele ${p.code}.`);
    el("pair-form").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if ("pairUnlink" in btn.dataset) {
    const code = btn.dataset.pairUnlink;
    if (!confirm(`¿Desvincular la tele con el código ${code}? Dejará de recibir esta lista.`)) return;
    const { error } = await supabaseClient.from("bt_pairings").delete().eq("code", code);
    if (error) alert("No se pudo desvincular: " + friendlyDbError(error));
    loadPairings();
  }
});

/* ------------------------------------------------------------ */
/* Listas automáticas                                             */
/* ------------------------------------------------------------ */
/* Enlaces (M3U o Xtream) que el proceso de cada noche vuelve a importar
   solo, añadiendo únicamente los canales nuevos. */

async function loadAutoSources() {
  const tbody = el("auto-tbody");
  tbody.innerHTML = `<tr><td colspan="7" class="muted">Cargando listas automáticas…</td></tr>`;
  const { data, error } = await supabaseClient
    .from("bt_auto_sources")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="error-text">${escapeHtml(friendlyDbError(error))}</td></tr>`;
    return;
  }
  state.autoSources = data || [];
  renderAutoSources();
}

function renderAutoSources() {
  const tbody = el("auto-tbody");
  if (!state.autoSources.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Todavía no hay ninguna lista automática. Pulsa "+ Añadir lista".</td></tr>`;
    return;
  }
  // Tampoco aquí se pinta la contraseña de Xtream.
  tbody.innerHTML = state.autoSources
    .map((src) => {
      const statusHtml = src.enabled
        ? '<span class="status-ok">● Activa</span>'
        : '<span class="muted">Desactivada</span>';
      return `
        <tr>
          <td class="name-cell" dir="auto">${escapeHtml(src.name || "—")}</td>
          <td>${escapeHtml(describePlaylist(src.kind, src.url, src.xtream_server, src.xtream_username))}</td>
          <td class="cat-cell" dir="auto">${escapeHtml(src.category_override || "La de la lista")}</td>
          <td>${statusHtml}</td>
          <td title="${escapeHtml(formatDateTime(src.last_run_at))}">${src.last_run_at ? escapeHtml(formatLastCheck(src.last_run_at)) : "Nunca"}</td>
          <td title="${escapeHtml(src.last_result || "")}">${escapeHtml(src.last_result || "—")}</td>
          <td>
            <button class="btn" data-auto-edit="${escapeHtml(src.id)}">✏️ Editar</button>
            <button class="btn" data-auto-toggle="${escapeHtml(src.id)}">${src.enabled ? "Desactivar" : "Activar"}</button>
            <button class="btn danger" data-auto-delete="${escapeHtml(src.id)}">Borrar</button>
          </td>
        </tr>`;
    })
    .join("");
}

function openAutoModal(src) {
  state.editingAutoId = src ? src.id : null;
  el("auto-modal-title").textContent = src ? "Editar lista automática" : "Añadir lista automática";
  el("auto-form").reset();
  el("auto-name").value = src ? src.name || "" : "";
  el("auto-category").value = src ? src.category_override || "" : "";
  el("auto-enabled").checked = src ? !!src.enabled : true;
  fillPlaylistFields("auto", {
    type: src ? src.kind : "m3u",
    url: src && src.url,
    server: src && src.xtream_server,
    username: src && src.xtream_username,
    password: src && src.xtream_password,
  });
  el("auto-form-error").classList.add("hidden");
  el("auto-modal").classList.remove("hidden");
}

el("new-auto-btn").addEventListener("click", () => openAutoModal(null));

el("auto-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const showError = (msg) => {
    el("auto-form-error").textContent = msg;
    el("auto-form-error").classList.remove("hidden");
  };
  const list = readPlaylistFields("auto");
  if (list.error) {
    showError(list.error);
    return;
  }
  const payload = {
    name: el("auto-name").value.trim() || null,
    kind: list.type,
    url: list.url,
    xtream_server: list.server,
    xtream_username: list.username,
    xtream_password: list.password,
    category_override: el("auto-category").value.trim() || null,
    enabled: el("auto-enabled").checked,
  };

  let error;
  if (state.editingAutoId != null) {
    ({ error } = await supabaseClient.from("bt_auto_sources").update(payload).eq("id", state.editingAutoId));
  } else {
    ({ error } = await supabaseClient.from("bt_auto_sources").insert(payload));
  }
  if (error) {
    showError("No se pudo guardar: " + friendlyDbError(error));
    return;
  }
  state.editingAutoId = null;
  el("auto-modal").classList.add("hidden");
  loadAutoSources();
});

el("auto-tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const findSource = (id) => state.autoSources.find((src) => String(src.id) === String(id));

  if ("autoEdit" in btn.dataset) {
    const src = findSource(btn.dataset.autoEdit);
    if (src) openAutoModal(src);
    return;
  }

  if ("autoToggle" in btn.dataset) {
    const src = findSource(btn.dataset.autoToggle);
    if (!src) return;
    btn.disabled = true;
    const { error } = await supabaseClient
      .from("bt_auto_sources")
      .update({ enabled: !src.enabled })
      .eq("id", src.id);
    if (error) alert("No se pudo cambiar: " + friendlyDbError(error));
    loadAutoSources();
    return;
  }

  if ("autoDelete" in btn.dataset) {
    const src = findSource(btn.dataset.autoDelete);
    if (!src) return;
    if (!confirm(`¿Borrar la lista automática "${src.name || "sin nombre"}"? Los canales que ya importó NO se borran.`)) return;
    const { error } = await supabaseClient.from("bt_auto_sources").delete().eq("id", src.id);
    if (error) alert("No se pudo borrar: " + friendlyDbError(error));
    loadAutoSources();
  }
});

/* ------------------------------------------------------------ */
/* Centro de control (vigilancia automática)                      */
/* ------------------------------------------------------------ */
/* Un proceso revisa todos los canales cada hora. Cada pasada deja un
   resumen en "bt_health_runs" y, en "bt_health_events", lo que ha hecho
   con cada canal que ha cambiado. Aquí solo se leen esas dos tablas. */

// Qué significa cada tipo de aviso, en palabras normales. Los de tipo
// "hidden-reason" son los motivos por los que un canal se ha ocultado en la app.
const HEALTH_EVENTS = {
  error_http: { label: "Error del servidor (404/500)", kind: "hidden-reason" },
  sin_respuesta: { label: "No contesta", kind: "hidden-reason" },
  bucle: { label: "Redirección en bucle", kind: "hidden-reason" },
  vacio: { label: "Sin vídeo", kind: "hidden-reason" },
  congelado: { label: "Emisión congelada", kind: "hidden-reason" },
  borrado: { label: "Borrado", kind: "deleted" },
  recuperado: { label: "Recuperado", kind: "restored" },
  duplicado: { label: "Duplicado borrado", kind: "deleted" },
};

const HIDDEN_EVENT_TYPES = Object.keys(HEALTH_EVENTS).filter((k) => HEALTH_EVENTS[k].kind === "hidden-reason");

function setControlStatus(text, isError) {
  el("control-status").textContent = text || "";
  el("control-status").classList.toggle("error-text", !!isError);
}

async function loadControl() {
  setControlStatus("Cargando…");
  const ok = await loadHealthRuns();
  if (ok) {
    setControlStatus("");
    await loadHealthEvents();
  }
}

/* Resumen de la última pasada y gráfica de las 24 últimas. Devuelve false
   si no se ha podido leer (por ejemplo, porque falta el archivo SQL). */
async function loadHealthRuns() {
  const { data, error } = await supabaseClient
    .from("bt_health_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(24);
  if (error) {
    setControlStatus(friendlyDbError(error), true);
    renderHealthSummary(null);
    el("health-chart").innerHTML = "";
    el("health-events-tbody").innerHTML = "";
    return false;
  }
  const runs = data || [];
  renderHealthSummary(runs[0] || null);
  renderHealthChart(runs.slice().reverse()); // de la más antigua a la más reciente
  return true;
}

function renderHealthSummary(run) {
  const show = (id, value) => {
    el(id).textContent = value ?? "—";
  };
  const warning = el("health-warning");
  warning.classList.add("hidden");

  if (!run) {
    show("health-when", "Todavía no ha habido ninguna");
    el("health-when").title = "";
    el("health-when-label").textContent = "Última vigilancia";
    ["health-total", "health-ok", "health-hidden", "health-deleted", "health-restored"].forEach((id) => show(id, null));
    return;
  }

  show("health-when", formatLastCheck(run.started_at));
  el("health-when").title = formatDateTime(run.started_at);
  el("health-when-label").textContent = run.finished_at
    ? `Última vigilancia (tardó ${formatDuration(new Date(run.finished_at) - new Date(run.started_at))})`
    : run.aborted
      ? "Última vigilancia (no terminó)"
      : "Última vigilancia (todavía en marcha)";
  show("health-total", run.total);
  show("health-ok", run.ok);
  show("health-hidden", run.hidden);
  show("health-deleted", run.deleted);
  show("health-restored", run.restored);

  // Si la pasada se paró a medias (por ejemplo, porque fallaban casi todos
  // los canales a la vez y parecía un problema de internet del servidor, no
  // de los canales), se avisa con la explicación que dejó el proceso.
  if (run.aborted) {
    warning.textContent =
      "⚠ La última vigilancia se paró antes de terminar" + (run.note ? `: ${run.note}` : ".");
    warning.classList.remove("hidden");
  }
}

/* Gráfica sencilla hecha solo con CSS: una columna por pasada, con la parte
   verde (funcionan) abajo y la roja (caídos) encima. Todas las columnas
   usan la misma escala, la de la pasada con más canales. */
function renderHealthChart(runs) {
  const chart = el("health-chart");
  if (!runs.length) {
    chart.innerHTML = `<p class="fine-print">Todavía no hay pasadas que enseñar.</p>`;
    return;
  }
  const max = Math.max(1, ...runs.map((r) => (Number(r.ok) || 0) + (Number(r.broken) || 0)));
  chart.innerHTML = runs
    .map((r) => {
      const ok = Number(r.ok) || 0;
      const broken = Number(r.broken) || 0;
      const tip = `${formatDateTime(r.started_at)} · ${ok} funcionan · ${broken} caídos${r.aborted ? " · no terminó" : ""}`;
      return `
        <div class="health-bar${r.aborted ? " aborted" : ""}" title="${escapeHtml(tip)}">
          <span class="bar-broken" style="height:${((broken / max) * 100).toFixed(1)}%"></span>
          <span class="bar-ok" style="height:${((ok / max) * 100).toFixed(1)}%"></span>
        </div>`;
    })
    .join("");
}

/* Los 200 avisos más recientes, del tipo elegido en el filtro. El filtro
   se aplica en Supabase, así que "200" son los 200 últimos de ESE tipo. */
async function loadHealthEvents() {
  const tbody = el("health-events-tbody");
  tbody.innerHTML = `<tr><td colspan="5" class="muted">Cargando avisos…</td></tr>`;
  const filter = el("health-filter").value;
  let query = supabaseClient
    .from("bt_health_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter === "__hidden") query = query.in("event", HIDDEN_EVENT_TYPES);
  else if (filter) query = query.eq("event", filter);

  const { data, error } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="error-text">${escapeHtml(friendlyDbError(error))}</td></tr>`;
    return;
  }
  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No hay avisos${filter ? " de este tipo" : ""}.</td></tr>`;
    return;
  }
  tbody.innerHTML = data
    .map((ev) => {
      const info = HEALTH_EVENTS[ev.event] || { label: ev.event || "—", kind: "other" };
      const hint = info.kind === "hidden-reason" ? "Ocultado en la app por este motivo" : "";
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(ev.created_at))}</td>
          <td class="name-cell" dir="auto">${escapeHtml(ev.channel_name || "—")}</td>
          <td class="cat-cell" dir="auto">${escapeHtml(ev.category || "—")}</td>
          <td><span class="event-tag ${escapeHtml(info.kind)}" title="${escapeHtml(hint)}">${escapeHtml(info.label)}</span></td>
          <td title="${escapeHtml(ev.detail || "")}">${escapeHtml(ev.detail || "—")}</td>
        </tr>`;
    })
    .join("");
}

el("health-filter").addEventListener("change", loadHealthEvents);
el("control-refresh-btn").addEventListener("click", loadControl);

init();
