from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.materia import Materia
from app.models.pregunta import DIFICULTAD_MAX, DIFICULTAD_MIN, Pregunta


class ValidacionError(ValueError):
    """Datos de la pregunta inválidos."""


def _validar_enunciado(enunciado: str) -> None:
    if not enunciado or not enunciado.strip():
        raise ValidacionError("El enunciado de la pregunta no puede estar vacío.")


def _validar_dificultad(dificultad: int) -> None:
    if not DIFICULTAD_MIN <= dificultad <= DIFICULTAD_MAX:
        raise ValidacionError(
            f"La dificultad debe estar entre {DIFICULTAD_MIN} y {DIFICULTAD_MAX}."
        )


def _validar_materia(session: Session, materia_id: int) -> None:
    if session.get(Materia, materia_id) is None:
        raise ValidacionError("La materia indicada no existe.")


def registrar_pregunta(
    session: Session,
    materia_id: int,
    enunciado: str,
    dificultad: int,
    respuesta: str | None = None,
    activa: bool = True,
) -> Pregunta:

    _validar_materia(session, materia_id)
    _validar_enunciado(enunciado)
    _validar_dificultad(dificultad)

    nueva_pregunta = Pregunta(
        materia_id=materia_id,
        enunciado=enunciado.strip(),
        dificultad=dificultad,
        respuesta=respuesta.strip() if respuesta else None,
        activa=activa,
    )

    session.add(nueva_pregunta)
    session.commit()
    session.refresh(nueva_pregunta)

    return nueva_pregunta


def listar_preguntas(
    session: Session,
    materia_id: int | None = None,
    dificultad: int | None = None,
    solo_activas: bool = False,
) -> list[Pregunta]:

    consulta = select(Pregunta)

    if materia_id is not None:
        consulta = consulta.where(Pregunta.materia_id == materia_id)
    if dificultad is not None:
        consulta = consulta.where(Pregunta.dificultad == dificultad)
    if solo_activas:
        consulta = consulta.where(Pregunta.activa.is_(True))

    consulta = consulta.order_by(Pregunta.dificultad, Pregunta.id)

    return list(session.scalars(consulta))


def obtener_pregunta(session: Session, pregunta_id: int) -> Pregunta | None:
    return session.get(Pregunta, pregunta_id)


def actualizar_pregunta(
    session: Session,
    pregunta_id: int,
    **campos,
) -> Pregunta | None:

    if campos.get("enunciado") is not None:
        _validar_enunciado(campos["enunciado"])
    if campos.get("dificultad") is not None:
        _validar_dificultad(campos["dificultad"])
    if campos.get("materia_id") is not None:
        _validar_materia(session, campos["materia_id"])

    pregunta = obtener_pregunta(session, pregunta_id)

    if pregunta is None:
        return None

    for clave, valor in campos.items():
        if valor is not None and hasattr(pregunta, clave):
            setattr(pregunta, clave, valor)

    session.commit()
    session.refresh(pregunta)

    return pregunta


def eliminar_pregunta(session: Session, pregunta_id: int) -> bool:
    pregunta = obtener_pregunta(session, pregunta_id)

    if pregunta is None:
        return False

    session.delete(pregunta)
    session.commit()

    return True
