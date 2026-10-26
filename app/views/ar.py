"""Vistas del Modo AR: el visor de cámara y el CRUD de administración de experiencias."""

from __future__ import annotations

import io

import qrcode
from flask import Blueprint, Response, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import ar_demos as services_ar_demos
from app.services import ar_signing
from app.services import experiencias_ar as services_experiencias_ar
from app.services import ubicaciones as services_ubicaciones

bp = Blueprint("ar", __name__, url_prefix="/ar")


@bp.route("", methods=["GET"])
def ar_page():
    """Visor de cámara: activa Modo AR, escanea QR y coloca el personaje 3D.

    Con ?embed=1 se sirve una versión sin header/sidebar (sin extender
    base.html), pensada para vivir dentro del <iframe> de la pestaña
    Cámara del asistente virtual.
    """
    if request.args.get("embed"):
        return render_template("ar_embed.html")
    return render_template("ar.html")


@bp.route("/aframe", methods=["GET"])
def ar_aframe_page():
    """Visor AR alternativo con A-Frame + MindAR (seguimiento de imagen).

    A diferencia de ar.html (Three.js + WebXR/QR), aquí León se arma con
    primitivas de A-Frame y se le animan la mandíbula y los brazos por
    separado: mueve la boca al hablar y saluda con las manos. Necesita el
    marcador compilado en app/images/targets.mind (ver la plantilla).
    """
    return render_template("ar_leon_aframe.html")


@bp.route("/demo/<slug>", methods=["GET"])
def demo_page(slug: str):
    """Página de ejemplo: explica y muestra de punta a punta el flujo
    "una página exporta un JSON -> ese JSON se referencia desde un QR -> el
    Modo AR lo lee y hace aparecer la figura -> la lee en voz alta", con un
    caso ya armado (la biblioteca) que no requiere crear antes una
    experiencia real desde el CRUD.
    """
    datos = services_ar_demos.demo_a_dict(slug)
    if datos is None:
        return Response(status=404)
    return render_template("ar_demo.html", slug=slug, datos=datos)


@bp.route("/demo/<slug>/qr.png", methods=["GET"])
def demo_qr(slug: str):
    """QR del ejemplo: apunta directo al Modo AR con el marcador
    "demo:<slug>" en el fragmento de la URL. A diferencia del QR de una
    experiencia real, no lleva token ni firma: el contenido es fijo en el
    código (ver app/services/ar_demos.py), no toca la base de datos.
    """
    if not services_ar_demos.demo_existe(slug):
        return Response(status=404)

    enlace = f"{url_for('ar.ar_page', _external=True)}#demo:{slug}"

    imagen = qrcode.make(enlace)
    buffer = io.BytesIO()
    imagen.save(buffer, format="PNG")
    buffer.seek(0)

    return Response(buffer.getvalue(), mimetype="image/png")


@bp.route("/experiencias", methods=["GET", "POST"])
def experiencias_page():
    session = get_session()
    error = None

    if request.method == "POST":
        try:
            services_experiencias_ar.crear_experiencia(
                session=session,
                ubicacion_id=request.form.get("ubicacion_id", type=int),
                nombre_personaje=request.form.get("nombre_personaje", "").strip(),
                modelo_url=request.form.get("modelo_url", "").strip() or None,
                escala=request.form.get("escala", type=float) or 1.0,
                animacion_inicial=request.form.get("animacion_inicial", "idle").strip() or "idle",
                animacion_interaccion=request.form.get("animacion_interaccion", "").strip() or None,
                sonido_url=request.form.get("sonido_url", "").strip() or None,
                dialogo=request.form.get("dialogo", "").strip() or None,
            )
            return redirect(url_for("ar.experiencias_page"))
        except ValueError as exc:
            error = str(exc)

    return render_template(
        "experiencias_ar.html",
        experiencias=services_experiencias_ar.listar_experiencias(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        error=error,
    )


@bp.route("/experiencias/<int:experiencia_id>/editar", methods=["GET", "POST"])
def experiencias_editar(experiencia_id: int):
    session = get_session()

    experiencia = services_experiencias_ar.obtener_experiencia(session, experiencia_id)
    if experiencia is None:
        return redirect(url_for("ar.experiencias_page"))

    error = None

    if request.method == "POST":
        try:
            services_experiencias_ar.actualizar_experiencia(
                session=session,
                experiencia_id=experiencia_id,
                ubicacion_id=request.form.get("ubicacion_id", type=int),
                nombre_personaje=request.form.get("nombre_personaje", "").strip(),
                modelo_url=request.form.get("modelo_url", "").strip() or None,
                escala=request.form.get("escala", type=float) or 1.0,
                animacion_inicial=request.form.get("animacion_inicial", "idle").strip() or "idle",
                animacion_interaccion=request.form.get("animacion_interaccion", "").strip() or None,
                sonido_url=request.form.get("sonido_url", "").strip() or None,
                dialogo=request.form.get("dialogo", "").strip() or None,
                activo=request.form.get("activo") == "on",
            )
            return redirect(url_for("ar.experiencias_page"))
        except ValueError as exc:
            error = str(exc)

    return render_template(
        "experiencia_ar_editar.html",
        experiencia=experiencia,
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        error=error,
    )


@bp.route("/experiencias/<int:experiencia_id>/eliminar", methods=["POST"])
def experiencia_eliminar(experiencia_id: int):
    services_experiencias_ar.eliminar_experiencia(get_session(), experiencia_id)
    return redirect(url_for("ar.experiencias_page"))


@bp.route("/experiencias/<int:experiencia_id>/qr.png", methods=["GET"])
def experiencia_qr(experiencia_id: int):
    """Genera el código QR listo para imprimir de una experiencia AR.

    Codifica un enlace al visor AR con el payload (token + firma) en el
    fragmento de la URL, para que abrir el QR con la cámara del sistema
    lleve directo al Modo AR incluso fuera de la app.
    """
    session = get_session()
    experiencia = services_experiencias_ar.obtener_experiencia(session, experiencia_id)
    if experiencia is None:
        return Response(status=404)

    payload = ar_signing.payload_qr(experiencia.token)
    enlace = f"{url_for('ar.ar_page', _external=True)}#{payload}"

    imagen = qrcode.make(enlace)
    buffer = io.BytesIO()
    imagen.save(buffer, format="PNG")
    buffer.seek(0)

    return Response(buffer.getvalue(), mimetype="image/png")
