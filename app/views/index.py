"""Vista del chatbot escolar (página principal)."""

from __future__ import annotations

from datetime import date

from flask import Blueprint, render_template, request
from flask import session as flask_session

from app.chatbot import responder
from app.db_session import get_session
from app.services import cronogramas as services_cronogramas
from app.services import cursos as services_cursos
from app.services import estudiantes as services_estudiantes
from app.services import materias as services_materias
from app.services import profesores as services_profesores

bp = Blueprint("index", __name__)


@bp.route("/", methods=["GET", "POST"])
def index():
    pregunta = ""
    respuesta = ""
    if request.method == "POST":
        pregunta = request.form.get("pregunta", "").strip()
        if pregunta:
            respuesta = responder(pregunta, get_session(), flask_session)

    session = get_session()
    cronogramas = services_cronogramas.listar_cronogramas(session)
    proximos_eventos = sorted(
        (c for c in cronogramas if c.fecha >= date.today()), key=lambda c: (c.fecha, c.hora)
    )[:3]

    stats = {
        "estudiantes": len(services_estudiantes.listar_estudiantes(session)),
        "profesores": len(services_profesores.listar_profesores(session)),
        "cursos": len(services_cursos.listar_cursos(session)),
        "materias": len(services_materias.listar_materias(session)),
        "eventos": len(proximos_eventos),
    }

    return render_template(
        "index.html",
        pregunta=pregunta,
        respuesta=respuesta,
        stats=stats,
        proximos_eventos=proximos_eventos,
    )
