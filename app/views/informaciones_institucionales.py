from __future__ import annotations

from flask import Blueprint, redirect, render_template, request, url_for

from app.db_session import get_session
from app.services import informaciones_institucionales as services


bp = Blueprint(
    "informaciones_institucionales",
    __name__,
)


@bp.route("/informaciones_institucionales", methods=["GET", "POST"])
def informaciones_institucionales():
    session = get_session()
    error = None

    if request.method == "POST":
        try:
            services.registrar_informacion_institucional(
                session=session,
                titulo=request.form["titulo"],
                categoria=request.form["categoria"],
                palabras_clave=request.form["palabras_clave"],
                contenido=request.form["contenido"],
                estado=request.form["estado"],
            )

            return redirect(
                url_for(
                    "informaciones_institucionales.informaciones_institucionales"
                )
            )

        except ValueError as exc:
            error = str(exc)

    informaciones = services.listar_informaciones_institucionales(session)

    return render_template(
        "informacionesinstitucionales.html",
        informaciones=informaciones,
        error=error,
    )


@bp.route(
    "/informaciones_institucionales/<int:informacion_id>/editar",
    methods=["GET", "POST"],
)
def editar(informacion_id: int):
    session = get_session()
    error = None

    informacion = services.obtener_informacion_institucional(
        session,
        informacion_id,
    )

    if informacion is None:
        return redirect(
            url_for(
                "informaciones_institucionales.informaciones_institucionales"
            )
        )

    if request.method == "POST":
        try:
            services.actualizar_informacion_institucional(
                session=session,
                informacion=informacion,
                titulo=request.form["titulo"],
                categoria=request.form["categoria"],
                palabras_clave=request.form["palabras_clave"],
                contenido=request.form["contenido"],
                estado=request.form["estado"],
            )

            return redirect(
                url_for(
                    "informaciones_institucionales.informaciones_institucionales"
                )
            )

        except ValueError as exc:
            error = str(exc)

    return render_template(
        "informacioninstitucional_editar.html",
        informacion=informacion,
        error=error,
    )
