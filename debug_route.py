from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models import Base
from app.services import rutas
from app.chatbot import resolver_destino_ruta, _extraer_destino_destino_ruta, _buscar_destino_ruta
import re

engine = create_engine('sqlite://')
Base.metadata.create_all(engine)
s = Session(engine)
rutas.crear_red_ejemplo(s)
texto = 'Como llego a la biblioteca?'
print('extraido:', _extraer_destino_destino_ruta(texto))
print('destino:', _buscar_destino_ruta(_extraer_destino_destino_ruta(texto), s))
print('resolver:', resolver_destino_ruta(texto, s, {}))
print('regex:', re.search(r'(?:como\s+llego|como\s+ir|como\s+voy|llego|voy|ir|vamos|llevame|llévame)\s+(?:a|al|a la|hasta|hacia)\s+(.+)', 'como llego a la biblioteca?'.lower()))
