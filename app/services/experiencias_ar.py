"""Servicios para gestionar experiencias AR (personajes 3D activados por QR)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.experiencia_ar import ExperienciaAR
from app.services import ar_signing


def validar_experiencia(nombre_personaje: str, ubicacion_id: int | None) -> None:
    """
    Valida los datos obligatorios de una experiencia AR.
    """
    if not nombre_personaje or not nombre_personaje.strip():
        raise ValueError("El nombre del personaje no puede estar vacío.")

    if len(nombre_personaje) > 100:
        raise ValueError("El nombre del personaje no puede superar los 100 caracteres.")

    if not ubicacion_id:
        raise ValueError("Debes seleccionar la ubicación asociada.")


def listar_experiencias(session: Session) -> list[ExperienciaAR]:
    """
    Retorna todas las experiencias AR.
    """
    return list(session.scalars(select(ExperienciaAR)))


def obtener_experiencia(session: Session, experiencia_id: int) -> ExperienciaAR | None:
    """
    Busca una experiencia AR por su ID.
    """
    return session.get(ExperienciaAR, experiencia_id)


def obtener_experiencia_por_token(session: Session, token: str) -> ExperienciaAR | None:
    """
    Busca una experiencia AR por su token (el que viaja dentro del QR).
    """
    return session.scalar(select(ExperienciaAR).where(ExperienciaAR.token == token))


def crear_experiencia(
    session: Session,
    ubicacion_id: int,
    nombre_personaje: str,
    modelo_url: str | None = None,
    escala: float = 1.0,
    animacion_inicial: str = "idle",
    animacion_interaccion: str | None = None,
    sonido_url: str | None = None,
    dialogo: str | None = None,
) -> ExperienciaAR:
    """
    Crea una nueva experiencia AR con un token nuevo y opaco.
    """
    validar_experiencia(nombre_personaje, ubicacion_id)

    nueva_experiencia = ExperienciaAR(
        ubicacion_id=ubicacion_id,
        token=ar_signing.generar_token(),
        nombre_personaje=nombre_personaje.strip(),
        modelo_url=(modelo_url or "").strip() or None,
        escala=escala or 1.0,
        animacion_inicial=(animacion_inicial or "idle").strip(),
        animacion_interaccion=(animacion_interaccion or "").strip() or None,
        sonido_url=(sonido_url or "").strip() or None,
        dialogo=(dialogo or "").strip() or None,
    )

    session.add(nueva_experiencia)
    session.commit()
    session.refresh(nueva_experiencia)

    return nueva_experiencia


def actualizar_experiencia(
    session: Session,
    experiencia_id: int,
    ubicacion_id: int,
    nombre_personaje: str,
    modelo_url: str | None = None,
    escala: float = 1.0,
    animacion_inicial: str = "idle",
    animacion_interaccion: str | None = None,
    sonido_url: str | None = None,
    dialogo: str | None = None,
    activo: bool = True,
) -> ExperienciaAR | None:
    """
    Actualiza una experiencia AR existente. El token nunca cambia: es el
    identificador impreso en el QR físico.
    """
    experiencia = obtener_experiencia(session, experiencia_id)

    if experiencia is None:
        return None

    validar_experiencia(nombre_personaje, ubicacion_id)

    experiencia.ubicacion_id = ubicacion_id
    experiencia.nombre_personaje = nombre_personaje.strip()
    experiencia.modelo_url = (modelo_url or "").strip() or None
    experiencia.escala = escala or 1.0
    experiencia.animacion_inicial = (animacion_inicial or "idle").strip()
    experiencia.animacion_interaccion = (animacion_interaccion or "").strip() or None
    experiencia.sonido_url = (sonido_url or "").strip() or None
    experiencia.dialogo = (dialogo or "").strip() or None
    experiencia.activo = activo

    session.commit()
    session.refresh(experiencia)

    return experiencia


def eliminar_experiencia(session: Session, experiencia_id: int) -> bool:
    """
    Elimina una experiencia AR.
    """
    experiencia = obtener_experiencia(session, experiencia_id)

    if experiencia is None:
        return False

    session.delete(experiencia)
    session.commit()

    return True


def experiencia_a_dict(experiencia: ExperienciaAR) -> dict:
    """
    Descriptor JSON que consume el visor AR una vez resuelto el QR.
    """
    return {
        "nombre_personaje": experiencia.nombre_personaje,
        "modelo_url": experiencia.modelo_url,
        "escala": experiencia.escala,
        "animacion_inicial": experiencia.animacion_inicial,
        "animacion_interaccion": experiencia.animacion_interaccion,
        "sonido_url": experiencia.sonido_url,
        "dialogo": experiencia.dialogo,
        "ubicacion": (
            {"id": experiencia.ubicacion.id, "nombre": experiencia.ubicacion.nombre}
            if experiencia.ubicacion
            else None
        ),
    }
