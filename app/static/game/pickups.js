/* Objetos recolectables: monedas (moneda de la partida), gemas (moneda
 * persistente) y corazones (curación). Con animación de flotación e imán
 * suave hacia el león cuando está cerca. */

import { Entity } from "./engine.js";

const STYLE = {
    coin: { color: "#f3d99a", edge: "#d8a63a", radius: 9 },
    gem: { color: "#7fe8e0", edge: "#2fb3a8", radius: 10 },
    heart: { color: "#ff8a8a", edge: "#c0392b", radius: 10 },
    cure: { color: "#ff3b3b", edge: "#8b0000", radius: 14 },
};

export class Pickup extends Entity {
    constructor(x, y, kind) {
        const style = STYLE[kind];
        super(x, y, style.radius);
        this.kind = kind;
        this.style = style;
        this.t = Math.random() * Math.PI * 2;
    }

    update(dt, player) {
        this.t += dt * 4;
        const d = Math.hypot(player.x - this.x, player.y - this.y);
        if (d < 140) {
            const pull = (1 - d / 140) * 420;
            const ang = Math.atan2(player.y - this.y, player.x - this.x);
            this.x += Math.cos(ang) * pull * dt;
            this.y += Math.sin(ang) * pull * dt;
        }
        if (d < player.radius + this.radius) this.collected = true;
    }

    draw(ctx, cam) {
        const [sx, sy] = cam.toScreen(this.x, this.y);
        const bob = Math.sin(this.t) * 4;
        ctx.save();
        ctx.translate(sx, sy + bob);
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.beginPath();
        ctx.ellipse(0, 10 - bob, this.radius * 0.8, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.style.edge;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.style.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius - 2.5, 0, Math.PI * 2);
        ctx.fill();

        if (this.kind === "heart") {
            ctx.fillStyle = "#c0392b";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("♥", 0, 1);
        } else if (this.kind === "cure") {
            // Cruz blanca de botiquín sobre el disco rojo
            ctx.fillStyle = "#ffffff";
            const arm = this.radius - 3, thick = 3.6;
            ctx.fillRect(-thick, -arm, thick * 2, arm * 2);
            ctx.fillRect(-arm, -thick, arm * 2, thick * 2);
            // Anillo rojo pulsante, como una baliza para localizarlo
            const pulse = 0.5 + Math.sin(this.t * 2) * 0.5;
            ctx.save();
            ctx.globalAlpha = 0.25 + 0.55 * pulse;
            ctx.strokeStyle = "#ff5a5a";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 4 + pulse * 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        ctx.restore();
    }
}
