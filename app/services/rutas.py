"""Servicios de la red de recorridos internos («Cómo llegar»).

- CRUD de nodos y tramos de la red (lo usa el editor en /rutas/editor).
- calcular_ruta(): ruta más corta (Dijkstra) entre dos nodos, opcionalmente
  evitando tramos no accesibles (escaleras).
- Las indicaciones paso a paso se generan a partir de la geometría (giros a
  izquierda/derecha, cambios de piso) salvo que el tramo tenga una
  instrucción escrita a mano.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.ruta import NodoRuta, TramoRuta
from app.models.ubicacion import Ubicacion
from app.services.mapa_config import obtener_configuracion

# (valor, etiqueta, ícono)
TIPOS_NODO: list[tuple[str, str, str]] = [
    ("punto", "Punto de paso (pasillo, cruce)", "•"),
    ("entrada", "Entrada / puerta", "🚪"),
    ("destino", "Destino (salón, oficina…)", "📍"),
    ("escalera", "Escalera", "🪜"),
    ("ascensor", "Ascensor", "🛗"),
    ("rampa", "Rampa", "♿"),
]
VALORES_TIPOS_NODO = {valor for valor, _, _ in TIPOS_NODO}
ICONOS_TIPO = {valor: icono for valor, _, icono in TIPOS_NODO}

# Velocidad media al caminar (m/s) para estimar el tiempo.
VELOCIDAD_CAMINANDO = 1.2
# Costo equivalente (metros) de cambiar un piso por escalera o ascensor
# (incluye la espera del ascensor).
COSTO_PISO_ESCALERA = 12.0
COSTO_PISO_ASCENSOR = 20.0


class RutaError(ValueError):
    """Error de validación o de cálculo de la ruta (mensaje apto para el usuario)."""


# --------------------------------------------------------------------------
# Utilidades geométricas
# --------------------------------------------------------------------------


def distancia_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia en metros entre dos coordenadas (fórmula de haversine)."""
    radio = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radio * math.asin(math.sqrt(a))


def rumbo(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Rumbo en grados (0 = norte, 90 = este) para ir del punto 1 al 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _giro(rumbo_anterior: float, rumbo_nuevo: float) -> str:
    """Clasifica el cambio de dirección entre dos tramos."""
    delta = (rumbo_nuevo - rumbo_anterior + 540) % 360 - 180  # -180..180
    if abs(delta) < 30:
        return "recto"
    if abs(delta) > 150:
        return "vuelta"
    if delta > 0:
        return "derecha" if delta > 60 else "leve-derecha"
    return "izquierda" if delta < -60 else "leve-izquierda"


# --------------------------------------------------------------------------
# Validación y CRUD
# --------------------------------------------------------------------------


def _limpiar(texto: str | None, maximo: int, campo: str) -> str | None:
    if texto is None:
        return None
    texto = str(texto).strip()
    if not texto:
        return None
    if len(texto) > maximo:
        raise RutaError(f"{campo} no puede superar los {maximo} caracteres.")
    return texto


def _validar_nodo(datos: dict, session: Session) -> dict:
    tipo = datos.get("tipo") or "punto"
    if tipo not in VALORES_TIPOS_NODO:
        raise RutaError("Tipo de punto no válido.")

    try:
        latitud = float(datos["latitud"])
        longitud = float(datos["longitud"])
    except (KeyError, TypeError, ValueError):
        raise RutaError("El punto necesita latitud y longitud numéricas.") from None
    if not (-90 <= latitud <= 90 and -180 <= longitud <= 180):
        raise RutaError("Coordenadas fuera de rango.")

    try:
        piso = int(datos.get("piso") or 1)
    except (TypeError, ValueError):
        raise RutaError("El piso debe ser un número entero.") from None
    if not -5 <= piso <= 50:
        raise RutaError("El piso debe estar entre -5 y 50.")

    ubicacion_id = datos.get("ubicacion_id") or None
    if ubicacion_id is not None:
        try:
            ubicacion_id = int(ubicacion_id)
        except (TypeError, ValueError):
            raise RutaError("Ubicación no válida.") from None
        if session.get(Ubicacion, ubicacion_id) is None:
            raise RutaError("La ubicación indicada no existe.")

    nombre = _limpiar(datos.get("nombre"), 100, "El nombre")
    if tipo == "destino" and not nombre and ubicacion_id is None:
        raise RutaError("Un destino necesita un nombre o una ubicación vinculada.")

    return {
        "nombre": nombre,
        "tipo": tipo,
        "piso": piso,
        "latitud": latitud,
        "longitud": longitud,
        "ubicacion_id": ubicacion_id,
        "foto_url": _limpiar(datos.get("foto_url"), 255, "La URL de la foto"),
        "descripcion": _limpiar(datos.get("descripcion"), 255, "La descripción"),
    }


def listar_nodos(session: Session) -> list[NodoRuta]:
    return list(session.scalars(select(NodoRuta).order_by(NodoRuta.piso, NodoRuta.id)))


def listar_tramos(session: Session) -> list[TramoRuta]:
    return list(session.scalars(select(TramoRuta).order_by(TramoRuta.id)))


def obtener_nodo(session: Session, nodo_id: int) -> NodoRuta | None:
    return session.get(NodoRuta, nodo_id)


def crear_nodo(session: Session, datos: dict) -> NodoRuta:
    nodo = NodoRuta(**_validar_nodo(datos, session))
    session.add(nodo)
    session.commit()
    session.refresh(nodo)
    return nodo


def actualizar_nodo(session: Session, nodo_id: int, datos: dict) -> NodoRuta | None:
    nodo = obtener_nodo(session, nodo_id)
    if nodo is None:
        return None
    # Permite actualizaciones parciales (p. ej. solo mover el punto).
    actuales = {
        "nombre": nodo.nombre, "tipo": nodo.tipo, "piso": nodo.piso,
        "latitud": nodo.latitud, "longitud": nodo.longitud,
        "ubicacion_id": nodo.ubicacion_id, "foto_url": nodo.foto_url,
        "descripcion": nodo.descripcion,
    }
    actuales.update({k: v for k, v in datos.items() if k in actuales})
    for campo, valor in _validar_nodo(actuales, session).items():
        setattr(nodo, campo, valor)
    session.commit()
    session.refresh(nodo)
    return nodo


def eliminar_nodo(session: Session, nodo_id: int) -> bool:
    nodo = obtener_nodo(session, nodo_id)
    if nodo is None:
        return False
    # Se borran explícitamente los tramos (no todos los motores aplican
    # ON DELETE CASCADE).
    for tramo in session.scalars(
        select(TramoRuta).where(or_(TramoRuta.origen_id == nodo_id, TramoRuta.destino_id == nodo_id))
    ):
        session.delete(tramo)
    session.delete(nodo)
    session.commit()
    return True


def crear_tramo(session: Session, datos: dict) -> TramoRuta:
    try:
        origen_id = int(datos.get("origen_id"))
        destino_id = int(datos.get("destino_id"))
    except (TypeError, ValueError):
        raise RutaError("Indica los dos puntos que une el tramo.") from None
    if origen_id == destino_id:
        raise RutaError("Un tramo debe unir dos puntos distintos.")

    origen = obtener_nodo(session, origen_id)
    destino = obtener_nodo(session, destino_id)
    if origen is None or destino is None:
        raise RutaError("Alguno de los puntos no existe.")

    existente = session.scalar(
        select(TramoRuta).where(
            or_(
                (TramoRuta.origen_id == origen_id) & (TramoRuta.destino_id == destino_id),
                (TramoRuta.origen_id == destino_id) & (TramoRuta.destino_id == origen_id),
            )
        )
    )
    if existente is not None:
        raise RutaError("Esos dos puntos ya están conectados.")

    if origen.piso != destino.piso:
        verticales = {"escalera", "ascensor", "rampa"}
        if origen.tipo not in verticales or destino.tipo not in verticales:
            raise RutaError("Para cambiar de piso, conecta dos escaleras, dos ascensores o dos rampas.")

    accesible = datos.get("accesible")
    if accesible is None:
        # Por defecto, todo tramo que toque una escalera no es accesible.
        accesible = "escalera" not in (origen.tipo, destino.tipo)

    tramo = TramoRuta(
        origen_id=origen_id,
        destino_id=destino_id,
        accesible=bool(accesible),
        instruccion=_limpiar(datos.get("instruccion"), 255, "La instrucción"),
        foto_url=_limpiar(datos.get("foto_url"), 255, "La URL de la foto"),
    )
    session.add(tramo)
    session.commit()
    session.refresh(tramo)
    return tramo


def actualizar_tramo(session: Session, tramo_id: int, datos: dict) -> TramoRuta | None:
    tramo = session.get(TramoRuta, tramo_id)
    if tramo is None:
        return None
    if "accesible" in datos:
        tramo.accesible = bool(datos["accesible"])
    if "instruccion" in datos:
        tramo.instruccion = _limpiar(datos["instruccion"], 255, "La instrucción")
    if "foto_url" in datos:
        tramo.foto_url = _limpiar(datos["foto_url"], 255, "La URL de la foto")
    session.commit()
    session.refresh(tramo)
    return tramo


def eliminar_tramo(session: Session, tramo_id: int) -> bool:
    tramo = session.get(TramoRuta, tramo_id)
    if tramo is None:
        return False
    session.delete(tramo)
    session.commit()
    return True


def nombre_nodo(nodo: NodoRuta) -> str:
    if nodo.nombre:
        return nodo.nombre
    if nodo.ubicacion is not None:
        return nodo.ubicacion.nombre
    etiqueta = {v: e for v, e, _ in TIPOS_NODO}.get(nodo.tipo, "Punto")
    return f"{etiqueta.split(' (')[0]} · piso {nodo.piso}"


def nodo_a_dict(nodo: NodoRuta) -> dict:
    return {
        "id": nodo.id,
        "nombre": nodo.nombre,
        "etiqueta": nombre_nodo(nodo),
        "tipo": nodo.tipo,
        "icono": ICONOS_TIPO.get(nodo.tipo, "•"),
        "piso": nodo.piso,
        "latitud": nodo.latitud,
        "longitud": nodo.longitud,
        "ubicacion_id": nodo.ubicacion_id,
        "ubicacion": nodo.ubicacion.nombre if nodo.ubicacion else None,
        "foto_url": nodo.foto_url,
        "descripcion_propia": nodo.descripcion,
        "descripcion": nodo.descripcion or (nodo.ubicacion.descripcion if nodo.ubicacion else None),
        # Se puede elegir como origen/destino en «Cómo llegar».
        "seleccionable": nodo.ubicacion_id is not None or (bool(nodo.nombre) and nodo.tipo != "punto"),
    }


def tramo_a_dict(tramo: TramoRuta) -> dict:
    return {
        "id": tramo.id,
        "origen_id": tramo.origen_id,
        "destino_id": tramo.destino_id,
        "accesible": tramo.accesible,
        "instruccion": tramo.instruccion,
        "foto_url": tramo.foto_url,
    }


# --------------------------------------------------------------------------
# Cálculo de rutas
# --------------------------------------------------------------------------


@dataclass
class _Arista:
    vecino: int
    tramo: TramoRuta
    costo: float


def _costo_tramo(a: NodoRuta, b: NodoRuta) -> float:
    plano = distancia_m(a.latitud, a.longitud, b.latitud, b.longitud)
    pisos = abs(a.piso - b.piso)
    if not pisos:
        return plano
    por_piso = COSTO_PISO_ASCENSOR if "ascensor" in (a.tipo, b.tipo) else COSTO_PISO_ESCALERA
    return plano + pisos * por_piso


def _grafo(nodos: dict[int, NodoRuta], tramos: list[TramoRuta], accesible: bool) -> dict[int, list[_Arista]]:
    grafo: dict[int, list[_Arista]] = {nid: [] for nid in nodos}
    for t in tramos:
        if accesible and not t.accesible:
            continue
        a, b = nodos.get(t.origen_id), nodos.get(t.destino_id)
        if a is None or b is None:
            continue
        costo = _costo_tramo(a, b)
        grafo[a.id].append(_Arista(b.id, t, costo))
        grafo[b.id].append(_Arista(a.id, t, costo))
    return grafo


def _dijkstra(grafo: dict[int, list[_Arista]], origen: int, destino: int) -> list[tuple[int, TramoRuta | None]] | None:
    """Devuelve [(nodo, tramo por el que se llegó), ...] o None si no hay camino."""
    distancias = {origen: 0.0}
    previo: dict[int, tuple[int, TramoRuta]] = {}
    cola = [(0.0, origen)]
    visitados = set()
    while cola:
        d, actual = heapq.heappop(cola)
        if actual in visitados:
            continue
        visitados.add(actual)
        if actual == destino:
            break
        for arista in grafo.get(actual, []):
            nueva = d + arista.costo
            if nueva < distancias.get(arista.vecino, math.inf):
                distancias[arista.vecino] = nueva
                previo[arista.vecino] = (actual, arista.tramo)
                heapq.heappush(cola, (nueva, arista.vecino))

    if destino not in visitados:
        return None
    camino: list[tuple[int, TramoRuta | None]] = []
    actual = destino
    while actual != origen:
        anterior, tramo = previo[actual]
        camino.append((actual, tramo))
        actual = anterior
    camino.append((origen, None))
    camino.reverse()
    return camino


_TEXTO_GIRO = {
    "recto": "Sigue derecho",
    "leve-derecha": "Sigue ligeramente a la derecha",
    "derecha": "Gira a la derecha",
    "leve-izquierda": "Sigue ligeramente a la izquierda",
    "izquierda": "Gira a la izquierda",
    "vuelta": "Da la vuelta",
}
_ICONO_GIRO = {
    "inicio": "🚶", "recto": "⬆️", "leve-derecha": "↗️", "derecha": "➡️",
    "leve-izquierda": "↖️", "izquierda": "⬅️", "vuelta": "↩️",
    "subir": "⏫", "bajar": "⏬", "llegada": "🏁",
}


def _texto_hacia(nodo: NodoRuta) -> str:
    """«hacia la Biblioteca» si el punto tiene nombre propio."""
    if nodo.nombre or nodo.ubicacion is not None:
        return f" hasta {nombre_nodo(nodo)}"
    if nodo.tipo == "escalera":
        return " hasta las escaleras"
    if nodo.tipo == "ascensor":
        return " hasta el ascensor"
    if nodo.tipo == "entrada":
        return " hasta la puerta"
    return ""


def _pasos(camino: list[tuple[int, TramoRuta | None]], nodos: dict[int, NodoRuta]) -> list[dict]:
    pasos: list[dict] = []
    rumbo_anterior: float | None = None

    for i in range(1, len(camino)):
        a = nodos[camino[i - 1][0]]
        b = nodos[camino[i][0]]
        tramo = camino[i][1]
        metros = distancia_m(a.latitud, a.longitud, b.latitud, b.longitud)
        foto = (tramo.foto_url if tramo else None) or b.foto_url

        if a.piso != b.piso:
            sube = b.piso > a.piso
            medio = "el ascensor" if "ascensor" in (a.tipo, b.tipo) else (
                "la rampa" if "rampa" in (a.tipo, b.tipo) else "las escaleras")
            texto = (tramo.instruccion if tramo and tramo.instruccion else
                     f"{'Sube' if sube else 'Baja'} por {medio} al piso {b.piso}")
            pasos.append({
                "tipo": "subir" if sube else "bajar",
                "icono": _ICONO_GIRO["subir" if sube else "bajar"],
                "texto": texto,
                "metros": 0,
                "piso": b.piso,
                "cambio_piso": True,
                "foto_url": foto,
                "nodos": [a.id, b.id],
            })
            rumbo_anterior = None  # al salir de la escalera se reorienta
            continue

        rumbo_actual = rumbo(a.latitud, a.longitud, b.latitud, b.longitud)
        giro = "inicio" if rumbo_anterior is None else _giro(rumbo_anterior, rumbo_actual)
        rumbo_anterior = rumbo_actual

        anterior = pasos[-1] if pasos else None
        # Los tramos rectos consecutivos sin instrucción ni foto propia se unen
        # en un solo paso («Sigue derecho 40 m»).
        if (giro == "recto" and anterior and not anterior["cambio_piso"]
                and not (tramo and (tramo.instruccion or tramo.foto_url))
                and not anterior.get("manual")):
            anterior["metros"] += metros
            anterior["nodos"].append(b.id)
            anterior["foto_url"] = anterior["foto_url"] or b.foto_url
            anterior["hacia"] = _texto_hacia(b)
            continue

        if giro == "inicio":
            base = "Al salir, camina" if anterior else "Comienza a caminar"
        else:
            base = _TEXTO_GIRO[giro]
        pasos.append({
            "tipo": giro,
            "icono": _ICONO_GIRO[giro],
            "base": base,
            "hacia": _texto_hacia(b),
            "texto": tramo.instruccion if tramo and tramo.instruccion else None,
            "manual": bool(tramo and tramo.instruccion),
            "metros": metros,
            "piso": b.piso,
            "cambio_piso": False,
            "foto_url": foto,
            "nodos": [a.id, b.id],
        })

    for paso in pasos:
        if not paso.get("texto"):
            paso["texto"] = f"{paso['base']} {round(paso['metros'])} m{paso['hacia']}"
        paso["metros"] = round(paso["metros"], 1)
        for clave in ("base", "hacia", "manual"):
            paso.pop(clave, None)

    destino = nodos[camino[-1][0]]
    pasos.append({
        "tipo": "llegada",
        "icono": _ICONO_GIRO["llegada"],
        "texto": f"Llegaste a {nombre_nodo(destino)}",
        "metros": 0,
        "piso": destino.piso,
        "cambio_piso": False,
        "foto_url": destino.foto_url,
        "nodos": [destino.id],
    })
    return pasos


def calcular_ruta(session: Session, origen_id: int, destino_id: int, accesible: bool = False) -> dict:
    """
    Calcula la ruta más corta entre dos nodos y sus indicaciones paso a paso.
    Lanza RutaError si los puntos no existen o no hay camino.
    """
    nodos = {n.id: n for n in listar_nodos(session)}
    if origen_id not in nodos or destino_id not in nodos:
        raise RutaError("El punto de partida o el destino no existe.")
    if origen_id == destino_id:
        raise RutaError("Ya estás en el destino.")

    tramos = listar_tramos(session)
    camino = _dijkstra(_grafo(nodos, tramos, accesible), origen_id, destino_id)
    if camino is None:
        if accesible and _dijkstra(_grafo(nodos, tramos, False), origen_id, destino_id):
            raise RutaError("No hay una ruta accesible (sin escaleras) hasta ese destino.")
        raise RutaError("No encontré un camino entre esos dos puntos. La red de recorridos puede estar incompleta.")

    ids = [nid for nid, _ in camino]
    metros = sum(
        distancia_m(nodos[a].latitud, nodos[a].longitud, nodos[b].latitud, nodos[b].longitud)
        for a, b in zip(ids, ids[1:])
    )
    pisos = sorted({nodos[nid].piso for nid in ids})
    return {
        "origen": nodo_a_dict(nodos[origen_id]),
        "destino": nodo_a_dict(nodos[destino_id]),
        "accesible": accesible,
        "metros": round(metros, 1),
        "minutos": max(1, round(metros / VELOCIDAD_CAMINANDO / 60 + sum(
            1 for a, b in zip(ids, ids[1:]) if nodos[a].piso != nodos[b].piso) * 0.5)),
        "pisos": pisos,
        "puntos": [
            {"id": nid, "latitud": nodos[nid].latitud, "longitud": nodos[nid].longitud, "piso": nodos[nid].piso}
            for nid in ids
        ],
        "pasos": _pasos(camino, nodos),
    }


# --------------------------------------------------------------------------
# Red de ejemplo
# --------------------------------------------------------------------------


def crear_red_ejemplo(session: Session) -> int:
    """
    Crea una red de demostración (dos pisos) alrededor del centro configurado
    del mapa (tabla configuracion_mapa), solo si la red está vacía.
    Devuelve cuántos puntos creó.
    """
    if session.scalar(select(NodoRuta.id).limit(1)) is not None:
        raise RutaError("La red ya tiene puntos; la red de ejemplo solo se crea en una red vacía.")

    def ubicacion(nombre: str, descripcion: str) -> Ubicacion:
        existente = session.scalar(select(Ubicacion).where(Ubicacion.nombre == nombre))
        if existente:
            return existente
        nueva = Ubicacion(nombre=nombre, descripcion=descripcion)
        session.add(nueva)
        session.flush()
        return nueva

    # (clave, tipo, piso, lat, lon, nombre, ubicación (nombre, descripción) o None)
    puntos = [
        ("porteria", "entrada", 1, 4.62728, -74.06500, "Portería principal", None),
        ("p1", "punto", 1, 4.62760, -74.06500, None, None),
        ("p2", "punto", 1, 4.62800, -74.06500, None, None),
        ("p3", "punto", 1, 4.62800, -74.06540, None, None),
        ("p4", "punto", 1, 4.62800, -74.06460, None, None),
        ("enfermeria", "destino", 1, 4.62760, -74.06480, None, ("Enfermería", "Junto a la portería principal.")),
        ("rectoria", "destino", 1, 4.62760, -74.06530, None, ("Rectoría", "Bloque administrativo, primer piso.")),
        ("banos", "destino", 1, 4.62812, -74.06525, None, ("Baños del patio", "Junto al patio central.")),
        ("cafeteria", "destino", 1, 4.62780, -74.06455, None, ("Cafetería", "Restaurante escolar y tienda.")),
        ("esc1", "escalera", 1, 4.62820, -74.06540, "Escaleras bloque B", None),
        ("asc1", "ascensor", 1, 4.62800, -74.06555, "Ascensor bloque B", None),
        ("lab", "destino", 1, 4.62830, -74.06460, None, ("Laboratorio de informática", "Bloque D.")),
        ("esc2", "escalera", 2, 4.62820, -74.06540, "Escaleras bloque B", None),
        ("asc2", "ascensor", 2, 4.62800, -74.06555, "Ascensor bloque B", None),
        ("pas2", "punto", 2, 4.62820, -74.06525, None, None),
        ("pas2b", "punto", 2, 4.62800, -74.06525, None, None),
        ("salon201", "destino", 2, 4.62832, -74.06525, None, ("Salón 201", "Bloque B, segundo piso.")),
        ("salon203", "destino", 2, 4.62820, -74.06505, None, ("Salón 203", "Bloque B, segundo piso, al fondo del pasillo.")),
        ("biblioteca", "destino", 2, 4.62788, -74.06525, None, ("Biblioteca", "Segundo piso del bloque administrativo.")),
        ("polifuncional", "destino", 2, 4.62765, -74.06520, None, ("Polifuncional", "Espacio multiuso del colegio.")),
    ]
    # Las coordenadas de arriba están dibujadas alrededor de (4.628, -74.065);
    # se trasladan al centro configurado para que la red quede en el colegio.
    config = obtener_configuracion(session)
    d_lat, d_lon = config.latitud - 4.628, config.longitud - (-74.065)

    creados: dict[str, NodoRuta] = {}
    for clave, tipo, piso, lat, lon, nombre, ubic in puntos:
        nodo = NodoRuta(
            tipo=tipo, piso=piso, latitud=lat + d_lat, longitud=lon + d_lon, nombre=nombre,
            ubicacion_id=ubicacion(*ubic).id if ubic else None,
        )
        session.add(nodo)
        creados[clave] = nodo
    session.flush()

    conexiones = [
        ("porteria", "p1"), ("p1", "p2"), ("p2", "p3"), ("p2", "p4"),
        ("p1", "enfermeria"), ("p1", "rectoria"), ("p3", "banos"), ("p4", "cafeteria"),
        ("p3", "esc1"), ("p3", "asc1"), ("p4", "lab"),
        ("esc1", "esc2"), ("asc1", "asc2"),
        ("esc2", "pas2"), ("asc2", "pas2b"), ("pas2b", "pas2"),
        ("pas2", "salon201"), ("pas2", "salon203"), ("pas2b", "biblioteca"), ("pas2b", "polifuncional"),
    ]
    for a, b in conexiones:
        na, nb = creados[a], creados[b]
        session.add(TramoRuta(
            origen_id=na.id, destino_id=nb.id,
            accesible="escalera" not in (na.tipo, nb.tipo),
        ))
    session.commit()
    return len(creados)
