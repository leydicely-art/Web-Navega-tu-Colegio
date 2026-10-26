"""Punto de entrada: menú principal (chatbot o gestión CRUD de datos)."""

from app.chatbot import responder
from app.database.database import SessionLocal, init_db
from app.menu import menu_gestion_datos


def _chat(session) -> None:
    print("Chatbot escolar. Escribe 'salir' para volver al menú.")
    print("Ejemplos: '¿en qué curso está Juan Pérez?', '¿qué estudiantes tiene 3ro A?'")
    while True:
        pregunta = input("\nTú: ").strip()
        if pregunta.lower() in {"salir", "exit", "quit"}:
            break
        if not pregunta:
            continue
        print(f"Bot: {responder(pregunta, session)}")


def main() -> None:
    init_db()
    session = SessionLocal()
    try:
        while True:
            print("\n=== MENÚ PRINCIPAL ===")
            print("1) Chatbot")
            print("2) Gestión de datos (CRUD)")
            print("0) Salir")
            eleccion = input("Elige una opción: ").strip()
            if eleccion == "1":
                _chat(session)
            elif eleccion == "2":
                menu_gestion_datos(session)
            elif eleccion == "0":
                break
            else:
                print("Opción inválida.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
