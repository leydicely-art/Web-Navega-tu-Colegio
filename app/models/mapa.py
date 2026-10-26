"""Configuración del mapa de «Cómo llegar» y fotos de referencia.

Todo lo que antes vivía en archivos (app/static/mapa/lugares.json y las fotos
subidas a app/images/rutas/) se guarda aquí, en la base de datos.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, LargeBinary, String, func
from sqlalchemy.dialects.mysql import LONGBLOB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ConfiguracionMapa(Base):
    """Vista inicial y límites del mapa. Hay una sola fila (id = 1)."""

    __tablename__ = "configuracion_mapa"

    id: Mapped[int] = mapped_column(primary_key=True)

    latitud: Mapped[float] = mapped_column(Float, nullable=False)
    longitud: Mapped[float] = mapped_column(Float, nullable=False)
    zoom: Mapped[int] = mapped_column(Integer, default=18, nullable=False)

    # Límites opcionales: si están, el mapa no deja alejarse de esa zona.
    limite_sur: Mapped[float | None] = mapped_column(Float, nullable=True)
    limite_oeste: Mapped[float | None] = mapped_column(Float, nullable=True)
    limite_norte: Mapped[float | None] = mapped_column(Float, nullable=True)
    limite_este: Mapped[float | None] = mapped_column(Float, nullable=True)

    def __repr__(self) -> str:
        return f"<ConfiguracionMapa {self.latitud},{self.longitud} z{self.zoom}>"


class PisoMapa(Base):
    """Nombre y plano (imagen sobre el mapa) de un piso."""

    __tablename__ = "piso_mapa"

    id: Mapped[int] = mapped_column(primary_key=True)

    numero: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)

    plano_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    plano_sur: Mapped[float | None] = mapped_column(Float, nullable=True)
    plano_oeste: Mapped[float | None] = mapped_column(Float, nullable=True)
    plano_norte: Mapped[float | None] = mapped_column(Float, nullable=True)
    plano_este: Mapped[float | None] = mapped_column(Float, nullable=True)

    def __repr__(self) -> str:
        return f"<PisoMapa {self.numero} {self.nombre or ''}>"


class FotoRuta(Base):
    """Foto subida desde el editor de rutas (o plano de un piso), guardada como binario."""

    __tablename__ = "foto_ruta"

    id: Mapped[int] = mapped_column(primary_key=True)

    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    tipo_mime: Mapped[str] = mapped_column(String(50), nullable=False)
    tamano: Mapped[int] = mapped_column(Integer, nullable=False)

    # En MySQL/MariaDB un BLOB normal solo admite 64 KB; LONGBLOB hasta 4 GB.
    datos: Mapped[bytes] = mapped_column(
        LargeBinary().with_variant(LONGBLOB(), "mysql", "mariadb"),
        nullable=False,
    )

    creado_en: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    def __repr__(self) -> str:
        return f"<FotoRuta {self.id} {self.nombre}>"
