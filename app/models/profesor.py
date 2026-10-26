from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.curso import Curso
    from app.models.materia import Materia
    from app.models.ubicacion import Ubicacion


class Profesor(Base):
    __tablename__ = "profesores"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    curso_id: Mapped[int | None] = mapped_column(
        ForeignKey("cursos.id"),
        nullable=True
    )

    # Horario de atención a estudiantes (texto libre, p. ej. "Lunes y jueves
    # 10:00-12:00") y el salón donde atiende.
    horario_atencion: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    ubicacion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ubicacion.id"),
        nullable=True,
    )

    curso: Mapped["Curso | None"] = relationship(
        back_populates="profesores"
    )

    materias: Mapped[list["Materia"]] = relationship(
        back_populates="profesor"
    )

    ubicacion: Mapped["Ubicacion | None"] = relationship(
        back_populates="profesores"
    )

    def __repr__(self) -> str:
        return f"<Profesor {self.nombre}>"