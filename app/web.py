from __future__ import annotations

import os

from flask import Flask, send_from_directory
from flask import session as flask_session

from app.database.database import init_db
from app.db_session import close_session
from app.routes import api_bp

from app.views import (
    ar,
    cronogramas,
    cursos,
    estudiantes,
    index,
    informaciones_institucionales,
    juego,
    materias,
    preguntas,
    profesores,
    rutas,
    salones,
    ubicaciones,
)

app = Flask(__name__)

app.secret_key = "tu_clave_secreta"

# En desarrollo, Flask por defecto le pide al navegador cachear los archivos
# estáticos (JS/CSS) hasta 12 horas. Eso hace que ediciones a ar.js/app.js no
# se vean en el celular aunque recargues la página. Se desactiva aquí; antes
# de pasar a producción, conviene volver a activarlo con URLs versionadas.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

# Cierra la sesión de SQLAlchemy abierta por get_session() al terminar cada
# petición. Sin esto, cada request web deja una conexión sin devolver al pool.
app.teardown_appcontext(close_session)

IMAGES_DIR = os.path.join(app.root_path, "images")
AUDIO_DIR = os.path.join(app.root_path, "audio")


@app.route("/images/<path:filename>")
def images(filename):
    return send_from_directory(IMAGES_DIR, filename)


@app.route("/audio/<path:filename>")
def audio(filename):
    return send_from_directory(AUDIO_DIR, filename)


@app.route("/sw.js")
def service_worker():
    """Sirve el service worker desde la raíz (no desde /static/) para que su
    scope cubra toda la app y pueda controlar cualquier ruta, no solo los
    archivos estáticos."""
    response = send_from_directory(app.static_folder, "sw.js")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory(
        app.static_folder,
        "manifest.webmanifest",
        mimetype="application/manifest+json"
    )


@app.context_processor
def inyectar_usuario_actual():
    """Expone el usuario del asistente virtual (estudiante logueado o invitado) a todas las plantillas."""
    return {
        "usuario_actual": {
            "tipo": flask_session.get("usuario_tipo"),
            "nombre": flask_session.get("usuario_nombre"),
            "curso": flask_session.get("usuario_curso"),
        }
    }


# Crear las tablas de la base de datos
init_db()

# Página principal (incluye el chatbot)
app.register_blueprint(index.bp)

# CRUD
app.register_blueprint(estudiantes.bp)
app.register_blueprint(profesores.bp)
app.register_blueprint(cursos.bp)
app.register_blueprint(materias.bp)
app.register_blueprint(preguntas.bp)
app.register_blueprint(salones.bp)
app.register_blueprint(ubicaciones.bp)
app.register_blueprint(cronogramas.bp)
app.register_blueprint(informaciones_institucionales.bp)
app.register_blueprint(ar.bp)
app.register_blueprint(juego.bp)
app.register_blueprint(rutas.bp)

# API REST (usada por el panel del asistente virtual)
app.register_blueprint(api_bp)