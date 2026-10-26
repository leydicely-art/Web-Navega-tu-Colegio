import importlib

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.chatbot import responder, resolver_destino_ruta
from app.models import Base, NodoRuta, Ubicacion
from app.web import app


def test_chatbot_imports():
    import app.chatbot
    importlib.reload(app.chatbot)


def test_resolver_destino_ruta_detecta_ubicacion_real():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        ubicacion = Ubicacion(nombre="Polifuncional", descripcion="Espacio multiuso.", accion="polifuncional")
        session.add(ubicacion)
        session.flush()
        session.add(
            NodoRuta(
                nombre="Polifuncional",
                tipo="destino",
                piso=2,
                latitud=0.0,
                longitud=0.0,
                ubicacion_id=ubicacion.id,
                descripcion="Espacio multiuso.",
            )
        )
        session.commit()

        resultado = resolver_destino_ruta("Dame la ubicación del polifuncional", session, {})

    assert resultado is not None
    assert resultado["solicita_origen"] is True
    assert resultado["destino"]["nombre"] == "Polifuncional"
    assert resultado["destino"]["accion"] == "polifuncional"


def test_responder_ubicacion_usa_solo_descripcion_guardada():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(
            Ubicacion(
                nombre="Bloque B",
                descripcion="Cuenta con aulas destinadas al desarrollo de las actividades académicas.",
                accion="bloqueB",
            )
        )
        session.commit()
        respuesta = responder("¿Dónde queda el bloque B?", session, {})

    assert respuesta == "Cuenta con aulas destinadas al desarrollo de las actividades académicas."


def test_responder_ubicacion_sin_descripcion_muestra_mensaje_breve():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add(Ubicacion(nombre="Biblioteca", descripcion=None, accion="biblioteca"))
        session.commit()
        respuesta = responder("¿Dónde queda la biblioteca?", session, {})

    assert respuesta == "No hay información descriptiva disponible."


def test_api_chatbot_pide_origen_con_opciones():
    client = app.test_client()
    response = client.get("/api/chatbot/%C2%BFComo%20llego%20a%20la%20biblioteca%3F")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ruta_pendiente"]["solicita_origen"] is True
    assert payload["ruta_pendiente"]["mensaje"] == "¿Dónde te encuentras actualmente? Selecciona tu ubicación de origen para mostrarte la ruta"
    assert payload["ruta_pendiente"]["origenes"]


def test_rutas_page_includes_pannellum_assets():
    client = app.test_client()
    response = client.get("/rutas")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "pannellum" in html.lower()
    assert "pannellum.css" in html.lower()
    assert "pannellum.js" in html.lower()


def test_index_y_rutas_tienen_enlaces_directos_entre_mapas():
    client = app.test_client()

    index_response = client.get("/")
    rutas_response = client.get("/rutas")

    assert index_response.status_code == 200
    assert 'href="/rutas"' in index_response.get_data(as_text=True)

    assert rutas_response.status_code == 200
    assert 'href="/"' in rutas_response.get_data(as_text=True)
