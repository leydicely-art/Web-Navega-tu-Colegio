"""Vistas de «Cómo llegar»: navegación interna paso a paso (estilo PathView).

- /rutas            Navegador: origen, destino, ruta accesible, paso a paso.
- /rutas/editor     Editor visual de la red de recorridos (puntos y tramos).
- /rutas/fotos/<id> Fotos de referencia guardadas en la base de datos.
- /api/rutas/...    API JSON que usan las dos páginas.

La lógica (validación, ruta más corta, indicaciones) vive en
app/services/rutas.py; aquí solo se traduce entre HTTP y el servicio.
"""

from __future__ import annotations

import io
import os
from urllib.parse import quote

import qrcode
from flask import Blueprint, Response, current_app, jsonify, render_template, request, url_for

from app.db_session import get_session
from app.services import mapa_config as services_mapa
from app.services import rutas as services_rutas
from app.services import ubicaciones as services_ubicaciones

bp = Blueprint("rutas", __name__)

# Fotos del proyecto (app/images/colegio) que también se ofrecen en el editor,
# además de las subidas, que se guardan en la base de datos (tabla foto_ruta).
CARPETAS_FOTOS = ("colegio",)
EXTENSIONES_FOTO = {".png", ".jpg", ".jpeg", ".webp"}


def _error(exc: Exception, codigo: int = 400):
    return jsonify({"error": str(exc)}), codigo


def _fotos_disponibles() -> list[dict]:
    fotos = [
        {"nombre": f"Subida · {f['nombre']}", "url": url_for("rutas.rutas_foto", foto_id=f["id"])}
        for f in services_mapa.listar_fotos(get_session())
    ]
    raiz = os.path.join(current_app.root_path, "images")
    for carpeta in CARPETAS_FOTOS:
        ruta = os.path.join(raiz, carpeta)
        if not os.path.isdir(ruta):
            continue
        for nombre in sorted(os.listdir(ruta)):
            if os.path.splitext(nombre)[1].lower() in EXTENSIONES_FOTO:
                fotos.append({
                    "nombre": f"{carpeta}/{nombre}",
                    "url": f"/images/{carpeta}/{quote(nombre)}",
                })
    return fotos


# --------------------------------------------------------------------------
# Páginas
# --------------------------------------------------------------------------


@bp.route("/rutas")
def rutas_page():
    """Acepta ?desde=<id>&hasta=<id>&accesible=1 (enlaces compartidos y QR)."""
    return render_template("rutas.html")


@bp.route("/rutas/editor")
def rutas_editor():
    return render_template("rutas_editor.html")


@bp.route("/rutas/fotos/<int:foto_id>")
def rutas_foto(foto_id: int):
    foto = services_mapa.obtener_foto(get_session(), foto_id)
    if foto is None:
        return Response(status=404)
    respuesta = Response(foto.datos, mimetype=foto.tipo_mime)
    # El contenido de una foto nunca cambia (una foto nueva tiene otro id).
    respuesta.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return respuesta


@bp.route("/rutas/nodos/<int:nodo_id>/qr.png")
def rutas_nodo_qr(nodo_id: int):
    """QR «Estás aquí»: al escanearlo con la cámara del celular se abre
    «Cómo llegar» con ese punto ya elegido como origen."""
    if services_rutas.obtener_nodo(get_session(), nodo_id) is None:
        return Response(status=404)

    enlace = url_for("rutas.rutas_page", desde=nodo_id, _external=True)
    imagen = qrcode.make(enlace)
    buffer = io.BytesIO()
    imagen.save(buffer, format="PNG")
    buffer.seek(0)
    return Response(buffer.getvalue(), mimetype="image/png")


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


@bp.route("/api/rutas/red")
def api_red():
    """Toda la red. Con ?editor=1 incluye además ubicaciones y fotos."""
    session = get_session()
    datos = {
        "nodos": [services_rutas.nodo_a_dict(n) for n in services_rutas.listar_nodos(session)],
        "tramos": [services_rutas.tramo_a_dict(t) for t in services_rutas.listar_tramos(session)],
        "tipos": [
            {"valor": v, "etiqueta": e, "icono": i} for v, e, i in services_rutas.TIPOS_NODO
        ],
    }
    if request.args.get("editor"):
        datos["ubicaciones"] = [
            {"id": u.id, "nombre": u.nombre, "latitud": u.latitud, "longitud": u.longitud}
            for u in sorted(services_ubicaciones.listar_ubicaciones(session), key=lambda u: u.nombre)
        ]
        datos["fotos"] = _fotos_disponibles()
    respuesta = jsonify(datos)
    respuesta.headers["Cache-Control"] = "no-cache"
    return respuesta


@bp.route("/api/rutas/calcular")
def api_calcular():
    try:
        origen_id = int(request.args.get("desde", ""))
        destino_id = int(request.args.get("hasta", ""))
    except ValueError:
        return jsonify({"error": "Elige el punto de partida y el destino."}), 400
    accesible = request.args.get("accesible") in {"1", "true", "si"}
    try:
        ruta = services_rutas.calcular_ruta(get_session(), origen_id, destino_id, accesible)
    except services_rutas.RutaError as exc:
        return _error(exc, 404)
    return jsonify(ruta)


@bp.route("/api/rutas/nodos", methods=["POST"])
def api_nodo_crear():
    try:
        nodo = services_rutas.crear_nodo(get_session(), request.get_json(silent=True) or {})
    except services_rutas.RutaError as exc:
        return _error(exc)
    return jsonify(services_rutas.nodo_a_dict(nodo)), 201


@bp.route("/api/rutas/nodos/<int:nodo_id>", methods=["PUT", "DELETE"])
def api_nodo_detalle(nodo_id: int):
    session = get_session()
    if request.method == "DELETE":
        if not services_rutas.eliminar_nodo(session, nodo_id):
            return jsonify({"error": "Punto no encontrado"}), 404
        return jsonify({"ok": True})

    try:
        nodo = services_rutas.actualizar_nodo(session, nodo_id, request.get_json(silent=True) or {})
    except services_rutas.RutaError as exc:
        return _error(exc)
    if nodo is None:
        return jsonify({"error": "Punto no encontrado"}), 404
    return jsonify(services_rutas.nodo_a_dict(nodo))


@bp.route("/api/rutas/tramos", methods=["POST"])
def api_tramo_crear():
    try:
        tramo = services_rutas.crear_tramo(get_session(), request.get_json(silent=True) or {})
    except services_rutas.RutaError as exc:
        return _error(exc)
    return jsonify(services_rutas.tramo_a_dict(tramo)), 201


@bp.route("/api/rutas/tramos/<int:tramo_id>", methods=["PUT", "DELETE"])
def api_tramo_detalle(tramo_id: int):
    session = get_session()
    if request.method == "DELETE":
        if not services_rutas.eliminar_tramo(session, tramo_id):
            return jsonify({"error": "Tramo no encontrado"}), 404
        return jsonify({"ok": True})

    try:
        tramo = services_rutas.actualizar_tramo(session, tramo_id, request.get_json(silent=True) or {})
    except services_rutas.RutaError as exc:
        return _error(exc)
    if tramo is None:
        return jsonify({"error": "Tramo no encontrado"}), 404
    return jsonify(services_rutas.tramo_a_dict(tramo))


@bp.route("/api/rutas/ejemplo", methods=["POST"])
def api_red_ejemplo():
    try:
        creados = services_rutas.crear_red_ejemplo(get_session())
    except services_rutas.RutaError as exc:
        return _error(exc)
    return jsonify({"creados": creados}), 201


@bp.route("/api/rutas/fotos", methods=["POST"])
def api_subir_foto():
    """Guarda una foto de referencia (o un plano) en la base de datos."""
    archivo = request.files.get("foto")
    if archivo is None or not archivo.filename:
        return jsonify({"error": "No llegó ninguna foto."}), 400

    datos = archivo.read(services_mapa.MAX_FOTO_BYTES + 1)
    try:
        foto = services_mapa.guardar_foto(get_session(), archivo.filename, archivo.mimetype, datos)
    except services_mapa.ConfigError as exc:
        return _error(exc)

    return jsonify({
        "nombre": f"Subida · {foto.nombre}",
        "url": url_for("rutas.rutas_foto", foto_id=foto.id),
    }), 201


@bp.route("/api/rutas/config", methods=["GET", "PUT"])
def api_config():
    """Vista inicial, límites y pisos del mapa."""
    session = get_session()
    if request.method == "PUT":
        try:
            services_mapa.actualizar_configuracion(session, request.get_json(silent=True) or {})
        except services_mapa.ConfigError as exc:
            return _error(exc)
    respuesta = jsonify(services_mapa.configuracion_a_dict(session))
    respuesta.headers["Cache-Control"] = "no-cache"
    return respuesta


@bp.route("/api/rutas/pisos/<int(signed=True):numero>", methods=["PUT", "DELETE"])
def api_piso(numero: int):
    session = get_session()
    try:
        if request.method == "DELETE":
            datos = services_mapa.eliminar_piso(session, numero)
        else:
            services_mapa.guardar_piso(session, numero, request.get_json(silent=True) or {})
            datos = services_mapa.configuracion_a_dict(session)
    except services_mapa.ConfigError as exc:
        return _error(exc)
    return jsonify(datos)
