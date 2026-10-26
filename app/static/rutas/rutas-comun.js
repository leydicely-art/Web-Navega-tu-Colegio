/*
 * Utilidades compartidas por «Cómo llegar» (rutas.js) y su editor
 * (rutas-editor.js): mapa base, selector de piso con planos opcionales,
 * llamadas a la API y un buscador (combobox) de puntos.
 *
 * La configuración (vista inicial, límites, nombres y planos de los pisos)
 * se guarda en la base de datos y se edita en el editor (⚙️ Ajustes del
 * mapa); llega desde /api/rutas/config con la forma:
 *   { colegio: { centro, zoom, zoomMinimo, zoomMaximo, limites? },
 *     pisos: { "2": { nombre, plano?, limites? } } }
 */
(function () {
    "use strict";

    const RC = {};

    RC.escapar = (texto) => (texto ?? "").toString().replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

    RC.normalizar = (texto) => (texto || "").toString().normalize("NFD")
        .replace(/[̀-ͯ]/g, "").toLowerCase().trim();

    RC.formatearMetros = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

    RC.nombrePiso = (piso, config) => {
        const cfg = config?.pisos?.[String(piso)];
        if (cfg?.nombre) return cfg.nombre;
        if (piso === 1) return "Primer piso";
        if (piso <= 0) return piso === 0 ? "Sótano" : `Sótano ${-piso}`;
        return `Piso ${piso}`;
    };

    RC.api = async (url, opciones = {}) => {
        const init = { headers: {}, ...opciones };
        if (init.body && !(init.body instanceof FormData)) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(init.body);
        }
        let respuesta;
        try {
            respuesta = await fetch(url, init);
        } catch (_) {
            throw new Error("Sin conexión con el servidor.");
        }
        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
        return datos;
    };

    RC.cargarConfigMapa = () => RC.api("/api/rutas/config");

    /** Mapa Leaflet centrado en el colegio, con zoom de interiores (hasta 22). */
    RC.crearMapa = (elemento, config) => {
        const c = config.colegio || {};
        const limites = Array.isArray(c.limites) ? L.latLngBounds(c.limites) : null;
        const mapa = L.map(elemento, {
            center: c.centro,
            zoom: c.zoom || 18,
            minZoom: c.zoomMinimo || 16,
            maxZoom: 22,
            maxBounds: limites || undefined,
            maxBoundsViscosity: limites ? 1 : 0,
        });
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
            maxNativeZoom: 19,
            maxZoom: 22,
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        }).addTo(mapa);
        if ("ResizeObserver" in window) new ResizeObserver(() => mapa.invalidateSize()).observe(elemento);
        return mapa;
    };

    /**
     * Control de pisos en el mapa. `alCambiar(piso)` se llama al elegir uno.
     * Devuelve { setPisos(lista), setPiso(n), piso() }.
     */
    RC.controlPisos = (mapa, config, alCambiar) => {
        let pisos = [];
        let actual = 1;
        let plano = null;
        const caja = L.DomUtil.create("div", "rutas-pisos leaflet-bar");
        caja.setAttribute("role", "group");
        caja.setAttribute("aria-label", "Piso");
        L.DomEvent.disableClickPropagation(caja);
        L.DomEvent.disableScrollPropagation(caja);

        const Control = L.Control.extend({ options: { position: "topright" }, onAdd: () => caja });
        new Control().addTo(mapa);

        function pintar() {
            caja.innerHTML = "";
            caja.hidden = pisos.length < 2;
            // De arriba hacia abajo, como en un ascensor.
            [...pisos].sort((a, b) => b - a).forEach((p) => {
                const b = L.DomUtil.create("button", "rutas-pisos__boton", caja);
                b.type = "button";
                b.textContent = p <= 0 ? (p === 0 ? "S" : `S${-p}`) : String(p);
                b.title = RC.nombrePiso(p, config);
                b.setAttribute("aria-label", RC.nombrePiso(p, config));
                b.setAttribute("aria-pressed", String(p === actual));
                L.DomEvent.on(b, "click", () => api.setPiso(p, true));
            });
        }

        function ponerPlano() {
            if (plano) mapa.removeLayer(plano);
            plano = null;
            const cfg = config?.pisos?.[String(actual)];
            if (cfg?.plano && Array.isArray(cfg.limites)) {
                plano = L.imageOverlay(cfg.plano, cfg.limites, { opacity: 0.85, interactive: false }).addTo(mapa);
                plano.bringToBack();
            }
        }

        const api = {
            setPisos(lista) {
                pisos = [...new Set(lista)].sort((a, b) => a - b);
                if (!pisos.length) pisos = [1];
                if (!pisos.includes(actual)) actual = pisos.includes(1) ? 1 : pisos[0];
                pintar();
                ponerPlano();
            },
            setPiso(p, desdeUsuario = false) {
                if (p === actual) return;
                actual = p;
                if (!pisos.includes(p)) pisos = [...pisos, p].sort((a, b) => a - b);
                pintar();
                ponerPlano();
                alCambiar?.(p, desdeUsuario);
            },
            piso: () => actual,
            /** Vuelve a pintar nombres y plano tras cambiar la configuración. */
            refrescar(nuevaConfig) {
                config = nuevaConfig;
                pintar();
                ponerPlano();
            },
        };
        return api;
    };

    /**
     * Buscador accesible (combobox) de puntos sobre un <input>.
     * opciones(): lista de {id, etiqueta, detalle, icono, texto, fijo?}
     * alElegir(item)
     */
    RC.combobox = (input, opciones, alElegir) => {
        const lista = document.createElement("ul");
        lista.className = "rutas-combobox__lista";
        lista.id = `${input.id}-lista`;
        lista.setAttribute("role", "listbox");
        lista.hidden = true;
        input.after(lista);
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-expanded", "false");
        input.setAttribute("aria-controls", lista.id);
        input.autocomplete = "off";

        let resultados = [];
        let indice = -1;

        function cerrar() {
            lista.hidden = true;
            input.setAttribute("aria-expanded", "false");
            input.removeAttribute("aria-activedescendant");
            indice = -1;
        }

        function marcar(i) {
            indice = i;
            lista.querySelectorAll("[data-i]").forEach((el, j) => el.setAttribute("aria-selected", String(j === i)));
            const el = lista.querySelector(`[data-i="${i}"]`);
            if (el) {
                input.setAttribute("aria-activedescendant", el.id);
                el.scrollIntoView({ block: "nearest" });
            }
        }

        function abrir() {
            const q = RC.normalizar(input.value);
            const terminos = q ? q.split(/\s+/) : [];
            resultados = opciones()
                .filter((o) => terminos.every((t) => o.texto.includes(t)))
                .sort((a, b) => {
                    // Las opciones fijas (p. ej. «Mi ubicación») van primero.
                    if (a.fijo !== b.fijo) return a.fijo ? -1 : 1;
                    const ra = RC.normalizar(a.etiqueta).startsWith(q) ? 0 : 1;
                    const rb = RC.normalizar(b.etiqueta).startsWith(q) ? 0 : 1;
                    return ra - rb || a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true });
                })
                .slice(0, 30);
            lista.innerHTML = "";
            if (!resultados.length) {
                lista.innerHTML = `<li class="rutas-combobox__vacio" role="option" aria-disabled="true">Sin resultados</li>`;
            }
            resultados.forEach((o, i) => {
                const li = document.createElement("li");
                li.id = `${lista.id}-${i}`;
                li.dataset.i = String(i);
                li.setAttribute("role", "option");
                li.setAttribute("aria-selected", "false");
                li.className = "rutas-combobox__opcion";
                li.innerHTML = `<span aria-hidden="true">${RC.escapar(o.icono)}</span><span><strong>${RC.escapar(o.etiqueta)}</strong><small>${RC.escapar(o.detalle || "")}</small></span>`;
                lista.append(li);
            });
            lista.hidden = false;
            input.setAttribute("aria-expanded", "true");
            indice = -1;
        }

        function elegir(o) {
            input.value = o.etiqueta;
            cerrar();
            alElegir(o);
        }

        input.addEventListener("input", abrir);
        input.addEventListener("focus", () => { input.select(); abrir(); });
        input.addEventListener("blur", () => setTimeout(cerrar, 150));
        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (lista.hidden) abrir();
                if (!resultados.length) return;
                const n = resultados.length;
                marcar((indice + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
            } else if (e.key === "Enter") {
                e.preventDefault();
                const o = resultados[Math.max(indice, 0)];
                if (o && !lista.hidden) elegir(o);
            } else if (e.key === "Escape") {
                cerrar();
            }
        });
        lista.addEventListener("mousedown", (e) => e.preventDefault());
        lista.addEventListener("click", (e) => {
            const li = e.target.closest("[data-i]");
            if (li) {
                elegir(resultados[Number(li.dataset.i)]);
                input.blur();
            }
        });

        return { cerrar };
    };

    /** Ícono redondo para un punto de la red. */
    RC.iconoNodo = (nodo, clase = "") => L.divIcon({
        className: "rutas-nodo-envoltura",
        html: `<span class="rutas-nodo rutas-nodo--${RC.escapar(nodo.tipo)} ${clase}">${nodo.tipo === "punto" ? "" : RC.escapar(nodo.icono)}</span>`,
        iconSize: nodo.tipo === "punto" ? [14, 14] : [28, 28],
        iconAnchor: nodo.tipo === "punto" ? [7, 7] : [14, 14],
    });

    window.RutasComun = RC;
})();
