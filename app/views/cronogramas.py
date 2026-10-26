"""Vistas del CRUD de cronogramas."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import cronogramas as services_cronogramas
from app.services import cursos as services_cursos
from app.services import ubicaciones as services_ubicaciones

bp = Blueprint("cronogramas", __name__)


def _leer_curso_ids_del_formulario() -> list[int]:
    return [int(valor) for valor in request.form.getlist("curso_ids") if valor]


def _leer_ubicacion_id_del_formulario() -> int | None:
    valor = request.form.get("ubicacion_id")
    return int(valor) if valor else None


@bp.route("/cronogramas", methods=["GET", "POST"])
def cronogramas_page():
    session = get_session()
    error = None

    if request.method == "POST":
        titulo = request.form.get("titulo", "").strip()
        fecha = request.form.get("fecha")
        hora = request.form.get("hora")
        ubicacion_id = _leer_ubicacion_id_del_formulario()
        descripcion = request.form.get("descripcion", "").strip() or None

        try:
            services_cronogramas.registrar_cronograma(
                session,
                titulo,
                fecha,
                hora,
                ubicacion_id,
                descripcion,
                _leer_curso_ids_del_formulario(),
            )
            return redirect(url_for("cronogramas.cronogramas_page"))

        except services_cronogramas.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "cronogramas.html",
        cronogramas=services_cronogramas.listar_cronogramas(session),
        cursos=services_cursos.listar_cursos(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        error=error,
    )


@bp.route("/cronogramas/<int:cronograma_id>/editar", methods=["GET", "POST"])
def cronograma_editar(cronograma_id):
    session = get_session()

    cronograma = services_cronogramas.obtener_cronograma(
        session,
        cronograma_id,
    )

    if cronograma is None:
        return redirect(url_for("cronogramas.cronogramas_page"))

    error = None

    if request.method == "POST":

        titulo = request.form.get("titulo", "").strip()
        fecha = request.form.get("fecha")
        hora = request.form.get("hora")
        ubicacion_id = _leer_ubicacion_id_del_formulario()
        descripcion = request.form.get("descripcion", "").strip() or None

        try:
            services_cronogramas.actualizar_cronograma(
                session,
                cronograma_id,
                _leer_curso_ids_del_formulario(),
                titulo=titulo,
                fecha=fecha,
                hora=hora,
                ubicacion_id=ubicacion_id,
                descripcion=descripcion,
            )

            return redirect(url_for("cronogramas.cronogramas_page"))

        except services_cronogramas.ValidacionError as exc:
            error = str(exc)

    return render_template(
        "cronogramas_editar.html",
        cronograma=cronograma,
        cursos=services_cursos.listar_cursos(session),
        ubicaciones=services_ubicaciones.listar_ubicaciones(session),
        error=error,
    )


@bp.route("/cronogramas/<int:cronograma_id>/eliminar", methods=["POST"])
def cronograma_eliminar(cronograma_id):
    services_cronogramas.eliminar_cronograma(
        get_session(),
        cronograma_id,
    )

    return redirect(url_for("cronogramas.cronogramas_page"))