"""Servicios de negocio para salones: validaciones y acceso a datos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Salon


class ValidacionError(ValueError):
    """Datos de salón inválidos."""


def _validar_nombre(nombre: str) -> None:
    if not nombre or not nombre.strip():
        raise ValidacionError("El nombre del salón no puede estar vacío.")


def registrar_salon(
    session: Session,
    nombre: str,
    ubicacion: str | None = None,
    capacidad: int | None = None,
    tipo: str | None = None,
    descripcion: str | None = None,
) -> Salon:
    """Registra un nuevo salón."""

    _validar_nombre(nombre)

    salon = Salon(
        nombre=nombre.strip(),
        ubicacion=ubicacion,
        capacidad=capacidad,
        tipo=tipo,
        descripcion=descripcion,
    )

    session.add(salon)
    session.commit()

    return salon


def listar_salones(session: Session) -> list[Salon]:
    """Devuelve todos los salones."""

    return list(session.scalars(select(Salon)))


def obtener_salon(session: Session, salon_id: int) -> Salon | None:
    """Obtiene un salón por su ID."""

    return session.get(Salon, salon_id)


def buscar_salon_por_nombre(
    session: Session,
    nombre: str
) -> Salon | None:
    """Búsqueda exacta, sin distinguir mayúsculas, por nombre de salón."""

    return session.scalar(
        select(Salon).where(
            Salon.nombre.ilike(nombre.strip())
        )
    )


def obtener_o_crear_salon(
    session: Session,
    nombre: str
) -> Salon:
    """Devuelve el salón con ese nombre; si no existe, lo crea."""

    salon = buscar_salon_por_nombre(session, nombre)

    if salon:
        return salon

    return registrar_salon(
        session,
        nombre.strip()
    )


def actualizar_salon(
    session: Session,
    salon_id: int,
    **campos
) -> Salon | None:
    """Actualiza los datos de un salón."""

    if campos.get("nombre") is not None:
        _validar_nombre(campos["nombre"])

    salon = obtener_salon(session, salon_id)

    if not salon:
        return None

    for clave, valor in campos.items():
        if valor is not None and hasattr(salon, clave):
            setattr(salon, clave, valor)

    session.commit()

    return salon


def eliminar_salon(
    session: Session,
    salon_id: int
) -> bool:
    """Elimina un salón."""

    salon = obtener_salon(session, salon_id)

    if not salon:
        return False

    session.delete(salon)
    session.commit()

    return True