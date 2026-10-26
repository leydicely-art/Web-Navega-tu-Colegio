"""Vistas del CRUD del banco de preguntas: llaman directamente a los servicios."""

from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.models.pregunta import DIFICULTAD_MAX, DIFICULTAD_MIN
from app.services import materias as services_materias
from app.services import preguntas as services_preguntas

bp = Blueprint("preguntas", __name__)

NIVELES_DIFICULTAD = list(range(DIFICULTAD_MIN, DIFICULTAD_MAX + 1))


def _entero_o_none(valor: str | None) -> int | None:
    try:
        return int(valor) if valor else None
    except (TypeError, ValueError):
        return None


@bp.route("/preguntas", methods=["GET", "POST"])
def preguntas_page():
    session = get_session()
    error = None

    if request.method == "POST":
        materia_id = _entero_o_none(request.form.get("materia_id"))
        enunciado = request.form.get("enunciado", "").strip()
        respuesta = request.form.get("respuesta", "").strip() or None
        dificultad = _entero_o_none(request.form.get("dificultad")) or DIFICULTAD_MIN
        activa = request.form.get("activa") == "on"

        try:
            services_preguntas.registrar_pregunta(
                session,
                materia_id,
                enunciado,
                dificultad,
                respuesta,
                activa,
            )
            return redirect(url_for("preguntas.preguntas_page"))

        except services_preguntas.ValidacionError as exc:
            session.rollback()
            error = str(exc)

    filtro_materia = _entero_o_none(request.args.get("materia_id"))
    filtro_dificultad = _entero_o_none(request.args.get("dificultad"))

    return render_template(
        "preguntas.html",
        preguntas=services_preguntas.listar_preguntas(
            session,
            materia_id=filtro_materia,
            dificultad=filtro_dificultad,
        ),
        materias=services_materias.listar_materias(session),
        niveles=NIVELES_DIFICULTAD,
        filtro_materia=filtro_materia,
        filtro_dificultad=filtro_dificultad,
        error=error,
    )


@bp.route("/preguntas/<int:pregunta_id>/editar", methods=["GET", "POST"])
def pregunta_editar(pregunta_id: int):
    session = get_session()

    pregunta = services_preguntas.obtener_pregunta(session, pregunta_id)

    if pregunta is None:
        return redirect(url_for("preguntas.preguntas_page"))

    error = None

    if request.method == "POST":
        materia_id = _entero_o_none(request.form.get("materia_id"))
        enunciado = request.form.get("enunciado", "").strip()
        respuesta = request.form.get("respuesta", "").strip() or None
        dificultad = _entero_o_none(request.form.get("dificultad")) or DIFICULTAD_MIN
        activa = request.form.get("activa") == "on"

        try:
            services_preguntas.actualizar_pregunta(
                session,
                pregunta_id,
                materia_id=materia_id,
                enunciado=enunciado,
                dificultad=dificultad,
                respuesta=respuesta,
            )
            # `activa` es booleano: se asigna aparte para poder desmarcarlo.
            pregunta.activa = activa
            session.commit()

            return redirect(url_for("preguntas.preguntas_page"))

        except services_preguntas.ValidacionError as exc:
            session.rollback()
            error = str(exc)

    return render_template(
        "pregunta_editar.html",
        pregunta=pregunta,
        materias=services_materias.listar_materias(session),
        niveles=NIVELES_DIFICULTAD,
        error=error,
    )


@bp.route("/preguntas/<int:pregunta_id>/eliminar", methods=["POST"])
def pregunta_eliminar(pregunta_id: int):
    services_preguntas.eliminar_pregunta(
        get_session(),
        pregunta_id,
    )

    return redirect(url_for("preguntas.preguntas_page"))
