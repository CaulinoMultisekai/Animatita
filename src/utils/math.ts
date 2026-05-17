export const distPointToSegment = (p, a, b) => {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const closest = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return Math.hypot(p.x - closest.x, p.y - closest.y);
};

export const smoothstep = (min, max, value) => {
    if (value <= min) return 0;
    if (value >= max) return 1;
    const x = (value - min) / (max - min);
    return x * x * (3 - 2 * x);
};

export const hslToRgb = (h, s, l) => {
    h /= 360;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r * 255, g * 255, b * 255];
};

export const delaunayTriangulate = (vertices) => {
    const circumcircle = (p1, p2, p3) => {
        const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
        const dx2 = p3.x - p1.x, dy2 = p3.y - p1.y;
        const d = 2 * (dx1 * dy2 - dx2 * dy1);
        if (Math.abs(d) < 1e-5) return null;
        const cx = p1.x + (dy2 * (dx1 * dx1 + dy1 * dy1) - dy1 * (dx2 * dx2 + dy2 * dy2)) / d;
        const cy = p1.y + (dx1 * (dx2 * dx2 + dy2 * dy2) - dx2 * (dx1 * dx1 + dy1 * dy1)) / d;
        return { x: cx, y: cy, r2: (cx - p1.x) ** 2 + (cy - p1.y) ** 2 };
    };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    vertices.forEach(v => {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
    });
    const dmax = Math.max(maxX - minX, maxY - minY) || 1;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const st = [{ x: midX - 20 * dmax, y: midY - dmax }, { x: midX, y: midY + 20 * dmax }, { x: midX + 20 * dmax, y: midY - dmax }];
    let pts = [...vertices, ...st];
    let triangles = [[pts.length - 3, pts.length - 2, pts.length - 1]];

    for (let i = 0; i < vertices.length; i++) {
        const p = vertices[i];
        let badTriangles = [];
        let polygon = [];
        for (let j = 0; j < triangles.length; j++) {
            const t = triangles[j];
            const c = circumcircle(pts[t[0]], pts[t[1]], pts[t[2]]);
            if (c && (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= c.r2 + 0.0001) {
                badTriangles.push(j);
                polygon.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
            }
        }
        for (let j = badTriangles.length - 1; j >= 0; j--) triangles.splice(badTriangles[j], 1);
        let edges = [];
        for (let j = 0; j < polygon.length; j++) {
            const edge = polygon[j];
            let shared = false;
            for (let k = 0; k < polygon.length; k++) {
                if (j !== k && ((edge[0] === polygon[k][0] && edge[1] === polygon[k][1]) || (edge[0] === polygon[k][1] && edge[1] === polygon[k][0]))) {
                    shared = true;
                    break;
                }
            }
            if (!shared) edges.push(edge);
        }
        for (let j = 0; j < edges.length; j++) triangles.push([edges[j][0], edges[j][1], i]);
    }
    return triangles.filter(t => t[0] < vertices.length && t[1] < vertices.length && t[2] < vertices.length);
};
