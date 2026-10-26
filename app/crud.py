"""Operaciones CRUD (crear, leer, actualizar, eliminar) para estudiantes y cursos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Curso, Estudiante

# --------------------------------------------------------------------------
# Estudiantes
# --------------------------------------------------------------------------


def crear_estudiante(session: Session, nombre: str, curso_id: int | None = None) -> Estudiante:
    estudiante = Estudiante(nombre=nombre, curso_id=curso_id)
    session.add(estudiante)
    session.commit()
    return estudiante


def listar_estudiantes(session: Session) -> list[Estudiante]:
    return list(session.scalars(select(Estudiante)))


def obtener_estudiante(session: Session, estudiante_id: int) -> Estudiante | None:
    return session.get(Estudiante, estudiante_id)


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


# --------------------------------------------------------------------------
# Cursos
# --------------------------------------------------------------------------


def crear_curso(session: Session, nombre: str, descripcion: str | None = None) -> Curso:
    curso = Curso(nombre=nombre, descripcion=descripcion)
    session.add(curso)
    session.commit()
    return curso


def listar_cursos(session: Session) -> list[Curso]:
    return list(session.scalars(select(Curso)))


def obtener_curso(session: Session, curso_id: int) -> Curso | None:
    return session.get(Curso, curso_id)


def actualizar_curso(session: Session, curso_id: int, **campos) -> Curso | None:
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
