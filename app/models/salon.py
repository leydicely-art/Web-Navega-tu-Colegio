from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.curso import curso_salones

if TYPE_CHECKING:
    from app.models.curso import Curso
    from app.models.horario_materia import HorarioMateria


class Salon(Base):
    __tablename__ = "salones"

    id: Mapped[int] = mapped_column(primary_key=True)

    nombre: Mapped[str] = mapped_column(
        String(100),
        unique=True
    )

    ubicacion: Mapped[str] = mapped_column(
        String(255),
        nullable=True
    )

    capacidad: Mapped[int | None] = mapped_column(
        nullable=True
    )

    tipo: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True
    )

    descripcion: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    cursos: Mapped[list["Curso"]] = relationship(
        secondary=curso_salones,
        back_populates="salones",
    )

    horarios: Mapped[list["HorarioMateria"]] = relationship(
        back_populates="salon"
    )

    def __repr__(self) -> str:
        return f"<Salon {self.nombre}>"