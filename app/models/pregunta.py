"""Banco de preguntas: cada pregunta pertenece a una materia y tiene un nivel de dificultad del 1 al 5."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.materia import Materia

DIFICULTAD_MIN = 1
DIFICULTAD_MAX = 5


class Pregunta(Base):
    __tablename__ = "preguntas"
    __table_args__ = (
        CheckConstraint(
            f"dificultad BETWEEN {DIFICULTAD_MIN} AND {DIFICULTAD_MAX}",
            name="ck_pregunta_dificultad_1_5",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    materia_id: Mapped[int] = mapped_column(ForeignKey("materias.id"), nullable=False)

    enunciado: Mapped[str] = mapped_column(Text, nullable=False)

    # Respuesta correcta o esperada. Opcional: se puede subir el enunciado
    # primero y completar la respuesta después.
    respuesta: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Nivel de dificultad del 1 (más fácil) al 5 (más difícil).
    dificultad: Mapped[int] = mapped_column(Integer, default=DIFICULTAD_MIN, nullable=False)

    activa: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    creada_en: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    materia: Mapped["Materia"] = relationship(back_populates="preguntas")

    def __repr__(self) -> str:
        return f"<Pregunta materia={self.materia_id} dif={self.dificultad}>"
