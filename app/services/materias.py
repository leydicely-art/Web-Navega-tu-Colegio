from __future__ import annotations

from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.horario_materia import DIA_ABREVIADOS, DIAS_SEMANA, HorarioMateria
from app.models.materia import Materia


class ValidacionError(ValueError):
    """Datos de la materia inválidos."""


def _validar_nombre(nombre: str) -> None:
    if not nombre or not nombre.strip():
        raise ValidacionError("El nombre de la materia no puede estar vacío.")


def _validar_horarios(horarios: dict[str, tuple[time, time] | None]) -> None:
    for dia, rango in horarios.items():
        if rango is None:
            continue

        hora_inicio, hora_fin = rango

        if hora_inicio >= hora_fin:
            raise ValidacionError(
                f"La hora de fin debe ser posterior a la de inicio el día {dia}."
            )


def registrar_materia(
    session: Session,
    nombre: str,
    descripcion: str | None = None,
    profesor_id: int | None = None,
    horarios: dict[str, tuple[time, time] | None] | None = None,
    curso_id: int | None = None,
    ubicacion_id: int | None = None,
) -> Materia:

    _validar_nombre(nombre)
    _validar_horarios(horarios or {})

    nueva_materia = Materia(
        nombre=nombre,
        descripcion=descripcion,
        profesor_id=profesor_id,
        curso_id=curso_id,
        ubicacion_id=ubicacion_id,
    )

    session.add(nueva_materia)
    session.flush()

    for dia in DIAS_SEMANA:
        rango = (horarios or {}).get(dia)

        if rango is None:
            continue

        hora_inicio, hora_fin = rango

        session.add(
            HorarioMateria(
                materia_id=nueva_materia.id,
                dia_semana=dia,
                hora_inicio=hora_inicio,
                hora_fin=hora_fin,
            )
        )

    session.commit()
    session.refresh(nueva_materia)

    return nueva_materia


def listar_materias(session: Session) -> list[Materia]:
    return list(session.scalars(select(Materia)))


def obtener_materia(
    session: Session,
    materia_id: int,
) -> Materia | None:

    return session.get(Materia, materia_id)


def actualizar_materia(
    session: Session,
    materia_id: int,
    **campos,
) -> Materia | None:

    if campos.get("nombre") is not None:
        _validar_nombre(campos["nombre"])

    materia = obtener_materia(session, materia_id)

    if materia is None:
        return None

    for clave, valor in campos.items():
        if valor is not None and hasattr(materia, clave):
            setattr(materia, clave, valor)

    session.commit()
    session.refresh(materia)

    return materia


def guardar_horarios(
    session: Session,
    materia_id: int,
    horarios: dict[str, tuple[time, time] | None],
) -> list[HorarioMateria]:
    """Reemplaza el horario semanal (lunes a viernes) de una materia.

    `horarios` debe mapear cada día en DIAS_SEMANA a una tupla
    (hora_inicio, hora_fin), o a None para no dictar clase ese día.
    """

    materia = obtener_materia(session, materia_id)

    if materia is None:
        raise ValidacionError("La materia no existe.")

    _validar_horarios(horarios)

    existentes = {horario.dia_semana: horario for horario in materia.horarios}

    for dia in DIAS_SEMANA:
        rango = horarios.get(dia)
        existente = existentes.get(dia)

        if rango is None:
            if existente is not None:
                session.delete(existente)
            continue

        hora_inicio, hora_fin = rango

        if existente is not None:
            existente.hora_inicio = hora_inicio
            existente.hora_fin = hora_fin
        else:
            session.add(
                HorarioMateria(
                    materia_id=materia_id,
                    dia_semana=dia,
                    hora_inicio=hora_inicio,
                    hora_fin=hora_fin,
                )
            )

    session.commit()
    session.refresh(materia)

    return materia.horarios


def resumir_horario(materia: Materia) -> str:
    if not materia.horarios:
        return "Sin horario"

    por_dia = {horario.dia_semana: horario for horario in materia.horarios}

    partes = [
        f"{DIA_ABREVIADOS[dia]} {por_dia[dia].hora_inicio.strftime('%H:%M')}"
        f"-{por_dia[dia].hora_fin.strftime('%H:%M')}"
        for dia in DIAS_SEMANA
        if dia in por_dia
    ]

    return ", ".join(partes)


def eliminar_materia(
    session: Session,
    materia_id: int,
) -> bool:

    materia = obtener_materia(session, materia_id)

    if materia is None:
        return False

    session.delete(materia)
    session.commit()

    return True