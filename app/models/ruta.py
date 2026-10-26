"""Red de recorridos internos del colegio (navegación paso a paso tipo PathView).

La red es un grafo: cada NodoRuta es un punto por el que se puede caminar
(un cruce de pasillos, una escalera, una puerta, un salón...) y cada TramoRuta
une dos nodos. El servicio app/services/rutas.py calcula sobre ella la ruta
más corta y las indicaciones paso a paso.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.ubicacion import Ubicacion


class NodoRuta(Base):
    __tablename__ = "nodo_ruta"

    id: Mapped[int] = mapped_column(primary_key=True)

    nombre: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Uno de app/services/rutas.py (TIPOS_NODO): punto, entrada, destino,
    # escalera, ascensor o rampa.
    tipo: Mapped[str] = mapped_column(String(20), default="punto", nullable=False)

    # Piso del edificio (1 = primer piso / nivel del suelo).
    piso: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    latitud: Mapped[float] = mapped_column(Float, nullable=False)
    longitud: Mapped[float] = mapped_column(Float, nullable=False)

    # Si el punto corresponde a una ubicación del colegio (biblioteca, salón
    # 203...), es un destino que se puede buscar en «Cómo llegar».
    ubicacion_id: Mapped[int | None] = mapped_column(
        ForeignKey("ubicacion.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Referencia visual del punto (lo que se ve al llegar), para el paso a paso.
    foto_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    descripcion: Mapped[str | None] = mapped_column(String(255), nullable=True)

    ubicacion: Mapped["Ubicacion | None"] = relationship()

    def __repr__(self) -> str:
        return f"<NodoRuta {self.id} {self.nombre or self.tipo} piso {self.piso}>"


class TramoRuta(Base):
    __tablename__ = "tramo_ruta"

    id: Mapped[int] = mapped_column(primary_key=True)

    origen_id: Mapped[int] = mapped_column(
        ForeignKey("nodo_ruta.id", ondelete="CASCADE"),
        nullable=False,
    )
    destino_id: Mapped[int] = mapped_column(
        ForeignKey("nodo_ruta.id", ondelete="CASCADE"),
        nullable=False,
    )

    # False para escaleras o pasos con desnivel: la «ruta accesible» los evita.
    accesible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Indicación escrita a mano para este tramo (si no, se genera sola) y una
    # foto de lo que se ve al recorrerlo en el sentido origen -> destino.
    instruccion: Mapped[str | None] = mapped_column(String(255), nullable=True)
    foto_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    origen: Mapped["NodoRuta"] = relationship(foreign_keys=[origen_id])
    destino: Mapped["NodoRuta"] = relationship(foreign_keys=[destino_id])

    def __repr__(self) -> str:
        return f"<TramoRuta {self.origen_id} -> {self.destino_id}>"
