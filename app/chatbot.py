"""Chatbot basado en reglas: responde preguntas sobre cursos, profesores,
materias, horarios, ubicaciones, cronograma e información institucional
consultando la base de datos.

Nota: el asistente no responde consultas sobre estudiantes concretos.
"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Cronograma,
    Curso,
    InformacionInstitucional,
    Materia,
    NodoRuta,
    Profesor,
    Ubicacion,
)
from app.models.horario_materia import DIA_ABREVIADOS, DIAS_SEMANA


AYUDA = (
    "No entendí la pregunta. Puedes preguntar, por ejemplo:\n"
    "- ¿Qué materias tiene <curso>?\n"
    "- ¿Quién es el profesor de <materia>?\n"
    "- ¿Qué materias dicta el profesor <profesor>?\n"
    "- ¿Qué curso tiene el profesor <profesor>?\n"
    "- ¿Cuál es el horario de <materia>?\n"
    "- ¿Cuál es el horario de atención del profesor <profesor>?\n"
    "- ¿Dónde queda <ubicación o materia>?\n"
    "- ¿Qué actividades hay hoy en el cronograma?\n"
    "- ¿Para qué curso es la actividad <actividad>?\n"
    "- ¿Dónde es la actividad <actividad>?\n"
    "- Muéstrame la información institucional sobre <tema>."
)


SALUDOS = {"hola", "buenas", "buenos dias", "buenos días", "buenas tardes", "buenas noches", "hey", "hi"}

_COMANDOS_AYUDA = {"ayuda", "help", "que puedes hacer", "qué puedes hacer", "opciones"}

# Clave donde se guarda, en la sesión del navegador, la pregunta que quedó a la
# espera de que el usuario aclare de qué curso habla (materias con nombre repetido).
_PENDIENTE = "materia_pendiente"
# Clave temporal (solo dura una llamada) con la materia ya elegida por el usuario.
_FORZADA = "materia_forzada"
# Estado de la consulta de rutas: destino real que el usuario pidió y aún no
# eligió su origen dentro del mapa de recorridos.
_RUTA_PENDIENTE = "ruta_pendiente"

_KEYWORDS: dict[str, list[str]] = {
    "curso": ["cursos", "curso"],
    "profesor": ["profesores", "profesora", "profesor"],
    "materia": ["materias", "materia", "asignaturas", "asignatura", "clases", "clase"],
    "horario": ["horarios", "horario", "horas", "hora"],
    "ubicacion": ["ubicaciones", "ubicación", "ubicacion", "salón", "salon", "aula", "lugar", "dónde", "donde"],
    "cronograma": ["cronograma", "actividades", "actividad", "eventos", "evento", "agenda"],
    "informacion": ["información", "informacion"],
}

_CONECTORES = {
    "de", "del", "al", "el", "la", "los", "las", "un", "una", "que", "tiene", "tienen",
    "dicta", "imparte", "es", "son", "esta", "está", "estan", "están", "se", "encuentra",
    "encuentran", "queda", "quedan", "hay", "en", "institucional", "sobre", "acerca",
    "con", "para", "por", "favor",
}

# Palabras que el usuario suele usar al responder "¿de qué curso?" y que no
# aportan al nombre del curso en sí ("la de 6A", "el curso 7B", "grado 3ro").
_RUIDO_CURSO = {"curso", "cursos", "grado", "grados", "seccion", "sección", "salon", "salón"}


def responder(pregunta: str, session: Session, contexto: dict | None = None) -> str:
    """Responde una pregunta.

    `contexto` es un diccionario persistente entre mensajes (la sesión del
    navegador). Se usa para recordar preguntas que quedaron a la espera de que
    el usuario aclare de qué curso habla. Si no se pasa, la conversación no
    tiene memoria (cada pregunta se resuelve de forma aislada).
    """
    ctx = contexto if contexto is not None else {}
    # Estado efímero de la vuelta anterior (materia ya elegida por el usuario):
    # se limpia aquí para que no contamine una pregunta nueva. `accion_de_ubicacion`
    # lo lee justo después, en la misma petición, antes de que se pierda.
    ctx.pop(_FORZADA, None)
    return _procesar(pregunta.strip().lower(), session, ctx)


def accion_de_ubicacion(
    pregunta: str,
    session: Session,
    contexto: dict | None = None,
) -> str | None:
    """Si la pregunta es por una ubicación (o por la ubicación de una materia) y
    esa ubicación tiene una acción del mapa asignada, devuelve el identificador
    del botón del mapa (por ejemplo "biblioteca" o "bloqueD").

    Lo usa la API web para que el asistente, además de responder por texto,
    abra el visor 360° de ese botón. Si no aplica, devuelve None.
    """
    contexto = contexto if contexto is not None else {}
    texto = pregunta.strip().lower()

    hallazgos = _detectar_categorias(texto)

    # Si el usuario acaba de aclarar el curso ("502") de una pregunta anterior
    # sobre una ubicación, esa respuesta suelta no dispara ninguna categoría:
    # reusamos la pregunta original que quedó guardada al resolver el curso.
    forzada = contexto.get(_FORZADA)
    if not hallazgos and forzada and forzada.get("pregunta"):
        texto = forzada["pregunta"]
        hallazgos = _detectar_categorias(texto)

    if not hallazgos:
        return None

    categorias = [categoria for _, categoria, _ in hallazgos]
    if "ubicacion" not in categorias:
        return None

    ultimo_fin = hallazgos[-1][2]
    nombre = _extraer_nombre(texto[ultimo_fin:])
    if not nombre:
        return None

    ubicacion = _buscar_ubicacion(nombre, session)
    if ubicacion is None:
        # Copia de solo lectura: si la materia tiene nombre repetido no queremos
        # que _resolver_materia deje una nueva pregunta pendiente en la sesión.
        materia, _aviso = _resolver_materia(nombre, session, dict(contexto), texto)
        ubicacion = materia.ubicacion if materia else None
    if ubicacion is None:
        return None

    return getattr(ubicacion, "accion", None) or None


def _limpiar(texto: str) -> str:
    return texto.strip(" ?¿!¡.")


# Todas las palabras que disparan una categoría (para no arrastrarlas dentro del
# nombre cuando el usuario las repite: "la actividad del cronograma pato").
_PALABRAS_CLAVE_PLANAS = {p for palabras in _KEYWORDS.values() for p in palabras}


def _extraer_nombre(resto: str) -> str:
    palabras = _limpiar(resto).split()
    while palabras and (
        palabras[0] in _CONECTORES or palabras[0] in _PALABRAS_CLAVE_PLANAS
    ):
        palabras.pop(0)
    return " ".join(palabras)


def _detectar_categorias(texto: str) -> list[tuple[int, str, int]]:
    hallazgos = []
    for categoria, palabras in _KEYWORDS.items():
        patron = r"\b(?:" + "|".join(palabras) + r")\b"
        m = re.search(patron, texto)
        if m:
            hallazgos.append((m.start(), categoria, m.end()))
    hallazgos.sort()
    return hallazgos


def _buscar_curso(nombre: str, session: Session) -> Curso | None:
    return session.scalar(select(Curso).where(Curso.nombre.ilike(f"%{nombre}%")))


def _buscar_profesor(nombre: str, session: Session) -> Profesor | None:
    return session.scalar(select(Profesor).where(Profesor.nombre.ilike(f"%{nombre}%")))


def _buscar_materia(nombre: str, session: Session) -> Materia | None:
    return session.scalar(select(Materia).where(Materia.nombre.ilike(f"%{nombre}%")))


def _buscar_materias(nombre: str, session: Session) -> list[Materia]:
    """Todas las materias cuyo nombre coincide (puede haber varias con el mismo
    nombre en cursos distintos)."""
    return list(session.scalars(select(Materia).where(Materia.nombre.ilike(f"%{nombre}%"))))


def _buscar_ubicacion(nombre: str, session: Session) -> Ubicacion | None:
    return session.scalar(select(Ubicacion).where(Ubicacion.nombre.ilike(f"%{nombre}%")))


def _buscar_destino_ruta(nombre: str, session: Session) -> dict | None:
    """Busca el destino real del mapa a partir de un nombre de salón, espacio o lugar."""
    nombre = (nombre or "").strip()
    if not nombre:
        return None

    # Primero se intenta la relación real del sistema: Ubicación -> NodoRuta.
    ubicacion = _buscar_ubicacion(nombre, session)
    if ubicacion is not None:
        nodo = session.scalar(select(NodoRuta).where(NodoRuta.ubicacion_id == ubicacion.id))
        if nodo is not None:
            return {
                "id": nodo.id,
                "nodo_id": nodo.id,
                "nombre": nodo.ubicacion.nombre if nodo.ubicacion else (nodo.nombre or ubicacion.nombre),
                "descripcion": nodo.descripcion or (nodo.ubicacion.descripcion if nodo.ubicacion else None),
                "etiqueta": nodo.ubicacion.nombre if nodo.ubicacion else (nodo.nombre or ubicacion.nombre),
                "tipo": nodo.tipo,
                "accion": (nodo.ubicacion.accion if nodo.ubicacion else None) or (ubicacion.accion if ubicacion else None),
            }
        return {
            "id": ubicacion.id,
            "nodo_id": None,
            "nombre": ubicacion.nombre,
            "descripcion": ubicacion.descripcion,
            "etiqueta": ubicacion.nombre,
            "tipo": "destino",
            "accion": ubicacion.accion,
        }

    # Si la red tiene un punto con nombre o descripción coincidente, también sirve.
    nodo = session.scalar(
        select(NodoRuta)
        .where(
            NodoRuta.nombre.ilike(f"%{nombre}%")
            | NodoRuta.descripcion.ilike(f"%{nombre}%")
        )
        .order_by(NodoRuta.piso, NodoRuta.id)
    )
    if nodo is not None:
        return {
            "id": nodo.id,
            "nodo_id": nodo.id,
            "nombre": nodo.ubicacion.nombre if nodo.ubicacion else (nodo.nombre or "Destino"),
            "descripcion": nodo.descripcion or (nodo.ubicacion.descripcion if nodo.ubicacion else None),
            "etiqueta": nodo.ubicacion.nombre if nodo.ubicacion else (nodo.nombre or "Destino"),
            "tipo": nodo.tipo,
            "accion": nodo.ubicacion.accion if nodo.ubicacion else None,
        }
    return None


def _extraer_destino_destino_ruta(texto: str) -> str | None:
    """Extrae el nombre del lugar cuando la pregunta usa un patrón natural como
    “¿Cómo llego a la biblioteca?” o “Llévame al polifuncional?”"""
    texto = (texto or "").strip()
    if not texto:
        return None

    patrones = [
        r"(?:como\s+llego|como\s+ir|como\s+voy|llego|voy|ir|vamos|llevame|llévame)\s+(?:a la|al|a|hasta|hacia)\s+(.+)",
        r"(?:d(?:o|ó)nde|donde)\s+(?:queda|est[aá]|esta|se\s+encuentra)\s+(?:el|la|los|las)?\s*(.+)",
        r"(?:a la|al|a|hasta|hacia)\s+(.+?)(?:\?|\.|!|$)",
    ]

    for patron in patrones:
        match = re.search(patron, texto.lower())
        if not match:
            continue
        nombre = match.group(1).strip(" ?¿!¡.,;:()[]{}\"'")
        nombre = re.sub(r"^(?:a la|al|a|la|el|los|las|hasta|hacia|de la|del|de los|de las|desde)\s+", "", nombre, flags=re.IGNORECASE)
        nombre = _limpiar(nombre)
        if nombre:
            return nombre
    return None


def resolver_destino_ruta(
    pregunta: str,
    session: Session,
    contexto: dict | None = None,
) -> dict | None:
    """Detecta si la pregunta apunta a un destino del mapa de rutas y prepara
    la solicitud de origen. Devuelve None si no es un destino navegable."""
    contexto = contexto if contexto is not None else {}
    texto = pregunta.strip()
    if not texto:
        return None

    buscado = texto.lower()
    hallazgos = _detectar_categorias(buscado)
    categorias = [categoria for _, categoria, _ in hallazgos]
    tiene_intencion_ruta = bool(
        re.search(
            r"\b(cómo|como)\s+(llego|ir|voy)|\b(llevame|llévame|ve|vamos)\s+(a|al|hasta)|\b(dónde|donde)\s+(queda|está|esta)|\b(ubicación|ubicacion)\b",
            buscado,
        )
        or "ubicacion" in categorias
    )
    if not tiene_intencion_ruta:
        return None

    nombre = None
    if hallazgos:
        ultimo_fin = hallazgos[-1][2]
        nombre = _extraer_nombre(texto[ultimo_fin:])
    if not nombre:
        nombre = _extraer_destino_destino_ruta(texto)
    if not nombre:
        return None

    destino = _buscar_destino_ruta(nombre, session)
    if destino is None:
        contexto.pop(_RUTA_PENDIENTE, None)
        return {
            "solicita_origen": False,
            "error": f"No encontré un punto del mapa asociado a '{nombre}'. Puedes probar con otro salón o espacio.",
        }

    contexto[_RUTA_PENDIENTE] = {
        "destino_id": destino["id"],
        "nombre": destino["nombre"],
        "pregunta": texto,
        "descripcion": destino["descripcion"],
        "mensaje": "¿Dónde te encuentras actualmente? Selecciona tu ubicación de origen para mostrarte la ruta",
    }
    return {
        "solicita_origen": True,
        "destino": destino,
        "mensaje": "¿Dónde te encuentras actualmente? Selecciona tu ubicación de origen para mostrarte la ruta",
    }


# --------------------------------------------------------------------------
# Materias con nombre repetido: desambiguación por curso
# --------------------------------------------------------------------------


def _curso_de_materia_texto(materia: Materia) -> str:
    return materia.curso.nombre if materia.curso else "sin curso"


def _rotular_materia(materia: Materia, session: Session) -> str:
    """Nombre de la materia, añadiendo el curso entre paréntesis solo cuando hay
    más de una materia con ese mismo nombre (para que la respuesta sea clara)."""
    cuantas = session.scalar(
        select(func.count(Materia.id)).where(Materia.nombre == materia.nombre)
    )
    if cuantas and cuantas > 1 and materia.curso:
        return f"{materia.nombre} ({materia.curso.nombre})"
    return materia.nombre


def _cursos_en_lenguaje_natural(cursos: list[str]) -> str:
    unicos = list(dict.fromkeys(cursos))
    if len(unicos) == 1:
        return unicos[0]
    return ", ".join(unicos[:-1]) + " o " + unicos[-1]


def _emparejar_curso(texto: str, opciones: list[dict]) -> dict | None:
    """Dado lo que respondió el usuario ("la de 6A", "el curso 7B", "3ro a"),
    intenta decir a cuál de las opciones se refiere."""
    palabras = [
        p for p in _limpiar(texto).split()
        if p not in _CONECTORES and p not in _RUIDO_CURSO
    ]
    candidato = " ".join(palabras).strip()
    if not candidato:
        return None

    for opcion in opciones:
        curso = opcion["curso"].lower()
        if candidato == curso or candidato in curso or curso in candidato:
            return opcion

    # Coincidencia laxa por palabras sueltas ("6a" dentro de "6to a", etc.).
    for opcion in opciones:
        curso = opcion["curso"].lower()
        if all(token in curso for token in candidato.split()):
            return opcion

    return None


def _materia_por_curso_en_frase(materias: list[Materia], texto: str) -> Materia | None:
    """Si la propia pregunta ya nombra el curso ("horario de matemáticas de 6A"),
    elige esa materia sin necesidad de volver a preguntar."""
    for materia in materias:
        if not materia.curso:
            continue
        curso = materia.curso.nombre.lower()
        if curso and curso in texto:
            return materia
        if all(token in texto for token in curso.split()):
            return materia
    return None


def _resolver_materia(
    nombre: str,
    session: Session,
    contexto: dict,
    texto: str,
) -> tuple[Materia | None, str | None]:
    """Resuelve una materia por nombre teniendo en cuenta los nombres repetidos.

    Devuelve una tupla (materia, aviso):
    - (materia, None)   -> se identificó una única materia.
    - (None, aviso)     -> hay varias; `aviso` es la pregunta amable por el curso.
    - (None, None)      -> no existe ninguna materia con ese nombre (que lo
                           resuelva quien llama, con su propio mensaje).
    """
    # ¿El usuario ya eligió el curso en el mensaje anterior?
    forzada = contexto.get(_FORZADA)
    if forzada and nombre and (
        forzada["nombre"] in nombre or nombre in forzada["nombre"]
    ):
        materia = session.get(Materia, forzada["id"])
        if materia is not None:
            return materia, None

    materias = _buscar_materias(nombre, session)

    if not materias:
        # ¿El usuario metió el curso dentro del nombre? ("matemáticas de 7B",
        # "matemáticas en 502", "matemáticas del 6A").
        for separador in (" de ", " del ", " en "):
            izquierda, _, derecha = nombre.partition(separador)
            derecha = derecha.strip()
            if not derecha or _buscar_curso(derecha, session) is None:
                continue
            candidatas = _buscar_materias(izquierda.strip(), session)
            if len(candidatas) == 1:
                return candidatas[0], None
            if len(candidatas) > 1:
                elegida = (
                    _materia_por_curso_en_frase(candidatas, texto)
                    or _materia_por_curso_en_frase(candidatas, derecha)
                )
                if elegida is not None:
                    return elegida, None
                materias = candidatas
                break
        if not materias:
            return None, None

    if len(materias) == 1:
        return materias[0], None

    elegida = _materia_por_curso_en_frase(materias, texto)
    if elegida is not None:
        return elegida, None

    opciones = [
        {"id": materia.id, "curso": _curso_de_materia_texto(materia)}
        for materia in materias
    ]
    contexto[_PENDIENTE] = {"pregunta": texto, "nombre": nombre, "opciones": opciones}

    cursos = _cursos_en_lenguaje_natural([opcion["curso"] for opcion in opciones])
    return None, (
        f"Encontré varias materias llamadas «{materias[0].nombre}». "
        f"¿Sobre cuál curso quieres saber: {cursos}?"
    )


def _resolver_pendiente(
    texto: str,
    pendiente: dict,
    session: Session,
    contexto: dict,
) -> str | None:
    """El usuario está respondiendo a un "¿de qué curso?" anterior.

    Devuelve la respuesta final si se logra entender el curso; devuelve None si
    parece que el usuario cambió de tema (para seguir con el flujo normal)."""
    opciones = pendiente.get("opciones") or []

    if texto in SALUDOS or texto in _COMANDOS_AYUDA:
        contexto.pop(_PENDIENTE, None)
        return None

    elegida = _emparejar_curso(texto, opciones)

    if elegida is None:
        # Si el mensaje no dispara ninguna otra intención, seguimos esperando
        # el curso en lugar de responder con la ayuda genérica.
        if not _detectar_categorias(texto):
            cursos = _cursos_en_lenguaje_natural([o["curso"] for o in opciones])
            return (
                "Todavía no identifiqué el curso. "
                f"Puedes responderme, por ejemplo, «{opciones[0]['curso']}». "
                f"Las opciones son {cursos}."
            )
        contexto.pop(_PENDIENTE, None)
        return None

    contexto.pop(_PENDIENTE, None)
    # Queda vigente solo hasta el próximo mensaje (responder() lo limpia). En la
    # misma petición, accion_de_ubicacion() lo usa para ofrecer el visor 360°.
    contexto[_FORZADA] = {
        "nombre": pendiente["nombre"],
        "id": elegida["id"],
        "pregunta": pendiente["pregunta"],
    }
    return _procesar(pendiente["pregunta"], session, contexto)


# --------------------------------------------------------------------------
# Intenciones
# --------------------------------------------------------------------------


def _materias_de_curso(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué curso quieres saber las materias?"
    curso = _buscar_curso(nombre, session)
    if not curso:
        return f"No encontré el curso '{nombre}'."
    if not curso.materias:
        return f"El curso {curso.nombre} no tiene materias registradas."
    nombres = ", ".join(m.nombre for m in curso.materias)
    return f"Materias de {curso.nombre}: {nombres}."


def _curso_de_materia(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué materia quieres saber el curso?"
    materia, aviso = _resolver_materia(nombre, session, contexto, texto)
    if aviso:
        return aviso
    if not materia:
        return f"No encontré la materia '{nombre}'."
    if not materia.curso:
        return f"{materia.nombre} no tiene un curso asignado."
    return f"{materia.nombre} pertenece al curso {materia.curso.nombre}."


def _materias_de_profesor(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué profesor quieres saber las materias?"
    profesor = _buscar_profesor(nombre, session)
    if not profesor:
        return f"No encontré al profesor '{nombre}'."
    if not profesor.materias:
        return f"{profesor.nombre} no tiene materias asignadas."
    nombres = ", ".join(m.nombre for m in profesor.materias)
    return f"{profesor.nombre} dicta: {nombres}."


def _profesor_de_materia(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué materia quieres saber el profesor?"
    materia, aviso = _resolver_materia(nombre, session, contexto, texto)
    if aviso:
        return aviso
    if not materia:
        return f"No encontré la materia '{nombre}'."
    if not materia.profesor:
        return f"{_rotular_materia(materia, session)} no tiene profesor asignado."
    return f"El profesor de {_rotular_materia(materia, session)} es {materia.profesor.nombre}."


def _profesor_de(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué materia o curso quieres saber el profesor?"
    materia, aviso = _resolver_materia(nombre, session, contexto, texto)
    if aviso:
        return aviso
    if materia:
        if not materia.profesor:
            return f"{_rotular_materia(materia, session)} no tiene profesor asignado."
        return f"El profesor de {_rotular_materia(materia, session)} es {materia.profesor.nombre}."
    curso = _buscar_curso(nombre, session)
    if curso:
        return _profesores_de_curso(nombre, session, contexto, texto)
    return f"No encontré la materia ni el curso '{nombre}'."


def _curso_de_profesor(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué profesor quieres saber el curso?"
    profesor = _buscar_profesor(nombre, session)
    if not profesor:
        return f"No encontré al profesor '{nombre}'."
    if not profesor.curso:
        return f"{profesor.nombre} no tiene curso asignado."
    return f"{profesor.nombre} tiene a cargo el curso {profesor.curso.nombre}."


def _profesores_de_curso(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué curso quieres saber los profesores?"
    curso = _buscar_curso(nombre, session)
    if not curso:
        return f"No encontré el curso '{nombre}'."
    if not curso.profesores:
        return f"El curso {curso.nombre} no tiene profesores asignados."
    nombres = ", ".join(p.nombre for p in curso.profesores)
    return f"Profesores de {curso.nombre}: {nombres}."


def _horario_de_profesor(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    # "horario (de atención) del profesor <nombre>": el nombre suele venir
    # limpio, pero si el usuario escribió "atención de Carlos" sin la palabra
    # "profesor", quitamos ese arrastre para quedarnos con el nombre.
    for prefijo in ("atención de ", "atencion de ", "atención ", "atencion "):
        if nombre.startswith(prefijo):
            nombre = nombre[len(prefijo):].strip()
            break
    if not nombre:
        return "¿De qué profesor quieres saber el horario de atención?"
    profesor = _buscar_profesor(nombre, session)
    if not profesor:
        return f"No encontré al profesor '{nombre}'."
    if not profesor.horario_atencion:
        return f"{profesor.nombre} no tiene horario de atención registrado."
    lugar = f" en {profesor.ubicacion.nombre}" if profesor.ubicacion else ""
    return f"Horario de atención de {profesor.nombre}: {profesor.horario_atencion}{lugar}."


def _horario_de_materia(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué materia quieres saber el horario?"
    materia, aviso = _resolver_materia(nombre, session, contexto, texto)
    if aviso:
        return aviso
    if not materia:
        return f"No encontré la materia '{nombre}'."
    if not materia.horarios:
        return f"{_rotular_materia(materia, session)} no tiene horario registrado."
    orden = {dia: i for i, dia in enumerate(DIAS_SEMANA)}
    horarios = sorted(materia.horarios, key=lambda h: orden.get(h.dia_semana, 99))
    partes = [
        f"{DIA_ABREVIADOS.get(h.dia_semana, h.dia_semana)} {h.hora_inicio.strftime('%H:%M')}-{h.hora_fin.strftime('%H:%M')}"
        for h in horarios
    ]
    return f"Horario de {_rotular_materia(materia, session)}: {', '.join(partes)}."


def _ubicacion_de(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué lugar o materia quieres saber la ubicación?"
    ubicacion = _buscar_ubicacion(nombre, session)
    if ubicacion:
        if ubicacion.descripcion and ubicacion.descripcion.strip():
            return ubicacion.descripcion.strip()
        return "No hay información descriptiva disponible."
    materia, aviso = _resolver_materia(nombre, session, contexto, texto)
    if aviso:
        return aviso
    if materia:
        if not materia.ubicacion:
            return f"{_rotular_materia(materia, session)} no tiene ubicación asignada."
        if materia.ubicacion.descripcion and materia.ubicacion.descripcion.strip():
            return materia.ubicacion.descripcion.strip()
        return "No hay información descriptiva disponible."
    return f"No encontré ninguna ubicación ni materia llamada '{nombre}'."


def _materias_en_ubicacion(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué ubicación quieres saber las materias?"
    ubicacion = _buscar_ubicacion(nombre, session)
    if not ubicacion:
        return f"No encontré la ubicación '{nombre}'."
    if not ubicacion.materias:
        return f"En {ubicacion.nombre} no hay materias registradas."
    nombres = ", ".join(m.nombre for m in ubicacion.materias)
    return f"Materias en {ubicacion.nombre}: {nombres}."


def _formatear_evento(c: Cronograma) -> str:
    lugar = c.ubicacion.nombre if c.ubicacion else "lugar por definir"
    return f"- {c.fecha.strftime('%d/%m/%Y')} {c.hora} en {lugar}: {c.titulo}"


def _cronograma_intent(nombre: str, texto: str, session: Session) -> str:
    if "hoy" in texto:
        hoy = date.today()
        eventos = list(
            session.scalars(select(Cronograma).where(Cronograma.fecha == hoy).order_by(Cronograma.hora))
        )
        if not eventos:
            return "No hay actividades registradas para hoy."
        return "Actividades de hoy:\n" + "\n".join(_formatear_evento(e) for e in eventos)

    if nombre:
        eventos = list(
            session.scalars(
                select(Cronograma).where(
                    Cronograma.titulo.ilike(f"%{nombre}%") | Cronograma.descripcion.ilike(f"%{nombre}%")
                )
            )
        )
        if not eventos:
            return f"No encontré actividades relacionadas con '{nombre}'."
        return "Actividades encontradas:\n" + "\n".join(_formatear_evento(e) for e in eventos)

    eventos = list(
        session.scalars(
            select(Cronograma).where(Cronograma.fecha >= date.today()).order_by(Cronograma.fecha)
        )
    )
    if not eventos:
        return "No hay próximas actividades registradas en el cronograma."
    return "Próximas actividades:\n" + "\n".join(_formatear_evento(e) for e in eventos)


def _cronograma_de_curso(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué curso quieres saber las actividades?"
    curso = _buscar_curso(nombre, session)
    if not curso:
        return f"No encontré el curso '{nombre}'."
    if not curso.cronogramas:
        return f"El curso {curso.nombre} no tiene actividades registradas."
    return f"Actividades de {curso.nombre}:\n" + "\n".join(_formatear_evento(c) for c in curso.cronogramas)


def _buscar_actividades(nombre: str, session: Session) -> list[Cronograma]:
    """Actividades del cronograma cuyo título o descripción coincide con `nombre`."""
    return list(
        session.scalars(
            select(Cronograma)
            .where(
                Cronograma.titulo.ilike(f"%{nombre}%")
                | Cronograma.descripcion.ilike(f"%{nombre}%")
            )
            .order_by(Cronograma.fecha)
        )
    )


def _cursos_de_actividad_texto(actividades: list[Cronograma]) -> str:
    partes = []
    for a in actividades:
        fecha = a.fecha.strftime("%d/%m/%Y")
        if a.cursos:
            cursos = ", ".join(c.nombre for c in a.cursos)
            partes.append(f"La actividad «{a.titulo}» ({fecha}) es para: {cursos}.")
        else:
            partes.append(
                f"La actividad «{a.titulo}» ({fecha}) no tiene cursos asignados "
                "(es general para el colegio)."
            )
    return "\n".join(partes)


def _cronograma_y_curso(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    """Cruce curso <-> actividad en ambos sentidos:
    - "¿qué actividades tiene 6A?"        -> lista las actividades del curso.
    - "¿para qué curso es la actividad X?" -> lista los cursos de la actividad.
    """
    if not nombre:
        return "¿De qué curso o de qué actividad quieres saber?"
    if _buscar_curso(nombre, session):
        return _cronograma_de_curso(nombre, session, contexto, texto)
    actividades = _buscar_actividades(nombre, session)
    if actividades:
        return _cursos_de_actividad_texto(actividades)
    return f"No encontré ningún curso ni actividad llamada '{nombre}'."


def _lugar_de_actividad(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    if not nombre:
        return "¿De qué actividad quieres saber el lugar?"
    actividades = _buscar_actividades(nombre, session)
    if not actividades:
        return f"No encontré ninguna actividad llamada '{nombre}'."
    partes = []
    for a in actividades:
        fecha = a.fecha.strftime("%d/%m/%Y")
        if a.ubicacion:
            detalle = f" ({a.ubicacion.descripcion})" if a.ubicacion.descripcion else ""
            partes.append(f"La actividad «{a.titulo}» ({fecha}) es en {a.ubicacion.nombre}{detalle}.")
        else:
            partes.append(f"La actividad «{a.titulo}» ({fecha}) no tiene lugar asignado.")
    return "\n".join(partes)


def _informacion_intent(nombre: str, session: Session, contexto: dict, texto: str) -> str:
    consulta = select(InformacionInstitucional).where(InformacionInstitucional.estado == "Activo")

    if nombre:
        consulta = consulta.where(
            InformacionInstitucional.titulo.ilike(f"%{nombre}%")
            | InformacionInstitucional.categoria.ilike(f"%{nombre}%")
            | InformacionInstitucional.palabras_clave.ilike(f"%{nombre}%")
        )

    resultados = list(session.scalars(consulta))

    if not resultados:
        if nombre:
            return f"No encontré información institucional sobre '{nombre}'."
        return "No hay información institucional disponible."

    if nombre and len(resultados) == 1:
        info = resultados[0]
        return f"{info.titulo}: {info.contenido}"

    titulos = ", ".join(i.titulo for i in resultados)
    return f"Información institucional disponible: {titulos}."


def _ubicacion_de_curso(
    nombre: str,
    session: Session,
    contexto: dict,
    texto: str,
) -> str:
    if not nombre:
        return "¿De qué curso quieres saber la ubicación?"

    curso = _buscar_curso(nombre, session)

    if not curso:
        return f"No encontré el curso '{nombre}'."

    if not curso.salones:
        return f"El curso {curso.nombre} no tiene salones asignados."

    partes = []

    for salon in curso.salones:
        if salon.descripcion:
            partes.append(
                f"{salon.nombre}: {salon.descripcion}"
            )
        else:
            partes.append(
                f"{salon.nombre}: ubicación no registrada"
            )

    return f"Ubicación del curso {curso.nombre}: " + "; ".join(partes) + "."


_DISPATCH_UNO = {
    "materia": _materias_de_curso,
    "profesor": _profesor_de,
    "horario": _horario_de_materia,
    "ubicacion": _ubicacion_de,
    "informacion": _informacion_intent,
}

_DISPATCH_DOS = {
    ("materia", "curso"): _materias_de_curso,
    ("curso", "materia"): _curso_de_materia,
    ("materia", "profesor"): _materias_de_profesor,
    ("profesor", "materia"): _profesor_de_materia,
    ("curso", "profesor"): _curso_de_profesor,
    ("profesor", "curso"): _profesores_de_curso,
    ("horario", "materia"): _horario_de_materia,
    ("materia", "horario"): _horario_de_materia,
    ("horario", "profesor"): _horario_de_profesor,
    ("profesor", "horario"): _horario_de_profesor,
    ("ubicacion", "materia"): _ubicacion_de,
    ("materia", "ubicacion"): _materias_en_ubicacion,
    ("cronograma", "curso"): _cronograma_y_curso,
    ("curso", "cronograma"): _cronograma_y_curso,
    ("cronograma", "ubicacion"): _lugar_de_actividad,
    ("ubicacion", "cronograma"): _lugar_de_actividad,
    ("curso", "ubicacion"): _ubicacion_de_curso,
    ("ubicacion", "curso"): _ubicacion_de_curso,
}


def _procesar(texto: str, session: Session, contexto: dict) -> str:
    texto = texto.strip()

    # ¿El usuario está respondiendo a un "¿de qué curso?" anterior?
    pendiente = contexto.get(_PENDIENTE)
    if pendiente:
        resuelto = _resolver_pendiente(texto, pendiente, session, contexto)
        if resuelto is not None:
            return resuelto

    if texto in SALUDOS:
        return "¡Hola! Soy el chatbot escolar. " + AYUDA

    if texto in _COMANDOS_AYUDA:
        return AYUDA

    hallazgos = _detectar_categorias(texto)
    if not hallazgos:
        return AYUDA

    categorias = list(dict.fromkeys(c for _, c, _ in hallazgos))
    ultimo_fin = hallazgos[-1][2]
    nombre = _extraer_nombre(texto[ultimo_fin:])

    if len(categorias) >= 2:
        manejador = _DISPATCH_DOS.get((categorias[0], categorias[1]))
        if manejador:
            return manejador(nombre, session, contexto, texto)

    if categorias[0] == "cronograma":
        return _cronograma_intent(nombre, texto, session)

    manejador = _DISPATCH_UNO.get(categorias[0])
    if manejador:
        return manejador(nombre, session, contexto, texto)

    return AYUDA
