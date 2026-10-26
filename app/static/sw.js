/*
 * Service worker del Portal Escolar.
 * Se registra desde la raíz ("/sw.js", ver ruta en app/web.py) para que su
 * scope cubra toda la app y no solo /static/.
 *
 * Estrategia:
 *  - Navegación (HTML): network-first, con la última página vista como
 *    respaldo si no hay conexión (el contenido viene de la base de datos,
 *    así que siempre se prefiere la versión fresca del servidor).
 *  - Estáticos (CSS/JS/iconos): network-first también, con la copia
 *    cacheada como respaldo solo si no hay conexión. Antes era cache-first
 *    (más rápido), pero eso deja fácilmente una versión vieja de style.css/
 *    app.js "pegada" en el dispositivo mientras se sigue iterando el diseño
 *    (subir CACHE_NAME no alcanza si el propio archivo cacheado nunca se
 *    vuelve a pedir a la red). Con red primero, el usuario siempre ve lo
 *    último publicado en el servidor en cuanto hay conexión.
 */

const CACHE_NAME = "portal-escolar-v5";
const APP_SHELL = [
    "/static/style.css",
    "/static/app.js",
    "/static/manifest.webmanifest",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
        );
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request))
    );
});
