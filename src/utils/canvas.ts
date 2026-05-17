export const drawTexturedTriangle = (ctx, img, imgRect, p0, p1, p2, t0, t1, t2) => {
    const cx = (p0.x + p1.x + p2.x) / 3;
    const cy = (p0.y + p1.y + p2.y) / 3;
    const transform = ctx.getTransform();
    const screenScale = Math.max(0.001, Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d));
    const pad = 1.35 / screenScale;
    const expand = (p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.max(0.001, Math.hypot(dx, dy));
        const sf = (len + pad) / len;
        return { x: cx + dx * sf, y: cy + dy * sf };
    };
    const cp0 = expand(p0);
    const cp1 = expand(p1);
    const cp2 = expand(p2);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cp0.x, cp0.y);
    ctx.lineTo(cp1.x, cp1.y);
    ctx.lineTo(cp2.x, cp2.y);
    ctx.closePath();
    ctx.clip();

    const denom = t0.x * (t1.y - t2.y) + t1.x * (t2.y - t0.y) + t2.x * (t0.y - t1.y);
    if (Math.abs(denom) > 0.0001) {
        const a = (p0.x * (t1.y - t2.y) + p1.x * (t2.y - t0.y) + p2.x * (t0.y - t1.y)) / denom;
        const b = (p0.y * (t1.y - t2.y) + p1.y * (t2.y - t0.y) + p2.y * (t0.y - t1.y)) / denom;
        const c = (p0.x * (t2.x - t1.x) + p1.x * (t0.x - t2.x) + p2.x * (t1.x - t0.x)) / denom;
        const d = (p0.y * (t2.x - t1.x) + p1.y * (t0.x - t2.x) + p2.y * (t1.x - t0.x)) / denom;
        const e = (p0.x * (t1.x * t2.y - t2.x * t1.y) + p1.x * (t2.x * t0.y - t0.x * t2.y) + p2.x * (t0.x * t1.y - t1.x * t0.y)) / denom;
        const f = (p0.y * (t1.x * t2.y - t2.x * t1.y) + p1.y * (t2.x * t0.y - t0.x * t2.y) + p2.y * (t0.x * t1.y - t1.x * t0.y)) / denom;
        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(img, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
    }
    ctx.restore();
};
