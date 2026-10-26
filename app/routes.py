"""Rutas de la API REST (GET/POST/PUT/DELETE) para estudiantes y cursos."""

from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask import session as flask_session

from app.chatbot import accion_de_ubicacion, responder, resolver_destino_ruta
from app.db_session import get_session
from app.models import Curso, Estudiante
from app.services import ar_demos as services_ar_demos
from app.services import ar_signing
from app.services import rutas as services_rutas
from app.services import cursos as services_cursos
from app.services import estudiantes as services_estudiantes
from app.services import experiencias_ar as services_experiencias_ar

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _estudiante_a_dict(e: Estudiante) -> dict:
    return {
        "id": e.id,
        "nombre": e.nombre,
        "curso_id": e.curso_id,
        "curso": e.curso.nombre if e.curso else None,
    }


def _curso_a_dict(c: Curso) -> dict:
    return {"id": c.id, "nombre": c.nombre, "descripcion": c.descripcion}


# --------------------------------------------------------------------------
# Estudiantes
# --------------------------------------------------------------------------


@api_bp.route("/estudiantes", methods=["GET", "POST"])
def estudiantes():
    session = get_session()
    if request.method == "GET":
        return jsonify([_estudiante_a_dict(e) for e in services_estudiantes.listar_estudiantes(session)])

    datos = request.get_json(silent=True) or {}
    try:
        estudiante = services_estudiantes.registrar_estudiante(
            session, nombre=datos.get("nombre"), curso_id=datos.get("curso_id")
        )
    except services_estudiantes.ValidacionError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(_estudiante_a_dict(estudiante)), 201


@api_bp.route("/estudiantes/buscar/<nombre>", methods=["GET"])
def estudiante_buscar_por_nombre(nombre: str):
    nombre = nombre.strip()
    if not nombre:
        return jsonify({"error": "Debes indicar el nombre"}), 400

    session = get_session()
    estudiante = services_estudiantes.buscar_estudiante_por_nombre(session, nombre)
    if not estudiante:
        return jsonify({"error": f"No encontré a '{nombre}'"}), 404
    return jsonify(_estudiante_a_dict(estudiante))


@api_bp.route("/estudiantes/<int:estudiante_id>", methods=["GET", "PUT", "DELETE"])
def estudiante_detalle(estudiante_id: int):
    session = get_session()

    if request.method == "GET":
        estudiante = services_estudiantes.obtener_estudiante(session, estudiante_id)
        if not estudiante:
            return jsonify({"error": "Estudiante no encontrado"}), 404
        return jsonify(_estudiante_a_dict(estudiante))

    if request.method == "PUT":
        datos = request.get_json(silent=True) or {}
        try:
            estudiante = services_estudiantes.actualizar_estudiante(session, estudiante_id, **datos)
        except services_estudiantes.ValidacionError as exc:
            return jsonify({"error": str(exc)}), 400
        if not estudiante:
            return jsonify({"error": "Estudiante no encontrado"}), 404
        return jsonify(_estudiante_a_dict(estudiante))

    eliminado = services_estudiantes.eliminar_estudiante(session, estudiante_id)
    if not eliminado:
        return jsonify({"error": "Estudiante no encontrado"}), 404
    return "", 204


# --------------------------------------------------------------------------
# Sesión del asistente virtual (iniciar sesión con nombre/curso o invitado)
# --------------------------------------------------------------------------


def _usuario_a_dict() -> dict:
    return {
        "tipo": flask_session.get("usuario_tipo"),
        "nombre": flask_session.get("usuario_nombre"),
        "curso": flask_session.get("usuario_curso"),
    }


@api_bp.route("/asistente/sesion", methods=["GET"])
def asistente_sesion():
    return jsonify(_usuario_a_dict())


@api_bp.route("/asistente/login", methods=["POST"])
def asistente_login():
    datos = request.get_json(silent=True) or {}
    nombre = (datos.get("nombre") or "").strip()
    curso_nombre = (datos.get("curso") or "").strip()

    if not nombre:
        return jsonify({"error": "Debes indicar tu nombre."}), 400
    if not curso_nombre:
        return jsonify({"error": "Debes indicar tu curso."}), 400

    session = get_session()
    curso = services_cursos.obtener_o_crear_curso(session, curso_nombre)
    estudiante = services_estudiantes.obtener_o_crear_estudiante(session, nombre, curso.id)

    flask_session["usuario_tipo"] = "estudiante"
    flask_session["usuario_nombre"] = estudiante.nombre
    flask_session["usuario_curso"] = curso.nombre
    flask_session["usuario_estudiante_id"] = estudiante.id

    return jsonify(
        {
            "tipo": "estudiante",
            "nombre": estudiante.nombre,
            "curso": curso.nombre,
            "mensaje": f"¡Hola, {estudiante.nombre}! Iniciaste sesión con el curso {curso.nombre}.",
        }
    )


@api_bp.route("/asistente/invitado", methods=["POST"])
def asistente_invitado():
    flask_session["usuario_tipo"] = "invitado"
    flask_session.pop("usuario_nombre", None)
    flask_session.pop("usuario_curso", None)
    flask_session.pop("usuario_estudiante_id", None)
    return jsonify({"tipo": "invitado", "mensaje": "Listo, sigues como invitado."})


@api_bp.route("/asistente/logout", methods=["POST"])
def asistente_logout():
    flask_session.pop("usuario_tipo", None)
    flask_session.pop("usuario_nombre", None)
    flask_session.pop("usuario_curso", None)
    flask_session.pop("usuario_estudiante_id", None)
    return jsonify({"tipo": None})


# --------------------------------------------------------------------------
# Chatbot
# --------------------------------------------------------------------------


@api_bp.route("/chatbot/<path:pregunta>", methods=["GET"])
def chatbot_pregunta(pregunta: str):
    pregunta = pregunta.strip()
    if not pregunta:
        return jsonify({"error": "Debes indicar la pregunta"}), 400

    session = get_session()
    ruta_pendiente = resolver_destino_ruta(pregunta, session, flask_session)
    respuesta = responder(pregunta, session, flask_session)
    accion = accion_de_ubicacion(pregunta, session, flask_session)

    if ruta_pendiente and ruta_pendiente.get("solicita_origen"):
        origenes = []
        for n in sorted(services_rutas.listar_nodos(session), key=lambda n: (n.piso, n.id)):
            if n.ubicacion_id is None and not (bool(n.nombre) and n.tipo != "punto"):
                continue
            info = services_rutas.nodo_a_dict(n)
            origenes.append(
                {
                    "id": n.id,
                    "etiqueta": info.get("etiqueta") or services_rutas.nombre_nodo(n),
                    "descripcion": info.get("descripcion") or (n.descripcion or "Espacio del colegio"),
                    "piso": n.piso,
                }
            )
        ruta_pendiente = {
            **ruta_pendiente,
            "origenes": origenes,
            "destino": {
                **ruta_pendiente["destino"],
                "descripcion": ruta_pendiente["destino"].get("descripcion")
                or "Espacio del colegio",
            },
        }
        respuesta = ruta_pendiente.get("mensaje") or "¿Desde qué punto te encuentras ahora?"
        return jsonify({
            "pregunta": pregunta,
            "respuesta": respuesta,
            "accion": accion,
            "ruta_pendiente": ruta_pendiente,
        })

    return jsonify({"pregunta": pregunta, "respuesta": respuesta, "accion": accion})


# --------------------------------------------------------------------------
# Cursos
# --------------------------------------------------------------------------


@api_bp.route("/cursos", methods=["GET", "POST"])
def cursos():
    session = get_session()
    if request.method == "GET":
        return jsonify([_curso_a_dict(c) for c in services_cursos.listar_cursos(session)])

    datos = request.get_json(silent=True) or {}
    try:
        curso = services_cursos.registrar_curso(session, datos.get("nombre"), datos.get("descripcion"))
    except services_cursos.ValidacionError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(_curso_a_dict(curso)), 201


@api_bp.route("/cursos/<int:curso_id>", methods=["GET", "PUT", "DELETE"])
def curso_detalle(curso_id: int):
    session = get_session()

    if request.method == "GET":
        curso = services_cursos.obtener_curso(session, curso_id)
        if not curso:
            return jsonify({"error": "Curso no encontrado"}), 404
        return jsonify(_curso_a_dict(curso))

    if request.method == "PUT":
        datos = request.get_json(silent=True) or {}
        try:
            curso = services_cursos.actualizar_curso(session, curso_id, **datos)
        except services_cursos.ValidacionError as exc:
            return jsonify({"error": str(exc)}), 400
        if not curso:
            return jsonify({"error": "Curso no encontrado"}), 404
        return jsonify(_curso_a_dict(curso))

    eliminado = services_cursos.eliminar_curso(session, curso_id)
    if not eliminado:
        return jsonify({"error": "Curso no encontrado"}), 404
    return "", 204


# --------------------------------------------------------------------------
# Modo AR (resolución de QR → experiencia AR)
# --------------------------------------------------------------------------


@api_bp.route("/ar/demo/<slug>", methods=["GET"])
def ar_demo_json(slug: str):
    """Página extra que exporta un JSON de prueba: misma forma que
    /api/ar/<payload>, pero fija en el código (sin token, sin base de
    datos). Sirve para explicar y probar todo el flujo JSON -> QR -> Modo
    AR -> figura con audio sin dar de alta antes una experiencia real
    (ver app/services/ar_demos.py y ar.demo_page/ar.demo_qr)."""
    datos = services_ar_demos.demo_a_dict(slug)
    if datos is None:
        return jsonify({"error": "Ejemplo no encontrado."}), 404
    return jsonify(datos)


@api_bp.route("/ar/<path:payload>", methods=["GET"])
def ar_resolver(payload: str):
    """Resuelve el payload leído de un QR (token + firma) a su experiencia AR."""
    token = ar_signing.token_desde_payload(payload)
    if token is None:
        return jsonify({"error": "Código QR inválido o manipulado."}), 400

    session = get_session()
    experiencia = services_experiencias_ar.obtener_experiencia_por_token(session, token)
    if experiencia is None or not experiencia.activo:
        return jsonify({"error": "Esta experiencia AR ya no está disponible."}), 404

    return jsonify(services_experiencias_ar.experiencia_a_dict(experiencia))
