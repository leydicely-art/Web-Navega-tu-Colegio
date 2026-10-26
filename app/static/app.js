/* Portal Escolar — interacciones de la interfaz (sidebar, asistente, ripple) */
(function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        initLoader();
        initSidebar();
        initAssistantPanel();
        initAssistantTabs();
        initAssistantCamera();
        initRipple();
        initFormLoading();
        initMascotAvatars();
        initAssistantChat();
        initAssistantAuth();
        initNavLogout();
        initPwaInstall();
        initOnboardingTour();
        initAmbientSound();
    });

    /* ------------------------------------------------------------------ */
    /* Instalación como app (PWA) — muestra un botón "Instalar" en el     */
    /* header cuando el navegador ofrece el evento beforeinstallprompt,   */
    /* así el usuario no depende del banner automático del navegador.     */
    /* ------------------------------------------------------------------ */
    function initPwaInstall() {
        const btn = document.getElementById("pwaInstallBtn");
        if (!btn) return;

        // Ya instalada y corriendo como app standalone: no hay nada que ofrecer.
        const yaInstalada =
            window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;
        if (yaInstalada) return;

        let deferredPrompt = null;

        window.addEventListener("beforeinstallprompt", (event) => {
            event.preventDefault();
            deferredPrompt = event;
            btn.hidden = false;
        });

        btn.addEventListener("click", async () => {
            if (!deferredPrompt) return;
            btn.hidden = true;
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
        });

        window.addEventListener("appinstalled", () => {
            btn.hidden = true;
            deferredPrompt = null;
        });
    }

    /* ------------------------------------------------------------------ */
    /* Mascota del asistente (león) — generador de SVG + control de estados */
    /* ------------------------------------------------------------------ */

    // Genera el marcado de la mascota animable (emoji 🦁). `state` inicial: "idle" | "thinking" | "done".
    function mascotSVG(state) {
        return (
            '<span class="mascot" data-state="' + (state || "idle") + '">' +
                '<span class="mascot__halo" aria-hidden="true"></span>' +
                '<span class="mascot__ring" aria-hidden="true"></span>' +
                '<span class="mascot__emoji" role="img" aria-label="Asistente virtual">🦁</span>' +
            '</span>'
        );
    }

    // Cambia el estado de una mascota ya montada. "done" se reproduce siempre desde cero
    // y vuelve sola a "idle" al terminar la animación de confirmación.
    function setMascotState(mascotEl, state) {
        if (!mascotEl) return;
        clearTimeout(mascotEl._mascotDoneTimer);

        if (state === "done") {
            mascotEl.dataset.state = "idle";
            void mascotEl.offsetWidth; // fuerza reflow para reiniciar la animación
            mascotEl.dataset.state = "done";
            mascotEl._mascotDoneTimer = setTimeout(() => {
                if (mascotEl.dataset.state === "done") mascotEl.dataset.state = "idle";
            }, 950);
        } else {
            mascotEl.dataset.state = state;
        }
    }

    function initMascotAvatars() {
        document.querySelectorAll("[data-mascot-mount]").forEach((el) => {
            el.innerHTML = mascotSVG("idle");
        });
    }

    window.PortalMascot = { svg: mascotSVG, setState: setMascotState };

    /* ------------------------------------------------------------------ */
    /* Preferencia única de sonido de toda la app (menú 🔊 del navbar).     */
    /* La usan tanto el sonido de fondo y la voz del asistente (más abajo,  */
    /* en este mismo archivo) como el minijuego (app/static/game/audio.js,  */
    /* que corre en otro documento cuando va en el <iframe> de "Aventura"). */
    /*   "todo"      -> música de fondo + voz del asistente + efectos.      */
    /*   "sin-fondo" -> voz del asistente y efectos, sin música de fondo.   */
    /*   "silencio"  -> todo apagado, incluida la voz del asistente.        */
    /* ------------------------------------------------------------------ */
    const PORTAL_AUDIO_KEY = "portalAudioModo";
    const PORTAL_AUDIO_EVENT = "portal:audio-modo";
    const MODOS_VALIDOS = ["todo", "sin-fondo", "silencio"];

    function leerModoAudio() {
        try {
            const guardado = localStorage.getItem(PORTAL_AUDIO_KEY);
            if (MODOS_VALIDOS.includes(guardado)) return guardado;
        } catch (e) {}
        return "todo";
    }

    function guardarModoAudio(modo) {
        try { localStorage.setItem(PORTAL_AUDIO_KEY, modo); } catch (e) {}
        window.dispatchEvent(new CustomEvent(PORTAL_AUDIO_EVENT, { detail: { modo } }));
    }

    /* ------------------------------------------------------------------ */
    /* Voz — reproductor de "notas de voz" estilo WhatsApp                  */
    /* Usa la Web Speech API del navegador (sin backend ni dependencias).   */
    /* Respeta la preferencia de sonido: no habla si el modo es "silencio". */
    /* ------------------------------------------------------------------ */

    const vozDisponible = "speechSynthesis" in window;
    let hablando = null; // { player, icon } del reproductor sonando ahora mismo

    // Nombres típicos de voces masculinas en español que ofrecen los navegadores
    // (Windows/Edge, Chrome/Android, macOS/iOS). No hay un campo de "género" en
    // la Web Speech API, así que se reconoce por el nombre de la voz.
    const NOMBRES_VOZ_MASCULINA = [
        "jorge", "pablo", "diego", "juan", "raul", "raúl", "carlos", "miguel",
        "alvaro", "álvaro", "fernando", "andres", "andrés", "male"
    ];

    let vocesCache = [];
    function actualizarVocesCache() {
        vocesCache = window.speechSynthesis.getVoices();
    }
    if (vozDisponible) {
        actualizarVocesCache();
        window.speechSynthesis.addEventListener("voiceschanged", actualizarVocesCache);
    }

    // Busca entre las voces del navegador una masculina en español; si no hay
    // ninguna instalada, devuelve null y se recurre a un tono más grave.
    function elegirVozMasculina() {
        if (!vocesCache.length) return null;
        const vocesEspanol = vocesCache.filter(v => v.lang && v.lang.toLowerCase().startsWith("es"));
        const candidatas = vocesEspanol.length ? vocesEspanol : vocesCache;
        return candidatas.find(v =>
            NOMBRES_VOZ_MASCULINA.some(nombre => v.name.toLowerCase().includes(nombre))
        ) || null;
    }

    function detenerVoz() {
        if (vozDisponible) window.speechSynthesis.cancel();
        if (hablando) {
            hablando.player.classList.remove("is-playing");
            hablando.icon.textContent = "▶";
        }
        hablando = null;
    }

    // Si el modo pasa a "Sin sonido" mientras el asistente está hablando, lo corta al momento.
    function alCambiarModoAudio(modo) {
        if (modo === "silencio") detenerVoz();
    }
    window.addEventListener("storage", (event) => {
        if (event.key === PORTAL_AUDIO_KEY) alCambiarModoAudio(leerModoAudio());
    });
    window.addEventListener(PORTAL_AUDIO_EVENT, (event) => {
        alCambiarModoAudio(event.detail && event.detail.modo);
    });

    function alternarVoz(texto, player, icon) {
        if (!vozDisponible) return;
        const eraEstePlayer = hablando && hablando.player === player;
        detenerVoz();
        if (eraEstePlayer) return;
        if (leerModoAudio() === "silencio") return; // el modo "Sin sonido" también silencia la voz del asistente

        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = "es-ES";
        utterance.rate = 0.98;

        const vozMasculina = elegirVozMasculina();
        if (vozMasculina) {
            utterance.voice = vozMasculina;
            utterance.lang = vozMasculina.lang;
        } else {
            // Sin voz masculina instalada: se baja el tono para que suene más grave.
            utterance.pitch = 0.7;
        }

        utterance.onend = detenerVoz;
        utterance.onerror = detenerVoz;

        player.classList.add("is-playing");
        icon.textContent = "❚❚";
        hablando = { player, icon };
        window.speechSynthesis.speak(utterance);
    }

    // Crea el reproductor "nota de voz" (botón ▶ + ondas) para leer `texto` en voz alta.
    // Con `autoplay: true` empieza a hablar solo, apenas se crea (sin esperar el clic).
    // Devuelve null si el navegador no soporta síntesis de voz.
    function crearVoicePlayer(texto, opciones) {
        if (!vozDisponible || !texto) return null;
        const autoplay = !!(opciones && opciones.autoplay);

        const player = document.createElement("div");
        player.className = "voice-player";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "voice-player__toggle";
        toggle.setAttribute("aria-label", "Escuchar este mensaje en voz alta");

        const icon = document.createElement("span");
        icon.className = "voice-player__icon";
        icon.textContent = "▶";
        toggle.appendChild(icon);

        const wave = document.createElement("span");
        wave.className = "voice-player__wave";
        for (let i = 0; i < 16; i++) wave.appendChild(document.createElement("span"));

        toggle.addEventListener("click", () => alternarVoz(texto, player, icon));

        player.appendChild(toggle);
        player.appendChild(wave);

        if (autoplay) alternarVoz(texto, player, icon);

        return player;
    }

    window.PortalVoice = { crearVoicePlayer, detenerVoz };

    function initLoader() {
        const loader = document.getElementById("pageLoader");
        if (!loader) return;
        window.requestAnimationFrame(() => {
            setTimeout(() => loader.classList.add("is-hidden"), 220);
        });
    }

    function initSidebar() {
        const sidebar = document.getElementById("appSidebar");
        const toggle = document.getElementById("sidebarToggle");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (!sidebar || !toggle || !backdrop) return;

        const open = () => {
            sidebar.classList.add("is-open");
            backdrop.classList.add("is-open");
        };
        const close = () => {
            sidebar.classList.remove("is-open");
            backdrop.classList.remove("is-open");
        };

        toggle.addEventListener("click", () => {
            sidebar.classList.contains("is-open") ? close() : open();
        });
        backdrop.addEventListener("click", close);
        sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
    }

    // Mismo breakpoint que .app-body/.assistant-panel en style.css: por
    // debajo de este ancho el panel del asistente pasa a overlay de
    // pantalla completa.
    const ASSISTANT_OVERLAY_QUERY = "(max-width: 900px)";

    function initAssistantPanel() {
        const panel = document.getElementById("assistantPanel");
        const fab = document.getElementById("assistantFab");
        const closeBtn = document.getElementById("assistantClose");
        if (!panel || !fab || !closeBtn) return;

      const abrir = () => {
    panel.classList.add("is-open");
    document.body.classList.add("assistant-open");
};
        fab.addEventListener("click", abrir);

        // En móvil el asistente es la vista principal: arranca ya abierto
        // en vez de esperar a que se toque el botón flotante.
        if (window.matchMedia(ASSISTANT_OVERLAY_QUERY).matches) {
            abrir();
        }

        closeBtn.addEventListener("click", () => {
            panel.classList.remove("is-open");
            document.body.classList.remove("assistant-open");
            PortalVoice.detenerVoz();
            // Al cerrar el chat, siempre se vuelve a la pestaña Chat y se
            // apaga la cámara (si estaba abierta) para la próxima vez.
            window.dispatchEvent(new CustomEvent("portal:assistant-closed"));
        });
    }

    /* ------------------------------------------------------------------ */
    /* Pestañas del asistente: 💬 Chat / 🗺️ Mapa                           */
    /* Reservadas para una futura vista compacta del panel (ver comentario */
    /* en .assistant-tabs, style.css); hoy el layout es el mismo en        */
    /* escritorio y móvil, así que quedan sin mostrarse. Si en el futuro   */
    /* se activan, el mapa real de Inicio (con sus zonas clicables) se     */
    /* "presta" a la pestaña moviendo su nodo en el DOM, y vuelve a su     */
    /* lugar original al volver a la pestaña Chat.                        */
    /* ------------------------------------------------------------------ */

    function initAssistantTabs() {
        const tabChat = document.getElementById("assistantTabChat");
        const tabMap = document.getElementById("assistantTabMap");
        const chatView = document.getElementById("assistantChatView");
        const mapView = document.getElementById("assistantMapView");
        const mapEmpty = document.getElementById("assistantMapEmpty");
        if (!tabChat || !tabMap || !chatView || !mapView) return;

        // Solo existe en la página de Inicio: es el propio mapa del campus,
        // no una copia (así sus zonas clicables y modales siguen funcionando
        // igual estén dentro o fuera del chat).
        const campusMapNav = document.getElementById("campusMap");
        const mapSection = campusMapNav ? campusMapNav.closest(".app-card") : null;
        let mapSlotMarker = null;

        if (mapSection && mapEmpty) mapEmpty.hidden = true;

        function moverMapaAlChat() {
            if (!mapSection) return;
            if (!mapSlotMarker) {
                mapSlotMarker = document.createComment("campus-map-slot");
                mapSection.parentNode.insertBefore(mapSlotMarker, mapSection);
            }
            mapView.appendChild(mapSection);
        }

        function devolverMapaASuLugar() {
            if (!mapSection || !mapSlotMarker || !mapSlotMarker.parentNode) return;
            mapSlotMarker.parentNode.insertBefore(mapSection, mapSlotMarker);
        }

        function mostrarPestana(tab) {
            const esMapa = tab === "map";
            tabChat.classList.toggle("is-active", !esMapa);
            tabMap.classList.toggle("is-active", esMapa);
            tabChat.setAttribute("aria-selected", String(!esMapa));
            tabMap.setAttribute("aria-selected", String(esMapa));
            chatView.hidden = esMapa;
            mapView.hidden = !esMapa;

            if (esMapa) moverMapaAlChat();
            else devolverMapaASuLugar();
        }

        tabChat.addEventListener("click", () => mostrarPestana("chat"));
        tabMap.addEventListener("click", () => mostrarPestana("map"));

        // Al cerrar el chat, siempre queda listo en la pestaña Chat para la
        // próxima vez (y el mapa, si se había prestado, vuelve a Inicio).
        window.addEventListener("portal:assistant-closed", () => mostrarPestana("chat"));
    }

    /* ------------------------------------------------------------------ */
    /* Botón de cámara del asistente: abre el Modo AR embebido            */
    /* (mismo visor de /ar, con León en 3D) dentro del propio panel de    */
    /* chat, sin salir de la página ni navegar a otra URL.                */
    /* ------------------------------------------------------------------ */

    function initAssistantCamera() {
        const panel = document.getElementById("assistantPanel");
        const openBtn = document.getElementById("assistantCameraBtn");
        const closeBtn = document.getElementById("assistantCameraClose");
        const cameraView = document.getElementById("assistantCameraView");
        const chatView = document.getElementById("assistantChatView");
        const frame = document.getElementById("assistantCameraFrame");
        if (!openBtn || !closeBtn || !cameraView || !chatView || !frame) return;

        function abrirCamara() {
            frame.src = "/ar?embed=1";
            cameraView.hidden = false;
            chatView.hidden = true;
            // Oculta la cabecera del asistente y las pestañas Chat/Mapa
            // mientras dura la cámara: el Modo AR debe ocupar toda la
            // pantalla, no quedar apretado bajo esas barras (ver
            // .assistant-panel--camera en style.css).
            if (panel) panel.classList.add("assistant-panel--camera");
        }

        function cerrarCamara() {
            cameraView.hidden = true;
            chatView.hidden = false;
            if (panel) panel.classList.remove("assistant-panel--camera");
            // Vaciar el src detiene la cámara/sesión AR del iframe (evita
            // dejar la cámara encendida en segundo plano).
            frame.src = "about:blank";
        }

        openBtn.addEventListener("click", abrirCamara);
        closeBtn.addEventListener("click", cerrarCamara);
        window.addEventListener("portal:assistant-closed", cerrarCamara);
    }

    function initRipple() {
        document.addEventListener("click", (event) => {
            const btn = event.target.closest(".btn");
            if (!btn) return;

            const rect = btn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const ripple = document.createElement("span");
            ripple.className = "btn-ripple";
            ripple.style.width = ripple.style.height = size + "px";
            ripple.style.left = event.clientX - rect.left - size / 2 + "px";
            ripple.style.top = event.clientY - rect.top - size / 2 + "px";

            btn.appendChild(ripple);
            ripple.addEventListener("animationend", () => ripple.remove());
        });
    }

    function initFormLoading() {
        document.querySelectorAll("form").forEach((form) => {
            form.addEventListener("submit", () => {
                // Formularios que se envían por JS (sin recargar) no muestran carga.
                if (form.hasAttribute("data-sin-carga")) return;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.classList.add("is-loading");
            });
        });
    }

// Botón enviar/micrófono del asistente: envía texto si hay algo escrito,
    // y si el campo está vacío graba la pregunta por voz (dictado a texto),
    // igual que el botón único de WhatsApp.
    function initAssistantVoiceInput(form, input) {
        const sendBtn = document.getElementById("assistantSendBtn");
        const icon = document.getElementById("assistantSendIcon");
        if (!sendBtn || !icon) return;

        const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        const dictadoDisponible = !!SpeechRecognitionCtor;
        let recognition = null;
        let escuchando = false;

        function actualizarIcono() {
            const hayTexto = input.value.trim().length > 0;
            icon.textContent = hayTexto || !dictadoDisponible ? "➤" : "🎤";
            sendBtn.classList.toggle("is-mic", !hayTexto && dictadoDisponible);
        }

        input.addEventListener("input", actualizarIcono);
        actualizarIcono();

        if (!dictadoDisponible) return;

        recognition = new SpeechRecognitionCtor();
        recognition.lang = "es-ES";
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.addEventListener("result", (event) => {
            input.value = event.results[0][0].transcript;
            actualizarIcono();
            form.dispatchEvent(new Event("submit", { cancelable: true }));
        });

        recognition.addEventListener("end", () => {
            escuchando = false;
            sendBtn.classList.remove("is-recording");
        });

        recognition.addEventListener("error", () => {
            escuchando = false;
            sendBtn.classList.remove("is-recording");
        });

        sendBtn.addEventListener("click", (event) => {
            if (input.value.trim()) return; // hay texto: se envía como formulario normal
            event.preventDefault();
            if (escuchando) {
                recognition.stop();
                return;
            }
            PortalVoice.detenerVoz(); // no escuchar mientras el asistente está hablando
            escuchando = true;
            sendBtn.classList.add("is-recording");
            recognition.start();
        });
    }
 

        function initAssistantChat() {
    const form = document.getElementById("assistantForm");
    const input = document.getElementById("assistantInput");
    const body = document.getElementById("assistantBody");
    if (!form || !input || !body) return;

    const CHAT_HISTORY_KEY = "portal:assistant:history";
    const ROUTE_FLOW_KEY = "portal:assistant:route";

    function leerHistorialAsistente() {
        try {
            const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function guardarHistorialAsistente(historial) {
        try {
            sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(historial));
        } catch (error) {
            // El navegador puede bloquear sessionStorage en páginas privadas o con restricciones.
        }
    }

    function leerFlujoRuta() {
        try {
            const raw = sessionStorage.getItem(ROUTE_FLOW_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function guardarFlujoRuta(flujo) {
        try {
            if (flujo) sessionStorage.setItem(ROUTE_FLOW_KEY, JSON.stringify(flujo));
            else sessionStorage.removeItem(ROUTE_FLOW_KEY);
        } catch (error) {
            // Se evita romper el chat si no se puede persistir la navegación.
        }
    }

    function crearMensajeVisual(role, text, opciones) {
        const wrap = document.createElement("div");
        wrap.className = "chat-msg chat-msg--" + role + (role === "bot" ? " anim-fade-up" : "");

        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const avatarHtml = role === "user"
            ? '<span class="chat-msg__avatar">🧑</span>'
            : '<span class="chat-msg__avatar">' + PortalMascot.svg("idle") + "</span>";

        wrap.innerHTML = avatarHtml + '<div class="chat-bubble"></div>';
        const bubble = wrap.querySelector(".chat-bubble");

        const textEl = document.createElement("span");
        textEl.className = "chat-bubble__text";
        textEl.textContent = text;
        bubble.appendChild(textEl);

        if (role === "bot") {
            const player = PortalVoice.crearVoicePlayer(text, { autoplay: true });
            if (player) bubble.appendChild(player);
        }

        if (opciones && opciones.length) {
            const pills = document.createElement("div");
            pills.className = "chat-suggestions";
            opciones.forEach((opcion) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "chat-chip";
                btn.textContent = opcion.etiqueta || opcion.nombre || opcion;
                btn.addEventListener("click", () => {
                    const flujo = leerFlujoRuta();
                    if (!flujo) return;
                    const destino = flujo.destino || {};
                    const origenId = Number(opcion.id ?? opcion.nodo_id ?? opcion.origen_id);
                    const destinoId = Number(destino.id ?? destino.nodo_id ?? flujo.destino_id);
                    if (!Number.isFinite(origenId) || !Number.isFinite(destinoId)) return;

                    const siguienteFlujo = {
                        ...flujo,
                        estado: "seleccionado",
                        origen: { id: origenId, etiqueta: opcion.etiqueta || opcion.nombre || opcion },
                        origen_id: origenId,
                        destino_id: destinoId,
                    };
                    guardarFlujoRuta(siguienteFlujo);

                    appendMessage("user", opcion.etiqueta || opcion.nombre || opcion, { celebrate: false });
                    const textoFinal = construirRespuestaFinal(destino, siguienteFlujo.origen);
                    const respuesta = appendMessage("bot", textoFinal, { celebrate: false });
                    if (destino && destino.accion) {
                        mostrarAccion360(respuesta, destino.accion);
                    }

                    if (window.location.pathname === "/rutas") {
                        window.dispatchEvent(new CustomEvent("portal:ruta-seleccionada", { detail: { desde: origenId, hasta: destinoId } }));
                    } else {
                        window.location.href = "/rutas?desde=" + encodeURIComponent(origenId) + "&hasta=" + encodeURIComponent(destinoId);
                    }
                });
                pills.appendChild(btn);
            });
            bubble.appendChild(pills);
        }

        const timeEl = document.createElement("span");
        timeEl.className = "chat-bubble__time";
        timeEl.textContent = time;
        if (role === "user") {
            const tick = document.createElement("span");
            tick.className = "chat-bubble__tick";
            tick.textContent = "✓✓";
            timeEl.appendChild(tick);
        }
        bubble.appendChild(timeEl);

        body.appendChild(wrap);
        body.scrollTop = body.scrollHeight;

        if (role === "bot" && opciones && opciones.length && typeof opciones[0] === "object") {
            const mensaje = wrap.querySelector(".chat-bubble__text");
            if (mensaje) mensaje.textContent = text;
        }

        if (role === "bot" && opciones === undefined) {
            const headerMascot = document.getElementById("assistantAvatar")?.querySelector(".mascot");
            PortalMascot.setState(headerMascot, "done");
        }

        return wrap;
    }

    function cargarHistorialAsistente() {
        const historial = leerHistorialAsistente();
        if (!historial.length) return false;
        body.innerHTML = "";
        historial.forEach((item) => {
            const opciones = Array.isArray(item.opciones) ? item.opciones : [];
            const wrap = crearMensajeVisual(item.role, item.text, opciones);
            if (item.role === "bot" && Array.isArray(item.opciones) && item.opciones.length) {
                // El mensaje se conserva tal como se guardó en el historial.
            }
            if (wrap && item.role === "bot") {
                const headerMascot = document.getElementById("assistantAvatar")?.querySelector(".mascot");
                PortalMascot.setState(headerMascot, "done");
            }
        });
        return true;
    }

    function persistirMensaje(role, text, metadata) {
        const historial = leerHistorialAsistente();
        historial.push({ role, text, time: new Date().toISOString(), opciones: metadata && metadata.opciones ? metadata.opciones : [] });
        guardarHistorialAsistente(historial);
    }

    function construirRespuestaFinal(destino, origen) {
        const descripcion = (destino && destino.descripcion ? String(destino.descripcion).trim() : "").replace(/\s+/g, " ");
        if (descripcion) {
            return descripcion;
        }
        return "No hay información descriptiva disponible.";
    }

    initAssistantVoiceInput(form, input);


   // Saludo + frase motivacional
const frasesMotivacionales = [
    " Recuerda: cada día es una nueva oportunidad para aprender algo nuevo.",
    " No importa qué tan lento avances, lo importante es que nunca dejes de avanzar.",
    " Cada cosa que aprendes hoy te acerca un poco más a tus sueños.",
    " Confía en ti mismo. Eres capaz de lograr grandes cosas.",
    " Atrévete a aprender, crecer y superar tus propios límites.",
    " Los grandes sueños comienzan con pequeños pasos.",
    " Enfócate en tus metas y disfruta el camino para alcanzarlas.",
    " Cada error es una oportunidad para aprender y mejorar.",
    " No te rindas. Puede que estés más cerca de lograrlo de lo que imaginas.",
    " Tu curiosidad puede llevarte a descubrir cosas increíbles.",
    " El esfuerzo de hoy puede convertirse en el logro de mañana.",
    " Siempre hay algo nuevo que aprender y una nueva meta por alcanzar.",
    " Los grandes sueños se construyen con esfuerzo, disciplina y constancia.",
    " Estudiar hoy es dar un paso más hacia el futuro que quieres.",
    " Cree en tu proceso. Cada pequeño avance cuenta."
];

  let ultimaFraseMotivacional = -1;

    function mostrarFraseMotivacional() {

        const greetingText = document.getElementById(
            "assistantGreetingText"
        );

        if (!greetingText) return;

        let indice;

        do {
            indice = Math.floor(
                Math.random() * frasesMotivacionales.length
            );
        } while (
            frasesMotivacionales.length > 1 &&
            indice === ultimaFraseMotivacional
        );

        ultimaFraseMotivacional = indice;

        const frase = frasesMotivacionales[indice];

        const saludo =
            "¡Hola! Bienvenido a Navega Tu Colegio. " +
            "Aquí podrás preguntar todo lo que desees sobre tu colegio, " +
            "profesores, materias, cursos y mucho más.";

        const mensajeCompleto = saludo + "\n\n" + frase;

        greetingText.textContent = mensajeCompleto;

        const reproductorAnterior =
            greetingText.parentElement.querySelector(".voice-player");

        if (reproductorAnterior) {
            reproductorAnterior.remove();
        }

        const reproductor =
            PortalVoice.crearVoicePlayer(mensajeCompleto, { autoplay: true });

        if (reproductor) {
            greetingText.insertAdjacentElement(
                "afterend",
                reproductor
            );
        }
    }

    if (!cargarHistorialAsistente()) {
        mostrarFraseMotivacional();
    }

        document.querySelectorAll(".chat-chip[data-question]").forEach((chip) => {
            chip.addEventListener("click", () => {
                input.value = chip.dataset.question;
                form.dispatchEvent(new Event("submit", { cancelable: true }));
                const panel = document.getElementById("assistantPanel");
                if (panel) panel.classList.add("is-open");
                document.body.classList.add("assistant-open");
            });
        });

        const headerAvatar = document.getElementById("assistantAvatar");

        // -- Preloader del león: reemplaza los "..." de escribiendo mientras
        // se espera la respuesta del chatbot. Se muestra siempre exactamente
        // 3 segundos (aunque la respuesta llegue antes), y la burbuja de
        // respuesta no aparece hasta que el león termina de desvanecerse. --
        const PRELOADER_MS = 3000;
        const preloader = document.getElementById("assistantPreloader");
        const preloaderVideo = document.getElementById("assistantPreloaderVideo");

        function mostrarPreloaderLeon() {
            if (!preloader) return;
            if (preloaderVideo) {
                try {
                    preloaderVideo.currentTime = 0;
                } catch (err) { /* el video puede no estar listo aún */ }
                preloaderVideo.play().catch(() => {});
            }
            preloader.classList.add("is-visible");
        }

        function ocultarPreloaderLeon(callback) {
            if (!preloader) {
                callback();
                return;
            }
            preloader.classList.remove("is-visible");
            // Espera a que termine la transición de salida (fade-out +
            // desplazamiento hacia arriba) antes de mostrar la respuesta.
            setTimeout(() => {
                if (preloaderVideo) preloaderVideo.pause();
                callback();
            }, 350);
        }

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const pregunta = input.value.trim();
            if (!pregunta) return;

            appendMessage("user", pregunta);
            input.value = "";
            input.focus();

            const headerMascot = headerAvatar && headerAvatar.querySelector(".mascot");
            PortalMascot.setState(headerMascot, "thinking");
            // Si el Modo AR está activo en esta misma página, el león 3D
            // escucha este evento y adopta una pose de "pensando".
            window.dispatchEvent(new CustomEvent("portal:assistant-state", { detail: { state: "thinking" } }));

            mostrarPreloaderLeon();

            const peticion = fetch("/api/chatbot/" + encodeURIComponent(pregunta)).then((res) => res.json());
            const esperaMinima = new Promise((resolve) => setTimeout(resolve, PRELOADER_MS));

            Promise.all([peticion, esperaMinima])
                .then(([data]) => {
                    ocultarPreloaderLeon(() => {
                        if (data.ruta_pendiente && data.ruta_pendiente.solicita_origen) {
                            const flujo = {
                                destino: data.ruta_pendiente.destino,
                                origenes: data.ruta_pendiente.origenes || [],
                                mensaje: data.ruta_pendiente.mensaje || "¿Dónde te encuentras actualmente? Selecciona tu ubicación de origen para mostrarte la ruta",
                                estado: "esperando-origen",
                            };
                            guardarFlujoRuta(flujo);
                            const wrap = appendMessage("bot", flujo.mensaje, {
                                celebrate: false,
                                opciones: flujo.origenes,
                                flujoRuta: flujo,
                            });
                            if (flujo.destino && flujo.destino.accion) {
                                mostrarAccion360(wrap, flujo.destino.accion);
                            }
                            PortalMascot.setState(headerMascot, "done");
                            window.dispatchEvent(new CustomEvent("portal:assistant-state", { detail: { state: "talking" } }));
                            return;
                        }
                        const wrap = appendMessage("bot", data.respuesta || data.error || "No pude procesar tu pregunta.");
                        // Si la ubicación consultada tiene una acción del mapa,
                        // ofrecemos (y abrimos) su vista en 360°.
                        if (data.accion) mostrarAccion360(wrap, data.accion);
                        PortalMascot.setState(headerMascot, "done");
                        window.dispatchEvent(new CustomEvent("portal:assistant-state", { detail: { state: "talking" } }));
                    });
                })
                .catch(() => {
                    ocultarPreloaderLeon(() => {
                        appendMessage("bot", "Hubo un problema de conexión. Intenta de nuevo.", { celebrate: false });
                        PortalMascot.setState(headerMascot, "idle");
                        window.dispatchEvent(new CustomEvent("portal:assistant-state", { detail: { state: "idle" } }));
                    });
                });
        });

        function appendMessage(role, text, options) {
            options = options || {};
            const wrap = document.createElement("div");
            // Las respuestas del bot entran con fade-in + slide-up, justo
            // después de que el preloader del león termina de desvanecerse.
            wrap.className = "chat-msg chat-msg--" + role + (role === "bot" ? " anim-fade-up" : "");

            const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

            const avatarHtml = role === "user"
                ? '<span class="chat-msg__avatar">🧑</span>'
                : '<span class="chat-msg__avatar">' + PortalMascot.svg("idle") + "</span>";

            wrap.innerHTML = avatarHtml + '<div class="chat-bubble"></div>';
            const bubble = wrap.querySelector(".chat-bubble");

            const textEl = document.createElement("span");
            textEl.className = "chat-bubble__text";
            textEl.textContent = text;
            bubble.appendChild(textEl);

            // Nota de voz: el asistente puede leer su respuesta en voz alta, como en WhatsApp.
            if (role === "bot") {
                const player = PortalVoice.crearVoicePlayer(text, { autoplay: true });
                if (player) bubble.appendChild(player);
            }

            if (options.opciones && options.opciones.length) {
                const pills = document.createElement("div");
                pills.className = "chat-suggestions";
                options.opciones.forEach((opcion) => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "chat-chip";
                    btn.textContent = opcion.etiqueta || opcion.nombre || opcion;
                    btn.addEventListener("click", () => {
                        const flujo = options.flujoRuta || leerFlujoRuta();
                        if (!flujo) return;
                        const destino = flujo.destino || {};
                        const origenId = Number(opcion.id ?? opcion.nodo_id ?? opcion.origen_id);
                        const destinoId = Number(destino.id ?? destino.nodo_id ?? flujo.destino_id ?? flujo.destino?.id);
                        if (!Number.isFinite(origenId) || !Number.isFinite(destinoId)) return;

                        const siguienteFlujo = {
                            ...flujo,
                            estado: "seleccionado",
                            origen: { id: origenId, etiqueta: opcion.etiqueta || opcion.nombre || opcion },
                            origen_id: origenId,
                            destino_id: destinoId,
                        };
                        guardarFlujoRuta(siguienteFlujo);

                        appendMessage("user", opcion.etiqueta || opcion.nombre || opcion, { celebrate: false });
                        const respuestaFinal = construirRespuestaFinal(destino, siguienteFlujo.origen);
                        const respuestaWrap = appendMessage("bot", respuestaFinal, { celebrate: false });
                        if (destino && destino.accion) mostrarAccion360(respuestaWrap, destino.accion);

                        if (window.location.pathname === "/rutas") {
                            window.dispatchEvent(new CustomEvent("portal:ruta-seleccionada", { detail: { desde: origenId, hasta: destinoId } }));
                        } else {
                            window.location.href = "/rutas?desde=" + encodeURIComponent(origenId) + "&hasta=" + encodeURIComponent(destinoId);
                        }
                    });
                    pills.appendChild(btn);
                });
                bubble.appendChild(pills);
            }

            const timeEl = document.createElement("span");
            timeEl.className = "chat-bubble__time";
            timeEl.textContent = time;
            if (role === "user") {
                const tick = document.createElement("span");
                tick.className = "chat-bubble__tick";
                tick.textContent = "✓✓";
                timeEl.appendChild(tick);
            }
            bubble.appendChild(timeEl);

            body.appendChild(wrap);
            body.scrollTop = body.scrollHeight;

            if (role === "bot" && options.celebrate !== false) {
                PortalMascot.setState(wrap.querySelector(".mascot"), "done");
            }

            persistirMensaje(role, text, { opciones: options.opciones || [] });
            return wrap;
        }

        // -- Vista 360° de una ubicación --------------------------------------
        // Cada botón del mapa tiene un modal con visor Pannellum en la página de
        // inicio (id "<accion>Modal"). Aquí añadimos un botón "Ver en 360°" a la
        // respuesta del asistente y abrimos ese visor.
        function construirCatalogoCampus() {
            if (window.__portalCampusModalCatalog) return window.__portalCampusModalCatalog;

            window.__portalCampusModalCatalog = {
                biblioteca: {
                    datosCuriosos: [
                        "La biblioteca más antigua del mundo que sigue en funcionamiento es la de Al-Qarawiyyin, en Fez (Marruecos), fundada en el año 859.",
                        "En la antigua Biblioteca de Alejandría se llegaron a guardar hasta 700.000 rollos de papiro.",
                        "La palabra biblioteca viene del griego biblíon, que significa libro, y thḗkē, que significa depósito: literalmente, depósito de libros.",
                        "La Biblioteca del Congreso de EE. UU. tiene más de 170 millones de artículos en su colección.",
                        "En la Edad Media, muchos libros se encadenaban a los estantes de la biblioteca para evitar que se los robaran.",
                        "El sistema decimal Dewey, usado para clasificar libros por tema, fue inventado en 1876 por un bibliotecario de apenas 21 años.",
                        "Finlandia es, en proporción, el país con más préstamos de biblioteca por persona al año en el mundo.",
                        "La Biblioteca Nacional de Colombia, fundada en 1777, es una de las más antiguas de todo el continente americano.",
                        "La invención de la imprenta por Gutenberg en 1440 transformó las bibliotecas: antes, copiar un solo libro a mano podía tardar meses.",
                        "En japonés, la palabra para \"biblioteca\" es toshokan (図書館), que literalmente significa \"edificio de libros e ilustraciones\"."
                    ],
                    imagenes: [
                        "/images/colegio/biblioteca segundo piso.png"
                    ]
                },
                bloqueD: {
                    datosCuriosos: [
                        "La palabra \"aula\" viene del latín aula, que en la Antigua Roma nombraba el patio o la sala principal de una vivienda.",
                        "Las escuelas con aulas separadas por edades son un invento relativamente reciente: se popularizaron apenas en el siglo XIX.",
                        "El color verde de muchos tableros escolares se eligió porque cansa menos la vista que el negro tras varias horas de clase.",
                        "Identificar los edificios escolares con letras (A, B, C, D…) es una práctica común para ayudar a los estudiantes nuevos a ubicarse rápido.",
                        "La mochila moderna de dos correas se inventó en 1938, pero no se hizo popular entre los estudiantes hasta los años 60.",
                        "El recreo no es solo un descanso: estudios muestran que las pausas activas mejoran la concentración en clase.",
                        "El colegio más grande del mundo por número de estudiantes, en Lucknow (India), tiene más de 55.000 alumnos matriculados.",
                        "Los pasillos anchos en los colegios no son casualidad: su diseño busca evitar aglomeraciones durante el cambio de clase.",
                        "El primer tablero de tiza para uso escolar se atribuye a James Pillans, un maestro escocés de comienzos del siglo XIX.",
                        "Identificar los edificios de un campus con letras es una convención tomada de la arquitectura hospitalaria, adaptada luego a los colegios."
                    ],
                    imagenes: [
                        "/images/colegio/bloque D.png"
                    ]
                },
                bloqueC: {
                    datosCuriosos: [
                        "La palabra \"curso\" viene del latín cursus, que significa \"carrera\" o \"recorrido\": el camino de aprendizaje de un año escolar.",
                        "En Colombia, el sistema de grados escolares (de 1° a 11°) se estandarizó formalmente durante el siglo XX.",
                        "Agrupar a los estudiantes por edad en \"cursos\" o \"grados\" se popularizó apenas en el siglo XIX, con la llegada de la educación pública masiva.",
                        "La palabra \"salón\" viene del francés salle, que originalmente significaba simplemente \"sala\".",
                        "Algunas escuelas en Japón mantienen a los mismos compañeros de curso durante toda la primaria, para fortalecer el sentido de comunidad.",
                        "El horario escolar dividido por asignaturas, como el que usamos hoy, se originó en Prusia a comienzos del siglo XIX.",
                        "Según la UNESCO, el número ideal de estudiantes por curso para un aprendizaje efectivo ronda los 25 alumnos.",
                        "La palabra \"grupo\" llegó al español desde el italiano gruppo, término que originalmente se usaba en el arte para nombrar un conjunto de figuras.",
                        "En la antigua Grecia, los estudiantes no usaban pupitres individuales: aprendían sentados en semicírculo alrededor de su maestro.",
                        "El uniforme escolar, tal como lo conocemos hoy, se originó en Inglaterra en el siglo XVI, en el Christ's Hospital de Londres."
                    ],
                    imagenes: [
                        "/images/colegio/bloque C-parteinicial.png",
                        "/images/colegio/bloque C-parteuno.png",
                        "/images/colegio/bloque C-partedos.png",
                        "/images/colegio/bloque C-partetres.png"
                    ]
                },
                rectoria: {
                    datosCuriosos: [
                        "La palabra \"rector\" viene del latín rectus, que significa \"el que dirige o gobierna\".",
                        "El cargo de rector nació en las universidades medievales; con el tiempo, muchos colegios adoptaron el título para su máxima autoridad.",
                        "Las primeras secretarías escolares surgieron en el siglo XIX, junto con los primeros sistemas formales de matrícula y registro académico.",
                        "En muchas instituciones, es el rector quien firma los diplomas de grado, por eso su firma aparece en los certificados oficiales.",
                        "La oficina de secretaría suele ser el primer punto de contacto de un colegio: allí se gestionan matrículas, certificados y trámites.",
                        "La palabra \"secretario\" viene del latín secretarius, relacionado con quien maneja información reservada o \"secreta\".",
                        "Algunas rectorías conservan libros de actas escritos a mano desde la fundación del colegio, como memoria histórica de la institución.",
                        "En las primeras universidades medievales, los rectores eran elegidos por los propios estudiantes, no designados por autoridades externas.",
                        "En muchas instituciones, el sello oficial que aparece en actas y diplomas se usaba, desde tiempos antiguos, para certificar la autenticidad de un documento incluso antes de que existieran las firmas.",
                        "En Colombia, la figura del rector escolar responde legalmente ante la Secretaría de Educación por la gestión académica y administrativa del colegio."
                    ],
                    imagenes: [
                        "/images/image.png"
                    ]
                },
                canchaFutbol: {
                    datosCuriosos: [
                        "El fútbol moderno nació en Inglaterra en 1863, cuando se fundó la Football Association y se escribieron sus primeras reglas oficiales.",
                        "Un campo de fútbol reglamentario puede medir entre 90 y 120 metros de largo, según la FIFA.",
                        "El balón clásico de 32 paneles blancos y negros se popularizó en el Mundial de México 1970.",
                        "La palabra \"gol\" viene del inglés goal, que significa \"meta\" u \"objetivo\".",
                        "El primer partido de fútbol femenino documentado se jugó en Escocia en 1881.",
                        "Jugar deportes en equipo como el fútbol ayuda a desarrollar habilidades sociales y de trabajo en equipo desde la infancia.",
                        "A la cancha de fútbol también se le llama \"el rectángulo verde\", por su clásica forma y color.",
                        "El silbato del árbitro se empezó a usar en el fútbol inglés en 1878; antes, los árbitros solo levantaban un pañuelo.",
                        "El campo deportivo del colegio tiene un área total de 522 metros cuadrados, de los cuales 498 metros cuadrados corresponden a la superficie de juego.",
                        "La construcción de este escenario deportivo, exclusivo para los estudiantes, requirió un presupuesto directo de 105 millones de pesos.",
                        "El pasto sintético en canchas escolares se popularizó porque resiste mejor el uso constante que el pasto natural en espacios de alto tráfico."
                    ],
                    imagenes: [
                        "/images/colegio/cancha de futbol.png"
                    ]
                },
                baloncesto: {
                    datosCuriosos: [
                        "El baloncesto fue inventado en 1891 por James Naismith.",
                        "El primer partido se jugó utilizando una canasta de duraznos como objetivo.",
                        "El baloncesto originalmente se creó como una actividad para practicar bajo techo durante el invierno.",
                        "Una cancha de baloncesto tiene líneas que delimitan zonas específicas para diferentes jugadas.",
                        "El pase, el drible y el lanzamiento son algunas de las habilidades fundamentales del baloncesto.",
                        "El baloncesto es uno de los deportes escolares más practicados en todo el mundo."
                    ],
                    imagenes: [
                        "/images/colegio/cancha de baloncesto.png"
                    ]
                },
                polifuncional: {
                    datosCuriosos: [
                        "El polifuncional es el espacio cerrado más grande del colegio.",
                        "Está diseñado para realizar diferentes tipos de actividades y eventos institucionales.",
                        "Su nombre refleja que puede utilizarse para muchas funciones diferentes.",
                        "Puede adaptarse para conferencias, reuniones, actividades culturales y eventos escolares.",
                        "Es un espacio pensado para reunir a una gran cantidad de estudiantes y miembros de la comunidad educativa."
                    ],
                    imagenes: [
                        "/images/colegio/polifuncional.png"
                    ]
                },
                primaria: {
                    datosCuriosos: [
                        "La educación primaria suele abarcar los primeros 5 o 6 años de escolaridad.",
                        "La palabra \"primaria\" viene del latín primarius, que significa \"lo primero\".",
                        "Finlandia, reconocida por su sistema educativo, no empieza la educación formal hasta los 7 años.",
                        "Aprender a leer entre los 5 y 7 años es una de las etapas más determinantes.",
                        "El primer libro de texto ilustrado para niños fue muy importante en la educación.",
                        "En muchos países, la educación primaria es gratuita y obligatoria.",
                        "Los recreos y el juego libre en primaria son clave para el desarrollo.",
                        "La UNESCO considera la educación primaria universal una de sus metas.",
                        "Gran parte de los alumnos de primaria conviven en la sede principal.",
                        "El bloque de primaria destaca por recibir de forma activa a niños."
                    ],
                    imagenes: [
                        "/images/colegio/primaria derecha.png",
                        "/images/colegio/primaria-segunda-parte.png"
                    ]
                },
                coordinacionPrimaria: {
                    datosCuriosos: [
                        "La palabra \"auditorio\" viene del latín audire, que significa \"escuchar\".",
                        "Los auditorios escolares modernos se popularizaron a comienzos del siglo XX, como espacios para actos cívicos y culturales.",
                        "Un buen diseño acústico en un auditorio puede mejorar enormemente la comprensión de lo que se escucha, incluso sin micrófono.",
                        "La función de \"coordinación académica\" surgió para acompañar de cerca el proceso de aprendizaje de los estudiantes más pequeños.",
                        "Muchos colegios usan su auditorio tanto para actos formales como para actividades artísticas: teatro, danza y música.",
                        "El primer anfiteatro griego, precursor de los auditorios modernos, data del siglo V a. C.",
                        "La palabra \"coordinar\" viene del latín cum (junto) y ordinare (ordenar): literalmente, \"poner en orden junto a otros\".",
                        "En algunos colegios, el auditorio también funciona como polideportivo cubierto para los días de lluvia.",
                        "Los coordinadores de primaria gestionan la disciplina y las notas a través de un moderno sistema en línea, cglv.controlacademico.com, que conecta los reportes en tiempo real directamente con los padres de familia.",
                        "Antes de llegar a ser la rectora oficial, la magíster Isabel Rivero ejerció durante años como coordinadora académica de la institución.",
                        "Cada mes de febrero, los coordinadores de primaria organizan la elección digital del Personerito, la voz de los más pequeños ante el gobierno escolar.",
                        "El polifuncional es el espacio cerrado más grande del colegio, diseñado para albergar entre 600 y 750 personas sentadas durante los grandes eventos institucionales.",
                        "Su nombre, \"polifuncional\", refleja justamente eso: sirve para muchas funciones. Puede transformarse en cuestión de minutos, por ejemplo, en el salón de conferencias del proyecto \"Creo Mi Futuro\".",
                        "La figura del personero estudiantil existe en Colombia desde la Ley General de Educación de 1994, como representante de los derechos de los estudiantes."
                    ],
                    imagenes: [
                        "/images/colegio/coordinacion primaria.png"
                    ]
                },
                parqueInfantil: {
                    datosCuriosos: [
                        "El primer parque infantil público del mundo se inauguró en Manchester, Inglaterra, en 1859.",
                        "Jugar en parques infantiles ayuda a los niños a desarrollar el equilibrio, la coordinación y la confianza en sí mismos.",
                        "El tobogán, uno de los juegos más populares, se patentó por primera vez en Estados Unidos en 1922.",
                        "Los columpios modernos se inspiraron en los columpios rituales usados en fiestas de la antigua Grecia.",
                        "Los parques infantiles con superficies de caucho reciclado reducen significativamente el riesgo de lesiones por caídas.",
                        "El rojo y el azul, muy usados en los juegos infantiles, son de los colores que los niños distinguen más fácilmente a temprana edad.",
                        "Jugar libremente al aire libre está asociado con menores niveles de estrés y mejor concentración en clase.",
                        "Muchos parques infantiles escolares incluyen zonas de arena porque estimulan el juego sensorial y la creatividad.",
                        "Los primeros parques en escuelas usaban madera pesada y metal; hoy se construyen con plástico reciclado de alta densidad para evitar astillas y quemaduras por el sol.",
                        "Jugar solo 20 minutos en el parque escolar puede aumentar la concentración en clase y reducir drásticamente la ansiedad infantil.",
                        "La ley colombiana exige zonas de amortiguación, como arena o caucho, bajo los juegos infantiles para reducir el riesgo de golpes en caso de caída."
                    ],
                    imagenes: [
                        "/images/colegio/parque.png"
                    ]
                },
                entrada: {
                    datosCuriosos: [
                        "La entrada principal es uno de los puntos de acceso más importantes de la institución.",
                        "El acceso principal permite orientar a estudiantes, docentes y visitantes.",
                        "La entrada funciona como uno de los principales puntos de referencia del colegio.",
                        "El escudo representa parte de la identidad de nuestra institución.",
                        "La entrada es el primer espacio que muchos visitantes conocen al llegar al colegio."
                    ],
                    imagenes: [
                        "/images/entrada360.png"
                    ]
                },
                bloqueB: {
                    datosCuriosos: [
                        "La palabra \"profesor\" viene del latín professor, que significa \"el que declara públicamente\" su saber.",
                        "El 5 de octubre se celebra el Día Mundial de los Docentes, establecido por la UNESCO en 1994.",
                        "En Finlandia, ser profesor es una de las profesiones más respetadas y competitivas.",
                        "La tiza es uno de los símbolos clásicos del aula.",
                        "Un buen profesor puede influir en la trayectoria de vida de un estudiante.",
                        "La palabra \"maestro\" viene del latín magister.",
                        "Los primeros gremios de maestros organizados en Europa datan de la Edad Media.",
                        "Enseñar también significa aprender.",
                        "En Colombia, ejercer la docencia requiere formación correspondiente.",
                        "La calidad del profesorado influye en el rendimiento escolar."
                    ],
                    imagenes: [
                        "/images/colegio/bloque b.png",
                        "/images/colegio/bloque B-partedos.png",
                        "/images/colegio/bloque B-partetres.png"
                    ]
                },
                bloqueA: {
                    datosCuriosos: [
                        "El Bloque A es uno de los espacios académicos de la institución.",
                        "Sus aulas están destinadas al desarrollo de diferentes actividades de aprendizaje.",
                        "Los salones permiten realizar actividades individuales y trabajos en grupo.",
                        "El aprendizaje en el aula combina la explicación de los profesores con la participación de los estudiantes.",
                        "Los espacios académicos también pueden utilizarse para exposiciones, proyectos y actividades escolares.",
                        "El trabajo en equipo dentro del aula ayuda a fortalecer la comunicación y la colaboración entre los estudiantes.",
                        "Las aulas son espacios fundamentales para el desarrollo de las actividades académicas durante la jornada escolar.",
                        "La organización de los espacios permite que diferentes grupos puedan desarrollar sus actividades de manera adecuada.",
                        "El Bloque A forma parte de la infraestructura que permite desarrollar las actividades educativas de la institución.",
                        "Cada aula cumple una función importante dentro de la experiencia educativa de los estudiantes."
                    ],
                    imagenes: [
                        "/images/colegio/bloque A-parteuno.png",
                        "/images/colegio/bloque A-partedos.png",
                        "/images/colegio/bloque A-partetres.png",
                        "/images/colegio/bloque A-partecuatro.png"
                    ]
                },
                laboratorio: {
                    datosCuriosos: [
                        "El laboratorio de Física y Química es un espacio destinado al aprendizaje práctico de las ciencias.",
                        "Los experimentos permiten observar de manera directa diferentes fenómenos físicos y químicos.",
                        "La Física estudia fenómenos relacionados con la materia, la energía, el movimiento y las fuerzas.",
                        "La Química estudia la composición, propiedades y transformaciones de la materia.",
                        "El trabajo experimental permite relacionar los conceptos aprendidos en clase con situaciones prácticas.",
                        "Los instrumentos de laboratorio ayudan a realizar mediciones y observaciones de manera controlada.",
                        "Los laboratorios escolares permiten desarrollar habilidades como la observación, el análisis y la formulación de hipótesis.",
                        "Las prácticas experimentales también ayudan a desarrollar el trabajo en equipo.",
                        "La seguridad es una parte fundamental de cualquier actividad realizada dentro de un laboratorio.",
                        "El laboratorio es un espacio donde la curiosidad y la experimentación ayudan a comprender mejor las ciencias."
                    ],
                    imagenes: [
                        "/images/colegio/laboratorios.png"
                    ]
                },
                aulasEspecializadas: {
                    datosCuriosos: [
                        "La primera computadora personal pensada para uso educativo, la Apple II, llegó a las aulas escolares en 1977.",
                        "Pintar y hacer manualidades en la infancia estimula la creatividad y también el desarrollo motor fino.",
                        "La palabra \"aula\" viene del latín aula, que significaba \"sala\" o \"patio principal\" en la antigua Roma.",
                        "Leonardo da Vinci llevaba siempre consigo un cuaderno de bocetos, una costumbre que hoy se sigue fomentando en las clases de arte.",
                        "La primera aula de informática escolar en muchos países se implementó recién en la década de 1980.",
                        "Los colores primarios (rojo, azul y amarillo) son la base con la que se enseña teoría del color en la mayoría de las clases de pintura.",
                        "Programar desde temprana edad ayuda a desarrollar el pensamiento lógico y la resolución de problemas.",
                        "El primer \"mouse\" de computador, inventado en 1964, era de madera y tenía solo un botón.",
                        "Las aulas de arte y música surgieron como espacios separados apenas a comienzos del siglo XX.",
                        "Tocar un instrumento musical desde la niñez se ha asociado con un mejor desarrollo de la memoria y la coordinación motora."
                    ],
                    imagenes: [
                        "/images/colegio/salas especializadas.png",
                        "/images/colegio/salas_especializadas_360.png"
                    ]
                }
            };

            return window.__portalCampusModalCatalog;
        }

        function inicializarModalCanvas(modal, accion, catalogo) {
            var imagenes = Array.isArray(catalogo && catalogo.imagenes) ? catalogo.imagenes : [];
            var datosCuriosos = Array.isArray(catalogo && catalogo.datosCuriosos) ? catalogo.datosCuriosos : [];
            var wrap = modal.querySelector('#' + accion + 'ZoomWrap');
            var panoEl = modal.querySelector('#' + accion + 'ZoomImg');
            var chatBody = modal.querySelector('#' + accion + 'ChatBody');
            var chatBtn = modal.querySelector('#' + accion + 'ChatBtn');
            var gallery = modal.querySelector('#' + accion + 'Gallery');
            var prevBtn = gallery ? gallery.querySelector('.campus-image-modal__nav--prev') : null;
            var nextBtn = gallery ? gallery.querySelector('.campus-image-modal__nav--next') : null;
            var countEl = modal.querySelector('#' + accion + 'GalleryCount');
            if (!wrap || !panoEl || !modal) return;

            var galleryIndex = 0;
            var panoViewer = null;

            if (gallery) {
                var tieneVarias = imagenes.length > 1;
                gallery.classList.toggle('campus-image-modal__gallery--single', !tieneVarias);
            }

            function cargarPanorama(indice) {
                if (!imagenes.length) return;
                galleryIndex = (indice + imagenes.length) % imagenes.length;
                if (countEl) countEl.textContent = (galleryIndex + 1) + ' / ' + imagenes.length;
                if (panoViewer) {
                    panoViewer.destroy();
                    panoViewer = null;
                }
                if (window.pannellum && window.pannellum.viewer) {
                    panoViewer = window.pannellum.viewer(panoEl.id, {
                        type: 'equirectangular',
                        panorama: imagenes[galleryIndex],
                        autoLoad: true,
                        compass: false,
                        showZoomCtrl: true,
                        showFullscreenCtrl: true,
                        hfov: 100
                    });
                }
            }

            if (prevBtn) prevBtn.addEventListener('click', function () { cargarPanorama(galleryIndex - 1); });
            if (nextBtn) nextBtn.addEventListener('click', function () { cargarPanorama(galleryIndex + 1); });

            function onKeyNav(ev) {
                if (!imagenes || imagenes.length < 2) return;
                if (ev.key === 'ArrowLeft') { ev.preventDefault(); cargarPanorama(galleryIndex - 1); }
                else if (ev.key === 'ArrowRight') { ev.preventDefault(); cargarPanorama(galleryIndex + 1); }
            }

            var usados = [];
            function siguienteDato() {
                if (!datosCuriosos.length) return 'Aquí puedes explorar este espacio en 360° y consultar información del lugar.';
                if (usados.length >= datosCuriosos.length) usados = [];
                var restantes = datosCuriosos.filter(function (_, i) { return usados.indexOf(i) === -1; });
                var elegido = restantes[Math.floor(Math.random() * restantes.length)];
                usados.push(datosCuriosos.indexOf(elegido));
                return elegido;
            }

            function mostrarTyping() {
                if (!chatBody) return;
                var typing = document.createElement('div');
                typing.className = 'chat-msg chat-msg--bot';
                typing.id = accion + 'Typing';
                typing.innerHTML = '<span class="chat-msg__avatar">' + (window.PortalMascot && window.PortalMascot.svg ? window.PortalMascot.svg('thinking') : '🤖') + '</span>' +
                    '<div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
                chatBody.appendChild(typing);
                chatBody.scrollTop = chatBody.scrollHeight;
            }

            function crearMensajeBot(texto) {
                var msg = document.createElement('div');
                msg.className = 'chat-msg chat-msg--bot';

                var avatar = document.createElement('span');
                avatar.className = 'chat-msg__avatar';
                avatar.innerHTML = window.PortalMascot && window.PortalMascot.svg ? window.PortalMascot.svg('idle') : '🤖';
                msg.appendChild(avatar);

                var bubble = document.createElement('div');
                bubble.className = 'chat-bubble';
                var parrafo = document.createElement('span');
                parrafo.textContent = texto;
                bubble.appendChild(parrafo);

                if (window.PortalVoice && window.PortalVoice.crearVoicePlayer) {
                    var player = window.PortalVoice.crearVoicePlayer(texto, { autoplay: true });
                    if (player) bubble.appendChild(player);
                }

                msg.appendChild(bubble);
                return msg;
            }

            function mostrarDato() {
                if (!chatBody) return;
                if (chatBtn) chatBtn.disabled = true;
                mostrarTyping();
                window.setTimeout(function () {
                    var typing = document.getElementById(accion + 'Typing');
                    if (typing) typing.remove();
                    var mensaje = crearMensajeBot(siguienteDato());
                    chatBody.appendChild(mensaje);
                    if (window.PortalMascot && window.PortalMascot.setState) {
                        window.PortalMascot.setState(mensaje.querySelector('.mascot'), 'done');
                    }
                    chatBody.scrollTop = chatBody.scrollHeight;
                    if (chatBtn) chatBtn.disabled = false;
                }, 650);
            }

            modal.addEventListener('shown.bs.modal', function () {
                cargarPanorama(0);
                document.addEventListener('keydown', onKeyNav);
                if (chatBody) chatBody.innerHTML = '';
                usados = [];
                mostrarDato();
            });

            modal.addEventListener('hidden.bs.modal', function () {
                document.removeEventListener('keydown', onKeyNav);
                if (panoViewer && typeof panoViewer.destroy === 'function') {
                    panoViewer.destroy();
                    panoViewer = null;
                }
            });

            if (chatBtn) {
                chatBtn.addEventListener('click', mostrarDato);
            }
        }

        function abrirModal360(accion) {
            if (!accion) return;
            const modalEl = document.getElementById(accion + "Modal");
            if (modalEl) {
                const modalInstance = window.bootstrap && window.bootstrap.Modal
                    ? window.bootstrap.Modal.getOrCreateInstance(modalEl)
                    : null;

                if (modalInstance) {
                    modalInstance.show();
                } else {
                    modalEl.classList.add('show');
                    modalEl.style.display = 'block';
                }
                return;
            }

            const catalogo = construirCatalogoCampus()[accion];
            if (!catalogo) return;

            const modal = document.createElement('div');
            modal.id = accion + 'Modal';
            modal.className = 'modal fade';
            modal.setAttribute('tabindex', '-1');
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = [
                '<div class="modal-dialog modal-xl modal-dialog-centered">',
                '  <div class="modal-content campus-image-modal">',
                '    <button type="button" class="campus-image-modal__close" data-bs-dismiss="modal" aria-label="Cerrar">✕</button>',
                '    <div class="campus-image-modal__body">',
                '      <div class="campus-image-modal__gallery" id="' + accion + 'Gallery">',
                '        <div class="campus-image-modal__zoom-wrap" id="' + accion + 'ZoomWrap">',
                '          <div class="campus-image-modal__pano" id="' + accion + 'ZoomImg" role="img" aria-label="Vista 360° de ' + (accion || 'este espacio') + '"></div>',
                '        </div>',
                '        <button type="button" class="campus-image-modal__nav campus-image-modal__nav--prev" aria-label="Imagen anterior">‹</button>',
                '        <button type="button" class="campus-image-modal__nav campus-image-modal__nav--next" aria-label="Imagen siguiente">›</button>',
                '        <span class="campus-image-modal__gallery-count" id="' + accion + 'GalleryCount">1 / 1</span>',
                '      </div>',
                '      <div class="campus-image-modal__chat">',
                '        <div class="campus-image-modal__chat-body" id="' + accion + 'ChatBody"></div>',
                '        <div class="campus-image-modal__chat-actions">',
                '          <button type="button" class="chat-chip" id="' + accion + 'ChatBtn">🎲 Cuéntame otro dato curioso</button>',
                '        </div>',
                '      </div>',
                '    </div>',
                '  </div>',
                '</div>'
            ].join('');

            document.body.appendChild(modal);
            inicializarModalCanvas(modal, accion, catalogo);

            if (window.bootstrap && window.bootstrap.Modal) {
                window.bootstrap.Modal.getOrCreateInstance(modal).show();
            } else {
                modal.classList.add('show');
                modal.style.display = 'block';
            }
        }

        function mostrarAccion360(botWrap, accion) {
            const bubble = botWrap && botWrap.querySelector(".chat-bubble");
            if (!bubble || !accion) return;

            const yaExiste = Array.from(bubble.querySelectorAll(".chat-chip")).some((chip) =>
                (chip.textContent || "").toLowerCase().includes("ver en 360")
            );
            if (yaExiste) return;

            // Mantiene la acción visible en el último mensaje del chatbot, con el
            // texto corto “ver en 360” para que el usuario acceda al visor panorámico.
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chat-chip";
            btn.textContent = "ver en 360";
            btn.setAttribute("aria-label", "Ver en 360");
            btn.title = "Ver en 360";
            btn.addEventListener("click", () => abrirModal360(accion));
            bubble.appendChild(btn);
            body.scrollTop = body.scrollHeight;
        }

    }

    /* ------------------------------------------------------------------ */
    /* Sesión del asistente: iniciar sesión (nombre + curso) o invitado     */
    /* ------------------------------------------------------------------ */

    function initAssistantAuth() {
        const body = document.getElementById("assistantBody");
        const loginChip = document.getElementById("assistantLoginChip");
        const guestChip = document.getElementById("assistantGuestChip");
        if (!body || (!loginChip && !guestChip)) return;

        const headerAvatar = document.getElementById("assistantAvatar");
        const headerMascot = headerAvatar && headerAvatar.querySelector(".mascot");
        const navAvatar = document.getElementById("navUserAvatar");
        const navName = document.getElementById("navUserName");

        function scrollDown() {
            body.scrollTop = body.scrollHeight;
        }

        function actualizarNavbar(nombre) {
            if (navAvatar) navAvatar.textContent = nombre.charAt(0).toUpperCase();
            if (navName) navName.textContent = nombre;
        }

        function appendUserChoice(texto) {
            const wrap = document.createElement("div");
            wrap.className = "chat-msg chat-msg--user";
            const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            wrap.innerHTML = '<span class="chat-msg__avatar">🧑</span><div class="chat-bubble"></div>';
            const bubble = wrap.querySelector(".chat-bubble");

            const textEl = document.createElement("span");
            textEl.className = "chat-bubble__text";
            textEl.textContent = texto;
            bubble.appendChild(textEl);

            const timeEl = document.createElement("span");
            timeEl.className = "chat-bubble__time";
            timeEl.textContent = time;
            const tick = document.createElement("span");
            tick.className = "chat-bubble__tick";
            tick.textContent = "✓✓";
            timeEl.appendChild(tick);
            bubble.appendChild(timeEl);

            body.appendChild(wrap);
            scrollDown();
        }

        function appendBotText(texto) {
            const wrap = document.createElement("div");
            wrap.className = "chat-msg chat-msg--bot";
            const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            wrap.innerHTML = '<span class="chat-msg__avatar">' + PortalMascot.svg("idle") + "</span><div class=\"chat-bubble\"></div>";
            const bubble = wrap.querySelector(".chat-bubble");

            const textEl = document.createElement("span");
            textEl.className = "chat-bubble__text";
            textEl.textContent = texto;
            bubble.appendChild(textEl);

            const player = PortalVoice.crearVoicePlayer(texto, { autoplay: true });
            if (player) bubble.appendChild(player);

            const timeEl = document.createElement("span");
            timeEl.className = "chat-bubble__time";
            timeEl.textContent = time;
            bubble.appendChild(timeEl);

            body.appendChild(wrap);
            scrollDown();
            PortalMascot.setState(wrap.querySelector(".mascot"), "done");
            if (headerMascot) PortalMascot.setState(headerMascot, "done");
            return wrap;
        }

        function quitarOpcionesIniciales() {
            const suggestions = document.getElementById("assistantSuggestions");
            if (suggestions) suggestions.remove();
        }

        function vincularSugerencias(container) {
            container.querySelectorAll(".chat-chip[data-question]").forEach((chip) => {
                chip.addEventListener("click", () => {
                    const form = document.getElementById("assistantForm");
                    const input = document.getElementById("assistantInput");
                    if (!form || !input) return;
                    input.value = chip.dataset.question;
                    form.dispatchEvent(new Event("submit", { cancelable: true }));
                });
            });
        }

        function mostrarSugerenciasNormales() {
            const wrap = document.createElement("div");
            wrap.className = "chat-suggestions";
            wrap.id = "assistantSuggestions";
            wrap.innerHTML =
                '<button type="button" class="chat-chip" data-question="¿Quién es el profesor de Matemáticas?">¿Profesor de Matemáticas?</button>' +
                '<button type="button" class="chat-chip" data-question="¿Dónde queda la biblioteca?">¿Dónde queda la biblioteca?</button>' +
                '<button type="button" class="chat-chip" data-question="¿Qué actividades hay hoy en el cronograma?">Actividades de hoy</button>';
            body.appendChild(wrap);
            vincularSugerencias(wrap);
            scrollDown();
        }

        function cargarListaCursos() {
            if (document.getElementById("assistantCursosList")) return;
            const datalist = document.createElement("datalist");
            datalist.id = "assistantCursosList";
            document.body.appendChild(datalist);
            fetch("/api/cursos")
                .then((res) => res.json())
                .then((cursos) => {
                    (cursos || []).forEach((c) => {
                        const option = document.createElement("option");
                        option.value = c.nombre;
                        datalist.appendChild(option);
                    });
                })
                .catch(() => {});
        }

        function mostrarFormularioLogin() {
            quitarOpcionesIniciales();

            const wrap = document.createElement("div");
            wrap.className = "chat-msg chat-msg--bot";
            wrap.innerHTML = '<span class="chat-msg__avatar">' + PortalMascot.svg("idle") + "</span><div class=\"chat-bubble\"></div>";
            const bubble = wrap.querySelector(".chat-bubble");

            const intro = document.createElement("span");
            intro.className = "chat-bubble__text";
            intro.textContent = "Perfecto, dime tu nombre y tu curso:";
            bubble.appendChild(intro);

            const form = document.createElement("form");
            form.className = "chat-login-form";

            const nombreInput = document.createElement("input");
            nombreInput.type = "text";
            nombreInput.placeholder = "Tu nombre";
            nombreInput.required = true;
            nombreInput.autocomplete = "off";

            const cursoInput = document.createElement("input");
            cursoInput.type = "text";
            cursoInput.placeholder = "Tu curso (ej. 5A)";
            cursoInput.required = true;
            cursoInput.autocomplete = "off";
            cursoInput.setAttribute("list", "assistantCursosList");

            const submitBtn = document.createElement("button");
            submitBtn.type = "submit";
            submitBtn.textContent = "Entrar";

            const error = document.createElement("span");
            error.className = "chat-login-form__error";

            form.appendChild(nombreInput);
            form.appendChild(cursoInput);
            form.appendChild(submitBtn);
            form.appendChild(error);
            bubble.appendChild(form);

            body.appendChild(wrap);
            scrollDown();
            nombreInput.focus();
            cargarListaCursos();

            form.addEventListener("submit", (event) => {
                event.preventDefault();
                const nombre = nombreInput.value.trim();
                const curso = cursoInput.value.trim();
                error.textContent = "";
                if (!nombre || !curso) return;

                submitBtn.disabled = true;
                submitBtn.textContent = "Entrando...";
                if (headerMascot) PortalMascot.setState(headerMascot, "thinking");

                fetch("/api/asistente/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre, curso }),
                })
                    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                    .then(({ ok, data }) => {
                        if (!ok) {
                            error.textContent = data.error || "No pude iniciar sesión.";
                            submitBtn.disabled = false;
                            submitBtn.textContent = "Entrar";
                            return;
                        }
                        form.remove();
                        actualizarNavbar(data.nombre);
                        appendBotText(data.mensaje);
                        mostrarSugerenciasNormales();
                    })
                    .catch(() => {
                        error.textContent = "Hubo un problema de conexión. Intenta de nuevo.";
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Entrar";
                    });
            });
        }

        if (loginChip) {
            loginChip.addEventListener("click", () => {
                appendUserChoice("Quiero iniciar sesión");
                mostrarFormularioLogin();
            });
        }

        if (guestChip) {
            guestChip.addEventListener("click", () => {
                appendUserChoice("Continuar como invitado");
                quitarOpcionesIniciales();
                if (headerMascot) PortalMascot.setState(headerMascot, "thinking");

                fetch("/api/asistente/invitado", { method: "POST" })
                    .then((res) => res.json())
                    .then((data) => {
                        actualizarNavbar("Invitado");
                        appendBotText(data.mensaje || "Listo, sigues como invitado.");
                        mostrarSugerenciasNormales();
                    })
                    .catch(() => {
                        appendBotText("Hubo un problema de conexión. Intenta de nuevo.");
                    });
            });
        }
    }

    function initNavLogout() {
        const btn = document.getElementById("navLogoutBtn");
        if (!btn) return;
        btn.addEventListener("click", () => {
            fetch("/api/asistente/logout", { method: "POST" }).finally(() => {
                window.location.reload();
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Guía paso a paso (onboarding) — se muestra sola a usuarios nuevos y  */
    /* puede reabrirse en cualquier momento desde el botón "🧭 Guía" del    */
    /* navbar (ver #tourStartBtn en base.html).                            */
    /* ------------------------------------------------------------------ */
    function initOnboardingTour() {
        const overlay = document.getElementById("tourOverlay");
        if (!overlay) return;

        const spotlight = document.getElementById("tourSpotlight");
        const tooltip = document.getElementById("tourTooltip");
        const stepLabel = document.getElementById("tourStepLabel");
        const titleEl = document.getElementById("tourTitle");
        const textEl = document.getElementById("tourText");
        const dotsEl = document.getElementById("tourDots");
        const prevBtn = document.getElementById("tourPrevBtn");
        const nextBtn = document.getElementById("tourNextBtn");
        const skipBtn = document.getElementById("tourSkipBtn");
        const startBtn = document.getElementById("tourStartBtn");
        if (!spotlight || !tooltip || !prevBtn || !nextBtn || !skipBtn) return;

        const sidebar = document.getElementById("appSidebar");
        const sidebarBackdrop = document.getElementById("sidebarBackdrop");
        const assistantPanel = document.getElementById("assistantPanel");
        const STORAGE_KEY = "portalTourVisto";

        function abrirSidebarParaTour() {
            if (sidebar) sidebar.classList.add("is-open");
            if (sidebarBackdrop) sidebarBackdrop.classList.add("is-open");
        }

        function cerrarSidebarDeTour() {
            if (sidebar) sidebar.classList.remove("is-open");
            if (sidebarBackdrop) sidebarBackdrop.classList.remove("is-open");
        }

        function abrirAsistenteParaTour() {
            if (!assistantPanel) return;
            assistantPanel.classList.add("is-open");
            document.body.classList.add("assistant-open");
        }

        function cerrarAsistenteDeTour() {
            if (!assistantPanel) return;
            assistantPanel.classList.remove("is-open");
            document.body.classList.remove("assistant-open");
        }

        // Todos los elementos referenciados viven en base.html, así que la
        // guía funciona igual en cualquier página del portal.
        const pasos = [
            {
                selector: ".brand",
                titulo: "¡Bienvenido a Portal Escolar! 🎓",
                texto: "Te mostramos en unos pasos cómo moverte por la plataforma. Desde aquí siempre puedes volver al inicio.",
            },
            {
                selector: "#sidebarToggle",
                titulo: "Menú de navegación",
                texto: "Toca este botón para abrir el menú con todas las secciones del colegio.",
                antes: abrirSidebarParaTour,
            },
            {
                selector: "#appSidebar .side-nav",
                titulo: "Explora el colegio",
                texto: "Aquí encuentras Cursos, Materias, Profesores, Ubicaciones y el Cronograma.",
            },
            {
                selector: ".header-cta",
                titulo: "Modo aventura",
                texto: "¿Prefieres aprender jugando? Entra al Modo aventura desde este botón.",
                antes: cerrarSidebarDeTour,
            },
            {
                selector: "#soundToggleBtn",
                titulo: "Sonido de fondo",
                texto: "Con este botón puedes silenciar o activar la música de fondo del portal.",
            },
            {
                selector: "#assistantFab",
                titulo: "Asistente virtual",
                texto: "¿Tienes dudas? Nuestro asistente responde tus preguntas desde cualquier página del portal.",
            },
            {
                selector: "#assistantPanel",
                titulo: "Chatea con el asistente",
                texto: "Escribe o usa el micrófono para preguntarle lo que quieras sobre el colegio.",
                antes: abrirAsistenteParaTour,
            },
        ];

        if (startBtn) {
            pasos.push({
                selector: "#tourStartBtn",
                titulo: "Vuelve a ver esta guía",
                texto: "Puedes repetir este recorrido cuando quieras tocando este botón.",
                antes: cerrarAsistenteDeTour,
            });
        }

        let pasoActual = 0;
        let activo = false;

        function renderDots() {
            if (!dotsEl) return;
            dotsEl.innerHTML = "";
            pasos.forEach((_, i) => {
                const dot = document.createElement("span");
                if (i === pasoActual) dot.classList.add("is-active");
                dotsEl.appendChild(dot);
            });
        }

        function posicionar(target) {
            const rect = target.getBoundingClientRect();
            const pad = 8;
            spotlight.style.top = (rect.top - pad) + "px";
            spotlight.style.left = (rect.left - pad) + "px";
            spotlight.style.width = (rect.width + pad * 2) + "px";
            spotlight.style.height = (rect.height + pad * 2) + "px";

            tooltip.classList.remove("is-visible");
            // Se calcula en el siguiente frame para medir el tooltip ya
            // con el texto del paso actual puesto.
            requestAnimationFrame(() => {
                const tw = tooltip.offsetWidth;
                const th = tooltip.offsetHeight;
                const margen = 14;

                let top = rect.bottom + margen;
                if (top + th > window.innerHeight - 8) {
                    top = rect.top - th - margen;
                }
                top = Math.max(8, Math.min(top, window.innerHeight - th - 8));

                let left = rect.left + rect.width / 2 - tw / 2;
                left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));

                tooltip.style.top = top + "px";
                tooltip.style.left = left + "px";
                tooltip.classList.add("is-visible");
            });
        }

        function mostrarPaso(index) {
            const paso = pasos[index];
            const target = paso && document.querySelector(paso.selector);

            if (!paso) return terminar();
            if (!target) {
                // El elemento no existe en esta página (no debería pasar,
                // pero por si acaso no se deja la guía atascada).
                return index + 1 < pasos.length ? mostrarPaso(index + 1) : terminar();
            }

            pasoActual = index;
            if (stepLabel) stepLabel.textContent = "Paso " + (index + 1) + " de " + pasos.length;
            titleEl.textContent = paso.titulo;
            textEl.textContent = paso.texto;
            renderDots();

            prevBtn.disabled = index === 0;
            nextBtn.textContent = index === pasos.length - 1 ? "Finalizar" : "Siguiente";

            if (paso.antes) {
                paso.antes();
                setTimeout(() => posicionar(target), 300); // espera la transición del sidebar
            } else {
                requestAnimationFrame(() => posicionar(target));
            }
        }

        function siguiente() {
            if (pasoActual + 1 >= pasos.length) return terminar();
            mostrarPaso(pasoActual + 1);
        }

        function anterior() {
            if (pasoActual === 0) return;
            mostrarPaso(pasoActual - 1);
        }

        function iniciar() {
            if (activo) return;
            activo = true;
            overlay.classList.add("is-open");
            document.body.classList.add("tour-open");
            mostrarPaso(0);
        }

        function terminar() {
            activo = false;
            overlay.classList.remove("is-open");
            tooltip.classList.remove("is-visible");
            document.body.classList.remove("tour-open");
            cerrarSidebarDeTour();
            cerrarAsistenteDeTour();
            try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) {}
        }

        nextBtn.addEventListener("click", siguiente);
        prevBtn.addEventListener("click", anterior);
        skipBtn.addEventListener("click", terminar);
        if (startBtn) startBtn.addEventListener("click", iniciar);

        window.addEventListener("resize", () => {
            if (!activo) return;
            const paso = pasos[pasoActual];
            const target = paso && document.querySelector(paso.selector);
            if (target) posicionar(target);
        });

        // Usuarios nuevos: la guía se abre sola en su primera visita.
        let yaVisto = true;
        try { yaVisto = !!localStorage.getItem(STORAGE_KEY); } catch (e) {}
        if (!yaVisto) setTimeout(iniciar, 1200);
    }

    /* ------------------------------------------------------------------ */
    /* Sonido de fondo — reproduce en loop app/audio/sound.mp3, siguiendo   */
    /* la preferencia de sonido definida más arriba (menú 🔊 del navbar).   */
    /* Solo suena en el modo "todo"; en "sin-fondo" y "silencio" se pausa.  */
    /* ------------------------------------------------------------------ */
    const TEXTOS_MODO = {
        todo: { icono: "🔊", etiqueta: "Sonido: todo activado" },
        "sin-fondo": { icono: "🎧", etiqueta: "Sonido: solo efectos, sin música de fondo" },
        silencio: { icono: "🔇", etiqueta: "Sonido silenciado" },
    };

    function initAmbientSound() {
        const btn = document.getElementById("soundToggleBtn");
        const sonido = document.getElementById("bgSound");
        const opciones = document.querySelectorAll("[data-sound-mode]");
        if (!btn || !sonido) return;

        let modo = leerModoAudio();
        sonido.volume = 0.2;

        function actualizarUI() {
            const info = TEXTOS_MODO[modo] || TEXTOS_MODO.todo;
            btn.textContent = info.icono;
            const etiqueta = info.etiqueta + " — clic para cambiarlo";
            btn.title = etiqueta;
            btn.setAttribute("aria-label", etiqueta);
            opciones.forEach((opcion) => {
                const activa = opcion.dataset.soundMode === modo;
                opcion.classList.toggle("is-active", activa);
                opcion.setAttribute("aria-checked", activa ? "true" : "false");
            });
        }

        function aplicarModo() {
            if (modo === "todo") {
                sonido.play().catch(() => {}); // el navegador puede seguir bloqueando hasta un gesto real
            } else {
                sonido.pause();
            }
        }

        // Los navegadores bloquean el audio automático: se intenta reproducir
        // en la primera interacción del usuario con la página.
        function alPrimerGesto() {
            aplicarModo();
            document.removeEventListener("click", alPrimerGesto);
            document.removeEventListener("keydown", alPrimerGesto);
            document.removeEventListener("touchstart", alPrimerGesto);
        }
        document.addEventListener("click", alPrimerGesto, { once: true });
        document.addEventListener("keydown", alPrimerGesto, { once: true });
        document.addEventListener("touchstart", alPrimerGesto, { once: true });

        opciones.forEach((opcion) => {
            opcion.addEventListener("click", () => {
                modo = opcion.dataset.soundMode;
                guardarModoAudio(modo);
                actualizarUI();
                aplicarModo();
            });
        });

        // Otra pestaña/ventana (misma sesión de navegador) cambió la preferencia.
        window.addEventListener("storage", (event) => {
            if (event.key !== PORTAL_AUDIO_KEY) return;
            modo = leerModoAudio();
            actualizarUI();
            aplicarModo();
        });

        actualizarUI();
    }
})();