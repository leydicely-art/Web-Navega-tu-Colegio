"""Vistas del CRUD de estudiantes: llaman directamente a los servicios."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import cursos as services_cursos
from app.services import estudiantes as services_estudiantes

bp = Blueprint("estudiantes", __name__)


@bp.route("/estudiantes", methods=["GET", "POST"])
def estudiantes_page():
    session = get_session()
    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        curso_id = request.form.get("curso_id") or None
        try:
            services_estudiantes.registrar_estudiante(
                session, nombre, int(curso_id) if curso_id else None
            )
            return redirect(url_for("estudiantes.estudiantes_page"))
        except services_estudiantes.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "estudiantes.html",
        estudiantes=services_estudiantes.listar_estudiantes(session),
        cursos=services_cursos.listar_cursos(session),
        error=error,
    )


@bp.route("/estudiantes/<int:estudiante_id>/editar", methods=["GET", "POST"])
def estudiante_editar(estudiante_id: int):
    session = get_session()
    estudiante = services_estudiantes.obtener_estudiante(session, estudiante_id)
    if not estudiante:
        return redirect(url_for("estudiantes.estudiantes_page"))

    error = None
    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        curso_id = request.form.get("curso_id") or None
        try:
            services_estudiantes.actualizar_estudiante(
                session, estudiante_id, nombre=nombre, curso_id=int(curso_id) if curso_id else None
            )
            return redirect(url_for("estudiantes.estudiantes_page"))
        except services_estudiantes.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "estudiante_editar.html",
        estudiante=estudiante,
        cursos=services_cursos.listar_cursos(session),
        error=error,
    )


@bp.route("/estudiantes/<int:estudiante_id>/eliminar", methods=["POST"])
def estudiante_eliminar(estudiante_id: int):
    services_estudiantes.eliminar_estudiante(get_session(), estudiante_id)
    return redirect(url_for("estudiantes.estudiantes_page"))
