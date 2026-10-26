from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.curso import Curso


class Estudiante(Base):
    __tablename__ = "estudiantes"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    curso_id: Mapped[int | None] = mapped_column(ForeignKey("cursos.id"), nullable=True)
    curso: Mapped["Curso | None"] = relationship(back_populates="estudiantes")

    def __repr__(self) -> str:
        return f"<Estudiante {self.nombre}>"
