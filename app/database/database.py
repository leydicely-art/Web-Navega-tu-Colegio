"""Conexión a PostgreSQL (Supabase) y utilidades de inicialización de la base de datos."""

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.models import Base

load_dotenv()


def _normalizar_url(url: str) -> str:
    """Adapta una URL de Supabase para SQLAlchemy + psycopg2.

    `pgbouncer=true` es un parámetro de Prisma que psycopg2 no reconoce, así que
    se elimina de la query string. El esquema se fuerza a `postgresql+psycopg2`
    porque es el único driver instalado (en Vercel la URL puede llegar como
    `postgres://` o `postgresql+psycopg://`).
    """
    partes = urlsplit(url.strip().strip('"').strip("'"))
    query = [(k, v) for k, v in parse_qsl(partes.query) if k != "pgbouncer"]
    return urlunsplit(partes._replace(scheme="postgresql+psycopg2", query=urlencode(query)))


# Pooler en modo transacción (puerto 6543): conexiones de la aplicación.
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5432/postgres")
# Pooler en modo sesión (puerto 5432): creación/migración del esquema.
DIRECT_URL = os.getenv("DIRECT_URL") or DATABASE_URL

engine = create_engine(_normalizar_url(DATABASE_URL), echo=False, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)

# Motor para DDL (create_all, ALTER TABLE): va por el pooler en modo sesión.
schema_engine = create_engine(_normalizar_url(DIRECT_URL), echo=False, pool_pre_ping=True)


def drop_database() -> None:
    """Elimina todas las tablas del proyecto (en Supabase no se borra la base `postgres`)."""
    Base.metadata.drop_all(schema_engine)


def _ensure_columns() -> None:
    """Agrega columnas nuevas a tablas que ya existían.

    Base.metadata.create_all() crea tablas faltantes, pero no añade columnas a
    una tabla ya creada. Aquí se aplican, de forma idempotente, los ajustes de
    esquema que el proyecto necesita.
    """
    inspector = inspect(schema_engine)
    tablas = set(inspector.get_table_names())

    if "ubicacion" in tablas:
        columnas = {col["name"] for col in inspector.get_columns("ubicacion")}
        if "accion" not in columnas:
            with schema_engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE ubicacion ADD COLUMN accion VARCHAR(50) NULL")
                )
        # Coordenadas GPS para el mapa del colegio (/mapa).
        for columna in ("latitud", "longitud"):
            if columna not in columnas:
                with schema_engine.begin() as conn:
                    conn.execute(
                        text(f"ALTER TABLE ubicacion ADD COLUMN {columna} DOUBLE PRECISION NULL")
                    )

    # El "lugar" del cronograma pasó de texto libre a una ubicación del colegio.
    if "cronograma" in tablas:
        columnas = {col["name"] for col in inspector.get_columns("cronograma")}
        with schema_engine.begin() as conn:
            if "ubicacion_id" not in columnas:
                conn.execute(
                    text("ALTER TABLE cronograma ADD COLUMN ubicacion_id INT NULL")
                )
            if "lugar" in columnas:
                conn.execute(text("ALTER TABLE cronograma DROP COLUMN lugar"))

    # Los profesores ahora tienen horario de atención y un salón (ubicación).
    if "profesores" in tablas:
        columnas = {col["name"] for col in inspector.get_columns("profesores")}
        with schema_engine.begin() as conn:
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
    restricción o índice único que cubra solo la columna `nombre` y se elimina
    (idempotente).
    """
    inspector = inspect(schema_engine)
    if "materias" not in inspector.get_table_names():
        return

    restricciones = {
        r["name"]
        for r in inspector.get_unique_constraints("materias")
        if r.get("name") and list(r.get("column_names") or []) == ["nombre"]
    }
    indices = {
        idx["name"]
        for idx in inspector.get_indexes("materias")
        if idx.get("name")
        and idx.get("unique")
        and list(idx.get("column_names") or []) == ["nombre"]
        and idx["name"] not in restricciones
    }

    with schema_engine.begin() as conn:
        for nombre in restricciones:
            conn.execute(text(f'ALTER TABLE materias DROP CONSTRAINT IF EXISTS "{nombre}"'))
        for nombre in indices:
            conn.execute(text(f'DROP INDEX IF EXISTS "{nombre}"'))


def init_db() -> None:
    if not os.getenv("DATABASE_URL"):
        raise RuntimeError(
            "Falta DATABASE_URL: copia .env.example a .env y pon la contraseña de Supabase."
        )
    Base.metadata.create_all(schema_engine)
    _ensure_columns()
    _drop_unique_materia_nombre()
