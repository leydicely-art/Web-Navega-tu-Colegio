from pathlib import Path


def test_ver_en_360_usa_modal_original_con_panel_de_informacion():
    app_js = Path(__file__).resolve().parents[1] / "app" / "static" / "app.js"
    contenido = app_js.read_text(encoding="utf-8")

    assert "campus-image-modal__gallery" in contenido
    assert "campus-image-modal__chat" in contenido


def test_chatbot_360_usa_catalogo_compartido_en_lugar_de_modal_generico():
    app_js = Path(__file__).resolve().parents[1] / "app" / "static" / "app.js"
    contenido = app_js.read_text(encoding="utf-8")

    assert "__portalCampusModalCatalog" in contenido
    assert "inicializarModalCanvas" in contenido
    assert "urlsPorAccion" not in contenido


def test_base_carga_pannellum_en_todas_las_paginas_para_el_visor_360():
    base_html = Path(__file__).resolve().parents[1] / "app" / "templates" / "base.html"
    contenido = base_html.read_text(encoding="utf-8")

    assert "pannellum.css" in contenido
    assert "pannellum.js" in contenido
