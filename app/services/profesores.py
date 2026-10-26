"""Servicios de negocio para profesores: validaciones y acceso a datos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.curso import Curso
from app.models.profesor import Profesor


class ValidacionError(ValueError):
    """Datos de profesor inválidos."""


def _validar_nombre(nombre: str) -> None:
    if not nombre or not nombre.strip():
        raise ValidacionError(
            "El nombre del profesor no puede estar vacío."
        )


def registrar_profesor(
    session: Session,
    nombre: str,
    curso_id: int | None = None,
    horario_atencion: str | None = None,
    ubicacion_id: int | None = None,
) -> Profesor:

    _validar_nombre(nombre)

    nuevo_profesor = Profesor(
        nombre=nombre,
        curso_id=curso_id,
        horario_atencion=horario_atencion,
        ubicacion_id=ubicacion_id,
    )

    session.add(nuevo_profesor)
    session.commit()
    session.refresh(nuevo_profesor)

    return nuevo_profesor


def listar_profesores(session: Session) -> list[Profesor]:
    return list(session.scalars(select(Profesor)))


def obtener_profesor(
    session: Session,
    profesor_id: int,
) -> Profesor | None:

    return session.get(Profesor, profesor_id)


def buscar_profesor_por_nombre(
    session: Session,
    nombre: str,
) -> Profesor | None:

    return session.scalar(
        select(Profesor).where(
            Profesor.nombre.ilike(f"%{nombre}%")
        )
    )


def buscar_por_nombre_y_curso(
    session: Session,
    nombre: str,
    curso: str,
) -> list[Profesor]:

    return list(
        session.scalars(
            select(Profesor)
            .join(Curso, Profesor.curso_id == Curso.id)
            .where(
                Profesor.nombre.ilike(f"%{nombre}%"),
                Curso.nombre.ilike(f"%{curso}%"),
            )
        )
    )


def actualizar_profesor(
    session: Session,
    profesor_id: int,
    **campos,
) -> Profesor | None:

    profesor = obtener_profesor(session, profesor_id)

    if profesor is None:
        return None

    if "nombre" in campos and campos["nombre"] is not None:
        _validar_nombre(campos["nombre"])

    for campo, valor in campos.items():
        setattr(profesor, campo, valor)

    session.commit()
    session.refresh(profesor)

    return profesor


def eliminar_profesor(
    session: Session,
    profesor_id: int,
) -> bool:

    profesor = obtener_profesor(session, profesor_id)

    if profesor is None:
        return False

    session.delete(profesor)
    session.commit()

    return True