"""Genera y valida los tokens que viajan (firmados) dentro de cada código QR físico.

El QR nunca codifica el contenido en sí: codifica un token opaco más una
firma HMAC. Si alguien reemplaza el sticker por uno propio, o intenta
adivinar/editar el texto, la firma no valida y el backend rechaza la
resolución antes de tocar la base de datos.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets

# En producción, definir AR_SIGNING_SECRET en el entorno (.env). El valor por
# defecto solo sirve para desarrollo local.
_SECRET = os.getenv("AR_SIGNING_SECRET", "portal-escolar-ar-dev-secret")


def generar_token() -> str:
    """Token aleatorio y opaco (no consecutivo, no adivinable) para una nueva experiencia."""
    return secrets.token_urlsafe(16)


def _firmar(token: str) -> str:
    return hmac.new(_SECRET.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()[:16]


def payload_qr(token: str) -> str:
    """Texto que se codifica dentro del QR: token + firma, separados por un punto."""
    return f"{token}.{_firmar(token)}"


def token_desde_payload(payload: str) -> str | None:
    """Valida la firma de un payload leído de un QR y devuelve el token si es válida."""
    if not payload or "." not in payload:
        return None

    token, firma = payload.rsplit(".", 1)
    if not token or not firma:
        return None

    if not hmac.compare_digest(firma, _firmar(token)):
        return None

    return token
