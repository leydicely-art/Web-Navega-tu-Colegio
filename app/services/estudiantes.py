"""Servicios de negocio para estudiantes: validaciones y acceso a datos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Curso, Estudiante


class ValidacionError(ValueError):
    """Datos de estudiante inválidos."""


def _validar_nombre(nombre: str) -> None:
    if not nombre or not nombre.strip():
        raise ValidacionError("El nombre del estudiante no puede estar vacío.")


def registrar_estudiante(session: Session, nombre: str, curso_id: int | None = None) -> Estudiante:
    _validar_nombre(nombre)
    estudiante = Estudiante(nombre=nombre, curso_id=curso_id)
    session.add(estudiante)
    session.commit()
    return estudiante


def listar_estudiantes(session: Session) -> list[Estudiante]:
    return list(session.scalars(select(Estudiante)))


def obtener_estudiante(session: Session, estudiante_id: int) -> Estudiante | None:
    return session.get(Estudiante, estudiante_id)


def buscar_estudiante_por_nombre(session: Session, nombre: str) -> Estudiante | None:
    return session.scalar(select(Estudiante).where(Estudiante.nombre.ilike(f"%{nombre}%")))


def buscar_por_nombre_y_curso_id(session: Session, nombre: str, curso_id: int) -> Estudiante | None:
    """Búsqueda exacta (sin distinguir mayúsculas) de un estudiante dentro de un curso puntual."""
    return session.scalar(
        select(Estudiante).where(
            Estudiante.nombre.ilike(nombre.strip()),
            Estudiante.curso_id == curso_id,
        )
    )


def obtener_o_crear_estudiante(session: Session, nombre: str, curso_id: int) -> Estudiante:
    """Devuelve el estudiante con ese nombre en ese curso; si no existe, lo crea."""
    estudiante = buscar_por_nombre_y_curso_id(session, nombre, curso_id)
    if estudiante:
        return estudiante
    return registrar_estudiante(session, nombre=nombre.strip(), curso_id=curso_id)


def buscar_por_nombre_y_curso(session: Session, nombre: str, curso: str) -> list[Estudiante]:
    return list(
        session.scalars(
            select(Estudiante)
            .join(Curso, Estudiante.curso_id == Curso.id)
            .where(
                Estudiante.nombre.ilike(f"%{nombre}%"),
                Curso.nombre.ilike(f"%{curso}%"),
            )
        )
    )


def actualizar_estudiante(session: Session, estudiante_id: int, **campos) -> Estudiante | None:
    if campos.get("nombre") is not None:
        _validar_nombre(campos["nombre"])
    estudiante = obtener_estudiante(session, estudiante_id)
    if not estudiante:
        return None
    for clave, valor in campos.items():
        if valor is not None and hasattr(estudiante, clave):
            setattr(estudiante, clave, valor)
    session.commit()
    return estudiante


def eliminar_estudiante(session: Session, estudiante_id: int) -> bool:
    estudiante = obtener_estudiante(session, estudiante_id)
    if not estudiante:
        return False
    session.delete(estudiante)
    session.commit()
    return True
