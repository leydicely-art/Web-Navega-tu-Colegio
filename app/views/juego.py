"""Vista del minijuego «Rugido Salvaje» (león aventurero, arcade/roguelite 2D).

Toda la lógica del juego vive en el cliente (canvas + módulos ES en
app/static/game/); esta vista solo sirve la página que lo aloja, igual que
el resto de páginas del portal.
"""

from __future__ import annotations

from flask import Blueprint, render_template, request

bp = Blueprint("juego", __name__)


@bp.route("/juego")
def juego_page():
    """Con ?embed=1 se sirve una versión sin header/sidebar (sin extender
    base.html), pensada para vivir dentro del <iframe> de la pestaña
    Aventura del asistente virtual (ver assistantTabAdventure en base.html
    y initAssistantTabs en app.js)."""
    if request.args.get("embed"):
        return render_template("juego_embed.html")
    return render_template("juego.html")
