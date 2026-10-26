from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Column, Date, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.curso import Curso
    from app.models.ubicacion import Ubicacion

cronograma_cursos = Table(
    "cronograma_cursos",
    Base.metadata,
    Column("cronograma_id", ForeignKey("cronograma.id"), primary_key=True),
    Column("curso_id", ForeignKey("cursos.id"), primary_key=True),
)


class Cronograma(Base):
    __tablename__ = "cronograma"

    id: Mapped[int] = mapped_column(primary_key=True)
    titulo: Mapped[str] = mapped_column(String(100))
    fecha: Mapped[date] = mapped_column(Date)
    hora: Mapped[str] = mapped_column(String(30))
    # El lugar del evento es una ubicación del colegio (antes era texto libre).
    ubicacion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ubicacion.id"),
        nullable=True,
    )
    descripcion: Mapped[str | None] = mapped_column(String(255), nullable=True)

    ubicacion: Mapped["Ubicacion | None"] = relationship(
        back_populates="cronogramas",
    )

    cursos: Mapped[list["Curso"]] = relationship(
        secondary=cronograma_cursos,
        back_populates="cronogramas",
    )

    def __repr__(self) -> str:
        return f"<Cronograma {self.titulo}>"