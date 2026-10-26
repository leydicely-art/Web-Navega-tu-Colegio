/*
 * Editor visual de la red de recorridos de «Cómo llegar».
 *
 * Modos:
 *  - Seleccionar: tocar un punto o un tramo para editarlo; arrastrar puntos.
 *  - Agregar punto: cada toque en el mapa crea un punto en el piso visible.
 *  - Conectar: tocar dos puntos crea un tramo; se encadena (el segundo pasa a
 *    ser el primero del siguiente tramo) para dibujar pasillos rápido.
 *    Para cambiar de piso: elegir la escalera, cambiar de piso, tocar la otra.
 */
(function () {
    "use strict";

    const RC = window.RutasComun;
    const $ = (id) => document.getElementById(id);

    const estado = {
        config: null,
        nodos: new Map(),
        tramos: new Map(),
        tipos: [],
        ubicaciones: [],
        fotos: [],
        modo: "seleccionar",
        nodoSel: null,
        tramoSel: null,
        conectarDesde: null,
        ultimoTipo: "punto",
        pisosExtra: new Set(),
    };

    let mapa, pisos, capaTramos, capaNodos;
    let fotoNodo, fotoTramo, fotoPlano;

    /** Muestra una sola sección del panel lateral. */
    function panel(cual) {
        const secciones = { vacio: "editorVacio", nodo: "editorNodoForm", tramo: "editorTramoForm", ajustes: "editorAjustesForm" };
        for (const [clave, id] of Object.entries(secciones)) $(id).hidden = clave !== cual;
    }

    /* ---------- Utilidades ---------- */

    function ayuda(texto, tipo = "info") {
        const el = $("editorAyuda");
        el.textContent = texto || "";
        el.dataset.tipo = tipo;
    }

    const TEXTO_MODO = {
        seleccionar: "Toca un punto o un tramo para editarlo. Arrastra los puntos para moverlos.",
        agregar: "Toca el mapa para agregar puntos; cada uno se une al anterior. Esc para empezar otro pasillo.",
        conectar: "Toca el primer punto y luego el segundo para unirlos.",
    };

    async function guardar(promesa, exito) {
        try {
            const r = await promesa;
            if (exito) ayuda(exito, "ok");
            return r;
        } catch (e) {
            ayuda(`⚠️ ${e.message}`, "error");
            return null;
        }
    }

    function tramosDe(nodoId) {
        return [...estado.tramos.values()].filter((t) => t.origen_id === nodoId || t.destino_id === nodoId);
    }

    /* ---------- Fotos ---------- */

    /** Selector de foto (lista + subir a la BD + vista previa). Devuelve {get, set}. */
    function crearSelectorFoto(contenedor, idSelect) {
        contenedor.innerHTML = `
            <div class="input-group input-group-sm">
                <select class="form-select form-select-sm"></select>
                <label class="btn btn-outline-secondary btn-sm mb-0">📷 Subir
                    <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden>
                </label>
            </div>
            <img class="rutas-editor__foto-preview" alt="" hidden>`;
        const select = contenedor.querySelector("select");
        const archivo = contenedor.querySelector("input[type=file]");
        const preview = contenedor.querySelector("img");
        if (idSelect) select.id = idSelect;

        function opciones(valor) {
            select.innerHTML = '<option value="">— Sin foto —</option>'
                + estado.fotos.map((f) => `<option value="${RC.escapar(f.url)}">${RC.escapar(f.nombre)}</option>`).join("");
            if (valor && !estado.fotos.some((f) => f.url === valor)) {
                select.insertAdjacentHTML("beforeend", `<option value="${RC.escapar(valor)}">${RC.escapar(valor)}</option>`);
            }
            select.value = valor || "";
            mostrar();
        }
        function mostrar() {
            preview.hidden = !select.value;
            if (select.value) preview.src = select.value;
        }
        select.addEventListener("change", mostrar);
        archivo.addEventListener("change", async () => {
            const f = archivo.files[0];
            if (!f) return;
            const datos = new FormData();
            datos.append("foto", f);
            ayuda("Subiendo foto…");
            const r = await guardar(RC.api("/api/rutas/fotos", { method: "POST", body: datos }), "Foto subida. Recuerda guardar.");
            archivo.value = "";
            if (r) {
                estado.fotos.push(r);
                opciones(r.url);
            }
        });

        return {
            get: () => select.value || null,
            set: (valor) => opciones(valor),
        };
    }

    /* ---------- Dibujo ---------- */

    function dibujar() {
        capaTramos.clearLayers();
        capaNodos.clearLayers();
        const piso = pisos.piso();

        for (const t of estado.tramos.values()) {
            const a = estado.nodos.get(t.origen_id);
            const b = estado.nodos.get(t.destino_id);
            if (!a || !b || a.piso !== piso || b.piso !== piso) continue;
            const clases = ["rutas-tramo-editor"];
            if (!t.accesible) clases.push("rutas-tramo-editor--no-accesible");
            if (estado.tramoSel === t.id) clases.push("is-sel");
            const linea = L.polyline([[a.latitud, a.longitud], [b.latitud, b.longitud]], { className: clases.join(" "), weight: 6 });
            // Línea invisible más gruesa para que sea fácil tocarla en el celular.
            const toque = L.polyline(linea.getLatLngs(), { opacity: 0, weight: 22 });
            toque.on("click", (e) => {
                L.DomEvent.stop(e);
                if (estado.modo === "seleccionar") seleccionarTramo(t.id);
            });
            capaTramos.addLayer(linea).addLayer(toque);
        }

        for (const n of estado.nodos.values()) {
            if (n.piso !== piso) {
                // Escaleras/ascensores de otros pisos, en tenue, para alinearlos.
                if (["escalera", "ascensor", "rampa"].includes(n.tipo)) {
                    L.marker([n.latitud, n.longitud], {
                        icon: RC.iconoNodo(n, "is-fantasma"),
                        interactive: estado.modo === "conectar",
                        title: `${n.etiqueta} (${RC.nombrePiso(n.piso, estado.config)})`,
                    }).on("click", () => alTocarNodo(n.id)).addTo(capaNodos);
                }
                continue;
            }
            const clases = [];
            if (estado.nodoSel === n.id) clases.push("is-sel");
            if (estado.conectarDesde === n.id) clases.push("is-origen");
            if (tramosDe(n.id).some((t) => estado.nodos.get(t.origen_id === n.id ? t.destino_id : t.origen_id)?.piso !== n.piso)) {
                clases.push("is-vertical");
            }
            if (!tramosDe(n.id).length) clases.push("is-suelto");
            const m = L.marker([n.latitud, n.longitud], {
                icon: RC.iconoNodo(n, clases.join(" ")),
                draggable: estado.modo === "seleccionar",
                title: n.etiqueta,
                zIndexOffset: estado.nodoSel === n.id ? 1000 : 0,
            });
            m.on("click", (e) => {
                L.DomEvent.stop(e);
                alTocarNodo(n.id);
            });
            m.on("dragend", async () => {
                const { lat, lng } = m.getLatLng();
                const r = await guardar(RC.api(`/api/rutas/nodos/${n.id}`, { method: "PUT", body: { latitud: lat, longitud: lng } }), "Punto movido.");
                if (r) estado.nodos.set(r.id, r);
                dibujar();
            });
            if (n.tipo !== "punto" || n.nombre || n.ubicacion) m.bindTooltip(n.etiqueta, { direction: "top", offset: [0, -12] });
            capaNodos.addLayer(m);
        }
        $("editorEjemplo").hidden = estado.nodos.size > 0;
    }

    function actualizarPisos() {
        pisos.setPisos([...[...estado.nodos.values()].map((n) => n.piso), ...estado.pisosExtra, pisos?.piso?.() ?? 1]);
    }

    /* ---------- Interacción ---------- */

    function setModo(modo) {
        estado.modo = modo;
        estado.conectarDesde = null;
        document.querySelectorAll("[data-modo]").forEach((b) => {
            const activo = b.dataset.modo === modo;
            b.classList.toggle("active", activo);
            b.setAttribute("aria-pressed", String(activo));
        });
        el("editorMapa").classList.toggle("is-agregando", modo === "agregar");
        ayuda(TEXTO_MODO[modo]);
        dibujar();
    }

    function el(id) { return $(id); }

    async function alTocarMapa(e) {
        if (estado.modo !== "agregar") {
            if (estado.modo === "seleccionar") deseleccionar();
            return;
        }
        const r = await guardar(RC.api("/api/rutas/nodos", {
            method: "POST",
            body: { latitud: e.latlng.lat, longitud: e.latlng.lng, piso: pisos.piso(), tipo: estado.ultimoTipo === "destino" ? "punto" : estado.ultimoTipo },
        }), "Punto agregado. Toca de nuevo para agregar otro.");
        if (!r) return;
        estado.nodos.set(r.id, r);
        // Si había un punto elegido, se une al nuevo automáticamente: así un
        // pasillo se dibuja tocando el mapa punto tras punto.
        if (estado.nodoSel && estado.nodos.get(estado.nodoSel)?.piso === r.piso) {
            const t = await guardar(RC.api("/api/rutas/tramos", { method: "POST", body: { origen_id: estado.nodoSel, destino_id: r.id } }),
                "Punto agregado y unido al anterior. Esc para empezar un pasillo nuevo.");
            if (t) estado.tramos.set(t.id, t);
        }
        seleccionarNodo(r.id);
    }

    async function alTocarNodo(id) {
        if (estado.modo !== "conectar") {
            seleccionarNodo(id);
            return;
        }
        if (!estado.conectarDesde) {
            estado.conectarDesde = id;
            ayuda(`Ahora toca el punto a unir con «${estado.nodos.get(id).etiqueta}». Para cambiar de piso, usa el selector de pisos.`);
            dibujar();
            return;
        }
        if (estado.conectarDesde === id) {
            estado.conectarDesde = null;
            ayuda(TEXTO_MODO.conectar);
            dibujar();
            return;
        }
        const r = await guardar(RC.api("/api/rutas/tramos", {
            method: "POST",
            body: { origen_id: estado.conectarDesde, destino_id: id },
        }), "Tramo creado. Toca otro punto para seguir uniendo o Esc para terminar.");
        if (r) {
            estado.tramos.set(r.id, r);
            estado.conectarDesde = id;
        }
        dibujar();
    }

    function deseleccionar() {
        estado.nodoSel = null;
        estado.tramoSel = null;
        panel("vacio");
        dibujar();
    }

    function seleccionarNodo(id) {
        const n = estado.nodos.get(id);
        if (!n) return;
        estado.nodoSel = id;
        estado.tramoSel = null;
        panel("nodo");

        $("editorNodoTitulo").textContent = `${n.icono} ${n.etiqueta}`;
        $("nodoNombre").value = n.nombre || "";
        $("nodoTipo").value = n.tipo;
        $("nodoPiso").value = n.piso;
        $("nodoUbicacion").value = n.ubicacion_id || "";
        $("nodoDescripcion").value = n.descripcion_propia || "";
        $("nodoDescripcion").placeholder = n.ubicacion && n.descripcion ? `De la ubicación: ${n.descripcion}` : "Ej: puerta azul al final del pasillo";
        fotoNodo.set(n.foto_url);
        $("nodoQr").href = `/rutas/nodos/${n.id}/qr.png`;

        const lista = $("nodoConexiones");
        lista.innerHTML = "";
        const conexiones = tramosDe(id);
        if (!conexiones.length) lista.innerHTML = '<li class="text-muted">Sin conexiones: usa 🔗 Conectar.</li>';
        for (const t of conexiones) {
            const otro = estado.nodos.get(t.origen_id === id ? t.destino_id : t.origen_id);
            const li = document.createElement("li");
            li.innerHTML = `
                <span>${t.accesible ? "♿" : "🪜"} ${RC.escapar(otro?.etiqueta || "?")}
                    ${otro && otro.piso !== n.piso ? `<small>(${RC.escapar(RC.nombrePiso(otro.piso, estado.config))})</small>` : ""}
                    ${t.instruccion || t.foto_url ? "<small>✎</small>" : ""}</span>
                <span>
                    <button type="button" class="btn btn-link btn-sm p-0" data-editar="${t.id}">Editar</button>
                    <button type="button" class="btn btn-link btn-sm p-0 text-danger" data-borrar="${t.id}" aria-label="Eliminar tramo">✕</button>
                </span>`;
            lista.append(li);
        }
        dibujar();
    }

    function seleccionarTramo(id) {
        const t = estado.tramos.get(id);
        if (!t) return;
        estado.tramoSel = id;
        panel("tramo");
        const a = estado.nodos.get(t.origen_id);
        const b = estado.nodos.get(t.destino_id);
        $("editorTramoTitulo").textContent = `${a?.etiqueta} → ${b?.etiqueta}`;
        $("tramoAccesible").checked = t.accesible;
        $("tramoInstruccion").value = t.instruccion || "";
        fotoTramo.set(t.foto_url);
        $("tramoVolver").hidden = !estado.nodoSel;
        dibujar();
    }

    async function borrarTramo(id) {
        if (!confirm("¿Eliminar este tramo?")) return;
        const r = await guardar(RC.api(`/api/rutas/tramos/${id}`, { method: "DELETE" }), "Tramo eliminado.");
        if (!r) return;
        estado.tramos.delete(id);
        if (estado.nodoSel) seleccionarNodo(estado.nodoSel);
        else deseleccionar();
    }

    /* ---------- Formularios ---------- */

    function llenarListas() {
        $("nodoTipo").innerHTML = estado.tipos.map((t) => `<option value="${t.valor}">${t.icono} ${RC.escapar(t.etiqueta)}</option>`).join("");
        $("nodoUbicacion").innerHTML = '<option value="">— Ninguna —</option>'
            + estado.ubicaciones.map((u) => `<option value="${u.id}">${RC.escapar(u.nombre)}</option>`).join("");
    }

    function enlazarFormularios() {
        llenarListas();
        fotoNodo = crearSelectorFoto(document.querySelector('[data-foto-para="nodo"]'), "nodoFoto");
        fotoTramo = crearSelectorFoto(document.querySelector('[data-foto-para="tramo"]'));
        fotoPlano = crearSelectorFoto(document.querySelector('[data-foto-para="plano"]'), "pisoPlano");
        enlazarAjustes();

        $("nodoUbicacion").addEventListener("change", () => {
            if ($("nodoUbicacion").value && $("nodoTipo").value === "punto") $("nodoTipo").value = "destino";
        });

        $("editorNodoForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = estado.nodoSel;
            const anterior = estado.nodos.get(id);
            const r = await guardar(RC.api(`/api/rutas/nodos/${id}`, {
                method: "PUT",
                body: {
                    nombre: $("nodoNombre").value,
                    tipo: $("nodoTipo").value,
                    piso: $("nodoPiso").value,
                    ubicacion_id: $("nodoUbicacion").value || null,
                    descripcion: $("nodoDescripcion").value,
                    foto_url: fotoNodo.get(),
                },
            }), "Punto guardado.");
            if (!r) return;
            estado.nodos.set(r.id, r);
            estado.ultimoTipo = r.tipo;
            if (r.piso !== anterior.piso) {
                actualizarPisos();
                pisos.setPiso(r.piso);
            }
            seleccionarNodo(r.id);
        });

        $("nodoEliminar").addEventListener("click", async () => {
            const id = estado.nodoSel;
            if (!confirm("¿Eliminar este punto y sus tramos?")) return;
            const r = await guardar(RC.api(`/api/rutas/nodos/${id}`, { method: "DELETE" }), "Punto eliminado.");
            if (!r) return;
            estado.nodos.delete(id);
            tramosDe(id).forEach((t) => estado.tramos.delete(t.id));
            deseleccionar();
        });

        $("nodoConexiones").addEventListener("click", (e) => {
            const editar = e.target.closest("[data-editar]");
            const borrar = e.target.closest("[data-borrar]");
            if (editar) seleccionarTramo(Number(editar.dataset.editar));
            if (borrar) borrarTramo(Number(borrar.dataset.borrar));
        });

        $("editorTramoForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const r = await guardar(RC.api(`/api/rutas/tramos/${estado.tramoSel}`, {
                method: "PUT",
                body: {
                    accesible: $("tramoAccesible").checked,
                    instruccion: $("tramoInstruccion").value,
                    foto_url: fotoTramo.get(),
                },
            }), "Tramo guardado.");
            if (r) {
                estado.tramos.set(r.id, r);
                dibujar();
            }
        });
        $("tramoEliminar").addEventListener("click", () => borrarTramo(estado.tramoSel));
        $("tramoVolver").addEventListener("click", () => seleccionarNodo(estado.nodoSel));
    }

    /* ---------- Ajustes del mapa (se guardan en la base de datos) ---------- */

    function mostrarAjustes() {
        estado.nodoSel = null;
        estado.tramoSel = null;
        panel("ajustes");
        const c = estado.config.colegio;
        $("ajustesVista").textContent = `${c.centro[0].toFixed(5)}, ${c.centro[1].toFixed(5)} · zoom ${c.zoom}`;
        $("ajustesLimite").textContent = c.limites
            ? "Activo: el mapa no deja salir de la zona guardada."
            : "Sin límite: el mapa se puede mover libremente.";
        $("ajustesQuitarLimite").hidden = !c.limites;
        const piso = pisos.piso();
        const cfgPiso = estado.config.pisos?.[String(piso)] || {};
        $("ajustesPisoTitulo").textContent = `Piso ${piso} (el que ves en el mapa)`;
        $("pisoNombre").value = cfgPiso.nombre || "";
        $("pisoNombre").placeholder = RC.nombrePiso(piso, { pisos: {} });
        fotoPlano.set(cfgPiso.plano || null);
        $("ajustesQuitarPlano").hidden = !cfgPiso.plano;
        dibujar();
    }

    function aplicarConfig(config) {
        estado.config = config;
        const l = config.colegio.limites;
        mapa.setMaxBounds(l ? L.latLngBounds(l) : null);
        pisos.refrescar(config);
        mostrarAjustes();
    }

    /** Rectángulo con la proporción de la imagen, centrado en la vista actual. */
    function limitesParaPlano(url) {
        return new Promise((resolver, rechazar) => {
            const img = new Image();
            img.onload = () => {
                const tam = mapa.getSize();
                const margen = 0.9;
                let ancho = tam.x * margen;
                let alto = ancho * (img.naturalHeight / img.naturalWidth);
                if (alto > tam.y * margen) {
                    alto = tam.y * margen;
                    ancho = alto * (img.naturalWidth / img.naturalHeight);
                }
                const x0 = (tam.x - ancho) / 2;
                const y0 = (tam.y - alto) / 2;
                const so = mapa.containerPointToLatLng([x0, y0 + alto]);
                const ne = mapa.containerPointToLatLng([x0 + ancho, y0]);
                resolver([[so.lat, so.lng], [ne.lat, ne.lng]]);
            };
            img.onerror = () => rechazar(new Error("No se pudo abrir la imagen del plano."));
            img.src = url;
        });
    }

    async function guardarPiso(cuerpo, exito) {
        const r = await guardar(RC.api(`/api/rutas/pisos/${pisos.piso()}`, { method: "PUT", body: cuerpo }), exito);
        if (r) aplicarConfig(r);
    }

    async function guardarConfig(cuerpo, exito) {
        const r = await guardar(RC.api("/api/rutas/config", { method: "PUT", body: cuerpo }), exito);
        if (r) aplicarConfig(r);
    }

    function enlazarAjustes() {
        $("editorAjustes").addEventListener("click", mostrarAjustes);
        $("ajustesCerrar").addEventListener("click", () => deseleccionar());

        $("ajustesUsarVista").addEventListener("click", () => {
            const c = mapa.getCenter();
            guardarConfig({ latitud: c.lat, longitud: c.lng, zoom: mapa.getZoom() }, "Vista inicial guardada.");
        });
        $("ajustesLimitar").addEventListener("click", () => {
            const b = mapa.getBounds();
            guardarConfig({ limites: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]] },
                "Límite guardado: el mapa ya no deja salir de esta zona.");
        });
        $("ajustesQuitarLimite").addEventListener("click", () => guardarConfig({ limites: null }, "Límite quitado."));

        $("editorAjustesForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            const cuerpo = { nombre: $("pisoNombre").value };
            const plano = fotoPlano.get();
            const actual = estado.config.pisos?.[String(pisos.piso())] || {};
            if (plano !== (actual.plano || null)) {
                cuerpo.plano_url = plano;
                cuerpo.plano_limites = null;
                if (plano) {
                    try {
                        cuerpo.plano_limites = await limitesParaPlano(plano);
                    } catch (err) {
                        ayuda(`⚠️ ${err.message}`, "error");
                        return;
                    }
                }
            }
            guardarPiso(cuerpo, cuerpo.plano_limites
                ? "Piso guardado. El plano se ubicó en la vista actual; usa «Reajustar» si no coincide."
                : "Piso guardado.");
        });
        $("ajustesReajustarPlano").addEventListener("click", async () => {
            const plano = fotoPlano.get();
            if (!plano) {
                ayuda("⚠️ Elige o sube primero la imagen del plano.", "error");
                return;
            }
            try {
                const limites = await limitesParaPlano(plano);
                guardarPiso({ plano_url: plano, plano_limites: limites }, "Plano reajustado a la vista actual.");
            } catch (err) {
                ayuda(`⚠️ ${err.message}`, "error");
            }
        });
        $("ajustesQuitarPlano").addEventListener("click",
            () => guardarPiso({ plano_url: null, plano_limites: null }, "Plano quitado."));
    }

    /* ---------- Inicio ---------- */

    async function recargar() {
        const red = await RC.api("/api/rutas/red?editor=1");
        estado.nodos = new Map(red.nodos.map((n) => [n.id, n]));
        estado.tramos = new Map(red.tramos.map((t) => [t.id, t]));
        estado.tipos = red.tipos;
        estado.ubicaciones = red.ubicaciones;
        estado.fotos = red.fotos;
    }

    async function iniciar() {
        try {
            estado.config = await RC.cargarConfigMapa();
            await recargar();
        } catch (e) {
            ayuda(`⚠️ No se pudo cargar la red: ${e.message}`, "error");
            return;
        }
        mapa = RC.crearMapa($("editorMapa"), estado.config);
        capaTramos = L.layerGroup().addTo(mapa);
        capaNodos = L.layerGroup().addTo(mapa);
        pisos = RC.controlPisos(mapa, estado.config, () => {
            if (estado.modo !== "conectar") estado.conectarDesde = null;
            if (!$("editorAjustesForm").hidden) mostrarAjustes();
            else dibujar();
        });
        actualizarPisos();
        mapa.on("click", alTocarMapa);

        enlazarFormularios();
        document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => setModo(b.dataset.modo)));
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || e.target.closest("input, select, textarea")) return;
            if (estado.conectarDesde) {
                estado.conectarDesde = null;
                ayuda(TEXTO_MODO[estado.modo]);
                dibujar();
            } else {
                deseleccionar();
            }
        });

        $("editorPisoNuevo").addEventListener("click", () => {
            const lista = [...estado.nodos.values()].map((n) => n.piso).concat([...estado.pisosExtra, 1]);
            const nuevo = Math.max(...lista) + 1;
            estado.pisosExtra.add(nuevo);
            actualizarPisos();
            pisos.setPiso(nuevo);
            ayuda(`${RC.nombrePiso(nuevo, estado.config)} listo. Agrega sus puntos con ➕.`);
        });

        $("editorPisoEliminar").addEventListener("click", async () => {
            const piso = pisos.piso();
            if (piso === null || piso === undefined) return;
            const nombre = RC.nombrePiso(piso, estado.config);
            const existeEnConfig = !!estado.config?.pisos?.[String(piso)];
            const puntosEnPiso = [...estado.nodos.values()].filter((n) => n.piso === piso).length;

            if (!existeEnConfig && !estado.pisosExtra.has(piso)) {
                ayuda(`⚠️ No existe ${nombre} para borrar.`, "error");
                return;
            }

            if (!existeEnConfig) {
                if (!confirm(`¿Eliminar ${nombre} sin guardarlo aún?`)) return;
                estado.pisosExtra.delete(piso);
                actualizarPisos();
                const siguiente = [...new Set([...estado.nodos.values()].map((n) => n.piso).concat([...estado.pisosExtra]))]
                    .filter((n) => n !== piso)
                    .sort((a, b) => a - b)[0] || 1;
                pisos.setPiso(siguiente);
                ayuda(`${nombre} eliminado del editor.`, "ok");
                return;
            }

            if (puntosEnPiso > 0) {
                ayuda(`⚠️ No se puede eliminar ${nombre} porque todavía tiene ${puntosEnPiso} punto${puntosEnPiso === 1 ? "" : "s"} asociados. Muévalos o elimínalos antes.`, "error");
                return;
            }

            if (!confirm(`¿Eliminar ${nombre}? Este cambio también se guardará en la base de datos.`)) return;
            const r = await guardar(RC.api(`/api/rutas/pisos/${piso}`, { method: "DELETE" }), `${nombre} eliminado.`);
            if (!r) return;
            estado.pisosExtra.delete(piso);
            estado.config = r;
            if (estado.nodoSel && estado.nodos.get(estado.nodoSel)?.piso === piso) {
                deseleccionar();
            }
            if (!$("editorAjustesForm").hidden) mostrarAjustes();
            else actualizarPisos();
            pisos.refrescar(r);
            ayuda(`${nombre} eliminado.`, "ok");
        });

        $("editorEjemplo").addEventListener("click", async () => {
            const r = await guardar(RC.api("/api/rutas/ejemplo", { method: "POST" }));
            if (!r) return;
            await recargar();
            llenarListas();
            actualizarPisos();
            dibujar();
            ayuda(`Red de ejemplo creada (${r.creados} puntos en 2 pisos). Prueba «Cómo llegar».`, "ok");
            const primero = [...estado.nodos.values()][0];
            if (primero) mapa.setView([primero.latitud, primero.longitud], 19);
        });

        setModo("seleccionar");
        const nodos = [...estado.nodos.values()].filter((n) => n.piso === pisos.piso());
        if (nodos.length) mapa.fitBounds(L.latLngBounds(nodos.map((n) => [n.latitud, n.longitud])).pad(0.2), { maxZoom: 20 }
    );


    // Centrar el mapa en el Colegio Guillermo León Valencia
    mapa.setView([5.8342157, -73.0371713], 18);
    }

    iniciar();
})();
