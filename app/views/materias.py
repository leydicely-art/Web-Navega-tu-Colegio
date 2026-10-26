"""Vistas del CRUD de materias: llaman directamente a los servicios."""

from __future__ import annotations

from datetime import time

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.models.horario_materia import DIA_SLUGS, DIAS_SEMANA
from app.services import cursos as services_cursos
from app.services import materias as services_materias
from app.services import profesores as services_profesores
from app.services import ubicaciones as services_ubicaciones

bp = Blueprint("materias", __name__)


def _leer_horarios_del_formulario() -> dict[str, tuple[time, time] | None]:
    horarios: dict[str, tuple[time, time] | None] = {}

    for dia in DIAS_SEMANA:
        slug = DIA_SLUGS[dia]
        inicio = request.form.get(f"horario_{slug}_inicio", "").strip()
        fin = request.form.get(f"horario_{slug}_fin", "").strip()

        if not inicio or not fin:
            horarios[dia] = None
            continue

        horarios[dia] = (time.fromisoformat(inicio), time.fromisoformat(fin))

    return horarios


@bp.route("/materias", methods=["GET", "POST"])
def materias_page():
    session = get_session()
    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None
        profesor_id = request.form.get("profesor_id") or None
        curso_id = request.form.get("curso_id") or None
        ubicacion_id = request.form.get("ubicacion_id") or None

        try:
            services_materias.registrar_materia(
                session,
                nombre,
                descripcion,
                int(profesor_id) if profesor_id else None,
                _leer_horarios_del_formulario(),
                int(curso_id) if curso_id else None,
                int(ubicacion_id) if ubicacion_id else None,
            )
            return redirect(url_for("materias.materias_page"))

        except services_materias.ValidacionError as exc:
            session.rollback()
            error = str(exc)

    return render_template(
        "materias.html",
        materias=services_materias.listar_materias(session),
        profesores=services_profesores.listar_profesores(session),
        cursos=services_cursos.listar_cursos(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        resumir_horario=services_materias.resumir_horario,
        dias_semana=DIAS_SEMANA,
        dia_slugs=DIA_SLUGS,
        error=error,
    )


@bp.route("/materias/<int:materia_id>/editar", methods=["GET", "POST"])
def materia_editar(materia_id: int):
    session = get_session()

    materia = services_materias.obtener_materia(session, materia_id)

    if materia is None:
        return redirect(url_for("materias.materias_page"))

    error = None

    if request.method == "POST":
        nombre = request.form.get("nombre", "").strip()
        descripcion = request.form.get("descripcion", "").strip() or None
        profesor_id = request.form.get("profesor_id") or None
        curso_id = request.form.get("curso_id") or None
        ubicacion_id = request.form.get("ubicacion_id") or None

        try:
            services_materias.actualizar_materia(
                session,
                materia_id,
                nombre=nombre,
                descripcion=descripcion,
                profesor_id=int(profesor_id) if profesor_id else None,
                curso_id=int(curso_id) if curso_id else None,
                ubicacion_id=int(ubicacion_id) if ubicacion_id else None,
            )
            services_materias.guardar_horarios(
                session,
                materia_id,
                _leer_horarios_del_formulario(),
            )

            return redirect(url_for("materias.materias_page"))

        except services_materias.ValidacionError as exc:
            session.rollback()
            error = str(exc)

    horarios_por_dia = {
        horario.dia_semana: horario for horario in materia.horarios
    }

    return render_template(
        "materias_editar.html",
        materia=materia,
        profesores=services_profesores.listar_profesores(session),
        cursos=services_cursos.listar_cursos(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        dias_semana=DIAS_SEMANA,
        dia_slugs=DIA_SLUGS,
        horarios_por_dia=horarios_por_dia,
        error=error,
    )


@bp.route("/materias/<int:materia_id>/eliminar", methods=["POST"])
def materia_eliminar(materia_id: int):
    services_materias.eliminar_materia(
        get_session(),
        materia_id,
    )

    return redirect(url_for("materias.materias_page"))