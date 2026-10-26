/*
 * «Cómo llegar»: navegación interna paso a paso (estilo PathView).
 *
 * Flujo: elegir origen (lista, mapa, QR «Estás aquí» con ?desde=<id> o
 * «Desde mi ubicación», que sigue el GPS en vivo)
 * y destino -> /api/rutas/calcular -> ruta en el mapa por piso + lista de
 * indicaciones -> modo paso a paso con foto, voz y cambio de piso automático.
 * La URL guarda desde/hasta/accesible, así que la ruta se puede compartir.
 */
(function () {
    "use strict";

    const RC = window.RutasComun;
    const $ = (id) => document.getElementById(id);

    const el = {
        form: $("rutasForm"),
        desde: $("rutasDesde"),
        hasta: $("rutasHasta"),
        intercambiar: $("rutasIntercambiar"),
        gps: $("rutasGps"),
        accesible: $("rutasAccesible"),
        mensaje: $("rutasMensaje"),
        resumen: $("rutasResumen"),
        resumenDatos: $("rutasResumenDatos"),
        iniciar: $("rutasIniciar"),
        voz: $("rutasVoz"),
        compartir: $("rutasCompartir"),
        mapa: $("rutasMapa"),
        pasos: $("rutasPasos"),
        pasoActual: $("rutasPasoActual"),
        pasoFoto: $("rutasPasoFoto"),
        pasoContador: $("rutasPasoContador"),
        pasoTexto: $("rutasPasoTexto"),
        anterior: $("rutasAnterior"),
        siguiente: $("rutasSiguiente"),
        salirPasos: $("rutasSalirPasos"),
    };

    const estado = {
        config: null,
        nodos: new Map(),
        desde: null,
        hasta: null,
        ruta: null,
        paso: -1, // -1 = vista general
        voz: false,
    };

    let mapa, pisos, capaRuta, capaNodos, capaGps, botonCentrar;

    function leerFlujoRutaGuardado() {
        try {
            const raw = sessionStorage.getItem("portal:assistant:route");
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    /* ---------- Mensajes ---------- */

    function mensaje(tipo, html) {
        if (!html) {
            el.mensaje.hidden = true;
            return;
        }
        el.mensaje.dataset.tipo = tipo;
        el.mensaje.innerHTML = html;
        el.mensaje.hidden = false;
    }

    /* ---------- Origen / destino ---------- */

    function opcionesPuntos() {
        return [...estado.nodos.values()]
            .filter((n) => n.seleccionable)
            .map((n) => ({
                id: n.id,
                etiqueta: n.etiqueta,
                detalle: RC.nombrePiso(n.piso, estado.config),
                icono: n.icono,
                texto: RC.normalizar(`${n.etiqueta} ${n.ubicacion || ""} ${n.descripcion || ""} ${n.tipo} piso ${n.piso}`),
            }));
    }

    function fijar(campo, id) {
        const nodo = estado.nodos.get(Number(id));
        if (!nodo) return false;
        if (campo === "desde" && gps.activo) desactivarGps();
        estado[campo] = nodo.id;
        (campo === "desde" ? el.desde : el.hasta).value = nodo.etiqueta;
        dibujarNodos();
        return true;
    }

    /* ---------- Desde mi ubicación (GPS en vivo) ---------- */

    // maximumAge evita pedir lecturas nuevas más seguido de lo necesario.
    const GEO_OPCIONES = { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 };
    const DISTANCIA_MAXIMA_M = 300; // más lejos que esto: no estás en el colegio
    const PRECISION_BAJA_M = 50;

    const gps = {
        activo: false,
        watchId: null,
        pausado: false,
        posicion: null,
        precision: null,
        avisoPrecision: false,
        conError: false, // hay un aviso de error del GPS en pantalla
        temporizador: null,
    };

    /** Punto de la red más cercano. El GPS no sabe el piso: se usa el que se ve. */
    function nodoMasCercano(latlng) {
        const todos = [...estado.nodos.values()];
        const enPiso = todos.filter((n) => n.piso === pisos.piso());
        let mejor = null;
        let distancia = Infinity;
        for (const n of enPiso.length ? enPiso : todos) {
            const d = latlng.distanceTo([n.latitud, n.longitud]);
            if (d < distancia) { mejor = n; distancia = d; }
        }
        return { nodo: mejor, distancia };
    }

    function pintarBotonGps(icono, etiqueta) {
        el.gps.setAttribute("aria-pressed", String(gps.activo));
        el.gps.textContent = icono;
        el.gps.title = etiqueta;
        el.gps.setAttribute("aria-label", etiqueta);
        botonCentrar.hidden = !gps.posicion;
    }

    async function activarGps() {
        if (!("geolocation" in navigator)) {
            mensaje("error", "Tu navegador no permite obtener la ubicación. Elige el punto de partida en la lista o escanea un QR «Estás aquí».");
            return;
        }
        if (!window.isSecureContext) {
            mensaje("error", "La ubicación solo funciona si la página se abre con HTTPS (o en localhost). Elige el punto de partida en la lista.");
            return;
        }
        // Si el permiso ya está bloqueado, el navegador no volverá a preguntar.
        try {
            const permiso = await navigator.permissions?.query({ name: "geolocation" });
            if (permiso?.state === "denied") {
                mensaje("error", mensajePermisoDenegado());
                return;
            }
        } catch (_) { /* Permissions API no disponible: se intenta igual. */ }

        gps.activo = true;
        gps.avisoPrecision = false;
        el.desde.value = "📍 Buscando tu ubicación…";
        pintarBotonGps("⏳", "Buscando tu ubicación… (toca para cancelar)");
        mensaje("info", "Buscando tu ubicación… Si el navegador lo pide, permite el acceso.");
        vigilar();
    }

    function vigilar() {
        if (gps.watchId !== null) return;
        gps.watchId = navigator.geolocation.watchPosition(alRecibirPosicion, alFallarPosicion, GEO_OPCIONES);
    }

    function dejarDeVigilar() {
        if (gps.watchId !== null) {
            navigator.geolocation.clearWatch(gps.watchId);
            gps.watchId = null;
        }
    }

    function desactivarGps() {
        dejarDeVigilar();
        clearTimeout(gps.temporizador);
        gps.activo = false;
        gps.pausado = false;
        gps.posicion = null;
        capaGps.clearLayers();
        const origen = estado.nodos.get(estado.desde);
        el.desde.value = origen ? origen.etiqueta : "";
        el.desde.title = "";
        pintarBotonGps("📍", "Desde mi ubicación");
    }

    function mensajePermisoDenegado() {
        return "Permiso de ubicación denegado. Para usar «Desde mi ubicación», permite el acceso en la configuración del navegador (ícono 🔒 junto a la dirección) o elige el punto en la lista.";
    }

    function alRecibirPosicion(pos) {
        const { latitude, longitude, accuracy } = pos.coords;
        const yo = L.latLng(latitude, longitude);
        const primera = !gps.posicion;
        // Una lectura buena después de un fallo pasajero borra el aviso.
        if (gps.conError) {
            gps.conError = false;
            mensaje(null);
        }
        gps.posicion = yo;
        gps.precision = accuracy;
        dibujarGps();
        pintarBotonGps("📍", "Ubicación activa (toca para apagar)");
        if (primera && !estado.ruta) mapa.setView(yo, Math.max(mapa.getZoom(), 19));

        const { nodo, distancia } = nodoMasCercano(yo);
        if (!nodo || distancia > DISTANCIA_MAXIMA_M) {
            el.desde.value = "📍 Mi ubicación (lejos del colegio)";
            mensaje("aviso", `Estás a ${RC.formatearMetros(distancia)} del colegio. Cuando llegues, la ruta saldrá desde donde estés; mientras tanto puedes elegir el punto de partida en la lista.`);
            return;
        }
        el.desde.value = "📍 Mi ubicación";
        el.desde.title = `Cerca de ${nodo.etiqueta} (±${Math.round(accuracy)} m)`;

        if (accuracy > PRECISION_BAJA_M && !gps.avisoPrecision) {
            gps.avisoPrecision = true;
            mensaje("aviso", `Precisión baja (±${Math.round(accuracy)} m). Dentro de los edificios el GPS se desvía: si el punto no es correcto, elígelo en la lista.`);
        } else if (primera) {
            mensaje(null);
        }

        if (estado.ruta && estado.paso >= 0) {
            // Paso a paso en curso: se avanza solo al llegar al final del paso.
            avanzarSiLlego(yo, accuracy);
        } else if (estado.desde !== nodo.id) {
            estado.desde = nodo.id;
            dibujarNodos();
            if (estado.hasta) {
                // Se espera un poco para no recalcular con cada lectura del GPS.
                clearTimeout(gps.temporizador);
                gps.temporizador = setTimeout(() => calcular({ silencioso: true }), primera ? 0 : 1500);
            } else if (primera) {
                el.hasta.focus();
            }
        }
    }

    function avanzarSiLlego(yo, precision) {
        const paso = estado.ruta.pasos[estado.paso];
        if (!paso || paso.cambio_piso || paso.tipo === "llegada") return;
        const meta = estado.nodos.get(paso.nodos[paso.nodos.length - 1]);
        if (!meta) return;
        const radio = Math.max(5, Math.min(precision, 12));
        if (yo.distanceTo([meta.latitud, meta.longitud]) <= radio) irAPaso(estado.paso + 1);
    }

    function alFallarPosicion(err) {
        gps.conError = true;
        if (err.code === err.PERMISSION_DENIED) {
            desactivarGps();
            mensaje("error", mensajePermisoDenegado());
        } else if (err.code === err.POSITION_UNAVAILABLE) {
            if (!gps.posicion) desactivarGps();
            mensaje("error", "No se pudo determinar tu ubicación. Verifica que la ubicación (GPS) del celular esté activada.");
        } else {
            // TIMEOUT: watchPosition sigue intentando; solo se informa.
            mensaje("aviso", gps.posicion
                ? "La señal GPS es débil; tu ubicación puede no estar actualizada."
                : "La señal GPS está tardando. Sigue intentándolo… (mejor cerca de una ventana o al aire libre)");
        }
    }

    /** Punto azul, círculo de precisión y línea hasta el inicio de la ruta. */
    function dibujarGps() {
        capaGps.clearLayers();
        if (!gps.posicion) return;
        L.circle(gps.posicion, { radius: gps.precision, className: "rutas-gps-precision", interactive: false }).addTo(capaGps);
        L.marker(gps.posicion, {
            icon: L.divIcon({ className: "rutas-nodo-envoltura", html: '<span class="rutas-gps"><span></span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
            keyboard: false,
            zIndexOffset: 1000,
            title: "Tu ubicación",
        }).bindTooltip(`Estás aquí (±${Math.round(gps.precision)} m)`, { direction: "top", offset: [0, -10] }).addTo(capaGps);

        const inicio = estado.ruta ? estado.nodos.get(estado.ruta.puntos[0].id) : estado.nodos.get(estado.desde);
        if (inicio && inicio.piso === pisos.piso()) {
            L.polyline([gps.posicion, [inicio.latitud, inicio.longitud]], { className: "rutas-gps-enlace", interactive: false }).addTo(capaGps);
        }
    }

    /** Pausa el GPS con la pestaña oculta (ahorra batería) y lo reanuda al volver. */
    function alCambiarVisibilidad() {
        if (document.hidden) {
            if (gps.watchId !== null) {
                dejarDeVigilar();
                gps.pausado = true;
            }
        } else if (gps.pausado && gps.activo) {
            gps.pausado = false;
            vigilar();
        }
    }

    function crearBotonCentrar() {
        const Control = L.Control.extend({
            options: { position: "topleft" },
            onAdd() {
                const b = L.DomUtil.create("button", "rutas-centrar leaflet-bar");
                b.type = "button";
                b.textContent = "🎯";
                b.title = "Centrar en mi ubicación";
                b.setAttribute("aria-label", "Centrar en mi ubicación");
                b.hidden = true;
                L.DomEvent.disableClickPropagation(b);
                L.DomEvent.on(b, "click", () => gps.posicion && mapa.flyTo(gps.posicion, Math.max(mapa.getZoom(), 19), { duration: 0.6 }));
                botonCentrar = b;
                return b;
            },
        });
        new Control().addTo(mapa);
    }

    /* ---------- Mapa ---------- */

    function dibujarNodos() {
        capaNodos.clearLayers();
        const piso = pisos.piso();
        for (const n of estado.nodos.values()) {
            if (!n.seleccionable || n.piso !== piso) continue;
            const esA = n.id === estado.desde;
            const esB = n.id === estado.hasta;
            const m = L.marker([n.latitud, n.longitud], {
                icon: RC.iconoNodo(n, esA ? "es-a" : esB ? "es-b" : ""),
                title: n.etiqueta,
                keyboard: true,
                zIndexOffset: esA || esB ? 500 : 0,
            });
            const div = document.createElement("div");
            div.className = "rutas-popup";
            div.innerHTML = `<strong>${RC.escapar(n.etiqueta)}</strong>
                <small>${RC.escapar(RC.nombrePiso(n.piso, estado.config))}</small>
                ${n.descripcion ? `<p>${RC.escapar(n.descripcion)}</p>` : ""}
                ${n.foto_url ? `<img src="${RC.escapar(n.foto_url)}" alt="" loading="lazy">` : ""}
                <div class="rutas-popup__acciones">
                    <button type="button" class="btn btn-sm btn-outline-primary" data-accion="desde">Salir de aquí</button>
                    <button type="button" class="btn btn-sm btn-primary" data-accion="hasta">Ir aquí</button>
                </div>`;
            div.addEventListener("click", (e) => {
                const accion = e.target.closest("[data-accion]")?.dataset.accion;
                if (!accion) return;
                mapa.closePopup();
                fijar(accion, n.id);
                if (estado.desde && estado.hasta) calcular();
            });
            m.bindPopup(div, { maxWidth: 240 });
            capaNodos.addLayer(m);
        }
    }

    function dibujarRuta() {
        capaRuta.clearLayers();
        const ruta = estado.ruta;
        if (!ruta) return;
        const piso = pisos.piso();
        const puntos = ruta.puntos;

        // Tramos del piso visible (sólidos) y del resto (tenues, de referencia).
        let tramo = [];
        const cerrar = (enPiso) => {
            if (tramo.length > 1) {
                L.polyline(tramo, { className: enPiso ? "rutas-linea" : "rutas-linea rutas-linea--otro-piso", interactive: false }).addTo(capaRuta);
            }
            tramo = [];
        };
        for (let i = 0; i < puntos.length; i++) {
            const p = puntos[i];
            const anterior = puntos[i - 1];
            if (anterior && anterior.piso !== p.piso) {
                cerrar(anterior.piso === piso);
                // Marcador de cambio de piso, en el piso visible.
                const origenVisible = anterior.piso === piso ? anterior : p.piso === piso ? p : null;
                if (origenVisible) {
                    const sube = p.piso > anterior.piso;
                    const otro = origenVisible === anterior ? p.piso : anterior.piso;
                    const texto = origenVisible === anterior
                        ? `${sube ? "Sube" : "Baja"} al ${RC.nombrePiso(p.piso, estado.config).toLowerCase()}`
                        : `Llegas desde el ${RC.nombrePiso(anterior.piso, estado.config).toLowerCase()}`;
                    L.marker([origenVisible.latitud, origenVisible.longitud], {
                        icon: L.divIcon({
                            className: "rutas-nodo-envoltura",
                            html: `<span class="rutas-cambio-piso">${sube ? "⏫" : "⏬"}</span>`,
                            iconSize: [34, 34],
                            iconAnchor: [17, 17],
                        }),
                        title: texto,
                        zIndexOffset: 800,
                    }).bindTooltip(`${texto} (toca para verlo)`).on("click", () => pisos.setPiso(otro, true)).addTo(capaRuta);
                }
            }
            tramo.push([p.latitud, p.longitud]);
        }
        cerrar(puntos[puntos.length - 1].piso === piso);

        const a = puntos[0];
        const b = puntos[puntos.length - 1];
        const marcaFin = (p, clase, letra, titulo) => {
            if (p.piso !== piso) return;
            L.marker([p.latitud, p.longitud], {
                icon: L.divIcon({ className: "rutas-nodo-envoltura", html: `<span class="rutas-extremo ${clase}">${letra}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
                title: titulo,
                zIndexOffset: 900,
                interactive: false,
            }).addTo(capaRuta);
        };
        marcaFin(a, "rutas-extremo--a", "A", "Inicio");
        marcaFin(b, "rutas-extremo--b", "🏁", "Destino");

        // Resalta el paso actual.
        const paso = ruta.pasos[estado.paso];
        if (paso) {
            const latlngs = paso.nodos
                .map((id) => estado.nodos.get(id))
                .filter((n) => n && n.piso === piso)
                .map((n) => [n.latitud, n.longitud]);
            if (latlngs.length > 1) {
                L.polyline(latlngs, { className: "rutas-linea rutas-linea--actual", interactive: false }).addTo(capaRuta);
            }
        }
    }

    function encuadrar() {
        const ruta = estado.ruta;
        if (!ruta) return;
        const piso = pisos.piso();
        const paso = ruta.pasos[estado.paso];
        let puntos;
        if (paso) {
            puntos = paso.nodos.map((id) => estado.nodos.get(id)).filter((n) => n && n.piso === piso);
        } else {
            puntos = ruta.puntos.filter((p) => p.piso === piso);
        }
        if (!puntos.length) return;
        const limites = L.latLngBounds(puntos.map((p) => [p.latitud, p.longitud]));
        // Un solo punto (p. ej. un cambio de piso): se centra sin acercar de más.
        if (limites.getNorthEast().equals(limites.getSouthWest())) {
            mapa.flyTo(limites.getCenter(), Math.max(mapa.getZoom(), 19), { duration: 0.6 });
        } else {
            mapa.flyToBounds(limites.pad(0.3), { maxZoom: 20, duration: 0.6 });
        }
    }

    /* ---------- Ruta ---------- */

    function urlRuta() {
        const params = new URLSearchParams();
        if (estado.desde) params.set("desde", estado.desde);
        if (estado.hasta) params.set("hasta", estado.hasta);
        if (el.accesible.checked) params.set("accesible", "1");
        return `${location.origin}${location.pathname}?${params}`;
    }

    async function calcular({ silencioso = false } = {}) {
        if (!estado.desde || !estado.hasta) {
            mensaje("aviso", !estado.desde ? "Elige desde dónde sales." : "Elige a dónde quieres ir.");
            (!estado.desde ? el.desde : el.hasta).focus();
            return;
        }
        history.replaceState(null, "", urlRuta());
        if (!silencioso) mensaje("info", "Calculando la ruta…");
        try {
            const params = new URLSearchParams({ desde: estado.desde, hasta: estado.hasta });
            if (el.accesible.checked) params.set("accesible", "1");
            estado.ruta = await RC.api(`/api/rutas/calcular?${params}`);
        } catch (e) {
            estado.ruta = null;
            el.resumen.hidden = true;
            el.pasos.innerHTML = "";
            el.pasoActual.hidden = true;
            capaRuta.clearLayers();
            mensaje("error", RC.escapar(e.message));
            return;
        }
        if (!silencioso) mensaje(null);
        estado.paso = -1;
        pintarResumen();
        pintarPasos();
        const piso = estado.ruta.puntos[0].piso;
        if (pisos.piso() !== piso) pisos.setPiso(piso);
        else { dibujarNodos(); dibujarRuta(); }
        dibujarGps();
        encuadrar();
        mostrarPasoActual();
    }

    function pintarResumen() {
        const r = estado.ruta;
        const cambios = r.pasos.filter((p) => p.cambio_piso).length;
        el.resumenDatos.innerHTML = `
            <span class="rutas-resumen__tiempo">${r.minutos} min</span>
            <span>${RC.formatearMetros(r.metros)}</span>
            ${cambios ? `<span>${cambios} cambio${cambios > 1 ? "s" : ""} de piso</span>` : ""}
            ${r.accesible ? '<span class="rutas-resumen__badge">♿ Accesible</span>' : ""}`;
        el.resumen.hidden = false;
    }

    function pintarPasos() {
        el.pasos.innerHTML = "";
        estado.ruta.pasos.forEach((p, i) => {
            const li = document.createElement("li");
            li.className = "rutas-paso";
            li.innerHTML = `
                <button type="button" class="rutas-paso__boton" data-i="${i}">
                    <span class="rutas-paso__icono" aria-hidden="true">${RC.escapar(p.icono)}</span>
                    <span class="rutas-paso__texto">
                        ${RC.escapar(p.texto)}
                        <small>${RC.escapar(RC.nombrePiso(p.piso, estado.config))}</small>
                    </span>
                    ${p.foto_url ? `<img class="rutas-paso__foto" src="${RC.escapar(p.foto_url)}" alt="" loading="lazy">` : ""}
                </button>`;
            el.pasos.append(li);
        });
    }

    function irAPaso(i) {
        const r = estado.ruta;
        if (!r) return;
        estado.paso = Math.max(-1, Math.min(i, r.pasos.length - 1));
        const paso = r.pasos[estado.paso];
        el.pasos.querySelectorAll(".rutas-paso").forEach((li, j) => li.classList.toggle("is-actual", j === estado.paso));
        if (paso) {
            el.pasos.children[estado.paso]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            // En un cambio de piso se muestra el piso al que se llega.
            if (paso.piso !== pisos.piso()) pisos.setPiso(paso.piso);
            else dibujarRuta();
            hablar(paso.texto);
        } else {
            dibujarRuta();
        }
        encuadrar();
        mostrarPasoActual();
    }

    function mostrarPasoActual() {
        const r = estado.ruta;
        const paso = r?.pasos[estado.paso];
        el.pasoActual.hidden = !paso;
        if (!paso) return;
        el.pasoContador.textContent = `Paso ${estado.paso + 1} de ${r.pasos.length} · ${RC.nombrePiso(paso.piso, estado.config)}`;
        el.pasoTexto.textContent = `${paso.icono} ${paso.texto}`;
        if (paso.foto_url) {
            el.pasoFoto.src = paso.foto_url;
            el.pasoFoto.alt = `Referencia: ${paso.texto}`;
            el.pasoFoto.hidden = false;
        } else {
            el.pasoFoto.hidden = true;
            el.pasoFoto.removeAttribute("src");
        }
        el.anterior.disabled = estado.paso === 0;
        el.siguiente.textContent = estado.paso === r.pasos.length - 1 ? "Terminar ✓" : "Siguiente ›";
    }

    /* ---------- Voz ---------- */

    function hablar(texto) {
        if (!estado.voz || !("speechSynthesis" in window)) return;
        speechSynthesis.cancel();
        const frase = new SpeechSynthesisUtterance(texto);
        frase.lang = "es-ES";
        const voz = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("es"));
        if (voz) frase.voice = voz;
        speechSynthesis.speak(frase);
    }

    /* ---------- Eventos ---------- */

    function enlazarEventos() {
        el.form.addEventListener("submit", (e) => {
            e.preventDefault();
            calcular();
        });
        el.accesible.addEventListener("change", () => { if (estado.ruta) calcular(); });
        el.intercambiar.addEventListener("click", () => {
            if (gps.activo) desactivarGps();
            [estado.desde, estado.hasta] = [estado.hasta, estado.desde];
            [el.desde.value, el.hasta.value] = [el.hasta.value, el.desde.value];
            dibujarNodos();
            if (estado.desde && estado.hasta) calcular();
        });
        el.gps.addEventListener("click", () => (gps.activo ? desactivarGps() : activarGps()));
        window.addEventListener("portal:ruta-seleccionada", (event) => {
            const { desde, hasta } = event.detail || {};
            if (!desde || !hasta) return;
            fijar("hasta", hasta);
            fijar("desde", desde);
            calcular();
        });
        document.addEventListener("visibilitychange", alCambiarVisibilidad);
        // Al salir de la página se libera el GPS.
        window.addEventListener("pagehide", dejarDeVigilar);
        window.addEventListener("pageshow", (e) => { if (e.persisted && gps.activo) vigilar(); });
        el.iniciar.addEventListener("click", () => irAPaso(0));
        el.anterior.addEventListener("click", () => irAPaso(estado.paso - 1));
        el.siguiente.addEventListener("click", () => {
            if (estado.paso >= estado.ruta.pasos.length - 1) {
                irAPaso(-1);
                mensaje("info", `🏁 ¡Llegaste a <strong>${RC.escapar(estado.ruta.destino.etiqueta)}</strong>!`);
            } else {
                irAPaso(estado.paso + 1);
            }
        });
        el.salirPasos.addEventListener("click", () => irAPaso(-1));
        el.pasos.addEventListener("click", (e) => {
            const b = e.target.closest("[data-i]");
            if (b) irAPaso(Number(b.dataset.i));
        });
        document.addEventListener("keydown", (e) => {
            if (estado.paso < 0 || e.target.closest("input, textarea")) return;
            if (e.key === "ArrowRight") el.siguiente.click();
            if (e.key === "ArrowLeft" && estado.paso > 0) el.anterior.click();
        });

        if (!("speechSynthesis" in window)) el.voz.hidden = true;
        el.voz.addEventListener("click", () => {
            estado.voz = !estado.voz;
            el.voz.setAttribute("aria-pressed", String(estado.voz));
            el.voz.textContent = estado.voz ? "🔊 Voz" : "🔈 Voz";
            if (estado.voz) hablar(estado.ruta?.pasos[estado.paso]?.texto || "Voz activada");
            else speechSynthesis.cancel();
        });

        el.compartir.addEventListener("click", async () => {
            const url = urlRuta();
            const r = estado.ruta;
            const texto = r ? `Cómo llegar de ${r.origen.etiqueta} a ${r.destino.etiqueta}` : "Cómo llegar";
            try {
                if (navigator.share) {
                    await navigator.share({ title: texto, text: texto, url });
                    return;
                }
                await navigator.clipboard.writeText(url);
                mensaje("info", "🔗 Enlace copiado. Pégalo donde quieras compartir la ruta.");
            } catch (e) {
                if (e?.name !== "AbortError") mensaje("info", `Copia este enlace: <a href="${RC.escapar(url)}">${RC.escapar(url)}</a>`);
            }
        });
    }

    /* ---------- Inicio ---------- */

    async function iniciar() {
        let red;
        try {
            [estado.config, red] = await Promise.all([RC.cargarConfigMapa(), RC.api("/api/rutas/red")]);
        } catch (e) {
            mensaje("error", `No se pudo cargar la red de recorridos: ${RC.escapar(e.message)}`);
            return;
        }
        red.nodos.forEach((n) => estado.nodos.set(n.id, n));

        mapa = RC.crearMapa(el.mapa, estado.config);
        capaNodos = L.layerGroup().addTo(mapa);
        capaRuta = L.layerGroup().addTo(mapa);
        capaGps = L.layerGroup().addTo(mapa);
        crearBotonCentrar();
        pisos = RC.controlPisos(mapa, estado.config, (_, desdeUsuario) => {
            dibujarNodos();
            dibujarRuta();
            dibujarGps();
            if (desdeUsuario || estado.paso < 0) encuadrar();
        });
        pisos.setPisos(red.nodos.map((n) => n.piso));

        const opcionMiUbicacion = {
            id: "gps",
            etiqueta: "Mi ubicación",
            detalle: "Usar el GPS y seguirte mientras caminas",
            icono: "📍",
            texto: "mi ubicacion gps donde estoy aqui",
            fijo: true,
        };
        RC.combobox(el.desde, () => [opcionMiUbicacion, ...opcionesPuntos()], (o) => {
            if (o.id === "gps") {
                if (!gps.activo) activarGps();
                return;
            }
            fijar("desde", o.id);
            if (estado.hasta) calcular(); else el.hasta.focus();
        });
        RC.combobox(el.hasta, opcionesPuntos, (o) => {
            fijar("hasta", o.id);
            if (estado.desde) calcular(); else el.desde.focus();
        });
        enlazarEventos();
        dibujarNodos();

        const flujoRuta = leerFlujoRutaGuardado();
        const destinoPersistido = flujoRuta ? Number(flujoRuta.destino_id ?? flujoRuta.destino?.id ?? flujoRuta.destino?.nodo_id ?? flujoRuta.hasta) : null;
        const origenPersistido = flujoRuta ? Number(flujoRuta.origen_id ?? flujoRuta.origen?.id ?? flujoRuta.desde) : null;

        if (!opcionesPuntos().length) {
            mensaje("aviso", 'Todavía no hay recorridos configurados. Créalos en el <a href="/rutas/editor">editor de rutas</a>.');
            return;
        }

        const params = new URLSearchParams(location.search);
        el.accesible.checked = params.get("accesible") === "1";

        const destinoDesdeUrl = params.has("hasta") ? Number(params.get("hasta")) : destinoPersistido;
        const origenDesdeUrl = params.has("desde") ? Number(params.get("desde")) : origenPersistido;

        const desdeOk = Number.isFinite(origenDesdeUrl) && fijar("desde", origenDesdeUrl);
        const hastaOk = Number.isFinite(destinoDesdeUrl) && fijar("hasta", destinoDesdeUrl);

        if (desdeOk && hastaOk) {
            calcular();
            return;
        }

        if (Number.isFinite(destinoDesdeUrl) && !Number.isFinite(origenDesdeUrl)) {
            const n = estado.nodos.get(destinoDesdeUrl);
            if (n && n.piso !== pisos.piso()) pisos.setPiso(n.piso);
            if (n) mapa.setView([n.latitud, n.longitud], 20);
            mensaje("info", `📍 Ruta preparada para <strong>${RC.escapar(n ? n.etiqueta : "el destino")}</strong>. Selecciona tu origen en el chatbot para continuar.`);
            return;
        }

        if (desdeOk) {
            const n = estado.nodos.get(estado.desde);
            if (n.piso !== pisos.piso()) pisos.setPiso(n.piso);
            mapa.setView([n.latitud, n.longitud], 20);
            mensaje("info", `📍 Estás en <strong>${RC.escapar(n.etiqueta)}</strong>. ¿A dónde quieres ir?`);
            el.hasta.focus();
        } else if (params.has("desde") || params.has("hasta") || Number.isFinite(destinoPersistido) || Number.isFinite(origenPersistido)) {
            mensaje("aviso", "El punto del enlace ya no existe. Elige origen y destino en la lista.");
        }
    }

    iniciar();
})();
