from __future__ import annotations

from datetime import time
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.materia import Materia
    from app.models.salon import Salon


DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]


# Claves sin tildes, seguras para usar como nombres de campo de formulario.
DIA_SLUGS = {
    "Lunes": "lunes",
    "Martes": "martes",
    "Miércoles": "miercoles",
    "Jueves": "jueves",
    "Viernes": "viernes",
}


DIA_ABREVIADOS = {
    "Lunes": "Lun",
    "Martes": "Mar",
    "Miércoles": "Mié",
    "Jueves": "Jue",
    "Viernes": "Vie",
}


class HorarioMateria(Base):
    __tablename__ = "horarios_materia"

    __table_args__ = (
        UniqueConstraint(
            "materia_id",
            "dia_semana",
            "hora_inicio",
            "hora_fin",
            name="uq_materia_horario",
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    materia_id: Mapped[int] = mapped_column(
        ForeignKey("materias.id")
    )

    # Salón donde se dicta la clase
    salon_id: Mapped[int | None] = mapped_column(
        ForeignKey("salones.id"),
        nullable=True
    )

    dia_semana: Mapped[str] = mapped_column(
        String(20)
    )

    hora_inicio: Mapped[time] = mapped_column(
        Time
    )

    hora_fin: Mapped[time] = mapped_column(
        Time
    )

    materia: Mapped["Materia"] = relationship(
        back_populates="horarios"
    )

    # Relación con el salón
    salon: Mapped["Salon | None"] = relationship(
        back_populates="horarios"
    )

    def __repr__(self) -> str:
        return (
            f"<HorarioMateria "
            f"{self.dia_semana} "
            f"{self.hora_inicio}-{self.hora_fin}>"
        )