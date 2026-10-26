"""Servicios de negocio para cursos: validaciones y acceso a datos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Curso


class ValidacionError(ValueError):
    """Datos de curso inválidos."""


def _validar_nombre(nombre: str) -> None:
    if not nombre or not nombre.strip():
        raise ValidacionError("El nombre del curso no puede estar vacío.")


def registrar_curso(session: Session, nombre: str, descripcion: str | None = None) -> Curso:
    _validar_nombre(nombre)
    curso = Curso(nombre=nombre, descripcion=descripcion)
    session.add(curso)
    session.commit()
    return curso


def listar_cursos(session: Session) -> list[Curso]:
    return list(session.scalars(select(Curso)))


def obtener_curso(session: Session, curso_id: int) -> Curso | None:
    return session.get(Curso, curso_id)


def buscar_curso_por_nombre(session: Session, nombre: str) -> Curso | None:
    """Búsqueda exacta (sin distinguir mayúsculas) por nombre de curso."""
    return session.scalar(select(Curso).where(Curso.nombre.ilike(nombre.strip())))


def obtener_o_crear_curso(session: Session, nombre: str) -> Curso:
    """Devuelve el curso con ese nombre; si no existe, lo crea."""
    curso = buscar_curso_por_nombre(session, nombre)
    if curso:
        return curso
    return registrar_curso(session, nombre.strip())


def actualizar_curso(session: Session, curso_id: int, **campos) -> Curso | None:
    if campos.get("nombre") is not None:
        _validar_nombre(campos["nombre"])
    curso = obtener_curso(session, curso_id)
    if not curso:
        return None
    for clave, valor in campos.items():
        if valor is not None and hasattr(curso, clave):
            setattr(curso, clave, valor)
    session.commit()
    return curso


def eliminar_curso(session: Session, curso_id: int) -> bool:
    curso = obtener_curso(session, curso_id)
    if not curso:
        return False
    session.delete(curso)
    session.commit()
    return True
