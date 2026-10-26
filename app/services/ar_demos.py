"""Experiencias AR de ejemplo ("prueba"): fijas en el código, sin depender de
la base de datos ni de una experiencia dada de alta por un administrador.

Sirven para poder explicar y probar de punta a punta cómo funciona el Modo
AR (una página exporta un JSON -> ese JSON se referencia desde un QR -> el
visor AR lo lee y hace aparecer la figura -> la lee en voz alta) sin tener
que crear antes una ubicación y una experiencia real desde el CRUD.
"""

from __future__ import annotations

DEMOS: dict[str, dict] = {
    "biblioteca": {
        "nombre_personaje": "León",
        "modelo_url": None,
        "escala": 1.0,
        "animacion_inicial": "idle",
        "animacion_interaccion": "saludo",
        "sonido_url": None,
        # No hay un archivo de audio grabado (sonido_url): el visor usa la
        # síntesis de voz del navegador para leer "dialogo" en voz alta.
        "modo_audio": True,
        "dialogo": (
            "¡Hola! Soy León, tu guía del colegio. Esto es la biblioteca: el "
            "lugar donde puedes leer, estudiar en silencio y pedir libros "
            "prestados. Aquí encontrarás libros de todas las materias, mesas "
            "para hacer tareas y bibliotecarios que te ayudan a encontrar lo "
            "que buscas."
        ),
        "ubicacion": {"id": None, "nombre": "Biblioteca"},
    },
    "rectoria": {
        "nombre_personaje": "León",
        "modelo_url": None,
        "escala": 1.0,
        "animacion_inicial": "idle",
        "animacion_interaccion": "saludo",
        "sonido_url": None,
        # Igual que la biblioteca: sin audio grabado, el visor lee "dialogo"
        # con la síntesis de voz del navegador.
        "modo_audio": True,
        "dialogo": (
            "¡Hola! Soy León, tu guía del colegio. Esto es la Rectoría: la "
            "oficina donde trabaja el rector o rectora, quien dirige todo el "
            "colegio. Aquí se toman las decisiones importantes de la "
            "institución, se atiende a las familias que necesitan un permiso o "
            "una constancia, y se coordina el trabajo de profesores y "
            "coordinadores. Si tienes una solicitud formal o una inquietud que "
            "no se resolvió en tu salón, este es el lugar al que acudir."
        ),
        "ubicacion": {"id": None, "nombre": "Rectoría"},
    },
}


def demo_existe(slug: str) -> bool:
    """True si hay una experiencia AR de ejemplo con ese slug."""
    return slug in DEMOS


def demo_a_dict(slug: str) -> dict | None:
    """Descriptor JSON de una experiencia AR de ejemplo (mismo formato que
    services.experiencias_ar.experiencia_a_dict), o None si el slug no existe."""
    demo = DEMOS.get(slug)
    return dict(demo) if demo is not None else None


def listar_slugs() -> list[str]:
    return list(DEMOS.keys())
