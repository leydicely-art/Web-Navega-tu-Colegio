"""Gestión de la sesión de base de datos por petición HTTP (Flask)."""

from __future__ import annotations

from flask import g

from app.database.database import SessionLocal


def get_session():
    if "db_session" not in g:
        g.db_session = SessionLocal()
    return g.db_session


def close_session(exception=None) -> None:
    session = g.pop("db_session", None)
    if session is not None:
        session.close()
