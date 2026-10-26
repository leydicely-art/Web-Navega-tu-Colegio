"""Menú interactivo de consola para el CRUD de estudiantes y cursos."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import crud

# --------------------------------------------------------------------------
# Helpers de entrada
# --------------------------------------------------------------------------


def _input(mensaje: str, opcional: bool = False) -> str | None:
    valor = input(mensaje).strip()
    if not valor and opcional:
        return None
    return valor


def _input_int(mensaje: str, opcional: bool = False) -> int | None:
    texto = _input(mensaje, opcional=opcional)
    if texto is None:
        return None
    try:
        return int(texto)
    except ValueError:
        print("Debe ser un número entero.")
        return None


def _pausar() -> None:
    input("\nPresiona Enter para continuar...")


# --------------------------------------------------------------------------
# Estudiantes
# --------------------------------------------------------------------------


def _listar_estudiantes(session: Session) -> None:
    estudiantes = crud.listar_estudiantes(session)
    if not estudiantes:
        print("No hay estudiantes registrados.")
        return
    for e in estudiantes:
        curso = e.curso.nombre if e.curso else "sin asignar"
        print(f"[{e.id}] {e.nombre} - curso: {curso}")


def _crear_estudiante(session: Session) -> None:
    nombre = _input("Nombre: ")
    curso_id = _input_int("Id del curso (opcional): ", opcional=True)
    estudiante = crud.crear_estudiante(session, nombre, curso_id)
    print(f"Estudiante creado con id {estudiante.id}.")


def _actualizar_estudiante(session: Session) -> None:
    estudiante_id = _input_int("Id del estudiante: ")
    if estudiante_id is None:
        return
    print("Deja en blanco los campos que no quieras cambiar.")
    nombre = _input("Nuevo nombre: ", opcional=True)
    curso_id = _input_int("Nuevo id de curso: ", opcional=True)
    resultado = crud.actualizar_estudiante(session, estudiante_id, nombre=nombre, curso_id=curso_id)
    print("Estudiante actualizado." if resultado else "No se encontró el estudiante.")


def _eliminar_estudiante(session: Session) -> None:
    estudiante_id = _input_int("Id del estudiante a eliminar: ")
    if estudiante_id is None:
        return
    eliminado = crud.eliminar_estudiante(session, estudiante_id)
    print("Estudiante eliminado." if eliminado else "No se encontró el estudiante.")


def menu_estudiantes(session: Session) -> None:
    opciones = {
        "1": ("Listar estudiantes", _listar_estudiantes),
        "2": ("Crear estudiante", _crear_estudiante),
        "3": ("Actualizar estudiante", _actualizar_estudiante),
        "4": ("Eliminar estudiante", _eliminar_estudiante),
    }
    _submenu("ESTUDIANTES", opciones, session)


# --------------------------------------------------------------------------
# Cursos
# --------------------------------------------------------------------------


def _listar_cursos(session: Session) -> None:
    cursos = crud.listar_cursos(session)
    if not cursos:
        print("No hay cursos registrados.")
        return
    for c in cursos:
        print(f"[{c.id}] {c.nombre} - {c.descripcion or 'sin descripción'} - estudiantes: {len(c.estudiantes)}")


def _crear_curso(session: Session) -> None:
    nombre = _input("Nombre: ")
    descripcion = _input("Descripción (opcional): ", opcional=True)
    curso = crud.crear_curso(session, nombre, descripcion)
    print(f"Curso creado con id {curso.id}.")


def _actualizar_curso(session: Session) -> None:
    curso_id = _input_int("Id del curso: ")
    if curso_id is None:
        return
    nombre = _input("Nuevo nombre: ", opcional=True)
    descripcion = _input("Nueva descripción: ", opcional=True)
    resultado = crud.actualizar_curso(session, curso_id, nombre=nombre, descripcion=descripcion)
    print("Curso actualizado." if resultado else "No se encontró el curso.")


def _eliminar_curso(session: Session) -> None:
    curso_id = _input_int("Id del curso a eliminar: ")
    if curso_id is None:
        return
    eliminado = crud.eliminar_curso(session, curso_id)
    print("Curso eliminado." if eliminado else "No se encontró el curso.")


def menu_cursos(session: Session) -> None:
    opciones = {
        "1": ("Listar cursos", _listar_cursos),
        "2": ("Crear curso", _crear_curso),
        "3": ("Actualizar curso", _actualizar_curso),
        "4": ("Eliminar curso", _eliminar_curso),
    }
    _submenu("CURSOS", opciones, session)


# --------------------------------------------------------------------------
# Motor genérico de submenú y menú principal de gestión
# --------------------------------------------------------------------------


def _submenu(titulo: str, opciones: dict[str, tuple[str, callable]], session: Session) -> None:
    while True:
        print(f"\n--- {titulo} ---")
        for clave, (etiqueta, _) in opciones.items():
            print(f"{clave}) {etiqueta}")
        print("0) Volver")
        eleccion = input("Elige una opción: ").strip()
        if eleccion == "0":
            return
        accion = opciones.get(eleccion)
        if not accion:
            print("Opción inválida.")
            continue
        try:
            accion[1](session)
        except Exception as exc:  # noqa: BLE001 - mostramos el error y seguimos en el menú
            session.rollback()
            print(f"Ocurrió un error: {exc}")
        _pausar()


def menu_gestion_datos(session: Session) -> None:
    opciones = {
        "1": ("Estudiantes", menu_estudiantes),
        "2": ("Cursos", menu_cursos),
    }
    while True:
        print("\n=== GESTIÓN DE DATOS (CRUD) ===")
        for clave, (etiqueta, _) in opciones.items():
            print(f"{clave}) {etiqueta}")
        print("0) Volver al menú principal")
        eleccion = input("Elige una opción: ").strip()
        if eleccion == "0":
            return
        accion = opciones.get(eleccion)
        if not accion:
            print("Opción inválida.")
            continue
        accion[1](session)
