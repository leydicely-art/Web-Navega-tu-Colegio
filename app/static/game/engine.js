/* Rugido Salvaje — motor mínimo (matemática 2D, entidades, cámara, colisiones).
 * Sin dependencias externas: solo lo que necesita este juego. */

export function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
}

export function angleTo(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
}

export function randRange(min, max) {
    return min + Math.random() * (max - min);
}

export function randInt(min, max) {
    return Math.floor(randRange(min, max + 1));
}

export function pick(arr) {
    return arr[randInt(0, arr.length - 1)];
}

/** Círculo vs círculo. Devuelve la profundidad de solapamiento (0 si no chocan). */
export function circleOverlap(a, b) {
    const d = dist(a.x, a.y, b.x, b.y);
    const overlap = a.radius + b.radius - d;
    return overlap > 0 ? { overlap, d: d || 0.0001 } : null;
}

/** Separa dos círculos empujándolos en direcciones opuestas (para obstáculos/entidades sólidas). */
export function resolveCircleCollision(a, b, hit) {
    const dx = (a.x - b.x) / hit.d;
    const dy = (a.y - b.y) / hit.d;
    const totalMass = (a.invMass ?? 1) + (b.invMass ?? 1);
    if (totalMass <= 0) return;
    const push = hit.overlap / totalMass;
    if (a.invMass !== 0) {
        a.x += dx * push * (a.invMass ?? 1);
        a.y += dy * push * (a.invMass ?? 1);
    }
    if (b.invMass !== 0) {
        b.x -= dx * push * (b.invMass ?? 1);
        b.y -= dy * push * (b.invMass ?? 1);
    }
}

/** Objeto base del mundo: posición, velocidad, radio de colisión y ciclo de vida. */
export class Entity {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.radius = radius;
        this.dead = false;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }

    draw(_ctx, _cam) {}
}

/** Cámara con seguimiento suave y screen shake moderado (impactos, rugido, jefe). */
export class Camera {
    constructor(viewW, viewH) {
        this.x = 0;
        this.y = 0;
        this.viewW = viewW;
        this.viewH = viewH;
        this.shakeMag = 0;
        this.shakeTime = 0;
        this.offX = 0;
        this.offY = 0;
    }

    follow(targetX, targetY, dt, bounds) {
        this.x = lerp(this.x, targetX, Math.min(1, dt * 6));
        this.y = lerp(this.y, targetY, Math.min(1, dt * 6));
        if (bounds) {
            const halfW = this.viewW / 2, halfH = this.viewH / 2;
            this.x = clamp(this.x, bounds.x0 + halfW, Math.max(bounds.x0 + halfW, bounds.x1 - halfW));
            this.y = clamp(this.y, bounds.y0 + halfH, Math.max(bounds.y0 + halfH, bounds.y1 - halfH));
        }
        if (this.shakeTime > 0) {
            this.shakeTime -= dt;
            const t = Math.max(0, this.shakeTime);
            this.offX = randRange(-1, 1) * this.shakeMag * (t > 0 ? 1 : 0);
            this.offY = randRange(-1, 1) * this.shakeMag * (t > 0 ? 1 : 0);
        } else {
            this.offX = 0;
            this.offY = 0;
        }
    }

    shake(mag, dur) {
        this.shakeMag = Math.max(this.shakeMag, mag);
        this.shakeTime = Math.max(this.shakeTime, dur);
    }

    /** Coordenadas de mundo -> coordenadas de pantalla. */
    toScreen(x, y) {
        return [x - this.x + this.viewW / 2 + this.offX, y - this.y + this.viewH / 2 + this.offY];
    }

    toWorld(sx, sy) {
        return [sx + this.x - this.viewW / 2, sy + this.y - this.viewH / 2];
    }

    isVisible(x, y, margin) {
        const [sx, sy] = this.toScreen(x, y);
        return sx > -margin && sx < this.viewW + margin && sy > -margin && sy < this.viewH + margin;
    }
}
