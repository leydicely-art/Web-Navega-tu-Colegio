"""Vistas del CRUD de ubicaciones."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import ubicaciones as services_ubicaciones

bp = Blueprint("ubicaciones", __name__)


@bp.route("/ubicaciones", methods=["GET", "POST"])
def ubicaciones_page():
    session = get_session()
    error = None

    if request.method == "POST":

        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None
        accion = request.form.get("accion", "").strip() or None

        try:
            latitud = services_ubicaciones.parsear_coordenada(
                request.form.get("latitud"), "latitud"
            )
            longitud = services_ubicaciones.parsear_coordenada(
                request.form.get("longitud"), "longitud"
            )
            services_ubicaciones.crear_ubicacion(
                session=session,
                nombre=nombre,
                descripcion=descripcion,
                accion=accion,
                latitud=latitud,
                longitud=longitud,
            )

            return redirect(
                url_for("ubicaciones.ubicaciones_page")
            )

        except ValueError as exc:
            error = str(exc)

    return render_template(
        "ubicaciones.html",
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        botones_mapa=services_ubicaciones.BOTONES_MAPA,
        botones_mapa_labels=dict(services_ubicaciones.BOTONES_MAPA),
        error=error,
    )


@bp.route("/ubicaciones/<int:ubicacion_id>/editar", methods=["GET", "POST"])
def ubicaciones_editar(ubicacion_id: int):
    session = get_session()

    ubicacion = services_ubicaciones.obtener_ubicacion(
        session,
        ubicacion_id,
    )

    if ubicacion is None:
        return redirect(
            url_for("ubicaciones.ubicaciones_page")
        )

    error = None

    if request.method == "POST":

        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None
        accion = request.form.get("accion", "").strip() or None

        try:
            latitud = services_ubicaciones.parsear_coordenada(
                request.form.get("latitud"), "latitud"
            )
            longitud = services_ubicaciones.parsear_coordenada(
                request.form.get("longitud"), "longitud"
            )
            services_ubicaciones.actualizar_ubicacion(
                session=session,
                ubicacion_id=ubicacion_id,
                nombre=nombre,
                descripcion=descripcion,
                accion=accion,
                latitud=latitud,
                longitud=longitud,
            )

            return redirect(
                url_for("ubicaciones.ubicaciones_page")
            )

        except ValueError as exc:
            error = str(exc)

    return render_template(
        "ubicacion_editar.html",
        ubicacion=ubicacion,
        botones_mapa=services_ubicaciones.BOTONES_MAPA,
        error=error,
    )


@bp.route("/ubicaciones/<int:ubicacion_id>/eliminar", methods=["POST"])
def ubicacion_eliminar(ubicacion_id: int):

    services_ubicaciones.eliminar_ubicacion(
        get_session(),
        ubicacion_id,
    )

    return redirect(
        url_for("ubicaciones.ubicaciones_page")
    )