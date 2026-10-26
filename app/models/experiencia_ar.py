"""Experiencia AR: el personaje/objeto 3D que aparece al escanear el QR de una ubicación."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.ubicacion import Ubicacion


class ExperienciaAR(Base):
    __tablename__ = "experiencia_ar"

    id: Mapped[int] = mapped_column(primary_key=True)

    ubicacion_id: Mapped[int] = mapped_column(ForeignKey("ubicacion.id"), nullable=False)

    # Token opaco y aleatorio que viaja (firmado) dentro del QR impreso.
    # Nunca es un ID consecutivo: así no se puede adivinar ni enumerar.
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)

    nombre_personaje: Mapped[str] = mapped_column(String(100), nullable=False)

    # URL del modelo .glb (relativa a /static o absoluta a un CDN). Puede
    # quedar vacía mientras no haya un modelo real: el visor AR usa un
    # personaje de reemplazo (un cubo con el nombre) para poder probar
    # el flujo completo antes de tener arte 3D definitivo.
    modelo_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    escala: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    animacion_inicial: Mapped[str] = mapped_column(String(50), default="idle", nullable=False)
    animacion_interaccion: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sonido_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dialogo: Mapped[str | None] = mapped_column(String(255), nullable=True)

    activo: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    ubicacion: Mapped["Ubicacion"] = relationship()

    def __repr__(self) -> str:
        return f"<ExperienciaAR {self.nombre_personaje} · {self.token}>"
