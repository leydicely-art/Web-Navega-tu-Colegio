from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InformacionInstitucional

def _validar_titulo(titulo: str) -> str:
    titulo = titulo.strip()

    if not titulo:
        raise ValueError("El título es obligatorio.")

    return titulo


def registrar_informacion_institucional(
    session: Session,
    titulo: str,
    categoria: str,
    palabras_clave: str,
    contenido: str,
    estado: str = "Activo",
) -> InformacionInstitucional:

    informacion = InformacionInstitucional(
        titulo=_validar_titulo(titulo),
        categoria=categoria.strip(),
        palabras_clave=palabras_clave.strip(),
        contenido=contenido.strip(),
        estado=estado,
    )

    session.add(informacion)
    session.commit()
    session.refresh(informacion)

    return informacion


def listar_informaciones_institucionales(
    session: Session,
) -> list[InformacionInstitucional]:

    return list(
        session.scalars(
            select(InformacionInstitucional).order_by(
                InformacionInstitucional.titulo
            )
        )
    )


def obtener_informacion_institucional(
    session: Session,
    informacion_id: int,
) -> InformacionInstitucional | None:

    return session.get(
        InformacionInstitucional,
        informacion_id,
    )


def actualizar_informacion_institucional(
    session: Session,
    informacion: InformacionInstitucional,
    titulo: str,
    categoria: str,
    palabras_clave: str,
    contenido: str,
    estado: str,
) -> InformacionInstitucional:

    informacion.titulo = _validar_titulo(titulo)
    informacion.categoria = categoria.strip()
    informacion.palabras_clave = palabras_clave.strip()
    informacion.contenido = contenido.strip()
    informacion.estado = estado

    session.commit()
    session.refresh(informacion)

    return informacion


def eliminar_informacion_institucional(
    session: Session,
    informacion: InformacionInstitucional,
) -> None:

    session.delete(informacion)
    session.commit()