"""Servicios para la gestión de ubicaciones."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ruta import NodoRuta
from app.models.ubicacion import Ubicacion

# Botones ubicados en el mapa del colegio (app/templates/index.html). El valor
# es el prefijo del modal (initCampusModal('<valor>', ...) -> #<valor>Modal); la
# etiqueta es lo que se muestra en el <select> de "Ubicaciones". Si una
# ubicación tiene una de estas acciones asignada, el chatbot abre su visor 360°.
BOTONES_MAPA: list[tuple[str, str]] = [
    ("entrada", "Entrada principal"),
    ("canchaFutbol", "Cancha de Fútbol"),
    ("baloncesto", "Cancha de Baloncesto"),
    ("polifuncional", "Polifuncional"),
    ("primaria", "Primaria"),
    ("coordinacionPrimaria", "Coordinación Primaria (Auditorio)"),
    ("parqueInfantil", "Parque Infantil"),
    ("biblioteca", "Biblioteca, Secretaría y Rectoría"),
    ("rectoria", "Rectoría y Secretaría"),
    ("bloqueD", "Bloque D (Ubicaciones)"),
    ("bloqueC", "Bloque C (Cursos)"),
    ("bloqueB", "Bloque B (Profesores)"),
    ("bloqueA", "Bloque A (Estudiantes)"),
    ("laboratorio", "Laboratorio de Física y Química"),
    ("aulasEspecializadas", "Aulas Especializadas"),
]

VALORES_BOTONES_MAPA: set[str] = {valor for valor, _ in BOTONES_MAPA}


def validar_ubicacion(nombre: str) -> None:
    """
    Valida el nombre de la ubicación.
    """
    if not nombre or not nombre.strip():
        raise ValueError("El nombre de la ubicación no puede estar vacío.")

    if len(nombre) > 100:
        raise ValueError(
            "El nombre de la ubicación no puede superar los 100 caracteres."
        )


def validar_accion(accion: str | None) -> None:
    """
    Valida que la acción sea uno de los botones del mapa (o nada).
    """
    if accion and accion not in VALORES_BOTONES_MAPA:
        raise ValueError("La acción indicada no corresponde a ningún botón del mapa.")


def parsear_coordenada(valor: str | None, nombre: str) -> float | None:
    """
    Convierte el texto de un formulario en una coordenada (acepta coma o
    punto decimal). Vacío -> None.
    """
    if valor is None or not valor.strip():
        return None
    try:
        return float(valor.strip().replace(",", "."))
    except ValueError:
        raise ValueError(f"La {nombre} debe ser un número (por ejemplo 4.628015).") from None


def validar_coordenadas(latitud: float | None, longitud: float | None) -> None:
    """
    Valida que las coordenadas vengan juntas y dentro de rango.
    """
    if (latitud is None) != (longitud is None):
        raise ValueError("Indica la latitud y la longitud juntas, o deja ambas vacías.")

    if latitud is not None and not -90 <= latitud <= 90:
        raise ValueError("La latitud debe estar entre -90 y 90.")

    if longitud is not None and not -180 <= longitud <= 180:
        raise ValueError("La longitud debe estar entre -180 y 180.")


def listar_ubicaciones(session: Session) -> list[Ubicacion]:
    """
    Retorna todas las ubicaciones.
    """
    return list(session.scalars(select(Ubicacion)))


def obtener_ubicacion(
    session: Session,
    ubicacion_id: int,
) -> Ubicacion | None:
    """
    Busca una ubicación por su ID.
    """
    return session.get(Ubicacion, ubicacion_id)


def crear_ubicacion(
    session: Session,
    nombre: str,
    descripcion: str | None = None,
    accion: str | None = None,
    latitud: float | None = None,
    longitud: float | None = None,
) -> Ubicacion:
    """
    Crea una nueva ubicación.
    """

    validar_ubicacion(nombre)
    validar_accion(accion)
    validar_coordenadas(latitud, longitud)

    nueva_ubicacion = Ubicacion(
        nombre=nombre,
        descripcion=descripcion,
        accion=accion,
        latitud=latitud,
        longitud=longitud,
    )

    session.add(nueva_ubicacion)
    session.commit()
    session.refresh(nueva_ubicacion)

    return nueva_ubicacion


def actualizar_ubicacion(
    session: Session,
    ubicacion_id: int,
    nombre: str,
    descripcion: str | None = None,
    accion: str | None = None,
    latitud: float | None = None,
    longitud: float | None = None,
) -> Ubicacion | None:
    """
    Actualiza una ubicación.
    """

    ubicacion = obtener_ubicacion(session, ubicacion_id)

    if ubicacion is None:
        return None

    validar_ubicacion(nombre)
    validar_accion(accion)
    validar_coordenadas(latitud, longitud)

    ubicacion.nombre = nombre
    ubicacion.descripcion = descripcion
    ubicacion.accion = accion
    ubicacion.latitud = latitud
    ubicacion.longitud = longitud

    session.commit()
    session.refresh(ubicacion)

    return ubicacion


def eliminar_ubicacion(
    session: Session,
    ubicacion_id: int,
) -> bool:
    """
    Elimina una ubicación.
    """

    ubicacion = obtener_ubicacion(session, ubicacion_id)

    if ubicacion is None:
        return False

    # Los puntos de la red de «Cómo llegar» vinculados a esta ubicación se
    # conservan (siguen siendo parte del recorrido), solo pierden el vínculo.
    for nodo in session.scalars(select(NodoRuta).where(NodoRuta.ubicacion_id == ubicacion_id)):
        nodo.ubicacion_id = None

    session.delete(ubicacion)
    session.commit()

    return True