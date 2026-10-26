from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.cronograma import Cronograma
    from app.models.materia import Materia
    from app.models.profesor import Profesor


class Ubicacion(Base):
    __tablename__ = "ubicacion"

    id: Mapped[int] = mapped_column(primary_key=True)

    nombre: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
    )

    descripcion: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Identificador de uno de los botones del mapa del colegio (por ejemplo
    # "biblioteca", "bloqueD", "canchaFutbol"). Cuando el chatbot responde por
    # esta ubicación y el campo está lleno, el asistente abre el visor 360° de
    # ese botón. Los valores válidos están en app/services/ubicaciones.py
    # (BOTONES_MAPA).
    accion: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    # Coordenadas GPS (grados decimales, WGS84) para ubicar el lugar en el
    # mapa GPS del colegio (/mapa). Opcionales: van las dos o ninguna.
    latitud: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    longitud: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    materias: Mapped[list["Materia"]] = relationship(
        back_populates="ubicacion"
    )

    # Cronogramas que ocurren en esta ubicación (antes era un texto libre
    # "lugar" en el propio cronograma).
    cronogramas: Mapped[list["Cronograma"]] = relationship(
        back_populates="ubicacion"
    )

    # Profesores que usan esta ubicación como salón de atención a estudiantes.
    profesores: Mapped[list["Profesor"]] = relationship(
        back_populates="ubicacion"
    )

    def __repr__(self) -> str:
        return f"<Ubicacion {self.nombre}>"