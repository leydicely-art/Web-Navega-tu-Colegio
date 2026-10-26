from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import String, Table, Column, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.cronograma import cronograma_cursos


# --------------------------------------------------------------------------
# Relación entre cursos y salones
# --------------------------------------------------------------------------

curso_salones = Table(
    "curso_salones",
    Base.metadata,
    Column(
        "curso_id",
        ForeignKey("cursos.id"),
        primary_key=True,
    ),
    Column(
        "salon_id",
        ForeignKey("salones.id"),
        primary_key=True,
    ),
)


if TYPE_CHECKING:
    from app.models.cronograma import Cronograma
    from app.models.estudiante import Estudiante
    from app.models.materia import Materia
    from app.models.profesor import Profesor
    from app.models.salon import Salon


class Curso(Base):
    __tablename__ = "cursos"

    id: Mapped[int] = mapped_column(primary_key=True)

    nombre: Mapped[str] = mapped_column(
        String(100),
        unique=True
    )

    descripcion: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True
    )

    estudiantes: Mapped[list["Estudiante"]] = relationship(
        back_populates="curso"
    )

    profesores: Mapped[list["Profesor"]] = relationship(
        back_populates="curso"
    )

    materias: Mapped[list["Materia"]] = relationship(
        back_populates="curso"
    )

    cronogramas: Mapped[list["Cronograma"]] = relationship(
        secondary=cronograma_cursos,
        back_populates="cursos",
    )

    # ----------------------------------------------------------------------
    # Relación muchos a muchos con salones
    # ----------------------------------------------------------------------

    salones: Mapped[list["Salon"]] = relationship(
        secondary=curso_salones,
        back_populates="cursos",
    )

    def __repr__(self) -> str:
        return f"<Curso {self.nombre}>"