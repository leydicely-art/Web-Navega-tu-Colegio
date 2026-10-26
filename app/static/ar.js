/**
 * Modo AR — Portal Escolar
 * -----------------------------------------------------------------------
 * Al activar la cámara, León (el león mascota del colegio) NO aparece
 * solo. El flujo tiene dos fases, siempre en este orden:
 *
 *  Fase 1 — el QR: primero hace falta reconocer un código QR del colegio
 *  (p. ej. el de /ar/demo/biblioteca). Si la URL ya trae uno resuelto (se
 *  abrió el enlace de un QR físico, escaneado con la cámara del sistema, o
 *  el botón "Abrir en Modo AR" de la página de ejemplo) se usa ese; si no,
 *  escanearQR() pide la cámara "plana" (getUserMedia) y lee cada frame con
 *  jsQR hasta reconocer uno válido. Esta fase es igual en cualquier
 *  dispositivo/navegador: es deliberadamente independiente de qué motor de
 *  AR se use después, porque una sesión WebXR ("AR anclada al mundo real")
 *  maneja el passthrough de cámara por dentro y no expone esos frames a la
 *  página — si el escaneo dependiera del motor, en Android con WebXR el QR
 *  nunca se leería.
 *
 *  Fase 2 — la posición: recién cuando ese QR se resuelve contra el backend
 *  (ver resolverPayload/aplicarPersonalizacion) se elige y arranca el motor
 *  de AR, ya con los datos de la experiencia (nombre/diálogo/modelo)
 *  cargados:
 *
 *  1) AR real (WebXR, hoy sobre todo Android/Chrome vía ARCore): usa
 *     hit-test para detectar una superficie (suelo/mesa) y recién ahí pide
 *     la posición (ver onXRFrame); una vez estable, ancla a León con un
 *     XRAnchor y lo renderiza con la cámara/perspectiva reales de la sesión
 *     XR. Así se puede rodear en 360° y León mantiene su sitio. Incluye
 *     sombra proyectada real (shadow map), estimación de luz del entorno
 *     (WebXR Lighting Estimation, si el dispositivo la ofrece) y una
 *     oclusión aproximada (no por píxel) basada en Depth Sensing, cuando el
 *     hardware la soporta.
 *
 *  2) AR simulada (iPhone/Safari y cualquier navegador sin WebXR AR): no
 *     hay noción de "posición" que pedir por separado — León aparece de una
 *     vez, a una distancia fija frente a ti, apenas arranca este motor (ya
 *     con el QR resuelto). Usa getUserMedia + un canvas de Three.js
 *     superpuesto al video (reutilizando, si puede, el mismo stream que
 *     abrió escanearQR()). No hay detección real de superficie ni oclusión:
 *     la cámara virtual gira con el giroscopio del teléfono para dar
 *     sensación de que León se queda fijo en el espacio. Es una limitación
 *     de la plataforma (Safari no expone WebXR AR), no de este código.
 */

(() => {
    "use strict";

    // -- Referencias del DOM --------------------------------------------
    const arStage = document.getElementById("arStage");
    const video = document.getElementById("arVideo");
    const overlayCanvas = document.getElementById("arOverlay");
    const qrCanvas = document.getElementById("arQrCanvas");
    const hud = document.getElementById("arHud");
    const modeBadge = document.getElementById("arModeBadge");
    const reubicarBtn = document.getElementById("arReubicarBtn");
    const xrConfirmPanel = document.getElementById("arXrConfirm");
    const xrConfirmBtn = document.getElementById("arXrConfirmBtn");
    const errorBox = document.getElementById("arError");
    const errorText = document.getElementById("arErrorText");
    const errorDetail = document.getElementById("arErrorDetail");
    const panel = document.getElementById("arPanel");
    const panelNombre = document.getElementById("arPanelNombre");
    const panelUbicacion = document.getElementById("arPanelUbicacion");
    const dialogoEl = document.getElementById("arPanelDialogo");
    const audioBadge = document.getElementById("arPanelAudio");
    const interactBtn = document.getElementById("arInteractBtn");
    const rescanBtn = document.getElementById("arRescanBtn");
    const torchBtn = document.getElementById("arTorchBtn");
    const voiceFab = document.getElementById("arVoiceFab");
    const voiceFabIcon = document.getElementById("arVoiceFabIcon");
    const scanFab = document.getElementById("arScanFab");
    const manualToggle = document.getElementById("arManualToggle");
    const manualForm = document.getElementById("arManualForm");
    const manualInput = document.getElementById("arManualInput");
    const qrTooltip = document.getElementById("arQrTooltip");
    const qrTooltipText = document.getElementById("arQrTooltipText");
    const qrTooltipClose = document.getElementById("arQrTooltipClose");

    if (!arStage) return; // no estamos en /ar

    const qrCtx = qrCanvas.getContext("2d", { willReadFrequently: true });

    // Segundo lienzo para un "zoom digital" del centro del frame: si el QR
    // ocupa solo una porción chica de la imagen (p. ej. una pantalla
    // fotografiada desde cierta distancia, como al leer un QR mostrado en una
    // laptop), recortar y agrandar esa zona central le da al decodificador
    // más píxeles "útiles" por módulo que el frame completo. Se usa solo
    // como reintento, cuando el frame completo no dio resultado (ver
    // detectarQR).
    const qrCropCanvas = document.createElement("canvas");
    qrCropCanvas.width = 640;
    qrCropCanvas.height = 640;
    const qrCropCtx = qrCropCanvas.getContext("2d", { willReadFrequently: true });

    // Lienzo diminuto para muestrear el color medio del video (luz ambiente
    // aproximada) en el modo simulado. No se usa en WebXR (ahí hay
    // estimación de luz real).
    const colorCanvas = document.createElement("canvas");
    colorCanvas.width = 8;
    colorCanvas.height = 6;
    const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });

    // -- Constantes de animación y anclaje -----------------------------------
    const LION_SCALE_PROCEDURAL = 0.6; // diámetro aprox. de la cara de repuesto (primitivas), en metros
    const LION_SCALE_MODELO = 1.15; // el .glb real ya viene recortado más "compacto"; necesita más escala para el mismo tamaño de cabeza
    const LION_HOVER_Y = 0.32; // altura a la que "flota" la cara sobre el punto anclado (efecto asistente holográfico)
    // Modelo real intacto (personaje de cuerpo completo generado por IA, sin
    // recortar ni reducir triángulos: ~2M triángulos, ~56 MB). Es un modelo
    // estático (sin huesos ni animaciones), así que solo se anima como un
    // todo (billboard + "entrada"/gestos de cabeza); si no carga (sin
    // conexión, archivo movido, o el navegador no aguanta tantos triángulos),
    // se usa la cara procedural como respaldo automático. Ver también
    // app/images/lion_cara.glb: la versión recortada y liviana (16k
    // triángulos) generada antes, por si se quiere volver a esa.
    const DEFAULT_MODEL_URL = "/images/lion.glb";
    const ENTRY_DURATION = 1300; // ms: caminata de entrada / materialización
    const EXIT_DURATION = 380; // ms: desvanecido al reubicar (ver iniciarAnimacionSalida)
    const DESTELLO_DURATION = 700; // ms: anillo de luz que se expande y se apaga bajo León al aparecer
    const GREET_DURATION = 1500; // ms: saludo al pulsar "Interactuar" o al reconocer un QR
    const TALKING_DURATION = 2400; // ms: "responde" mientras la IA contesta
    const ESTABILIDAD_VENTANA = 550; // ms de estabilidad del hit-test antes de anclar solo
    const ESTABILIDAD_RADIO = 0.03; // 3 cm: variación máxima para considerarlo "estable"
    // Amortiguación (mayor = reacciona más rápido) de los dos seguimientos
    // continuos del render loop: hacia dónde "mira" León (billboard) y, en AR
    // real, hacia dónde lo mueve el tracking del ancla. Sin esto ambos
    // saltaban de golpe a la pose nueva cada frame; con una interpolación
    // exponencial (ver orientarHaciaCamara/aplicarPoseAAnclajeSuave) el
    // movimiento se ve como un seguimiento fluido en vez de un temblor o un
    // giro brusco cada vez que el usuario mueve el teléfono.
    const BILLBOARD_TURN_SPEED = 10;
    const ANCHOR_SMOOTH_SPEED = 14;

    // -- Estado general -----------------------------------------------------
    let THREE = null;
    let gltfLoader = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let clock = null;
    let animId = null;

    let modoXR = false;
    let xrSession = null;
    let referenceSpace = null;
    let hitTestSource = null;
    let anchor = null;
    let leonColocado = false;
    let hitReticleMesh = null;

    // Único interruptor del que depende TODO el audio de este archivo (voz
    // sintetizada y sonido_url grabado, ver hablar()/interactBtn más abajo):
    // true solo entre el instante en que la animación de entrada de León
    // termina (ver iniciarAnimacionEntrada) y el instante en que empieza a
    // desvanecerse/desaparece (iniciarAnimacionSalida, finalizarSesionXR,
    // escanearNuevoQR). Antes, el botón "Interactuar" (dentro de arPanel) y
    // el micrófono flotante (arVoiceFab) podían disparar audio con el panel
    // visible ANTES de que León terminara de aparecer -o, en AR real, antes
    // de que el hit-test lo anclara a una superficie-: aplicarPersonalizacion()
    // mostraba arPanel de forma incondicional apenas se reconocía el QR,
    // bastante antes de que intentarXRConActivacion()/iniciarModoSimulado()
    // llegaran siquiera a crear a León. Con esta bandera, ya no importa qué
    // tan pronto quede visible o clickeable la UI: hablar() y la reproducción
    // de sonido_url la comprueban directo y nunca sale audio si sigue en
    // false, sin excepción.
    let leonListo = false;

    let anchorGroup = null; // se posiciona en el punto anclado (XR) o fijo frente a la cámara (simulado)
    let modelRoot = null; // contiene al león (procedural o .glb) + su sombra

    let destelloMesh = null; // anillo de luz de la animación de aparición (ver crearDestelloAparicion)
    let destelloDesde = 0;

    let stream = null;

    let mixer = null;
    let ultimoGltfAnimations = [];
    let activeExperiencia = null;
    let lastResolvedPayload = null;

    let leonActivo = null; // partes animables del león procedural (null si se cargó un .glb real)
    let estadoLeon = "idle"; // entering | idle | thinking | talking | greet | leaving
    let estadoDesde = 0;
    let animacionSalidaCallback = null; // ver iniciarAnimacionSalida

    let proximoParpadeo = 0;
    let parpadeando = false;
    let parpadeoHasta = 0;

    let hemiSim = null;
    let dirSim = null;
    let orientacionDisponible = false;

    let lastDetectAt = 0;
    let ultimaMuestraColor = 0;

    // Lector de códigos QR: se prefiere la API nativa del navegador
    // (BarcodeDetector, disponible en Chrome/Android vía Google Play
    // Services) sobre jsQR, un decodificador 100% en JS que llega desde un
    // CDN. Nativo es bastante más robusto leyendo QR en condiciones
    // difíciles (poca luz, ángulo, o el caso típico de fotografiar un QR
    // que a su vez se muestra en OTRA pantalla, con el muaré que eso genera
    // entre las dos grillas de píxeles) porque usa el mismo motor de visión
    // que la cámara nativa del sistema, no una reimplementación en JS. jsQR
    // queda como respaldo automático para navegadores sin esa API (Safari,
    // Firefox, o si el script del CDN no llegó a cargar).
    let barcodeDetector = null;
    if ("BarcodeDetector" in window) {
        try {
            barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
        } catch (err) {
            barcodeDetector = null;
        }
    }
    let detectandoQR = false; // evita solapar detecciones async mientras una sigue en curso
    let frameQRcuenta = 0;

    // Cuántas veces seguidas falló barcodeDetector.detect() (no "no encontró
    // nada": directamente rechazó la promesa). Un puñado de fallas seguidas
    // casi siempre significa que el objeto existe pero no funciona de
    // verdad en este dispositivo (típico cuando el navegador expone la API
    // pero el módulo de escaneo de Google Play Services no está instalado o
    // no se pudo descargar, algo común en emuladores, dispositivos sin Play
    // Services o recién restaurados): sin este freno, detectarQR() quedaba
    // atascado reintentando para siempre con un lector roto y jsQR —que sí
    // podría leerlo— nunca llegaba a probarse.
    let barcodeDetectorFallas = 0;
    let barcodeDetectorDeshabilitado = false;
    const MAX_FALLAS_BARCODE_DETECTOR = 5;

    let torchActivo = false;

    let depthActivo = false;
    let occlusionFade = 1;
    let frameCount = 0;

    let estabilidadRef = null;
    let estabilidadDesde = 0;

    // -- Utilidades ---------------------------------------------------------

    // Constraints de video para getUserMedia. Pedimos explícitamente una
    // resolución alta ("ideal", no "exact": si el hardware no llega, el
    // navegador negocia lo más parecido en vez de fallar) porque sin esto
    // muchos navegadores entregan un stream de baja resolución (a veces
    // 640x480) muy por debajo de lo que usa la app de cámara del sistema.
    // Con un QR denso — y más si encima se lee de pantalla a pantalla, con
    // el muaré que eso genera (ver comentario de barcodeDetector más abajo)
    // — esa diferencia de nitidez/resolución suele ser justo lo que separa
    // "lo lee" de "no lo lee", tanto con BarcodeDetector como con jsQR.
    function constraintsCamara() {
        return {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
        };
    }

    // Fuerza enfoque continuo por hardware cuando el navegador lo expone
    // (Chrome/Android vía MediaTrackCapabilities). getUserMedia no lo pide
    // por defecto, así que sin esto algunos dispositivos no reenfocan tan
    // agresivo como la app de cámara nativa al acercar el QR. Se degrada en
    // silencio si la capability no existe (p. ej. iOS/Safari).
    async function habilitarEnfoqueContinuo(mediaStream) {
        try {
            const track = mediaStream.getVideoTracks()[0];
            if (!track || typeof track.getCapabilities !== "function") return;
            const caps = track.getCapabilities();
            if (caps.focusMode && caps.focusMode.includes("continuous")) {
                await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
            }
        } catch (err) {
            // No crítico: si falla, el enfoque queda en lo que haya negociado
            // el navegador por defecto.
        }
    }

    function setHud(texto) {
        hud.textContent = texto;
        hud.hidden = !texto;
    }

    // Tooltip con el texto crudo del último QR leído (antes de recortarle el
    // payload tras el "#", ver extraerPayload): se muestra apenas se decodifica
    // un código, reconocido o no, para que se pueda ver "in situ" qué se leyó
    // realmente sin depender de la consola del navegador (ver mostrarError).
    function mostrarQrTooltip(texto) {
        if (!qrTooltip || !qrTooltipText || !texto) return;
        qrTooltipText.textContent = texto;
        qrTooltip.hidden = false;
    }

    function ocultarQrTooltip() {
        if (!qrTooltip) return;
        qrTooltip.hidden = true;
    }

    if (qrTooltipClose) {
        qrTooltipClose.addEventListener("click", ocultarQrTooltip);
    }

    let motivoSinXR = ""; // por qué se cayó al modo simulado (para diagnosticar en el celular sin devtools)

    function setModeBadge(tipo) {
        if (!modeBadge) return;
        modeBadge.hidden = false;
        if (tipo === "real") {
            modeBadge.textContent = "🟢 AR anclada al mundo real";
            modeBadge.className = "ar-mode-badge ar-mode-badge--real";
        } else {
            modeBadge.textContent = "🟡 AR simulada (sin anclaje de superficie)" + (motivoSinXR ? " — " + motivoSinXR : "");
            modeBadge.className = "ar-mode-badge ar-mode-badge--sim";
        }
    }

    function mostrarError(err) {
        console.error("Modo AR:", err);
        const mensajes = {
            NotAllowedError:
                "Necesitamos permiso de cámara para el Modo AR. Actívalo en los ajustes del navegador e inténtalo de nuevo.",
            NotFoundError: "No encontramos una cámara en este dispositivo.",
            NotReadableError:
                "La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.",
            Unsupported:
                "Este dispositivo o navegador no admite el Modo AR. Usa la vista de Mapa.",
        };
        errorText.textContent = mensajes[err && err.name] || "No pudimos activar la cámara en este dispositivo.";
        // Detalle técnico visible (no hay acceso a la consola del navegador en
        // la mayoría de los celulares): ayuda a diagnosticar sin herramientas
        // de desarrollador conectadas.
        if (errorDetail) {
            const detalle = [err && err.name, err && err.message].filter(Boolean).join(": ");
            errorDetail.textContent = detalle || "";
            errorDetail.hidden = !detalle;
        }
        errorBox.hidden = false;
        setHud("");
        mostrarEntradaManual(false);
        if (torchBtn) torchBtn.hidden = true;
        mostrarVoiceFab(false);
        mostrarScanFab(false);
    }

    function comprobarSoporte() {
        const prueba = document.createElement("canvas");
        const gl = prueba.getContext("webgl") || prueba.getContext("experimental-webgl");
        if (!gl) {
            mostrarError({ name: "Unsupported" });
            return false;
        }
        const tieneXR = "xr" in navigator;
        const tieneCamaraClasica = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        if (!tieneXR && !tieneCamaraClasica) {
            mostrarError({ name: "Unsupported" });
            return false;
        }
        return true;
    }

    function extraerPayload(texto) {
        // El QR impreso codifica un enlace completo (.../ar#token.firma) para
        // que abrirlo con la cámara del sistema funcione también fuera de la
        // app. Aquí nos quedamos solo con el payload tras el "#".
        const i = texto.indexOf("#");
        return i === -1 ? texto : texto.slice(i + 1);
    }

    // -- Modo audio: lee el diálogo en voz alta con la síntesis de voz del
    // navegador (Web Speech API), para experiencias sin un archivo de audio
    // grabado (sonido_url). Ver services/ar_demos.py: el ejemplo de la
    // biblioteca activa esto con "modo_audio": true.
    function setAudioState(hablando) {
        if (audioBadge) audioBadge.hidden = !hablando;
        // El botón flotante de voz también refleja "hablando" (con el ícono
        // 🔊), tanto cuando León lee su diálogo al aparecer como cuando
        // responde una pregunta hecha por voz (ver preguntarPorVoz).
        if (voiceFab) voiceFab.classList.toggle("is-speaking", !!hablando);
        actualizarIconoVoiceFab();
    }

    // El Modo AR arranca solo, sin pantalla ni tap previo que esperar (ver
    // "-- Arranque --" más abajo): así, el primer diálogo de León se dispara
    // apenas se reconoce el QR, antes de que el usuario haya tocado nada. En
    // ese momento, muchos navegadores de celular rechazan
    // speechSynthesis.speak() con el error "not-allowed" por falta de un
    // gesto real todavía vigente en la página (la misma exigencia que
    // activacionXRVigente() resuelve para WebXR, ver más abajo). Se guarda
    // acá el texto que quedó sin poder leerse para reintentarlo apenas
    // llegue el primer toque real (cualquiera: Reubicar, Escanear otro QR,
    // Interactuar...), en vez de que el audio quede mudo hasta que algún
    // flujo -como reubicar en AR real, que sí exige un tap para anclar-
    // termine generando ese gesto por su cuenta.
    let dialogoPendienteDeGesto = null;

    function hablar(texto) {
        if (!texto || !("speechSynthesis" in window)) return;
        // Guard no negociable: si León todavía no terminó de aparecer/anclarse
        // (ver leonListo), no se reproduce audio bajo ningún motivo, sin
        // importar quién haya llamado a hablar() (diálogo automático, el
        // micrófono flotante, o el botón "Interactuar"). Se descarta en
        // silencio en vez de encolarlo: cuando León SÍ esté listo, el propio
        // flujo que corresponda (reproducirDialogoSiCorresponde, un nuevo tap
        // en el micrófono, etc.) vuelve a llamar a hablar() por su cuenta.
        if (!leonListo) return;
        try {
            window.speechSynthesis.cancel(); // corta cualquier lectura anterior antes de empezar una nueva
            const utter = new SpeechSynthesisUtterance(texto);
            utter.lang = "es-ES";
            utter.onstart = () => setAudioState(true);
            utter.onend = () => setAudioState(false);
            utter.onerror = (ev) => {
                setAudioState(false);
                if (ev && ev.error === "not-allowed") dialogoPendienteDeGesto = texto;
            };
            window.speechSynthesis.speak(utter);
        } catch (err) {
            console.warn("Modo AR: no se pudo iniciar la síntesis de voz.", err);
        }
    }

    function detenerHabla() {
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        setAudioState(false);
    }

    // Primer toque real en cualquier parte de la página: si quedó un diálogo
    // mudo por falta de gesto (ver hablar() arriba), se reintenta ahora.
    document.addEventListener(
        "pointerdown",
        () => {
            if (!dialogoPendienteDeGesto) return;
            const texto = dialogoPendienteDeGesto;
            dialogoPendienteDeGesto = null;
            hablar(texto);
        },
        { passive: true }
    );

    // -- Botón flotante de voz: preguntarle al chatbot sin salir de la cámara
    // ni escribir en el teclado, con respuesta SOLO por audio (nunca se
    // muestra el texto de la respuesta, a diferencia del chat de texto del
    // panel lateral en app.js). Usa el mismo endpoint de reglas
    // (/api/chatbot/<pregunta>, ver app/chatbot.py) y la misma síntesis de
    // voz que ya lee el diálogo de León (ver hablar() arriba), así que
    // funciona igual dentro de /ar como embebido en el iframe del asistente
    // (ar_embed.html no carga app.js, por eso esto no depende de él).
    const VoiceRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    let voiceRecognition = null;
    let escuchandoPregunta = false;

    // Se muestra/oculta según si la cámara/AR está realmente activa (ver
    // llamadas en escanearQR, mostrarError y finalizarSesionXR): no tiene
    // sentido ofrecerlo todavía en la pantalla de "Activar cámara".
    function mostrarVoiceFab(mostrar) {
        if (voiceFab) voiceFab.hidden = !mostrar;
    }

    // Mismo ciclo de vida que el botón de voz (ver llamadas junto a
    // mostrarVoiceFab): visible solo mientras la cámara/AR está activa.
    function mostrarScanFab(mostrar) {
        if (scanFab) scanFab.hidden = !mostrar;
    }

    function actualizarIconoVoiceFab() {
        if (!voiceFab || !voiceFabIcon) return;
        if (voiceFab.classList.contains("is-listening")) voiceFabIcon.textContent = "⏺";
        else if (voiceFab.classList.contains("is-thinking")) voiceFabIcon.textContent = "…";
        else if (voiceFab.classList.contains("is-speaking")) voiceFabIcon.textContent = "🔊";
        else voiceFabIcon.textContent = "🎤";
    }

    function setVoiceFabEstado(estado) {
        if (!voiceFab) return;
        voiceFab.classList.toggle("is-listening", estado === "listening");
        voiceFab.classList.toggle("is-thinking", estado === "thinking");
        actualizarIconoVoiceFab();
    }

    // Envía la pregunta dictada al mismo chatbot de reglas que usa el chat de
    // texto, y lee la respuesta en voz alta al terminar. León adopta las
    // mismas poses de "pensando"/"respondiendo" que ya tiene para el chat
    // (ver actualizarLeon), aunque no haya ningún QR escaneado todavía.
    function responderPorVoz(pregunta) {
        setVoiceFabEstado("thinking");
        setEstadoLeon("thinking");
        setHud("🤔 Pensando la respuesta a: “" + pregunta + "”…");

        fetch("/api/chatbot/" + encodeURIComponent(pregunta))
            .then((res) => res.json())
            .then((datos) => {
                setVoiceFabEstado("idle");
                setHud("");
                setEstadoLeon("talking");
                hablar(datos.respuesta || datos.error || "No pude procesar tu pregunta.");
            })
            .catch(() => {
                setVoiceFabEstado("idle");
                setEstadoLeon("idle");
                setHud("⚠️ Hubo un problema de conexión. Intenta de nuevo.");
            });
    }

    function preguntarPorVoz() {
        // El micrófono queda visible desde antes de que León aparezca (ver
        // mostrarVoiceFab en escanearQR/intentarXR/iniciarModoSimulado, que
        // lo muestran apenas hay cámara, no cuando hay León ubicado). Sin
        // este chequeo se podía escuchar la pregunta igual y, recién al
        // querer responder, hablar() la descartaba en silencio por
        // !leonListo: el usuario preguntaba y nunca entendía por qué no hubo
        // respuesta. Se avisa acá, antes de gastar el reconocimiento de voz.
        if (!leonListo) {
            setHud("⏳ Espera a que " + (activeExperiencia && activeExperiencia.nombre_personaje ? activeExperiencia.nombre_personaje : "León") + " aparezca para poder responderte.");
            return;
        }
        if (!VoiceRecognitionCtor) {
            setHud("⚠️ Este navegador no admite dictado por voz.");
            return;
        }
        if (escuchandoPregunta) {
            voiceRecognition.stop();
            return;
        }
        detenerHabla(); // no escuchar mientras León todavía está hablando

        if (!voiceRecognition) {
            voiceRecognition = new VoiceRecognitionCtor();
            voiceRecognition.lang = "es-ES";
            voiceRecognition.interimResults = false;
            voiceRecognition.maxAlternatives = 1;

            voiceRecognition.addEventListener("result", (event) => {
                const pregunta = event.results[0][0].transcript.trim();
                if (pregunta) responderPorVoz(pregunta);
            });
            voiceRecognition.addEventListener("end", () => {
                escuchandoPregunta = false;
                setVoiceFabEstado("idle");
            });
            voiceRecognition.addEventListener("error", (event) => {
                escuchandoPregunta = false;
                setVoiceFabEstado("idle");
                if (event.error !== "no-speech" && event.error !== "aborted") {
                    setHud("⚠️ No pudimos escucharte. Intenta de nuevo.");
                }
            });
        }

        escuchandoPregunta = true;
        setVoiceFabEstado("listening");
        setHud("🎙️ Escuchando tu pregunta…");
        try {
            voiceRecognition.start();
        } catch (err) {
            escuchandoPregunta = false;
            setVoiceFabEstado("idle");
        }
    }

    if (voiceFab) {
        voiceFab.addEventListener("click", preguntarPorVoz);
    }

    // Se llama recién cuando León ya terminó de aparecer (ver el parámetro
    // alListo de crearGrupoLeonSiHaceFalta/iniciarAnimacionEntrada), nunca
    // apenas se reconoce el QR: así el diálogo se escucha después de que la
    // figura esté ubicada frente al usuario, como si León lo dijera al
    // aparecer, en vez de sonar de fondo mientras todavía se está
    // materializando.
    function reproducirDialogoSiCorresponde() {
        const datos = activeExperiencia;
        if (datos && !datos.sonido_url && datos.modo_audio && datos.dialogo) {
            setEstadoLeon("talking");
            hablar(datos.dialogo);
        }
    }

    function disposeObject(obj) {
        obj.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const materiales = Array.isArray(child.material) ? child.material : [child.material];
                materiales.forEach((mat) => {
                    Object.values(mat).forEach((valor) => {
                        if (valor && valor.isTexture) valor.dispose();
                    });
                    mat.dispose();
                });
            }
        });
    }

    async function cargarThree() {
        if (THREE) return;
        // Se importa por el import map declarado en ar.html ("three" /
        // "three/addons/"): GLTFLoader.js internamente hace
        // `import * as THREE from "three"`, y esa referencia "pelada" solo
        // se resuelve si el documento trae el import map.
        const threeModule = await import("three");
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        THREE = threeModule;
        gltfLoader = new GLTFLoader();
    }

    // -- León de reemplazo (mientras no haya un .glb real) -------------------
    //
    // Solo la cara de León (no el cuerpo completo), de frente, con la misma
    // identidad visual del mascote 2D del asistente (base.html): cara
    // redonda, melena en forma de "estallido" de mechones alrededor, ojos
    // grandes con brillo y una mandíbula que se abre para hablar/saludar.
    // El grupo se construye con el frente mirando hacia -Z (la convención de
    // Object3D.lookAt de three.js) porque cada frame se orienta solo para
    // mirar a la cámara (ver orientarHaciaCamara), sin importar hacia dónde
    // quedó el anclaje real: así siempre "está de frente" al usuario. No
    // requiere ningún asset .glb externo, pero el resto del código está
    // listo para reemplazarlo por uno (ver cargarModeloPersonalizado) sin
    // tocar la lógica de estados/animación.

    function crearLeon() {
        const dorado = 0xd7a24a;
        const doradoClaro = 0xe9c27a;
        const crema = 0xfff3df;
        const marron = 0x7a4a24;
        const oscuro = 0x2b1a10;

        const material = (color) =>
            new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.04, transparent: true, opacity: 1 });

        const grupo = new THREE.Group();

        const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), material(dorado));
        cabeza.castShadow = true;
        grupo.add(cabeza);

        // Hocico: parche más claro en la mitad inferior-frontal de la cara.
        const hocico = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), material(crema));
        hocico.scale.set(1, 0.75, 0.55);
        hocico.position.set(0, -0.09, -0.26);
        grupo.add(hocico);

        const nariz = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.05, 12), material(oscuro));
        nariz.rotation.x = Math.PI / 2;
        nariz.position.set(0, 0.02, -0.4);
        grupo.add(nariz);

        // Mandíbula: pivote a la altura de la boca; al rotar en X, "abre" la
        // boca hacia adelante/abajo (hablar, saludar, rugir de contento).
        const bocaPivote = new THREE.Group();
        bocaPivote.position.set(0, -0.14, -0.24);
        const boca = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), material(doradoClaro));
        boca.scale.set(1.3, 0.55, 0.85);
        boca.position.set(0, -0.02, -0.06);
        bocaPivote.add(boca);
        grupo.add(bocaPivote);

        // Ojos: cada uno es su propio grupo (esclerótica + pupila + brillo),
        // para poder mover la pupila (mirar alrededor) y cerrar el ojo
        // (parpadeo) de forma independiente.
        const ojos = [-0.15, 0.15].map((x) => {
            const ojoGrupo = new THREE.Group();
            ojoGrupo.position.set(x, 0.08, -0.27);

            const esclerotica = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 14), material(crema));
            ojoGrupo.add(esclerotica);

            const pupilaGrupo = new THREE.Group();
            ojoGrupo.add(pupilaGrupo);
            const pupila = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 10), material(oscuro));
            pupila.position.set(0, 0, -0.045);
            pupilaGrupo.add(pupila);
            const brillo = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), material(0xffffff));
            brillo.position.set(0.012, 0.012, -0.058);
            pupilaGrupo.add(brillo);

            grupo.add(ojoGrupo);
            return { grupo: ojoGrupo, pupilaGrupo };
        });

        // Cejas: pequeñas cápsulas sobre cada ojo, útiles para expresiones
        // ("pensando" con una levantada, "saludo" con ambas arriba).
        const cejas = [-0.15, 0.15].map((x) => {
            const ceja = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.09, 4, 8), material(marron));
            ceja.rotation.z = Math.PI / 2;
            ceja.position.set(x, 0.17, -0.26);
            ceja.userData.baseY = ceja.position.y; // referencia para las expresiones (pensar/saludar)
            grupo.add(ceja);
            return ceja;
        });

        const orejas = [-0.22, 0.22].map((x) => {
            const oreja = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), material(marron));
            oreja.scale.set(0.9, 1, 0.6);
            oreja.position.set(x, 0.3, -0.02);
            grupo.add(oreja);
            return oreja;
        });

        // Melena: un "estallido" de mechones alrededor de la cara, como el
        // ícono 2D del asistente. Quedan ligeramente detrás de la cara
        // (z > -0.15) para enmarcarla sin taparla al verla de frente.
        const puntos = 14;
        for (let i = 0; i < puntos; i += 1) {
            const ang = (i / puntos) * Math.PI * 2;
            const largo = i % 2 === 0;
            const mechon = new THREE.Mesh(
                new THREE.SphereGeometry(largo ? 0.1 : 0.075, 8, 8),
                material(i % 2 ? marron : dorado)
            );
            mechon.scale.set(1, largo ? 1.7 : 1.2, 0.6);
            mechon.position.set(Math.sin(ang) * 0.36, Math.cos(ang) * 0.36, -0.06 + Math.cos(ang * 2) * 0.03);
            mechon.castShadow = true;
            grupo.add(mechon);
        }

        return {
            grupo,
            cabeza,
            bocaPivote,
            ojos,
            cejas,
            orejas,
        };
    }

    function normalizarModelo(obj) {
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const centro = new THREE.Vector3();
        box.getCenter(centro);

        obj.scale.multiplyScalar(1 / maxDim);
        obj.position.set(-centro.x / maxDim, -box.min.y / maxDim, -centro.z / maxDim);
    }

    function crearSombraCatcherReal() {
        const catcher = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.ShadowMaterial({ opacity: 0.3 }));
        catcher.rotation.x = -Math.PI / 2;
        catcher.receiveShadow = true;
        return catcher;
    }

    function crearTexturaSombraFalsa() {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const ctx = c.getContext("2d");
        const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
        g.addColorStop(0, "rgba(0,0,0,0.5)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
    }

    function crearSombraFalsa() {
        const plano = new THREE.Mesh(
            new THREE.PlaneGeometry(0.4, 0.4),
            new THREE.MeshBasicMaterial({ map: crearTexturaSombraFalsa(), transparent: true, depthWrite: false })
        );
        plano.rotation.x = -Math.PI / 2;
        plano.position.y = 0.001;
        return plano;
    }

    // Anillo de luz que se expande y se apaga bajo León al materializarse: la
    // señal visual de "transición" que acompaña al rebote de escala (ver
    // iniciarAnimacionEntrada/actualizarLeon), como un destello de portal en
    // el punto donde va a aparecer.
    function crearDestelloAparicion() {
        const anillo = new THREE.Mesh(
            new THREE.RingGeometry(0.01, 0.34, 40),
            new THREE.MeshBasicMaterial({
                color: 0xfff0c2,
                transparent: true,
                opacity: 0.85,
                side: THREE.DoubleSide,
                depthWrite: false,
            })
        );
        anillo.rotation.x = -Math.PI / 2;
        anillo.position.y = 0.01;
        return anillo;
    }

    // -- Máquina de estados de animación (compartida por ambos motores) ------

    function setEstadoLeon(nombre) {
        if (nombre === estadoLeon) return;
        estadoLeon = nombre;
        estadoDesde = performance.now();
    }

    // Billboard de solo yaw: hace que "grupo" siempre presente su frente
    // (eje -Z) hacia la cámara, sin importar la orientación del anclaje real
    // (en WebXR, el plano detectado puede quedar mirando a cualquier lado) ni
    // hacia dónde gira el usuario. Se iguala la Y del objetivo a la del
    // propio grupo para que la cara no se incline hacia arriba/abajo, solo
    // gire sobre sí misma (como un personaje que "te sigue con la mirada").
    let vCamara, vGrupo, qBillboardPrev, qBillboardDestino;

    // delta (segundos, opcional): si se pasa, el giro hacia la cámara se
    // amortigua (slerp) en vez de saltar de golpe a la orientación exacta,
    // para que León "siga" al usuario con un movimiento continuo y natural
    // en vez de encarar en un solo salto cada frame. Sin delta (o durante la
    // materialización, que ya trae su propio giro) se aplica sin amortiguar,
    // igual que antes.
    function orientarHaciaCamara(grupo, delta) {
        if (!grupo || !camera) return;
        if (!vCamara) {
            vCamara = new THREE.Vector3();
            vGrupo = new THREE.Vector3();
            qBillboardPrev = new THREE.Quaternion();
            qBillboardDestino = new THREE.Quaternion();
        }
        camera.getWorldPosition(vCamara);
        grupo.getWorldPosition(vGrupo);
        vCamara.y = vGrupo.y;

        qBillboardPrev.copy(grupo.quaternion);
        grupo.lookAt(vCamara);
        // Object3D.lookAt() en three.js tiene una particularidad: para
        // Cameras/Lights apunta -Z al objetivo, pero para un Object3D común
        // (como este Group) internamente intercambia "eye" y "target" y
        // termina apuntando +Z al objetivo. Como la cara (procedural y el
        // modelo real) está construida de cara a -Z, se corrige con este giro
        // de 180° para volver a la convención "-Z mira al objetivo".
        grupo.rotateY(Math.PI);

        if (!delta || estadoLeon === "entering") return; // sin amortiguar: primer frame o ya girando por la propia entrada
        qBillboardDestino.copy(grupo.quaternion);
        grupo.quaternion.copy(qBillboardPrev);
        const t = 1 - Math.exp(-BILLBOARD_TURN_SPEED * delta);
        grupo.quaternion.slerp(qBillboardDestino, t);
    }

    function actualizarLeon(delta, ahora) {
        if (!leonActivo) return;
        const l = leonActivo;
        const t = ahora / 1000;
        // La cara real (.glb) es un mesh estático: sin ojos/cejas/mandíbula
        // que animar por separado. Se degrada con gracia a solo billboard +
        // "entrada"/gestos de cabeza enteros; la cara procedural sí trae
        // todas las partes y usa las expresiones detalladas de abajo.
        const detallado = !!l.ojos;

        orientarHaciaCamara(l.grupo, delta); // primero: que quede de frente al usuario...

        if (detallado) {
            // Parpadeo: reloj propio, independiente del estado general.
            if (!proximoParpadeo) proximoParpadeo = ahora + 1500;
            if (ahora >= proximoParpadeo) {
                parpadeando = true;
                parpadeoHasta = ahora + 130;
                proximoParpadeo = ahora + 1800 + Math.random() * 3200;
            }
            if (parpadeando && ahora > parpadeoHasta) parpadeando = false;
            const cierre = parpadeando ? 0.1 : 1;
            l.ojos.forEach((ojo) => (ojo.grupo.scale.y = cierre));

            // Respiración: un pulso muy sutil en toda la cabeza, siempre activo.
            const respiro = 1 + Math.sin(t * 2.2) * 0.018;
            l.cabeza.scale.set(respiro, respiro, respiro);

            // Orejas: leve tic ocasional.
            l.orejas[0].rotation.z = Math.sin(t * 0.9) * 0.08 - 0.05;
            l.orejas[1].rotation.z = Math.sin(t * 0.9 + 1.4) * 0.08 + 0.05;
        } else if (estadoLeon !== "entering") {
            // Respiración genérica sobre todo el grupo (no hay una "cabeza"
            // separada del resto que escalar sola). Se salta durante
            // "entering" porque ese estado ya controla la escala del rebote.
            l.grupo.scale.setScalar(1 + Math.sin(t * 2.2) * 0.012);
        }

        // ...luego se aplican, ENCIMA del billboard, pequeños giros locales
        // (rotate*) que sí se notan porque se suman a la orientación ya
        // calculada en vez de reemplazarla.
        if (estadoLeon === "entering") {
            const p = Math.min(1, (ahora - estadoDesde) / ENTRY_DURATION);
            // Ease-out-back: aparece con un ligero "rebote" de más a menos, como
            // si se materializara, en vez de caminar (ya no tiene cuerpo/patas).
            const c1 = 1.70158;
            const c3 = c1 + 1;
            const pm1 = p - 1;
            const ease = 1 + c3 * pm1 * pm1 * pm1 + c1 * pm1 * pm1;
            l.grupo.scale.setScalar(Math.max(0.001, ease));
            l.grupo.position.y = THREE.MathUtils.lerp(LION_HOVER_Y - 0.18, LION_HOVER_Y, Math.min(1, p * 1.3));
            // Se desvanece desde transparente y gira mientras se asienta, para
            // reforzar la sensación de "materialización" además del rebote de
            // escala (acompaña al anillo de destello, ver crearDestelloAparicion).
            aplicarOpacidadLeon(Math.min(1, p * 1.6));
            l.grupo.rotateY((1 - p) * Math.PI * 0.6);
            if (p >= 1) {
                l.grupo.scale.setScalar(1);
                l.grupo.position.y = LION_HOVER_Y;
                aplicarOpacidadLeon(1);
                setEstadoLeon("idle");
            }
        } else if (estadoLeon === "thinking") {
            l.grupo.rotateZ(-0.14);
            if (detallado) {
                l.cejas[0].position.y = l.cejas[0].userData.baseY + 0.02;
                l.cejas[1].position.y = l.cejas[1].userData.baseY;
                l.ojos.forEach((ojo, i) => {
                    ojo.pupilaGrupo.position.set(0.01, 0.018 + Math.sin(t * 2 + i) * 0.004, 0); // mirada hacia arriba, "pensando"
                });
                l.bocaPivote.rotation.x = 0.05 + Math.sin(t * 4) * 0.02; // pequeño mordisqueo de labio
            }
        } else if (estadoLeon === "talking") {
            l.grupo.rotateZ(Math.sin(t * 1.8) * 0.05);
            if (detallado) {
                l.cejas.forEach((c) => (c.position.y = c.userData.baseY + 0.008));
                l.ojos.forEach((ojo) => ojo.pupilaGrupo.position.set(0, 0, 0));
                l.bocaPivote.rotation.x = (Math.sin(t * 9) * 0.5 + 0.5) * 0.34; // parlotea al "responder"
            } else {
                l.grupo.rotateX(Math.sin(t * 6) * 0.02); // pequeño asentimiento, ya que no hay mandíbula que abrir
            }
            if (ahora - estadoDesde > TALKING_DURATION) setEstadoLeon("idle");
        } else if (estadoLeon === "greet") {
            const p = Math.min(1, (ahora - estadoDesde) / GREET_DURATION);
            l.grupo.rotateZ(Math.sin(ahora / 140) * 0.14 * Math.sin(p * Math.PI)); // saluda con un pequeño meneo de cabeza
            if (detallado) {
                l.cejas.forEach((c) => (c.position.y = c.userData.baseY + 0.022));
                l.ojos.forEach((ojo) => ojo.pupilaGrupo.position.set(0, 0, 0));
                l.bocaPivote.rotation.x = 0.4 * Math.sin(Math.min(1, p * 1.6) * Math.PI); // boca abierta, contento
            }
            if (p >= 1) setEstadoLeon("idle");
        } else if (estadoLeon === "leaving") {
            const p = Math.min(1, (ahora - estadoDesde) / EXIT_DURATION);
            // Ease-in (acelera): lo opuesto al ease-out-back de la entrada,
            // para que la desaparición se sienta como un desvanecido rápido
            // en vez de un rebote en reversa (ver iniciarAnimacionSalida).
            // multiplyScalar (no setScalar) para no pisar la respiración
            // genérica ya aplicada arriba cuando el modelo no es "detallado".
            const ease = p * p;
            // setScalar (absoluto), no multiplyScalar: igual que en
            // "entering", tiene que basarse en "p" de este frame, no en lo
            // que haya quedado de scale en el frame anterior (con el león
            // procedural de respaldo, grupo.scale no se resetea solo en cada
            // frame como sí ocurre con la respiración del .glb real, así que
            // multiplicar iría encogiendo de más, acumulando frame a frame).
            l.grupo.scale.setScalar(Math.max(0.001, 1 - ease * 0.35));
            aplicarOpacidadLeon(1 - ease);
            l.grupo.rotateY(ease * Math.PI * 0.25);
            if (p >= 1) {
                modelRoot.visible = false;
                l.grupo.scale.setScalar(1); // listo para la próxima aparición
                aplicarOpacidadLeon(1);
                setEstadoLeon("idle");
                const callback = animacionSalidaCallback;
                animacionSalidaCallback = null;
                if (callback) callback();
            }
        } else if (detallado) {
            // idle: reposo, mirando alrededor de vez en cuando.
            l.cejas.forEach((c) => (c.position.y = c.userData.baseY));
            l.ojos.forEach((ojo, i) => {
                ojo.pupilaGrupo.position.set(
                    Math.sin(t * 0.35 + i * 2) * 0.014,
                    Math.sin(t * 0.22 + i) * 0.01,
                    0
                );
            });
            l.bocaPivote.rotation.x = 0;
        }

        // Anillo de destello (ver iniciarAnimacionEntrada): se actualiza al
        // final, después de cualquier aplicarOpacidadLeon() de arriba, para
        // que su propio fundido de salida no quede pisado por el fundido de
        // entrada de León.
        if (destelloMesh) {
            if (!destelloMesh.parent) {
                // Ya no está en la escena (p. ej. cargarModeloPersonalizado lo
                // reemplazó al limpiar modelRoot junto con el resto de las
                // partes); nada que animar.
                destelloMesh = null;
            } else {
                const pDestello = Math.min(1, (ahora - destelloDesde) / DESTELLO_DURATION);
                destelloMesh.scale.setScalar(THREE.MathUtils.lerp(0.15, 1.6, pDestello));
                destelloMesh.material.opacity = 0.85 * (1 - pDestello);
                destelloMesh.rotation.z += 0.02;
                if (pDestello >= 1) {
                    modelRoot.remove(destelloMesh);
                    destelloMesh.geometry.dispose();
                    destelloMesh.material.dispose();
                    destelloMesh = null;
                }
            }
        }
    }

    function aplicarOpacidadLeon(valor) {
        if (!modelRoot) return;
        modelRoot.traverse((child) => {
            if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => {
                    m.transparent = true;
                    m.opacity = valor;
                });
            }
        });
    }

    // alListo (opcional): se invoca ENTRY_DURATION ms después, cuando la
    // animación de aparición ya terminó y León quedó firme frente al
    // usuario. Se usa para recién ahí disparar la lectura en voz alta del
    // diálogo (ver reproducirDialogoSiCorresponde): así el audio empieza
    // después de que la imagen esté ubicada, como si León lo dijera al
    // aparecer, en vez de sonar mientras todavía se está materializando.
    function iniciarAnimacionEntrada(alListo) {
        estadoLeon = "entering";
        estadoDesde = performance.now();
        leonListo = false; // recién se materializa; nada de audio hasta que termine (ver más abajo)

        if (modelRoot) {
            if (destelloMesh) {
                // Reingreso mientras el destello anterior todavía se estaba
                // apagando (p. ej. reescaneo rápido de otro QR): se descarta
                // sin esperar a que termine su propia animación.
                if (destelloMesh.parent) modelRoot.remove(destelloMesh);
                destelloMesh.geometry.dispose();
                destelloMesh.material.dispose();
            }
            destelloMesh = crearDestelloAparicion();
            destelloDesde = estadoDesde;
            modelRoot.add(destelloMesh);
        }

        setTimeout(() => {
            leonListo = true; // recién ahora León está "ubicado": habilita hablar() y el sonido_url
            if (typeof alListo === "function") alListo();
        }, ENTRY_DURATION);
    }

    // Contraparte de iniciarAnimacionEntrada: desvanece a León en su lugar
    // (encogiendo/girando levemente mientras se apaga) en vez de cortarlo a
    // invisible de golpe con modelRoot.visible = false. Se usa al reubicar
    // (mismo QR, nueva superficie) y al reconocer un QR distinto mientras
    // León ya está a la vista (ver reubicarBtn/aplicarPersonalizacion), en
    // cualquier caso donde el render loop sigue corriendo mientras se
    // desvanece. alTerminar (opcional) se llama recién EXIT_DURATION ms
    // después, cuando ya terminó de desvanecerse y quedó oculto — el mismo
    // patrón que el alListo de iniciarAnimacionEntrada, pero disparado desde
    // el propio render loop (actualizarLeon) en vez de un setTimeout, para
    // que quede sincronizado con la animación en vez de una espera aparte.
    function iniciarAnimacionSalida(alTerminar) {
        if (!modelRoot || !modelRoot.visible) {
            // No hay nada visible que desvanecer (p. ej. el primer QR de la
            // sesión): se salta directo al callback en vez de animar una
            // salida vacía.
            if (typeof alTerminar === "function") alTerminar();
            return;
        }
        leonListo = false; // se está yendo: deja de estar "ubicado" apenas arranca el desvanecido
        animacionSalidaCallback = typeof alTerminar === "function" ? alTerminar : null;
        setEstadoLeon("leaving");
    }

    function agregarLeonProcedural() {
        const leon = crearLeon();
        leon.grupo.traverse((child) => {
            if (child.isMesh) child.castShadow = true;
        });
        modelRoot.add(leon.grupo);
        leonActivo = leon;
    }

    // Nota: dispara ella misma la animación de entrada al final (en vez de que
    // lo haga quien la llama), porque cargar el modelo real es asíncrono: si
    // "entrando" se marcara antes de que el modelo termine de cargar, el
    // rebote de aparición arrancaría a medias o ya habría terminado para
    // cuando el modelo por fin es visible.
    async function crearGrupoLeonSiHaceFalta(alListo) {
        if (modelRoot) {
            modelRoot.visible = true;
            iniciarAnimacionEntrada(alListo);
            return;
        }
        modelRoot = new THREE.Group();
        anchorGroup.add(modelRoot);

        try {
            const gltf = await gltfLoader.loadAsync(DEFAULT_MODEL_URL);
            const modelo = gltf.scene;
            modelo.traverse((child) => {
                if (child.isMesh) child.castShadow = true;
            });
            // A diferencia del recorte (que ya venía centrado y escalado a
            // metros), este es el archivo intacto tal cual: pies en y=0,
            // ~1m de alto. normalizarModelo() lo centra en X/Z y lo escala a
            // una unidad para que LION_SCALE_MODELO decida el tamaño final,
            // igual que con un .glb personalizado por QR.
            normalizarModelo(modelo);
            // El hocico del personaje mira hacia +Z, pero orientarHaciaCamara()
            // usa grupo.lookAt(), que asume que el frente es -Z (la misma
            // convención que la cara procedural). Sin este giro de 180°, se
            // vería la nuca en vez de la cara.
            modelo.rotation.y = Math.PI;
            const grupo = new THREE.Group();
            grupo.add(modelo);
            modelRoot.add(grupo);
            modelRoot.scale.setScalar(LION_SCALE_MODELO);
            leonActivo = { grupo }; // sin ojos/cejas/boca: solo billboard + gestos de cabeza completos
        } catch (err) {
            console.warn("No se pudo cargar la cara real de León; se usa la versión procedural.", err);
            modelRoot.scale.setScalar(LION_SCALE_PROCEDURAL);
            agregarLeonProcedural();
        }
        modelRoot.add(modoXR ? crearSombraCatcherReal() : crearSombraFalsa());
        iniciarAnimacionEntrada(alListo);
    }

    // -- Motor 1: AR real con WebXR (hit-test + anclaje de mundo) ------------

    function registrarEstabilidad(pose) {
        const p = pose.transform.position;
        if (
            !estabilidadRef ||
            Math.hypot(p.x - estabilidadRef.x, p.y - estabilidadRef.y, p.z - estabilidadRef.z) > ESTABILIDAD_RADIO
        ) {
            estabilidadRef = { x: p.x, y: p.y, z: p.z };
            estabilidadDesde = performance.now();
        }
    }

    function estabilidadLista() {
        return !!estabilidadRef && performance.now() - estabilidadDesde > ESTABILIDAD_VENTANA;
    }

    function estabilidadReset() {
        estabilidadRef = null;
        estabilidadDesde = 0;
    }

    function mostrarReticuloXR(pose) {
        hitReticleMesh.visible = true;
        hitReticleMesh.matrix.fromArray(pose.transform.matrix);
        hitReticleMesh.matrix.decompose(hitReticleMesh.position, hitReticleMesh.quaternion, hitReticleMesh.scale);
        hitReticleMesh.scale.set(1, 1, 1);
    }

    function aplicarPoseAAnclaje(pose) {
        anchorGroup.matrix.fromArray(pose.transform.matrix);
        anchorGroup.matrix.decompose(anchorGroup.position, anchorGroup.quaternion, anchorGroup.scale);
        anchorGroup.scale.set(1, 1, 1);
    }

    let vAnchorPos, qAnchorQuat, vAnchorScale;

    // Igual que aplicarPoseAAnclaje, pero amortiguando (lerp/slerp) hacia la
    // pose reportada por el tracking del ancla en vez de saltar a ella de
    // golpe cada frame. El tracking real tiene un ruido de unos pocos
    // milímetros/grados frame a frame; sin amortiguar, ese ruido se veía como
    // un pequeño temblor en León aunque el teléfono estuviera quieto. Solo se
    // usa en el seguimiento continuo (ver onXRFrame); el anclaje inicial (ver
    // colocarEnPose) sigue usando aplicarPoseAAnclaje sin amortiguar, para
    // que León aparezca ya en su sitio y no "deslizándose" hacia él.
    function aplicarPoseAAnclajeSuave(pose, delta) {
        if (!vAnchorPos) {
            vAnchorPos = new THREE.Vector3();
            qAnchorQuat = new THREE.Quaternion();
            vAnchorScale = new THREE.Vector3();
        }
        anchorGroup.matrix.fromArray(pose.transform.matrix);
        anchorGroup.matrix.decompose(vAnchorPos, qAnchorQuat, vAnchorScale);
        if (!delta) {
            anchorGroup.position.copy(vAnchorPos);
            anchorGroup.quaternion.copy(qAnchorQuat);
            return;
        }
        const t = 1 - Math.exp(-ANCHOR_SMOOTH_SPEED * delta);
        anchorGroup.position.lerp(vAnchorPos, t);
        anchorGroup.quaternion.slerp(qAnchorQuat, t);
    }

    function colocarEnPose(hitResult) {
        if (leonColocado) return;
        leonColocado = true;
        hitReticleMesh.visible = false;

        const poseInicial = hitResult.getPose(referenceSpace);
        if (poseInicial) aplicarPoseAAnclaje(poseInicial);

        crearGrupoLeonSiHaceFalta(reproducirDialogoSiCorresponde);

        panel.hidden = false;
        // Si ya se aplicó una personalización (experiencia real o de
        // ejemplo) antes de anclar, no se pisa su nombre/ubicación.
        if (!activeExperiencia) {
            panelNombre.textContent = "🦁 León";
            panelUbicacion.textContent = "anclado al suelo real";
        }
        setHud("✨ León apareció. Rodéalo: se queda anclado a ese punto.");
        if (reubicarBtn) reubicarBtn.hidden = false;

        if (typeof hitResult.createAnchor === "function") {
            hitResult
                .createAnchor()
                .then((a) => {
                    anchor = a;
                })
                .catch(() => {
                    anchor = null;
                });
        }
    }

    function configurarLucesXR() {
        const hemi = new THREE.HemisphereLight(0xffffff, 0x3a2a1a, 0.9);
        const dir = new THREE.DirectionalLight(0xfff2d9, 1.0);
        dir.position.set(0.6, 1.4, 0.5);
        dir.castShadow = true;
        dir.shadow.mapSize.set(1024, 1024);
        dir.shadow.camera.near = 0.1;
        dir.shadow.camera.far = 4;
        dir.shadow.camera.left = -1.3;
        dir.shadow.camera.right = 1.3;
        dir.shadow.camera.top = 1.3;
        dir.shadow.camera.bottom = -1.3;
        dir.shadow.bias = -0.002;
        scene.add(hemi, dir);

        // Estimación de luz real del entorno (si el dispositivo la ofrece):
        // ajusta intensidad/color/dirección de la luz principal y aporta un
        // mapa de entorno, para que León refleje la iluminación real de la
        // escena en vez de una luz fija. Se degrada de forma automática y
        // silenciosa a las luces fijas de arriba si no está disponible.
        import("three/addons/webxr/XREstimatedLight.js")
            .then(({ XREstimatedLight }) => {
                const xrLight = new XREstimatedLight(renderer);
                xrLight.addEventListener("estimationstart", () => {
                    scene.add(xrLight);
                    scene.remove(hemi, dir);
                    if (xrLight.environment) scene.environment = xrLight.environment;
                    if (xrLight.directionalLight) {
                        xrLight.directionalLight.castShadow = true;
                        xrLight.directionalLight.shadow.mapSize.set(1024, 1024);
                        xrLight.directionalLight.shadow.camera.near = 0.1;
                        xrLight.directionalLight.shadow.camera.far = 4;
                        xrLight.directionalLight.shadow.camera.left = -1.3;
                        xrLight.directionalLight.shadow.camera.right = 1.3;
                        xrLight.directionalLight.shadow.camera.top = 1.3;
                        xrLight.directionalLight.shadow.camera.bottom = -1.3;
                    }
                });
                xrLight.addEventListener("estimationend", () => {
                    scene.add(hemi, dir);
                    scene.remove(xrLight);
                    scene.environment = null;
                });
                scene.add(xrLight);
            })
            .catch((err) => {
                console.warn("Estimación de luz WebXR no disponible; se usa iluminación fija.", err);
            });
    }

    function configurarOcclusion(session) {
        depthActivo = !!(session.enabledFeatures && session.enabledFeatures.includes("depth-sensing"));
    }

    // Oclusión aproximada: NO es oclusión por píxel (eso exigiría el canal
    // GPU de Depth Sensing con un shader propio, difícil de validar sin
    // hardware real delante). En vez de arriesgar artefactos visuales raros,
    // se muestrea una cuadrícula de puntos con la API estable
    // getDepthInMeters() sobre el centro de la pantalla (donde suele estar
    // León) y, si la mayoría "ve" algo del mundo real más cerca que León, se
    // atenúa su opacidad como si quedara detrás. Solo se activa si el
    // dispositivo concedió la función depth-sensing.
    function actualizarOcclusion(frame, viewerPose) {
        if (!depthActivo || !modelRoot || !viewerPose || !viewerPose.views.length) return;
        try {
            const view = viewerPose.views[0];
            if (typeof frame.getDepthInformation !== "function") {
                depthActivo = false;
                return;
            }
            const depthInfo = frame.getDepthInformation(view);
            if (!depthInfo) return;

            const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
            const leonPos = new THREE.Vector3().setFromMatrixPosition(modelRoot.matrixWorld);
            const distLeon = camPos.distanceTo(leonPos);

            let ocluidos = 0;
            let muestras = 0;
            for (let gx = 0.35; gx <= 0.65; gx += 0.15) {
                for (let gy = 0.35; gy <= 0.65; gy += 0.15) {
                    const metros = depthInfo.getDepthInMeters(gx, gy);
                    muestras += 1;
                    if (metros > 0.05 && metros < distLeon - 0.12) ocluidos += 1;
                }
            }
            const proporcion = muestras ? ocluidos / muestras : 0;
            const objetivo = proporcion > 0.55 ? 0.08 : 1;
            occlusionFade += (objetivo - occlusionFade) * 0.15;
            aplicarOpacidadLeon(occlusionFade);
        } catch (err) {
            depthActivo = false; // si algo falla, se desactiva en silencio y León sigue siempre visible
        }
    }

    let lastXRTime = 0;

    function onXRFrame(time, frame) {
        if (!frame) return;
        const delta = lastXRTime ? (time - lastXRTime) / 1000 : 0;
        lastXRTime = time;

        const viewerPose = referenceSpace ? frame.getViewerPose(referenceSpace) : null;

        if (!leonColocado && hitTestSource) {
            // El QR ya se resolvió antes de llegar a intentarXR() (ver
            // escanearQR()): lo único que falta aquí es encontrar la posición.
            const resultados = frame.getHitTestResults(hitTestSource);
            if (resultados.length) {
                const pose = resultados[0].getPose(referenceSpace);
                if (pose) {
                    mostrarReticuloXR(pose);
                    registrarEstabilidad(pose);
                    if (estabilidadLista()) {
                        colocarEnPose(resultados[0]);
                    } else {
                        setHud("🔎 Mantén el teléfono quieto sobre esa superficie…");
                    }
                }
            } else {
                hitReticleMesh.visible = false;
                estabilidadReset();
                setHud("🔎 Busca una superficie (suelo o mesa) para anclar a León.");
            }
        } else if (leonColocado && anchor) {
            const anchorPose = frame.getPose(anchor.anchorSpace, referenceSpace);
            if (anchorPose) aplicarPoseAAnclajeSuave(anchorPose, delta);
        }

        frameCount += 1;
        if (depthActivo && viewerPose && frameCount % 4 === 0) {
            actualizarOcclusion(frame, viewerPose);
        }

        actualizarLeon(delta, time);
        if (mixer) mixer.update(delta);
        renderer.render(scene, camera);
    }

    function finalizarSesionXR() {
        if (renderer) renderer.setAnimationLoop(null);
        xrSession = null;
        hitTestSource = null;
        anchor = null;
        leonColocado = false;
        leonListo = false; // la sesión XR terminó: ya no hay ningún anclaje válido en pie
        modoXR = false;
        // anchorGroup/scene/camera pertenecían a esta sesión XR y quedan sin
        // renderer que los dibuje una vez que termina: si no se limpian acá,
        // aplicarPersonalizacion() (al leer un QR nuevo mientras todavía se
        // está re-escaneando con la cámara plana, ver escanearNuevoQR) los ve
        // como "anchorGroup" no nulo con modoXR ya en false y cree por error
        // que el motor simulado está listo para materializar a León de una,
        // aunque no haya ningún anclaje real en pie. Sin esto, el diálogo se
        // podía leer en voz alta antes de que León volviera a ubicarse.
        anchorGroup = null;
        scene = null;
        camera = null;
        if (reubicarBtn) reubicarBtn.hidden = true;
        setHud("");
        detenerHabla();
        mostrarVoiceFab(false);
        mostrarScanFab(false);
    }

    // Deja dicho en consola y en el badge de modo (persistente, a diferencia
    // del HUD que enseguida lo pisan los mensajes de iniciarModoSimulado) por
    // qué no se usó AR real, en vez de caer al modo simulado en silencio.
    // Útil para probar en celulares sin acceso a las herramientas de
    // desarrollador.
    function avisarSinXR(motivo) {
        console.info("Modo AR: WebXR AR no se usó —", motivo);
        motivoSinXR = motivo;
    }

    // "User activation" (el gesto reciente del usuario, tap/click) es lo que
    // exige el navegador para conceder requestSession("immersive-ar", ...);
    // si expira, la rechaza con SecurityError aunque todo lo demás esté bien.
    // El problema es que, antes de llegar a intentarXR(), activarModoAR()
    // espera a resolverDesdeUrl()/escanearQR() — que pueden incluir un
    // fetch() al backend o varios frames de cámara buscando un QR — y eso
    // suele tardar más que la ventana de activación que concedió el tap
    // inicial. navigator.userActivation.isActive dice si esa ventana sigue
    // vigente en este preciso momento.
    function activacionXRVigente() {
        // Si el navegador no expone userActivation (p. ej. Safari) no hay
        // forma de saberlo de antemano; se sigue de largo porque de todos
        // modos esos navegadores no tienen WebXR AR e intentarXR() va a
        // fallar rápido por otro motivo (sin pedir nada extra al usuario).
        return !("userActivation" in navigator) || navigator.userActivation.isActive;
    }

    // Pide un toque adicional, bien pegado en el tiempo a la llamada real de
    // requestSession(), para recuperar una activación fresca cuando la del
    // botón original ya se gastó. Resuelve la promesa de forma síncrona
    // dentro del propio evento "click" del botón: el código que sigue a este
    // await corre como continuación inmediata de ese evento, así que todavía
    // cuenta como "gesto reciente" para el navegador.
    function esperarToqueXR() {
        return new Promise((resolve) => {
            if (!xrConfirmPanel || !xrConfirmBtn) {
                resolve();
                return;
            }
            setHud("");
            xrConfirmPanel.hidden = false;
            const onClick = () => {
                xrConfirmBtn.removeEventListener("click", onClick);
                xrConfirmPanel.hidden = true;
                resolve();
            };
            xrConfirmBtn.addEventListener("click", onClick);
        });
    }

    async function probablementeSoportaXR() {
        if (!("xr" in navigator)) return false;
        try {
            return await navigator.xr.isSessionSupported("immersive-ar");
        } catch (err) {
            return false;
        }
    }

    // Envoltorio de intentarXR() que se asegura de tener una activación
    // vigente justo antes de pedir la sesión. isSessionSupported() no
    // consume ni requiere activación, así que puede chequearse aparte sin
    // gastar la ventana del tap original; solo se pide un toque extra cuando
    // hace falta (WebXR realmente disponible, pero la activación ya expiró).
    async function intentarXRConActivacion() {
        const soportaXR = await probablementeSoportaXR();
        if (soportaXR && !activacionXRVigente()) {
            await esperarToqueXR();
        }
        return intentarXR();
    }

    async function intentarXR() {
        if (!("xr" in navigator)) {
            avisarSinXR("este navegador no expone navigator.xr (no es Chrome/Chromium con WebXR, o el sitio no es un contexto seguro).");
            return false;
        }

        let soportado = false;
        try {
            soportado = await navigator.xr.isSessionSupported("immersive-ar");
        } catch (err) {
            avisarSinXR("navigator.xr.isSessionSupported() falló: " + (err && err.message));
            return false;
        }
        if (!soportado) {
            avisarSinXR("navigator.xr existe, pero este navegador/dispositivo reporta que no soporta immersive-ar (revisa que sea Chrome actualizado, no el navegador del fabricante).");
            return false;
        }

        // A partir de aquí puede fallar cualquier paso (carga del CDN, negociación
        // de la sesión, referencias de espacio...). Nada de esto debe tirar abajo
        // el intento de caer al modo simulado: por eso todo el cuerpo posterior
        // vive en un único try/catch que limpia y devuelve false ante cualquier
        // error, en vez de dejarlo escapar hacia activarModoAR().
        let session = null;
        try {
            await cargarThree();

            session = await navigator.xr.requestSession("immersive-ar", {
                requiredFeatures: ["hit-test", "local"],
                optionalFeatures: ["dom-overlay", "light-estimation", "anchors", "depth-sensing"],
                domOverlay: { root: arStage },
                depthSensing: {
                    usagePreference: ["cpu-optimized", "gpu-optimized"],
                    dataFormatPreference: ["luminance-alpha", "float32"],
                },
            });

            modoXR = true;
            setModeBadge("real");
            mostrarVoiceFab(true); // dom-overlay: el botón (parte del DOM de arStage) sigue visible/interactivo dentro de la sesión XR
            mostrarScanFab(true);

            renderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true, antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.xr.enabled = true;

            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera();

            hitReticleMesh = new THREE.Mesh(
                new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ color: 0x7dffb0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
            );
            hitReticleMesh.visible = false;
            scene.add(hitReticleMesh);

            anchorGroup = new THREE.Group();
            scene.add(anchorGroup);

            configurarLucesXR();

            // three.js pide por defecto el espacio de referencia "local-floor"
            // al hacer setSession(), pero arriba solo se solicitó/concedió
            // "local" en requestSession(). Si no coinciden, algunos
            // dispositivos rechazan la sesión con NotSupportedError ("This
            // device does not support the requested reference space type").
            // Se fija aquí para que three.js pida el mismo tipo que ya se
            // negoció.
            renderer.xr.setReferenceSpaceType("local");
            await renderer.xr.setSession(session);
            xrSession = session;

            referenceSpace = renderer.xr.getReferenceSpace();
            const viewerSpace = await session.requestReferenceSpace("viewer");
            try {
                hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
            } catch (err) {
                console.warn("No se pudo iniciar el hit-test; sin él no es posible anclar al suelo.", err);
                hitTestSource = null;
            }

            configurarOcclusion(session);
            session.addEventListener("end", finalizarSesionXR);

            panel.hidden = true; // se muestra al anclar a León
            // A esta altura el QR ya se resolvió (ver escanearQR(), que corre
            // antes de intentar WebXR): lo que falta ahora es la posición.
            setHud("🔎 Busca una superficie (suelo o mesa) para anclar a León.");

            renderer.setAnimationLoop(onXRFrame);
            return true;
        } catch (err) {
            avisarSinXR("la sesión immersive-ar se negoció pero falló al iniciar: " + (err && err.name) + (err && err.message ? " — " + err.message : ""));
            if (renderer) {
                renderer.setAnimationLoop(null);
                renderer.dispose();
                renderer = null;
            }
            if (session) {
                try {
                    await session.end();
                } catch (endErr) {
                    /* la sesión puede ya estar cerrada */
                }
            }
            modoXR = false;
            xrSession = null;
            hitTestSource = null;
            return false;
        }
    }

    if (reubicarBtn) {
        reubicarBtn.addEventListener("click", () => {
            if (!modoXR || !leonColocado) return;
            reubicarBtn.hidden = true;
            panel.hidden = true;
            setHud("🔎 Buscando de nuevo una superficie…");
            // León se desvanece en su lugar (la sesión XR sigue corriendo, así
            // que se ve la transición) y recién cuando termina se reinicia el
            // hit-test: así no se ve un corte brusco a invisible mientras
            // arriba ya dice "Buscando de nuevo una superficie…".
            iniciarAnimacionSalida(() => {
                leonColocado = false;
                anchor = null;
                estabilidadReset();
            });
        });
    }

    // -- Motor 2: AR simulada (getUserMedia + orientación del teléfono) ------

    const ZEE = () => new THREE.Vector3(0, 0, 1);
    let euler, q0, q1;

    function setCameraQuaternionDesdeOrientacion(alpha, beta, gamma, orient) {
        if (!euler) {
            euler = new THREE.Euler();
            q0 = new THREE.Quaternion();
            q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° en X
        }
        euler.set(beta, alpha, -gamma, "YXZ");
        camera.quaternion.setFromEuler(euler);
        camera.quaternion.multiply(q1);
        camera.quaternion.multiply(q0.setFromAxisAngle(ZEE(), -orient));
    }

    function onDeviceOrientation(event) {
        if (event.alpha === null || !camera) return;
        const alpha = THREE.MathUtils.degToRad(event.alpha);
        const beta = THREE.MathUtils.degToRad(event.beta || 0);
        const gamma = THREE.MathUtils.degToRad(event.gamma || 0);
        const orient = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || window.orientation || 0);
        setCameraQuaternionDesdeOrientacion(alpha, beta, gamma, orient);
    }

    async function habilitarOrientacion() {
        orientacionDisponible = false;
        if (typeof DeviceOrientationEvent === "undefined") return;
        if (typeof DeviceOrientationEvent.requestPermission === "function") {
            try {
                const resp = await DeviceOrientationEvent.requestPermission();
                if (resp !== "granted") return;
            } catch (err) {
                return;
            }
        }
        window.addEventListener("deviceorientation", onDeviceOrientation);
        orientacionDisponible = true;
    }

    function configurarLucesSimuladas() {
        hemiSim = new THREE.HemisphereLight(0xffffff, 0x33241a, 0.9);
        dirSim = new THREE.DirectionalLight(0xffffff, 0.7);
        dirSim.position.set(0.5, 1, 0.6);
        scene.add(hemiSim, dirSim);
    }

    // Aproximación barata de "iluminación dinámica" sin WebXR: se muestrea el
    // color medio del frame de video (downscaled a 8x6) y se usa para teñir
    // las luces de la escena, así León responde al ambiente real capturado
    // por la cámara aunque no haya estimación de luz de verdad.
    function muestrearColorAmbiente() {
        if (!video.videoWidth) return;
        try {
            colorCtx.drawImage(video, 0, 0, 8, 6);
            const data = colorCtx.getImageData(0, 0, 8, 6).data;
            let r = 0,
                g = 0,
                b = 0,
                n = 0;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                n += 1;
            }
            r /= n;
            g /= n;
            b /= n;
            const brillo = (r + g + b) / (3 * 255);
            const intensidad = THREE.MathUtils.clamp(0.5 + brillo * 0.9, 0.4, 1.5);
            if (hemiSim) {
                hemiSim.intensity = intensidad;
                hemiSim.color.setRGB(r / 255, g / 255, b / 255);
            }
            if (dirSim) {
                dirSim.intensity = intensidad * 0.8;
            }
        } catch (err) {
            // el frame puede no estar listo aún; se reintenta en el próximo muestreo
        }
    }

    async function detectarQR() {
        if (video.readyState < video.HAVE_CURRENT_DATA) return;
        if (detectandoQR) return; // el frame anterior todavía se está procesando
        detectandoQR = true;
        frameQRcuenta += 1;
        try {
            // Se dibuja el frame UNA sola vez a un canvas propio y se usa como
            // fuente para los dos lectores. Antes se le pasaba el <video> en
            // vivo directamente a BarcodeDetector.detect(); en algunos
            // Chrome/Android esa lectura es menos confiable que un snapshot
            // estático, y así además se puede reutilizar el mismo bitmap para
            // el recorte central de más abajo sin volver a tocar el <video>.
            qrCtx.drawImage(video, 0, 0, qrCanvas.width, qrCanvas.height);

            if (barcodeDetector && !barcodeDetectorDeshabilitado) {
                try {
                    const codigos = await barcodeDetector.detect(qrCanvas);
                    if (codigos.length) {
                        mostrarQrTooltip(codigos[0].rawValue);
                        resolverPayload(extraerPayload(codigos[0].rawValue));
                        return;
                    }
                    barcodeDetectorFallas = 0; // detectó algo (aunque sea "nada"): el lector funciona de verdad
                } catch (err) {
                    barcodeDetectorFallas += 1;
                    console.warn(
                        `Modo AR: BarcodeDetector.detect() falló (${barcodeDetectorFallas}/${MAX_FALLAS_BARCODE_DETECTOR}):`,
                        err
                    );
                    if (barcodeDetectorFallas >= MAX_FALLAS_BARCODE_DETECTOR) {
                        barcodeDetectorDeshabilitado = true;
                        console.warn(
                            "Modo AR: BarcodeDetector no funciona en este dispositivo (API presente pero detect() rechaza siempre); se pasa a jsQR."
                        );
                    }
                }
            }

            if (typeof window.jsQR !== "function") return;

            let imageData;
            try {
                imageData = qrCtx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            } catch (e) {
                return;
            }
            let resultado = window.jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "attemptBoth",
            });

            // Recorte central "con zoom": más caro, así que solo cada pocos
            // frames y solo si el frame completo no dio nada. Ayuda cuando el
            // QR ocupa una porción chica del encuadre.
            if (!resultado && frameQRcuenta % 3 === 0) {
                const cw = qrCanvas.width;
                const ch = qrCanvas.height;
                const lado = Math.min(cw, ch) * 0.5;
                const sx = (cw - lado) / 2;
                const sy = (ch - lado) / 2;
                qrCropCtx.drawImage(qrCanvas, sx, sy, lado, lado, 0, 0, qrCropCanvas.width, qrCropCanvas.height);
                try {
                    const cropData = qrCropCtx.getImageData(0, 0, qrCropCanvas.width, qrCropCanvas.height);
                    resultado = window.jsQR(cropData.data, cropData.width, cropData.height, {
                        inversionAttempts: "attemptBoth",
                    });
                } catch (e) {
                    /* se ignora: se reintenta en el próximo turno */
                }
            }

            if (resultado) {
                mostrarQrTooltip(resultado.data);
                resolverPayload(extraerPayload(resultado.data));
            }
        } catch (err) {
            // Frame puntualmente ilegible (movimiento, desenfoque): se
            // reintenta solo en el próximo, sin cortar el escaneo.
        } finally {
            detectandoQR = false;
        }
    }

    async function resolverPayload(payload) {
        if (!payload || payload === lastResolvedPayload) return;
        lastResolvedPayload = payload;
        // "demo:<slug>" identifica a una experiencia de ejemplo, fija en el
        // código (ver app/services/ar_demos.py): no lleva token ni firma, así
        // que se resuelve contra su propio endpoint en vez del de /api/ar/<payload>.
        const esDemo = payload.startsWith("demo:");
        const url = esDemo
            ? `/api/ar/demo/${encodeURIComponent(payload.slice(5))}`
            : `/api/ar/${encodeURIComponent(payload)}`;
        try {
            const resp = await fetch(url);
            const datos = await resp.json();
            if (!resp.ok) throw new Error(datos.error || "No se pudo resolver el código.");
            aplicarPersonalizacion(datos);
        } catch (err) {
            lastResolvedPayload = null;
            // Antes esto fallaba en silencio total: si la cámara SÍ leía un QR
            // (checksum válido) pero el backend no lo reconocía (otro QR,
            // vencido, formato distinto), no había ninguna señal visible y el
            // HUD seguía pidiendo "escaneá el QR" para siempre.
            console.warn("Modo AR: se leyó un código pero no se pudo resolver.", err);
            setHud("⚠️ Leímos un código, pero no lo reconocimos. Probá con el del colegio o ingresalo a mano.");
        }
    }

    function mostrarEntradaManual(mostrar) {
        if (!manualToggle) return;
        manualToggle.hidden = !mostrar;
        if (!mostrar && manualForm) manualForm.hidden = true;
    }

    async function configurarTorch(mediaStream) {
        torchActivo = false;
        if (torchBtn) torchBtn.classList.remove("is-on");
        if (!torchBtn) return;
        try {
            const track = mediaStream.getVideoTracks()[0];
            const caps = track && typeof track.getCapabilities === "function" ? track.getCapabilities() : null;
            torchBtn.hidden = !(caps && caps.torch);
        } catch (err) {
            torchBtn.hidden = true;
        }
    }

    async function alternarTorch() {
        if (!stream) return;
        const track = stream.getVideoTracks()[0];
        if (!track) return;
        const nuevoValor = !torchActivo;
        try {
            await track.applyConstraints({ advanced: [{ torch: nuevoValor }] });
            torchActivo = nuevoValor;
            if (torchBtn) torchBtn.classList.toggle("is-on", torchActivo);
        } catch (err) {
            console.warn("Modo AR: no se pudo alternar la linterna.", err);
        }
    }

    // Si se abrió el enlace del QR directamente (en vez de escanearlo desde
    // dentro del Modo AR ya activo), el payload viaja en el fragmento de la
    // URL de esta misma página. Se resuelve una sola vez, al activar la cámara,
    // y ANTES de intentar escanear en vivo (ver escanearQR()): si ya viene en
    // la URL, no hace falta pedir la cámara para leer un QR físico.
    function resolverDesdeUrl() {
        if (location.hash && location.hash.length > 1) return resolverPayload(extraerPayload(location.hash));
        return Promise.resolve();
    }

    // Fase 1: escaneo del QR con la cámara "plana" (getUserMedia + jsQR),
    // ANTES de decidir/lanzar el motor de AR. Es necesario porque una sesión
    // WebXR ("AR anclada al mundo real") maneja el passthrough de la cámara
    // por dentro y no expone esos frames a la página: si el escaneo viviera
    // solo en el motor simulado (como antes), en Android con WebXR el QR
    // nunca se leería, aunque el HUD lo pidiera. Al separarlo así, el
    // escaneo funciona igual en cualquier dispositivo, y solo después de
    // resolver el QR se decide (en activarModoAR) si se entra a AR real
    // (donde recién ahí se pide la posición, ver intentarXR/onXRFrame) o a
    // la versión simulada.
    async function escanearQR() {
        if (activeExperiencia) return; // ya se resolvió por la URL (resolverDesdeUrl)

        ocultarQrTooltip();
        setHud("📷 Escanea el código QR del colegio para continuar.");

        // Si ya hay un stream de cámara plano abierto y vivo (p. ej. al volver
        // de AR simulada a escanear otro QR sin haber pasado nunca por WebXR),
        // se reutiliza en vez de pedir uno nuevo: evita un segundo permiso y
        // un parpadeo, igual que ya hace iniciarModoSimulado(). Solo si no hay
        // stream (primera vez, o porque se cerró al entrar a AR real, que
        // toma la cámara de forma exclusiva) se pide uno.
        const streamVivo = stream && stream.getVideoTracks().some((t) => t.readyState === "live");
        if (!streamVivo) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: constraintsCamara(),
                    audio: false,
                });
            } catch (err) {
                if (err && err.name === "OverconstrainedError") {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true });
                } else {
                    throw err;
                }
            }
        }
        await habilitarEnfoqueContinuo(stream);
        await configurarTorch(stream);
        mostrarEntradaManual(true);
        mostrarVoiceFab(true); // la cámara ya está activa: se puede preguntar por voz aunque no se haya leído un QR todavía
        mostrarScanFab(true);

        video.hidden = false;
        video.srcObject = stream;
        await video.play();

        await new Promise((resolve) => {
            if (video.readyState >= video.HAVE_METADATA) return resolve();
            video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        });

        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        arStage.style.setProperty("--ar-aspect", `${w} / ${h}`);
        qrCanvas.width = w;
        qrCanvas.height = h;

        // Diagnóstico visible en consola (no siempre hay devtools a mano en el
        // celular): qué lector se usó y a qué resolución quedó el stream,
        // para poder distinguir "no hay lector disponible" de "el lector
        // está andando pero la imagen no alcanza".
        console.info(
            "Modo AR: escaneo QR con",
            barcodeDetector ? "BarcodeDetector nativo" : typeof window.jsQR === "function" ? "jsQR (respaldo)" : "ningún lector",
            "— resolución del stream:",
            w + "x" + h
        );

        if (!barcodeDetector && typeof window.jsQR !== "function") {
            // Sin decodificador nativo (BarcodeDetector, solo en Chrome/Android)
            // y sin jsQR (probablemente el script del CDN no llegó a cargar:
            // sin conexión, o bloqueado por la red/el navegador). El escaneo
            // en vivo no puede funcionar así; se avisa en vez de dejar el HUD
            // pidiendo un QR que nunca se va a poder leer.
            console.warn("Modo AR: no hay ningún lector de QR disponible (ni BarcodeDetector ni jsQR).");
            setHud("⚠️ No se pudo cargar el lector de QR. Revisa tu conexión y volvé a intentar, o abrí el enlace del QR directamente.");
        }

        // Reintenta la detección en cada frame hasta que resolverPayload()
        // (disparado desde detectarQR) marque activeExperiencia.
        const inicioEscaneo = performance.now();
        let avisoLenteAvisado = false;
        let ultimoIntento = 0;
        await new Promise((resolve) => {
            const tick = () => {
                if (activeExperiencia) {
                    resolve();
                    return;
                }
                // Si tarda mucho en encontrar nada (y sí hay un decodificador
                // andando), suele ser distancia/enfoque/luz: un aviso con
                // consejos concretos ayuda más que el mensaje genérico fijo.
                if (
                    !avisoLenteAvisado &&
                    (barcodeDetector || typeof window.jsQR === "function") &&
                    performance.now() - inicioEscaneo > 8000
                ) {
                    avisoLenteAvisado = true;
                    setHud("📷 Seguimos sin leerlo: acercá el QR, buscá más luz y mantené el teléfono quieto.");
                }
                // Antes se llamaba a detectarQR() en cada frame (hasta 60/s),
                // sin ninguna necesidad: un decodificador de QR no es
                // instantáneo, y machacarlo así solo calienta el teléfono sin
                // mejorar la chance de leerlo. Con el freno del detector nativo
                // roto (ver detectarQR) y el reintento con zoom, conviene
                // dejarle margen de CPU a cada intento en vez de solaparlos.
                const ahora = performance.now();
                if (ahora - ultimoIntento > 150) {
                    ultimoIntento = ahora;
                    detectarQR();
                }
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    function aplicarPersonalizacion(datos) {
        // Se guarda ANTES de pisar activeExperiencia: si ya había una
        // experiencia distinta a la vista (se leyó un QR nuevo sin pasar por
        // "Escanear otro QR", p. ej. apuntando la cámara a otro cartel del
        // colegio mientras León seguía mostrándose), la reubicación se ve
        // como una transición (desvanece/reaparece, ver iniciarAnimacionSalida)
        // en vez de que la pose de "entrada" se dispare de golpe encima del
        // modelo anterior.
        const huboExperienciaPrevia = !!activeExperiencia && !!modelRoot && modelRoot.visible;
        activeExperiencia = datos;
        mostrarEntradaManual(false);
        ocultarQrTooltip(); // el QR se reconoció: el panel de la experiencia reemplaza al diagnóstico
        if (torchBtn) torchBtn.hidden = true;
        if (torchActivo) alternarTorch(); // no tiene sentido dejar la linterna prendida una vez reconocido el QR
        panelNombre.textContent = "🦁 " + (datos.nombre_personaje || "León");
        panelUbicacion.textContent = datos.ubicacion ? "en " + datos.ubicacion.nombre : "";
        dialogoEl.hidden = true;
        if (datos.dialogo) {
            dialogoEl.textContent = datos.dialogo;
            dialogoEl.hidden = false;
        }

        // Fuera de WebXR no hace falta anclar a una superficie real: el QR
        // reconocido es la señal que dispara la aparición de León. En XR, en
        // cambio, la colocación queda a cargo del hit-test (ver onXRFrame),
        // que ya revisa activeExperiencia en cada frame.
        if (!modoXR && anchorGroup) {
            if (huboExperienciaPrevia) {
                iniciarAnimacionSalida(() => crearGrupoLeonSiHaceFalta(reproducirDialogoSiCorresponde));
            } else {
                crearGrupoLeonSiHaceFalta(reproducirDialogoSiCorresponde);
            }
        }

        panel.hidden = false;
        setEstadoLeon("greet");
        setHud("✨ " + (datos.nombre_personaje || "León") + " te reconoció.");

        if (datos.modelo_url) cargarModeloPersonalizado(datos.modelo_url, datos);
    }

    async function cargarModeloPersonalizado(url, datos) {
        try {
            const gltf = await gltfLoader.loadAsync(url);
            const modelo = gltf.scene;
            normalizarModelo(modelo);
            modelo.traverse((child) => {
                if (child.isMesh) child.castShadow = true;
            });

            modelRoot.children.slice().forEach((child) => {
                if (child.isGroup || child.isMesh) {
                    modelRoot.remove(child);
                    disposeObject(child);
                }
            });
            modelRoot.add(modelo);
            modelRoot.add(modoXR ? crearSombraCatcherReal() : crearSombraFalsa());
            leonActivo = null; // el rig procedural ya no se anima: ahora animan los clips del .glb

            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(modelo);
                ultimoGltfAnimations = gltf.animations;
                const inicial = datos.animacion_inicial || "idle";
                const clip =
                    gltf.animations.find((c) => c.name.toLowerCase().includes(inicial.toLowerCase())) || gltf.animations[0];
                mixer.clipAction(clip).play();
            }
        } catch (err) {
            console.warn("No se pudo cargar el modelo personalizado; se conserva a León de reemplazo:", err);
        }
    }

    async function iniciarModoSimulado() {
        modoXR = false;
        setModeBadge("simulada");
        mostrarVoiceFab(true); // por si el QR se resolvió desde la URL y escanearQR() nunca llegó a mostrarlo
        mostrarScanFab(true);

        // Si escanearQR() ya abrió la cámara para leer el QR, se reutiliza el
        // mismo stream en vez de pedirlo de nuevo (evita un segundo permiso y
        // un parpadeo). Solo se pide uno nuevo si por algún motivo no hay uno
        // abierto todavía (p. ej. si en el futuro se llama a este motor sin
        // pasar por la fase de escaneo).
        if (!stream) {
            setHud("Solicitando permiso de cámara…");
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: constraintsCamara(),
                    audio: false,
                });
            } catch (err) {
                if (err && err.name === "OverconstrainedError") {
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    } catch (err2) {
                        return mostrarError(err2);
                    }
                } else {
                    return mostrarError(err);
                }
            }
            await habilitarEnfoqueContinuo(stream);

            video.hidden = false;
            video.srcObject = stream;
            await video.play();

            await new Promise((resolve) => {
                if (video.readyState >= video.HAVE_METADATA) return resolve();
                video.addEventListener("loadedmetadata", () => resolve(), { once: true });
            });
        }

        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        arStage.style.setProperty("--ar-aspect", `${w} / ${h}`);
        qrCanvas.width = w;
        qrCanvas.height = h;

        await cargarThree();

        renderer = new THREE.WebGLRenderer({ canvas: overlayCanvas, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const cw = overlayCanvas.clientWidth || w;
        const ch = overlayCanvas.clientHeight || h;
        renderer.setSize(cw, ch, false);

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(58, cw / ch, 0.01, 100);

        configurarLucesSimuladas();

        anchorGroup = new THREE.Group();
        anchorGroup.position.set(0, -0.32, -1.3); // fijo frente a la posición inicial de la cámara
        scene.add(anchorGroup);

        // El QR ya se resolvió antes de llegar acá (ver escanearQR() /
        // resolverDesdeUrl en activarModoAR), así que León aparece de una vez;
        // aplicarPersonalizacion() ya dejó cargados nombre/diálogo, solo
        // faltaba este anchorGroup para poder materializarlo.
        if (activeExperiencia) {
            crearGrupoLeonSiHaceFalta(reproducirDialogoSiCorresponde);
            panel.hidden = false;
        }

        await habilitarOrientacion();

        clock = new THREE.Clock();
        ultimaMuestraColor = 0;
        requestAnimationFrame(tickSimulado);

        setHud(
            orientacionDisponible
                ? "🦁 León apareció frente a ti. Mueve el teléfono para mirar alrededor."
                : "🦁 León apareció frente a ti."
        );
    }

    function tickSimulado() {
        animId = requestAnimationFrame(tickSimulado);
        const delta = clock ? clock.getDelta() : 0;
        const ahora = performance.now();

        if (ahora - lastDetectAt > 220) {
            lastDetectAt = ahora;
            detectarQR();
        }
        if (ahora - ultimaMuestraColor > 500) {
            ultimaMuestraColor = ahora;
            muestrearColorAmbiente();
        }

        actualizarLeon(delta, ahora);
        if (mixer) mixer.update(delta);
        if (renderer && scene && camera) renderer.render(scene, camera);
    }

    function detenerCamara() {
        if (animId) cancelAnimationFrame(animId);
        animId = null;
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
        if (renderer && !modoXR) renderer.dispose();
        detenerHabla();
        if (voiceRecognition && escuchandoPregunta) {
            try {
                voiceRecognition.abort();
            } catch (err) {
                /* la sesión de reconocimiento puede ya estar cerrada */
            }
        }
    }

    // -- Reacciones a la IA: saludo / piensa / responde -----------------------
    // app.js dispara este evento cuando el asistente del portal empieza a
    // pensar o termina de responder. Si el Modo AR está activo en esta misma
    // página, León adopta la pose correspondiente.
    window.addEventListener("portal:assistant-state", (ev) => {
        const s = ev.detail && ev.detail.state;
        if (s === "thinking") setEstadoLeon("thinking");
        else if (s === "talking") setEstadoLeon("talking");
        else if (s === "idle") setEstadoLeon("idle");
    });

    if (torchBtn) {
        torchBtn.addEventListener("click", alternarTorch);
    }

    // Alternativa cuando la cámara no puede leer el QR (pantalla con
    // muaré/reflejo, poca resolución, código dañado, etc.): pegar el enlace
    // completo del QR o el payload a mano hace exactamente lo mismo que
    // resolverlo desde la URL (ver resolverDesdeUrl).
    if (manualToggle && manualForm && manualInput) {
        manualToggle.addEventListener("click", () => {
            manualForm.hidden = !manualForm.hidden;
            if (!manualForm.hidden) manualInput.focus();
        });
        manualForm.addEventListener("submit", (ev) => {
            ev.preventDefault();
            const valor = manualInput.value.trim();
            if (!valor) return;
            resolverPayload(extraerPayload(valor));
            manualForm.hidden = true;
            manualInput.value = "";
        });
    }

    interactBtn.addEventListener("click", () => {
        // Mismo guard que hablar(): sonido_url es el único audio del archivo
        // que NO pasa por hablar() (es un <audio> grabado, no síntesis de
        // voz), así que necesita su propio chequeo de leonListo para que la
        // regla "nunca antes de que León esté ubicado" también lo cubra a él.
        if (leonListo && activeExperiencia && activeExperiencia.sonido_url) {
            const audio = new Audio(activeExperiencia.sonido_url);
            audio.play().catch(() => {
                /* la reproducción automática puede fallar en algunos navegadores; no es crítico */
            });
        } else if (activeExperiencia && activeExperiencia.modo_audio && activeExperiencia.dialogo) {
            hablar(activeExperiencia.dialogo); // hablar() ya descarta esto solo si !leonListo
        }

        if (mixer && ultimoGltfAnimations.length && activeExperiencia && activeExperiencia.animacion_interaccion) {
            const nombre = activeExperiencia.animacion_interaccion.toLowerCase();
            const clip = ultimoGltfAnimations.find((c) => c.name.toLowerCase().includes(nombre));
            if (clip) {
                const accion = mixer.clipAction(clip);
                accion.reset();
                accion.setLoop(THREE.LoopOnce, 1);
                accion.clampWhenFinished = true;
                accion.play();
            }
        }

        if (activeExperiencia && activeExperiencia.dialogo) {
            dialogoEl.textContent = activeExperiencia.dialogo;
            dialogoEl.hidden = false;
        }

        setEstadoLeon("greet");
    });

    // -- Redimensionado -------------------------------------------------------

    function onResize() {
        if (!renderer || !camera || modoXR) return; // en XR, three.js ajusta la cámara con las vistas de cada frame
        const w = overlayCanvas.clientWidth;
        const h = overlayCanvas.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    }
    window.addEventListener("resize", onResize);

    // -- Activación (automática al cargar, sin pantalla ni gesto previo) ------

    // Evita que activarModoAR() arranque dos veces.
    let arModoActivado = false;

    async function activarModoAR() {
        if (arModoActivado) return;
        arModoActivado = true;
        setHud("Preparando Modo AR…");
        try {
            // Primero el QR, después la posición: si la URL ya trae un QR
            // resuelto (p. ej. el enlace de /ar/demo/biblioteca, o el de un
            // QR físico abierto con la cámara del sistema), se lo usa tal
            // cual; si no, se pide escanearlo en vivo con la cámara antes de
            // tocar WebXR/el modo simulado.
            await resolverDesdeUrl();
            if (!activeExperiencia) await escanearQR();

            const xrOk = await intentarXRConActivacion();
            if (xrOk) {
                // WebXR maneja su propio passthrough de cámara: la vista
                // previa "plana" que usó escanearQR() ya no hace falta.
                if (stream) {
                    stream.getTracks().forEach((track) => track.stop());
                    stream = null;
                }
                video.hidden = true;
                video.srcObject = null;
            } else {
                await iniciarModoSimulado(); // reutiliza el stream de escanearQR() si ya está abierto
            }
        } catch (err) {
            mostrarError(err);
        }
    }

    // Vuelve a escanear un QR sin recargar la página, una vez que León ya
    // apareció (ver arRescanBtn en ar.html, dentro de arPanel). En modo
    // simulado alcanza con resetear el estado: el loop de detección
    // (tickSimulado -> detectarQR) sigue corriendo de fondo y el próximo QR
    // reconocido dispara aplicarPersonalizacion() de nuevo. En AR real, en
    // cambio, la sesión WebXR es la que maneja el passthrough de cámara y no
    // expone esos frames a la página (ver el comentario de escanearQR): hay
    // que cerrarla primero y repetir el mismo camino que activarModoAR()
    // (escanear con la cámara "plana" y recién después decidir de nuevo si
    // se entra a AR real o a la versión simulada).
    async function escanearNuevoQR() {
        detenerHabla();
        leonListo = false; // vuelve a escanear: el León anterior ya no cuenta como "ubicado"
        activeExperiencia = null;
        lastResolvedPayload = null;
        panel.hidden = true;
        dialogoEl.hidden = true;
        if (reubicarBtn) reubicarBtn.hidden = true;
        ocultarQrTooltip();
        if (rescanBtn) rescanBtn.disabled = true;
        if (scanFab) scanFab.disabled = true;

        if (modoXR) {
            // La sesión XR (y con ella el render loop) está a punto de
            // terminar: no alcanza a verse una animación de desvanecido, así
            // que acá se sigue cortando de golpe (a diferencia del modo
            // simulado más abajo, donde el loop sigue corriendo sin pausa).
            if (modelRoot) modelRoot.visible = false;
            if (xrSession) {
                try {
                    await xrSession.end(); // dispara finalizarSesionXR (limpia xrSession/hitTestSource/anchor/modoXR)
                } catch (err) {
                    /* la sesión puede ya estar terminando */
                }
            }
            // La escena XR (scene/anchorGroup) queda descartada junto con la
            // sesión: sin resetear estas referencias, crearGrupoLeonSiHaceFalta()
            // reutilizaría un León ya "colgado" de una escena que ya no se
            // renderiza, y no se vería nada al reconocer el próximo QR.
            if (renderer) {
                try {
                    renderer.dispose();
                } catch (err) {
                    /* nada que limpiar si ya estaba descartado */
                }
                renderer = null;
            }
            modelRoot = null;
            leonActivo = null;
            mixer = null;
            ultimoGltfAnimations = [];
            destelloMesh = null;

            setHud("Preparando para escanear un nuevo código…");
            try {
                await escanearQR();
                const xrOk = await intentarXRConActivacion();
                if (xrOk) {
                    if (stream) {
                        stream.getTracks().forEach((track) => track.stop());
                        stream = null;
                    }
                    video.hidden = true;
                    video.srcObject = null;
                } else {
                    await iniciarModoSimulado();
                }
            } catch (err) {
                mostrarError(err);
            }
        } else {
            // Modo simulado: el render loop (tickSimulado) no se interrumpe
            // en ningún momento, así que León puede desvanecerse con su
            // propia animación de salida en vez de cortar a invisible de
            // golpe (ver iniciarAnimacionSalida). detectarQR() sigue
            // corriendo igual mientras tanto, así que un QR ya puede
            // reconocerse durante el desvanecido.
            iniciarAnimacionSalida();
            mostrarEntradaManual(true);
            if (stream) await configurarTorch(stream); // por si convenía la linterna para el QR anterior y sigue disponible
            setHud("📷 Escaneá un nuevo código QR del colegio.");
        }

        if (rescanBtn) rescanBtn.disabled = false;
        if (scanFab) scanFab.disabled = false;
    }

    if (rescanBtn) {
        rescanBtn.addEventListener("click", escanearNuevoQR);
    }

    if (scanFab) {
        scanFab.addEventListener("click", escanearNuevoQR);
    }

    document.addEventListener("visibilitychange", () => {
        if (modoXR) return; // WebXR gestiona su propio ciclo de vida al perder el foco
        if (document.hidden) {
            if (animId) cancelAnimationFrame(animId);
            animId = null;
        } else if (stream && !animId && THREE) {
            requestAnimationFrame(tickSimulado);
        }
    });

    window.addEventListener("pagehide", () => {
        detenerCamara();
        if (xrSession) xrSession.end().catch(() => {});
    });

    // Ya no hay pantalla "Activá la cámara" ni gesto previo que esperar: se
    // arranca directo apenas carga la página. Esto NO se salta el paso de
    // "reubicar a León": como este arranque no viene de un click real,
    // activacionXRVigente() (ver más arriba) nota que no hay activación
    // vigente y intentarXRConActivacion() pide igual un toque extra (panel
    // arXrConfirm, "Tocá para anclar a León") antes de anclar en AR real, así
    // que la posición se vuelve a pedir después de cada QR escaneado, como
    // corresponde. En cambio, si el dispositivo no admite WebXR AR (o el
    // navegador exige un gesto explícito para getUserMedia, p. ej. iPhone/
    // Safari), la cámara puede rechazarse con NotAllowedError; en ese caso
    // mostrarError() explica cómo habilitarla desde los ajustes del
    // navegador y reintentar.
    //
    // -- Arranque -------------------------------------------------------------

    if (comprobarSoporte()) {
        // Precarga three.js/GLTFLoader en segundo plano, sin esperar a
        // ningún gesto del usuario: import() no requiere ni consume "user
        // activation". Así, para cuando intentarXR() por fin llegue a pedir
        // la sesión (incluso justo después del toque extra de
        // intentarXRConActivacion), el módulo ya está en caché y no gasta
        // esa ventana en la descarga desde el CDN.
        cargarThree().catch((err) => {
            console.warn("Modo AR: no se pudo precargar three.js; se reintentará al activar la cámara.", err);
        });

        activarModoAR();
    }
})();
