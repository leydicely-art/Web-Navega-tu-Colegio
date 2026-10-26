"""Punto de entrada para levantar el servidor web (chatbot + rutas API) en el puerto 5000, sin pasar por el menú de consola."""

from app.database.database import init_db
from app.web import app

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
