/* Boughazi-TV — Panel de administración
   Todo el código de esta página en un único archivo, comentado en
   español para que sea fácil de seguir. */

const el = (id) => document.getElementById(id);

const state = {
  channels: [],
  selectedIds: new Set(),
  statsTimer: null,
  importItems: [],
  channelSearch: "",
  editingChannelId: null,
  userSearch: "",
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

function flagFor(category) {
  const key = normalizeText(category);
  return FLAGS[key] || "📺";
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
  await loadChannels();
  await refreshStats();
  state.statsTimer = setInterval(refreshStats, 15000);
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  el("login-error").classList.add("hidden");
  const email = el("login-email").value.trim();
  const password = el("login-password").value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    el("login-error").textContent = "Correo o contraseña incorrectos.";
    el("login-error").classList.remove("hidden");
    return;
  }
  await tryEnterDashboard();
});

el("logout-btn").addEventListener("click", async () => {
  clearInterval(state.statsTimer);
  await supabaseClient.auth.signOut();
  showLogin();
});

/* ------------------------------------------------------------ */
/* Pestañas                                                       */
/* ------------------------------------------------------------ */

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    el("tab-" + btn.dataset.tab).classList.remove("hidden");
    if (btn.dataset.tab === "codes") loadCodes();
    if (btn.dataset.tab === "users") loadUsers();
  });
});

/* ------------------------------------------------------------ */
/* Estadísticas                                                   */
/* ------------------------------------------------------------ */

async function refreshStats() {
  const { count: registered } = await supabaseClient
    .from("bt_viewers")
    .select("id", { count: "exact", head: true });

  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const { count: online } = await supabaseClient
    .from("bt_presence")
    .select("viewer_id", { count: "exact", head: true })
    .gte("last_ping", cutoff);

  const { count: activeChannels } = await supabaseClient
    .from("bt_channels")
    .select("id", { count: "exact", head: true })
    .eq("is_broken", false);

  el("stat-registered").textContent = registered ?? "—";
  el("stat-online").textContent = online ?? "—";
  el("stat-channels").textContent = activeChannels ?? "—";

  // Prueba real de que la comprobación automática de canales se ha
  // ejecutado de verdad: se busca la fecha más reciente guardada en
  // "last_checked_at" (el sistema automático la pone en TODOS los
  // canales cada vez que se ejecuta, hayan cambiado de estado o no).
  // Así no hay que fiarse solo de que todo salga en verde.
  const { data: lastCheckRows } = await supabaseClient
    .from("bt_channels")
    .select("last_checked_at")
    .not("last_checked_at", "is", null)
    .order("last_checked_at", { ascending: false })
    .limit(1);

  el("stat-last-check").textContent = formatLastCheck(
    lastCheckRows && lastCheckRows[0] ? lastCheckRows[0].last_checked_at : null
  );
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
  const pageSize = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseClient
      .from("bt_channels")
      .select("*")
      .order("channel_number", { ascending: true, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error) {
      el("channels-status").textContent = "Error al cargar: " + error.message;
      return;
    }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  state.channels = all;
  state.selectedIds.clear();
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

  let html = "";
  for (const group of groups) {
    html += `
      <tr class="group-header">
        <td colspan="7">
          <div class="group-header-inner">
            <span class="group-flag">${flagFor(group.category)}</span>
            <span class="group-name" dir="auto">${escapeHtml(group.category)}</span>
            <span class="group-count">(${group.items.length} canal${group.items.length === 1 ? "" : "es"})</span>
            <button class="btn danger" data-delete-country="${escapeHtml(group.category)}">🗑 Borrar país entero</button>
          </div>
        </td>
      </tr>`;

    group.items.forEach((c, idx) => {
      const statusHtml = c.is_broken
        ? '<span class="status-broken">⚠ Caído</span>'
        : '<span class="status-ok">● OK</span>';
      // loading="lazy": con muchos canales, el navegador solo descarga
      // el logo cuando esa fila está a punto de verse en pantalla, en
      // vez de intentar cargar miles de imágenes todas a la vez (que
      // es lo que estaba poniendo lento/congelado el panel).
      const logoHtml = c.logo_url
        ? `<img class="channel-logo" loading="lazy" src="${escapeHtml(c.logo_url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'channel-logo empty',textContent:'—'}))" />`
        : `<span class="channel-logo empty">—</span>`;

      html += `
        <tr>
          <td><input type="checkbox" class="row-check" data-id="${c.id}" ${
        state.selectedIds.has(c.id) ? "checked" : ""
      } /></td>
          <td>${idx + 1}</td>
          <td>${logoHtml}</td>
          <td class="name-cell" dir="auto">${escapeHtml(c.name)}</td>
          <td>${statusHtml}</td>
          <td><a class="link-icon" href="${c.stream_url}" target="_blank" rel="noopener">ver enlace</a></td>
          <td>
            <button class="btn" data-edit="${c.id}">✏️ Editar</button>
            <button class="btn danger" data-delete="${c.id}">Borrar</button>
          </td>
        </tr>`;
    });
  }

  el("channels-tbody").innerHTML = html;

  document.querySelectorAll(".row-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedIds.add(cb.dataset.id);
      else state.selectedIds.delete(cb.dataset.id);
      updateBulkBar();
    });
  });
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("¿Borrar este canal? No se puede deshacer.")) return;
      deleteChannels([btn.dataset.delete]);
    });
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditChannel(btn.dataset.edit));
  });
  document.querySelectorAll("[data-delete-country]").forEach((btn) => {
    btn.addEventListener("click", () => deleteWholeCountry(btn.dataset.deleteCountry));
  });
}

el("channel-search").addEventListener("input", (e) => {
  state.channelSearch = e.target.value;
  renderChannels();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

el("select-all").addEventListener("change", (e) => {
  if (e.target.checked) state.channels.forEach((c) => state.selectedIds.add(c.id));
  else state.selectedIds.clear();
  renderChannels();
  updateBulkBar();
});

function updateBulkBar() {
  const n = state.selectedIds.size;
  el("bulk-bar").classList.toggle("hidden", n === 0);
  el("bulk-count").textContent = `${n} seleccionado${n === 1 ? "" : "s"}`;
}

el("bulk-clear-btn").addEventListener("click", () => {
  state.selectedIds.clear();
  renderChannels();
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
  await deleteChannels(items.map((c) => c.id));
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
  const channel = state.channels.find((c) => c.id === id);
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
    ({ error } = await supabaseClient.from("bt_channels").insert(payload));
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

   IMPORTANTE: los canales que de verdad fallan (respuesta HTTP con
   error, no un simple bloqueo de CORS) se BORRAN para siempre de la
   base de datos, no se dejan solo ocultos — igual que hace ahora la
   comprobación automática de cada noche. También se borran aquí los
   canales duplicados (mismo enlace de vídeo que otro ya guardado). */
el("check-channels-btn").addEventListener("click", async () => {
  el("channels-status").textContent = "Comprobando canales, puede tardar un poco…";

  // 1) Duplicados exactos (mismo enlace de vídeo): se queda uno solo.
  const porEnlace = new Map();
  for (const c of state.channels) {
    const clave = (c.stream_url || "").trim().toLowerCase();
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
      return a.id.localeCompare ? a.id.localeCompare(b.id) : a.id - b.id;
    });
    for (const sobrante of ordenado.slice(1)) idsDuplicados.push(sobrante.id);
  }
  if (idsDuplicados.length) {
    await supabaseClient.from("bt_channels").delete().in("id", idsDuplicados);
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
    }
    if (comprobableDeVerdad && broken) {
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

  if (idsArreglados.length) {
    // Estaban marcados como caídos de una comprobación anterior y ahora
    // sí responden: se limpia la marca, todos de una vez.
    await supabaseClient
      .from("bt_channels")
      .update({ is_broken: false, last_checked_at: new Date().toISOString() })
      .in("id", idsArreglados);
  }
  if (idsCaidos.length) {
    await supabaseClient.from("bt_channels").delete().in("id", idsCaidos);
  }

  el("channels-status").textContent =
    `Hecho: ${idsDuplicados.length} duplicados y ${idsCaidos.length} caídos borrados para siempre.`;
  await loadChannels();
  await refreshStats();
});

/* ---- Importar lista de canales (M3U / M3U8 / texto simple) ----
   Así no hay que añadir los canales uno a uno con un enlace: se
   sube el archivo entero y se rellenan todos de golpe. */

el("import-channels-btn").addEventListener("click", () => {
  el("import-file-input").value = "";
  el("import-category-override").value = "";
  el("import-status").textContent = "";
  el("import-preview-wrap").classList.add("hidden");
  el("import-confirm-btn").classList.add("hidden");
  el("import-error").classList.add("hidden");
  state.importItems = [];
  el("import-modal").classList.remove("hidden");
});

function parseChannelList(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let pending = null; // datos del #EXTINF que estamos esperando emparejar con su enlace

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith("#EXTINF")) {
      const commaIdx = line.indexOf(",");
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

el("import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const items = parseChannelList(text).filter((it) => it.streamUrl);

  if (!items.length) {
    el("import-status").textContent = "No se ha encontrado ningún canal en ese archivo. Comprueba que sea un M3U válido.";
    el("import-preview-wrap").classList.add("hidden");
    el("import-confirm-btn").classList.add("hidden");
    return;
  }

  state.importItems = items.map((it, i) => ({ ...it, id: i, selected: true }));
  el("import-status").textContent = `${items.length} canal(es) encontrados. Quita el visto de los que no quieras subir y toca "Importar".`;
  renderImportPreview();
  el("import-preview-wrap").classList.remove("hidden");
  el("import-select-all").checked = true;
  el("import-confirm-btn").classList.remove("hidden");
  updateImportConfirmLabel();
});

function renderImportPreview() {
  const override = el("import-category-override").value.trim();
  el("import-preview-tbody").innerHTML = state.importItems
    .map(
      (it) => `
        <tr>
          <td><input type="checkbox" class="import-row-check" data-id="${it.id}" ${it.selected ? "checked" : ""} /></td>
          <td>${escapeHtml(it.name)}</td>
          <td>${escapeHtml(override || it.category || "")}</td>
        </tr>`
    )
    .join("");

  document.querySelectorAll(".import-row-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const item = state.importItems.find((it) => String(it.id) === cb.dataset.id);
      if (item) item.selected = cb.checked;
      updateImportConfirmLabel();
    });
  });
}

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

el("import-confirm-btn").addEventListener("click", async () => {
  const chosen = state.importItems.filter((it) => it.selected);
  if (!chosen.length) return;

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
      logo_url: it.logoUrl || null,
      stream_url: it.streamUrl,
    };
  });

  el("import-confirm-btn").disabled = true;
  el("import-confirm-btn").textContent = "Importando…";
  el("import-error").classList.add("hidden");

  const { error } = await supabaseClient.from("bt_channels").insert(rows);

  el("import-confirm-btn").disabled = false;
  if (error) {
    el("import-error").textContent = "No se pudo importar: " + error.message;
    el("import-error").classList.remove("hidden");
    updateImportConfirmLabel();
    return;
  }

  el("import-modal").classList.add("hidden");
  await loadChannels();
  await refreshStats();
});

/* ------------------------------------------------------------ */
/* Códigos de acceso                                               */
/* ------------------------------------------------------------ */

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres confusos
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function loadCodes() {
  const { data, error } = await supabaseClient
    .from("bt_access_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return;
  el("codes-tbody").innerHTML = data
    .map((code) => {
      const statusHtml = code.used_by_email
        ? '<span class="status-broken">Usado</span>'
        : '<span class="status-ok">Libre</span>';
      return `
        <tr>
          <td>${code.code}</td>
          <td>${escapeHtml(code.label || "")}</td>
          <td>${statusHtml}</td>
          <td>${escapeHtml(code.used_by_email || "—")}</td>
          <td><button class="btn danger" data-del-code="${code.id}">Borrar</button></td>
        </tr>`;
    })
    .join("");

  document.querySelectorAll("[data-del-code]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Borrar este código?")) return;
      await supabaseClient.from("bt_access_codes").delete().eq("id", btn.dataset.delCode);
      loadCodes();
    });
  });
}

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
  const { data, error } = await supabaseClient
    .from("bt_viewers")
    .select("*")
    .order("created_at", { ascending: false });
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
          <td>${formatDateOnly(u.created_at)}</td>
          <td>${escapeHtml(u.linked_code || "—")}</td>
          <td>${accessStatusHtml(u.access_expires_at)}</td>
          <td>
            <div class="user-time-actions">
              <button class="btn" data-add-month="${u.id}">+1 mes</button>
              <button class="btn" data-add-year="${u.id}">+1 año</button>
              <input type="date" data-date-input="${u.id}" />
              <button class="btn" data-set-date="${u.id}">Fijar fecha</button>
              <button class="btn" data-clear-expiry="${u.id}">Quitar caducidad</button>
            </div>
          </td>
        </tr>`
    )
    .join("");

  document.querySelectorAll("[data-add-month]").forEach((btn) => {
    btn.addEventListener("click", () => addTimeToUser(btn.dataset.addMonth, 30));
  });
  document.querySelectorAll("[data-add-year]").forEach((btn) => {
    btn.addEventListener("click", () => addTimeToUser(btn.dataset.addYear, 365));
  });
  document.querySelectorAll("[data-set-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.setDate;
      const input = document.querySelector(`[data-date-input="${id}"]`);
      if (!input || !input.value) {
        alert("Elige primero una fecha en la casilla de al lado.");
        return;
      }
      setUserExpiry(id, new Date(input.value + "T23:59:59").toISOString());
    });
  });
  document.querySelectorAll("[data-clear-expiry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!confirm("¿Quitar la caducidad? Esta persona tendrá acceso sin límite de tiempo.")) return;
      setUserExpiry(btn.dataset.clearExpiry, null);
    });
  });
}

el("user-search").addEventListener("input", (e) => {
  state.userSearch = e.target.value;
  renderUsers();
});

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

init();
