"""Inserta datos de ejemplo para poder probar el chatbot."""

from app.database.database import SessionLocal, init_db
from app.models import Curso, Estudiante


def seed() -> None:
    init_db()
    session = SessionLocal()
    try:
        if session.query(Estudiante).first():
            print("La base de datos ya tiene datos, no se volvió a sembrar.")
            return

        curso_3a = Curso(nombre="3ro A", descripcion="Tercer año, sección A")
        curso_4b = Curso(nombre="4to B", descripcion="Cuarto año, sección B")

        est_juan = Estudiante(nombre="Juan Pérez", curso=curso_3a)
        est_maria = Estudiante(nombre="María Rodríguez", curso=curso_4b)

        session.add_all([curso_3a, curso_4b, est_juan, est_maria])
        session.commit()
        print("Datos de ejemplo insertados correctamente.")
    finally:
        session.close()


if __name__ == "__main__":
    seed()
