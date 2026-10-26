"""Vistas del CRUD de salones: llaman directamente a los servicios."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import salones as services_salones

bp = Blueprint("salones", __name__)


@bp.route("/salones", methods=["GET", "POST"])
def salones_page():
    session = get_session()
    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None

        try:
            services_salones.registrar_salon(
                session,
                nombre,
                descripcion
            )
            return redirect(url_for("salones.salones_page"))

        except services_salones.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "salones.html",
        salones=services_salones.listar_salones(session),
        error=error,
    )


@bp.route("/salones/<int:salon_id>/editar", methods=["GET", "POST"])
def salon_editar(salon_id: int):
    session = get_session()

    salon = services_salones.obtener_salon(session, salon_id)

    if not salon:
        return redirect(url_for("salones.salones_page"))

    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None

        try:
            services_salones.actualizar_salon(
                session,
                salon_id,
                nombre=nombre,
                descripcion=descripcion
            )
            return redirect(url_for("salones.salones_page"))

        except services_salones.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "salon_editar.html",
        salon=salon,
        error=error
    )


@bp.route("/salones/<int:salon_id>/eliminar", methods=["POST"])
def salon_eliminar(salon_id: int):
    services_salones.eliminar_salon(
        get_session(),
        salon_id
    )

    return redirect(url_for("salones.salones_page"))