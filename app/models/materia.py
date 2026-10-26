from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.curso import Curso
    from app.models.horario_materia import HorarioMateria
    from app.models.pregunta import Pregunta
    from app.models.profesor import Profesor
    from app.models.ubicacion import Ubicacion


class Materia(Base):
    __tablename__ = "materias"

    id: Mapped[int] = mapped_column(primary_key=True)
    # El nombre puede repetirse: dos cursos pueden tener una materia "Matemáticas".
    # El curso es lo que las distingue (ver app/chatbot.py, desambiguación).
    nombre: Mapped[str] = mapped_column(String(100))
    descripcion: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profesor_id: Mapped[int | None] = mapped_column(
        ForeignKey("profesores.id"),
        nullable=True
    )
    curso_id: Mapped[int | None] = mapped_column(
        ForeignKey("cursos.id"),
        nullable=True
    )
    ubicacion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ubicacion.id"),
        nullable=True
    )

    profesor: Mapped["Profesor | None"] = relationship(
        back_populates="materias"
    )

    curso: Mapped["Curso | None"] = relationship(
        back_populates="materias"
    )

    ubicacion: Mapped["Ubicacion | None"] = relationship(
        back_populates="materias"
    )

    horarios: Mapped[list["HorarioMateria"]] = relationship(
        back_populates="materia",
        cascade="all, delete-orphan",
    )

    preguntas: Mapped[list["Pregunta"]] = relationship(
        back_populates="materia",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Materia {self.nombre}>"