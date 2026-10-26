# Navega tu Colegio

Portal web escolar hecho con Flask y PostgreSQL (Supabase). Reúne un chatbot que responde preguntas sobre el colegio, un mapa con rutas internas («Cómo llegar»), recorridos 360°, experiencias de realidad aumentada con códigos QR y el minijuego «Rugido Salvaje». También incluye páginas de administración (CRUD) para los datos del colegio.

## Funcionalidades

| Ruta | Descripción |
|---|---|
| `/` | Chatbot escolar (p. ej. «¿en qué curso está Juan Pérez?») |
| `/rutas`, `/rutas/editor` | Mapa del colegio, cálculo de rutas entre ubicaciones y editor de nodos/tramos |
| `/ar`, `/ar/experiencias` | Visor de realidad aumentada y administración de experiencias con su QR |
| `/juego` | Minijuego del león (canvas, lógica en `app/static/game/`) |
| `/cursos`, `/estudiantes`, `/profesores`, `/materias`, `/salones`, `/ubicaciones`, `/cronogramas`, `/preguntas`, `/informaciones_institucionales` | Gestión de datos |

## Requisitos

- Python 3.11 o superior
- Una base de datos PostgreSQL (el proyecto usa Supabase)

## Instalación

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
```

## Configuración

Copia `.env.example` a `.env` y completa los valores:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Pooler de Supabase en modo transacción (puerto 6543). La usa la aplicación. |
| `DIRECT_URL` | Pooler en modo sesión (puerto 5432). Se usa para crear y migrar las tablas. Si falta, se usa `DATABASE_URL`. |
| `AR_SIGNING_SECRET` | Clave para firmar (HMAC) los tokens de los QR del Modo AR. Usa un valor propio y secreto en producción. |

Si la contraseña tiene caracteres especiales (`@ : / # ? %`), codifícalos en la URL (p. ej. `@` → `%40`).

> No subas `.env` al repositorio: contiene la contraseña de la base de datos.

## Ejecución

Servidor web en `http://localhost:5000`:

```bash
python run.py
```

Al arrancar, `init_db()` crea las tablas que falten y aplica los ajustes de esquema pendientes.

Otras opciones:

```bash
python main.py          # menú de consola: chatbot o gestión CRUD
python -m app.seed      # carga datos de ejemplo (solo si la base está vacía)
```

## Pruebas

Las pruebas usan SQLite en memoria, así que no necesitan Supabase:

```bash
pip install pytest
pytest
```

## Despliegue en Vercel

`pyproject.toml` define el punto de entrada (`[tool.vercel] entrypoint = "run:app"`). Configura `DATABASE_URL`, `DIRECT_URL` y `AR_SIGNING_SECRET` en las variables de entorno del proyecto en Vercel.

El único driver instalado es `psycopg2-binary`. Por eso `app/database/database.py` convierte cualquier URL (`postgres://`, `postgresql+psycopg://`…) a `postgresql+psycopg2://` y quita el parámetro `pgbouncer=true`.

## Estructura

```
app/
  database/     conexión a la base de datos e init_db()
  models/       modelos SQLAlchemy
  services/     lógica de negocio (rutas, AR, cursos, etc.)
  views/        blueprints de Flask
  templates/    plantillas Jinja
  static/       JS/CSS, incluido el juego (static/game/)
  images/, audio/  recursos multimedia
  chatbot.py    motor de respuestas del chatbot
  web.py        aplicación Flask
run.py          servidor web
main.py         menú de consola
tests/          pruebas con pytest
```
