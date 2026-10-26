"""Servicios de negocio para cronogramas: validaciones y acceso a datos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.cronograma import Cronograma
from app.models.curso import Curso


class ValidacionError(ValueError):
    """Datos del cronograma inválidos."""


def _validar_titulo(titulo: str) -> None:
    if not titulo or not titulo.strip():
        raise ValidacionError("El título del cronograma no puede estar vacío.")


def _resolver_cursos(session: Session, curso_ids: list[int]) -> list[Curso]:
    if not curso_ids:
        return []
    return list(session.scalars(select(Curso).where(Curso.id.in_(curso_ids))))


def registrar_cronograma(
    session: Session,
    titulo: str,
    fecha,
    hora: str,
    ubicacion_id: int | None = None,
    descripcion: str | None = None,
    curso_ids: list[int] | None = None,
) -> Cronograma:

    _validar_titulo(titulo)

    cronograma = Cronograma(
        titulo=titulo,
        fecha=fecha,
        hora=hora,
        ubicacion_id=ubicacion_id,
        descripcion=descripcion,
        cursos=_resolver_cursos(session, curso_ids or []),
    )

    session.add(cronograma)
    session.commit()
    session.refresh(cronograma)

    return cronograma


def listar_cronogramas(session: Session) -> list[Cronograma]:
    return list(session.scalars(select(Cronograma)))


def obtener_cronograma(
    session: Session,
    cronograma_id: int,
) -> Cronograma | None:
    return session.get(Cronograma, cronograma_id)


def actualizar_cronograma(
    session: Session,
    cronograma_id: int,
    curso_ids: list[int] | None = None,
    **campos,
) -> Cronograma | None:

    if campos.get("titulo") is not None:
        _validar_titulo(campos["titulo"])

    cronograma = obtener_cronograma(session, cronograma_id)

    if cronograma is None:
        return None

    for clave, valor in campos.items():
        if valor is not None and hasattr(cronograma, clave):
            setattr(cronograma, clave, valor)

    if curso_ids is not None:
        cronograma.cursos = _resolver_cursos(session, curso_ids)

    session.commit()
    session.refresh(cronograma)

    return cronograma


def eliminar_cronograma(
    session: Session,
    cronograma_id: int,
) -> bool:

    cronograma = obtener_cronograma(session, cronograma_id)

    if cronograma is None:
        return False

    session.delete(cronograma)
    session.commit()

    return True