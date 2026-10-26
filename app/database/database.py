"""Conexión a MariaDB y utilidades de inicialización de la base de datos."""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.models import Base

load_dotenv()

DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "proyect")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine)


def ensure_database_exists() -> None:
    server_url = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/"
    temp_engine = create_engine(server_url)
    with temp_engine.connect() as conn:
        conn.execute(text(f"CREATE DATABASE IF NOT EXISTS {DB_NAME} CHARACTER SET utf8mb4"))
    temp_engine.dispose()


def drop_database() -> None:
    server_url = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/"
    temp_engine = create_engine(server_url)
    with temp_engine.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME}"))
    temp_engine.dispose()


def _ensure_columns() -> None:
    """Agrega columnas nuevas a tablas que ya existían.

    Base.metadata.create_all() crea tablas faltantes, pero no añade columnas a
    una tabla ya creada. Aquí se aplican, de forma idempotente, los ajustes de
    esquema que el proyecto necesita.
    """
    inspector = inspect(engine)
    tablas = set(inspector.get_table_names())

    if "ubicacion" in tablas:
        columnas = {col["name"] for col in inspector.get_columns("ubicacion")}
        if "accion" not in columnas:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE ubicacion ADD COLUMN accion VARCHAR(50) NULL")
                )
        # Coordenadas GPS para el mapa del colegio (/mapa).
        for columna in ("latitud", "longitud"):
            if columna not in columnas:
                with engine.begin() as conn:
                    conn.execute(
                        text(f"ALTER TABLE ubicacion ADD COLUMN {columna} DOUBLE NULL")
                    )

    # El "lugar" del cronograma pasó de texto libre a una ubicación del colegio.
    if "cronograma" in tablas:
        columnas = {col["name"] for col in inspector.get_columns("cronograma")}
        with engine.begin() as conn:
            if "ubicacion_id" not in columnas:
                conn.execute(
                    text("ALTER TABLE cronograma ADD COLUMN ubicacion_id INT NULL")
                )
            if "lugar" in columnas:
                conn.execute(text("ALTER TABLE cronograma DROP COLUMN lugar"))

    # Los profesores ahora tienen horario de atención y un salón (ubicación).
    if "profesores" in tablas:
        columnas = {col["name"] for col in inspector.get_columns("profesores")}
        with engine.begin() as conn:
            if "horario_atencion" not in columnas:
                conn.execute(
                    text(
                        "ALTER TABLE profesores "
                        "ADD COLUMN horario_atencion VARCHAR(255) NULL"
                    )
                )
            if "ubicacion_id" not in columnas:
                conn.execute(
                    text("ALTER TABLE profesores ADD COLUMN ubicacion_id INT NULL")
                )


def _drop_unique_materia_nombre() -> None:
    """Quita el índice UNIQUE que antes tenía materias.nombre.

    Ahora se permite que dos cursos tengan una materia con el mismo nombre.
    create_all() no elimina índices existentes, así que aquí se busca cualquier
    índice único que cubra solo la columna `nombre` y se elimina (idempotente).
    """
    inspector = inspect(engine)
    if "materias" not in inspector.get_table_names():
        return

    indices = list(inspector.get_indexes("materias"))
    for restriccion in inspector.get_unique_constraints("materias"):
        indices.append(
            {
                "name": restriccion.get("name"),
                "unique": True,
                "column_names": restriccion.get("column_names", []),
            }
        )

    nombres_a_borrar = {
        idx["name"]
        for idx in indices
        if idx.get("name")
        and idx.get("unique")
        and list(idx.get("column_names") or []) == ["nombre"]
    }

    for nombre_indice in nombres_a_borrar:
        with engine.begin() as conn:
            conn.execute(text(f"DROP INDEX `{nombre_indice}` ON `materias`"))


def init_db() -> None:
    ensure_database_exists()
    Base.metadata.create_all(engine)
    _ensure_columns()
    _drop_unique_materia_nombre()
