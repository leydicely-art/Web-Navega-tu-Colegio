"""Servicios de configuración del mapa de «Cómo llegar»: vista inicial,
límites, pisos (nombre y plano) y fotos de referencia guardadas en la BD."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.mapa import ConfiguracionMapa, FotoRuta, PisoMapa
from app.models.ruta import NodoRuta

# Vista por defecto mientras no se configure una (o no haya puntos en la red).
CENTRO_POR_DEFECTO = (4.628, -74.065)
ZOOM_POR_DEFECTO = 18

TIPOS_FOTO = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_FOTO_BYTES = 8 * 1024 * 1024


class ConfigError(ValueError):
    """Error de validación (mensaje apto para el usuario)."""


def _numero(valor, campo: str, minimo: float, maximo: float) -> float:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        raise ConfigError(f"{campo} debe ser un número.") from None
    if not minimo <= numero <= maximo:
        raise ConfigError(f"{campo} debe estar entre {minimo} y {maximo}.")
    return numero


def _limites(valor) -> tuple[float, float, float, float] | None:
    """[[sur, oeste], [norte, este]] -> (sur, oeste, norte, este) o None."""
    if not valor:
        return None
    try:
        (sur, oeste), (norte, este) = valor
    except (TypeError, ValueError):
        raise ConfigError("Los límites deben ser [[sur, oeste], [norte, este]].") from None
    sur = _numero(sur, "La latitud sur", -90, 90)
    norte = _numero(norte, "La latitud norte", -90, 90)
    oeste = _numero(oeste, "La longitud oeste", -180, 180)
    este = _numero(este, "La longitud este", -180, 180)
    if sur >= norte or oeste >= este:
        raise ConfigError("Los límites no forman un rectángulo válido.")
    return sur, oeste, norte, este


# --------------------------------------------------------------------------
# Configuración general
# --------------------------------------------------------------------------


def obtener_configuracion(session: Session) -> ConfiguracionMapa:
    """Devuelve la configuración; la crea la primera vez centrada en la red
    de recorridos (si ya hay puntos) o en el centro por defecto."""
    config = session.get(ConfiguracionMapa, 1)
    if config is not None:
        return config

    lat, lon = session.execute(select(func.avg(NodoRuta.latitud), func.avg(NodoRuta.longitud))).one()
    config = ConfiguracionMapa(
        id=1,
        latitud=lat if lat is not None else CENTRO_POR_DEFECTO[0],
        longitud=lon if lon is not None else CENTRO_POR_DEFECTO[1],
        zoom=ZOOM_POR_DEFECTO,
    )
    session.add(config)
    session.commit()
    return config


def actualizar_configuracion(session: Session, datos: dict) -> ConfiguracionMapa:
    config = obtener_configuracion(session)
    if "latitud" in datos or "longitud" in datos:
        config.latitud = _numero(datos.get("latitud"), "La latitud", -90, 90)
        config.longitud = _numero(datos.get("longitud"), "La longitud", -180, 180)
    if "zoom" in datos:
        config.zoom = int(_numero(datos.get("zoom"), "El zoom", 3, 22))
    if "limites" in datos:
        limites = _limites(datos["limites"])
        config.limite_sur, config.limite_oeste, config.limite_norte, config.limite_este = (
            limites if limites else (None, None, None, None)
        )
    session.commit()
    return config


# --------------------------------------------------------------------------
# Pisos
# --------------------------------------------------------------------------


def listar_pisos(session: Session) -> list[PisoMapa]:
    return list(session.scalars(select(PisoMapa).order_by(PisoMapa.numero)))


def guardar_piso(session: Session, numero: int, datos: dict) -> PisoMapa:
    if not -5 <= numero <= 50:
        raise ConfigError("El piso debe estar entre -5 y 50.")
    piso = session.scalar(select(PisoMapa).where(PisoMapa.numero == numero))
    if piso is None:
        piso = PisoMapa(numero=numero)
        session.add(piso)

    if "nombre" in datos:
        nombre = (datos.get("nombre") or "").strip()
        if len(nombre) > 100:
            raise ConfigError("El nombre del piso no puede superar los 100 caracteres.")
        piso.nombre = nombre or None
    if "plano_url" in datos:
        plano = (datos.get("plano_url") or "").strip()
        if len(plano) > 255:
            raise ConfigError("La URL del plano es demasiado larga.")
        piso.plano_url = plano or None
    if "plano_limites" in datos:
        limites = _limites(datos["plano_limites"])
        piso.plano_sur, piso.plano_oeste, piso.plano_norte, piso.plano_este = (
            limites if limites else (None, None, None, None)
        )
    if piso.plano_url and piso.plano_sur is None:
        raise ConfigError("Para mostrar el plano, ajústalo a una zona del mapa.")

    session.commit()
    return piso


def eliminar_piso(session: Session, numero: int) -> dict:
    """Elimina la definición del piso si no tiene puntos asociados y no es el último piso guardado."""
    if not -5 <= numero <= 50:
        raise ConfigError("El piso debe estar entre -5 y 50.")

    piso = session.scalar(select(PisoMapa).where(PisoMapa.numero == numero))
    if piso is None:
        raise ConfigError("El piso no existe.")

    puntos = list(session.scalars(select(NodoRuta).where(NodoRuta.piso == numero)).all())
    if puntos:
        raise ConfigError(
            f"No se puede eliminar el piso {numero} porque todavía tiene puntos o tramos asociados. "
            "Muévalos o elimínalos antes de borrar el piso."
        )

    session.delete(piso)
    session.commit()
    return configuracion_a_dict(session)


def configuracion_a_dict(session: Session) -> dict:
    """Formato que consume el cliente (static/rutas/rutas-comun.js)."""
    config = obtener_configuracion(session)
    colegio = {
        "centro": [config.latitud, config.longitud],
        "zoom": config.zoom,
        "zoomMinimo": 3,
        "zoomMaximo": 22,
    }
    if config.limite_sur is not None:
        colegio["limites"] = [[config.limite_sur, config.limite_oeste], [config.limite_norte, config.limite_este]]

    pisos = {}
    for piso in listar_pisos(session):
        datos = {"nombre": piso.nombre}
        if piso.plano_url and piso.plano_sur is not None:
            datos["plano"] = piso.plano_url
            datos["limites"] = [[piso.plano_sur, piso.plano_oeste], [piso.plano_norte, piso.plano_este]]
        pisos[str(piso.numero)] = datos

    return {"colegio": colegio, "pisos": pisos}


# --------------------------------------------------------------------------
# Fotos
# --------------------------------------------------------------------------


def guardar_foto(session: Session, nombre: str, tipo_mime: str, datos: bytes) -> FotoRuta:
    if tipo_mime not in TIPOS_FOTO:
        raise ConfigError("Formato no permitido (usa PNG, JPG o WEBP).")
    if not datos:
        raise ConfigError("La foto está vacía.")
    if len(datos) > MAX_FOTO_BYTES:
        raise ConfigError("La foto supera los 8 MB.")
    foto = FotoRuta(
        nombre=(nombre or "foto")[:120],
        tipo_mime=tipo_mime,
        tamano=len(datos),
        datos=datos,
    )
    session.add(foto)
    session.commit()
    session.refresh(foto)
    return foto


def obtener_foto(session: Session, foto_id: int) -> FotoRuta | None:
    return session.get(FotoRuta, foto_id)


def listar_fotos(session: Session) -> list[dict]:
    """Solo los metadatos (sin cargar los binarios)."""
    filas = session.execute(
        select(FotoRuta.id, FotoRuta.nombre).order_by(FotoRuta.id.desc())
    ).all()
    return [{"id": fila.id, "nombre": fila.nombre} for fila in filas]
