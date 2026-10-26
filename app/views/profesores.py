"""Vistas del CRUD de profesores: llaman directamente a los servicios."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import cursos as services_cursos
from app.services import profesores as services_profesores
from app.services import ubicaciones as services_ubicaciones

bp = Blueprint("profesores", __name__)


def _leer_ubicacion_id_del_formulario() -> int | None:
    valor = request.form.get("ubicacion_id")
    return int(valor) if valor else None


@bp.route("/profesores", methods=["GET", "POST"])
def profesores_page():
    session = get_session()
    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        curso_id = request.form.get("curso_id") or None
        horario_atencion = request.form.get("horario_atencion", "").strip() or None
        try:
            services_profesores.registrar_profesor(
                session,
                nombre,
                int(curso_id) if curso_id else None,
                horario_atencion,
                _leer_ubicacion_id_del_formulario(),
            )
            return redirect(url_for("profesores.profesores_page"))
        except services_profesores.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "profesores.html",
        profesores=services_profesores.listar_profesores(session),
        cursos=services_cursos.listar_cursos(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        error=error,
    )


@bp.route("/profesores/<int:profesor_id>/editar", methods=["GET", "POST"])
def profesor_editar(profesor_id: int):
    session = get_session()
    profesor = services_profesores.obtener_profesor(session, profesor_id)
    if not profesor:
        return redirect(url_for("profesores.profesores_page"))

    error = None
    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        curso_id = request.form.get("curso_id") or None
        horario_atencion = request.form.get("horario_atencion", "").strip() or None
        try:
            services_profesores.actualizar_profesor(
                session,
                profesor_id,
                nombre=nombre,
                curso_id=int(curso_id) if curso_id else None,
                horario_atencion=horario_atencion,
                ubicacion_id=_leer_ubicacion_id_del_formulario(),
            )
            return redirect(url_for("profesores.profesores_page"))
        except services_profesores.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "profesor_editar.html",
        profesor=profesor,
        cursos=services_cursos.listar_cursos(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        error=error,
    )


@bp.route("/profesores/<int:profesor_id>/eliminar", methods=["POST"])
def profesor_eliminar(profesor_id: int):
    services_profesores.eliminar_profesor(get_session(), profesor_id)
    return redirect(url_for("profesores.profesores_page"))
