"""Vistas del CRUD de cursos: llaman directamente a los servicios."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import cursos as services_cursos

bp = Blueprint("cursos", __name__)


@bp.route("/cursos", methods=["GET", "POST"])
def cursos_page():
    session = get_session()
    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None
        try:
            services_cursos.registrar_curso(session, nombre, descripcion)
            return redirect(url_for("cursos.cursos_page"))
        except services_cursos.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "cursos.html",
        cursos=services_cursos.listar_cursos(session),
        error=error,
    )


@bp.route("/cursos/<int:curso_id>/editar", methods=["GET", "POST"])
def curso_editar(curso_id: int):
    session = get_session()
    curso = services_cursos.obtener_curso(session, curso_id)
    if not curso:
        return redirect(url_for("cursos.cursos_page"))

    error = None
    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None
        try:
            services_cursos.actualizar_curso(session, curso_id, nombre=nombre, descripcion=descripcion)
            return redirect(url_for("cursos.cursos_page"))
        except services_cursos.ValidacionError as exc:
            error = str(exc)

    return render_template("curso_editar.html", curso=curso, error=error)


@bp.route("/cursos/<int:curso_id>/eliminar", methods=["POST"])
def curso_eliminar(curso_id: int):
    services_cursos.eliminar_curso(get_session(), curso_id)
    return redirect(url_for("cursos.cursos_page"))
