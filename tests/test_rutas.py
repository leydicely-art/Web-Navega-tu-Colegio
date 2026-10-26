"""Pruebas del cálculo de rutas internas («Cómo llegar») sobre SQLite en memoria."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Base
from app.services import rutas


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        rutas.crear_red_ejemplo(s)
        yield s


def _id(session, etiqueta):
    return next(n.id for n in rutas.listar_nodos(session) if rutas.nombre_nodo(n) == etiqueta)


def test_ruta_normal_usa_escaleras(session):
    ruta = rutas.calcular_ruta(session, _id(session, "Portería principal"), _id(session, "Salón 203"))
    textos = [p["texto"] for p in ruta["pasos"]]
    assert "Sube por las escaleras al piso 2" in textos
    assert textos[-1] == "Llegaste a Salón 203"
    assert ruta["pisos"] == [1, 2]


def test_ruta_accesible_usa_ascensor(session):
    ruta = rutas.calcular_ruta(
        session, _id(session, "Portería principal"), _id(session, "Salón 203"), accesible=True
    )
    textos = [p["texto"] for p in ruta["pasos"]]
    assert "Sube por el ascensor al piso 2" in textos
    assert not any("escaleras" in t for t in textos)


def test_sin_ruta_accesible_si_solo_hay_escaleras(session):
    # Sin el ascensor, al segundo piso solo se llega por escaleras.
    for nodo in rutas.listar_nodos(session):
        if nodo.tipo == "ascensor":
            rutas.eliminar_nodo(session, nodo.id)
    with pytest.raises(rutas.RutaError, match="accesible"):
        rutas.calcular_ruta(
            session, _id(session, "Portería principal"), _id(session, "Salón 203"), accesible=True
        )


def test_instruccion_manual_reemplaza_la_generada(session):
    # El único tramo que sale de la portería es el primero de cualquier ruta.
    tramo = next(t for t in rutas.listar_tramos(session) if t.origen_id == _id(session, "Portería principal"))
    rutas.actualizar_tramo(session, tramo.id, {"instruccion": "Cruza el torniquete"})
    ruta = rutas.calcular_ruta(session, _id(session, "Portería principal"), _id(session, "Enfermería"))
    assert ruta["pasos"][0]["texto"] == "Cruza el torniquete"


def test_no_se_conectan_pisos_sin_escalera(session):
    with pytest.raises(rutas.RutaError, match="cambiar de piso"):
        rutas.crear_tramo(
            session,
            {"origen_id": _id(session, "Cafetería"), "destino_id": _id(session, "Biblioteca")},
        )


def test_configuracion_y_pisos_se_guardan_en_la_bd(session):
    from app.services import mapa_config

    mapa_config.actualizar_configuracion(
        session, {"latitud": 6.25, "longitud": -75.58, "zoom": 19, "limites": [[6.24, -75.59], [6.26, -75.57]]}
    )
    mapa_config.guardar_piso(
        session, 2, {"nombre": "Bachillerato", "plano_url": "/rutas/fotos/1", "plano_limites": [[6.249, -75.581], [6.251, -75.579]]}
    )
    datos = mapa_config.configuracion_a_dict(session)
    assert datos["colegio"]["centro"] == [6.25, -75.58]
    assert datos["colegio"]["limites"] == [[6.24, -75.59], [6.26, -75.57]]
    assert datos["pisos"]["2"]["nombre"] == "Bachillerato"
    assert datos["pisos"]["2"]["plano"] == "/rutas/fotos/1"

    mapa_config.actualizar_configuracion(session, {"limites": None})
    assert "limites" not in mapa_config.configuracion_a_dict(session)["colegio"]


def test_piso_no_se_elimina_si_tiene_puntos_o_solo_queda_el_ultimo(session):
    from app.services import mapa_config

    mapa_config.guardar_piso(session, 2, {"nombre": "Segundo piso"})
    with pytest.raises(mapa_config.ConfigError, match="puntos|tramos"):
        mapa_config.eliminar_piso(session, 2)

    for nodo in list(rutas.listar_nodos(session)):
        if nodo.piso == 2:
            rutas.eliminar_nodo(session, nodo.id)
    # Elimina el piso sin dejar la configuración vacía.
    mapa_config.eliminar_piso(session, 2)
    assert "2" not in mapa_config.configuracion_a_dict(session)["pisos"]


def test_foto_se_guarda_como_binario(session):
    from app.services import mapa_config

    foto = mapa_config.guardar_foto(session, "pasillo.png", "image/png", b"\x89PNG datos")
    assert mapa_config.obtener_foto(session, foto.id).datos == b"\x89PNG datos"
    assert mapa_config.listar_fotos(session)[0]["nombre"] == "pasillo.png"
    with pytest.raises(mapa_config.ConfigError):
        mapa_config.guardar_foto(session, "virus.exe", "application/x-msdownload", b"MZ")


def test_chatbot_detecta_destino_ruta_real_y_pide_origen(session):
    from app.chatbot import resolver_destino_ruta

    destino = next(n for n in rutas.listar_nodos(session) if rutas.nombre_nodo(n) == "Biblioteca")
    resultado = resolver_destino_ruta("¿Cómo llego a la biblioteca?", session)

    assert resultado is not None
    assert resultado["solicita_origen"] is True
    assert resultado["destino"]["id"] == destino.id
    assert resultado["destino"]["descripcion"]
    assert "biblioteca" in resultado["destino"]["nombre"].lower()


def test_chatbot_actualiza_destino_pendiente_si_llega_otra_consulta(session):
    from app.chatbot import resolver_destino_ruta

    ctx = {}
    primero = resolver_destino_ruta("Llévame a la biblioteca", session, ctx)
    segundo = resolver_destino_ruta("¿Cómo llego al polifuncional?", session, ctx)

    assert primero is not None and segundo is not None
    assert primero["destino"]["nombre"].lower() == "biblioteca"
    assert segundo["destino"]["nombre"].lower() == "polifuncional" or "polifuncional" in segundo["destino"]["nombre"].lower()
    assert ctx.get("ruta_pendiente", {}).get("destino_id") == segundo["destino"]["id"]
