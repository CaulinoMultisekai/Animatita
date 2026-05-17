const TAU = Math.PI * 2;

const smoothstep = (min, max, value) => {
  if (value <= min) return 0;
  if (value >= max) return 1;
  const x = (value - min) / (max - min);
  return x * x * (3 - 2 * x);
};

const distPointToSegment = (p, a, b) => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
};

const shortestAngleDelta = (from, to) => {
  let diff = to - from;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  return diff;
};

const delaunayTriangulate = (vertices) => {
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
  vertices.forEach((v) => {
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
  });
  const dmax = Math.max(maxX - minX, maxY - minY) || 1;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const st = [{ x: midX - 20 * dmax, y: midY - dmax }, { x: midX, y: midY + 20 * dmax }, { x: midX + 20 * dmax, y: midY - dmax }];
  const pts = [...vertices, ...st];
  const triangles = [[pts.length - 3, pts.length - 2, pts.length - 1]];
  for (let i = 0; i < vertices.length; i++) {
    const polygon = [];
    for (let j = triangles.length - 1; j >= 0; j--) {
      const t = triangles[j];
      const c = circumcircle(pts[t[0]], pts[t[1]], pts[t[2]]);
      if (c && (pts[i].x - c.x) ** 2 + (pts[i].y - c.y) ** 2 <= c.r2 + 0.0001) {
        polygon.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
        triangles.splice(j, 1);
      }
    }
    polygon.forEach((edge, idx) => {
      const shared = polygon.some((other, otherIdx) => idx !== otherIdx && edge[0] === other[1] && edge[1] === other[0]);
      if (!shared) triangles.push([edge[0], edge[1], i]);
    });
  }
  return triangles.filter((t) => t[0] < vertices.length && t[1] < vertices.length && t[2] < vertices.length);
};

const drawTexturedTriangle = (ctx, img, imgRect, p0, p1, p2, t0, t1, t2) => {
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

const loadImage = (source) => new Promise((resolve, reject) => {
  if (!source) return resolve(null);
  if (source instanceof HTMLImageElement) return source.complete ? resolve(source) : (source.onload = () => resolve(source));
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
});

export class AnimatitaPlayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.densityScale = 1;
    this.speedScale = 1;
    this.debugMode = -1;
    this.scaleMode = 'contain';
    this.anchor = 'center';
    this.displayScale = 1;
    this.lissajousEnabled = true;
    this.animationTitle = '';
    this.raf = 0;
    this.last = performance.now();
    this.engine = this.createEngine();
  }

  createEngine() {
    return {
      bones: [], jiggles: [], pins: [], verticesRest: [], verticesCurrent: [], triangles: [], weights: [], vertexPins: [],
      image: null, depthImage: null, imageRect: { x: 200, y: 150, w: 400, h: 400 },
      pitchX: 0, yawY: 0, parallaxX: 0, parallaxY: 0, animProgress: 0, animDirection: 1,
      meshType: 'GRID', gridSize: 20, edgeDensity: 1, borderOffset: 0, depthGamma: 0.3, depthMultiplier: 0.2, invertDepth: false,
      depthBlur: 0, depthMapSmoothness: 0, edgeDepth: 0, edgeBevel: 0.05,
      depthGradientY: 0.85, depthGradientSmoothness: 0.4, deformZIntensity: 0.5,
      useBonePhysics: true, secPhysStiffness: 0.15, secPhysDamping: 0.85
    };
  }

  async load(characterFile, image, depth) {
    const data = typeof characterFile === 'string'
      ? JSON.parse(characterFile.trim().startsWith('{') ? characterFile : await (await fetch(characterFile)).text())
      : JSON.parse(await characterFile.text());
    const character = data.character || data;
    const settings = character.settings || data.settings || {};
    Object.assign(this.engine, settings);
    this.engine.bones = structuredClone(character.bones || data.bones || []);
    this.engine.jiggles = structuredClone(character.jiggles || data.jiggles || []);
    this.engine.pins = structuredClone(character.pins || data.pins || []);
    this.engine.imageRect = character.imageRect || data.imageRect || this.engine.imageRect;
    this.animations = data.animations || [{ title: 'default', keyframes: data.keyframes || [] }];
    this.animationTitle = this.animations[0]?.title || '';
    this.engine.image = await loadImage(image);
    this.engine.depthImage = await loadImage(depth);
    this.remesh();
    this.setAnimation(this.animationTitle);
    return this;
  }

  setMeshDensity(value) {
    this.densityScale = Math.max(0.1, Number(value) || 1);
    this.remesh();
  }

  setAnimationSpeed(value) {
    this.speedScale = Math.max(0, Number(value) || 0);
  }

  setDebug(enabled) {
    this.debugMode = enabled === true ? 3 : Number(enabled);
    if (!Number.isFinite(this.debugMode)) this.debugMode = -1;
  }

  setScaleMode(mode) {
    this.scaleMode = ['contain', 'cover', 'stretch', 'none'].includes(mode) ? mode : 'contain';
  }

  setAnchor(anchor) {
    this.anchor = anchor || 'center';
  }

  setDisplayScale(value) {
    this.displayScale = Math.max(0.01, Number(value) || 1);
  }

  setLissajousEnabled(enabled) {
    this.lissajousEnabled = !!enabled;
  }

  setAnimation(title) {
    const next = this.animations?.find((item) => item.title === title) || this.animations?.[0];
    if (!next) return false;
    this.animation = next;
    this.animationTitle = next.title;
    this.engine.animProgress = 0;
    this.engine.animDirection = 1;
    return true;
  }

  play() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.engine = null;
    this.ctx = null;
    this.canvas = null;
    this.animations = null;
    this.animation = null;
  }

  remesh() {
    if (this.engine.meshType === 'OPTIMIZED' && this.engine.image) this.remeshOptimized();
    else this.remeshGrid();
    if ((this.engine.borderOffset || 0) !== 0 && this.engine.verticesRest.length > 0) {
      const e = this.engine;
      const cx = e.imageRect.x + e.imageRect.w / 2;
      const cy = e.imageRect.y + e.imageRect.h / 2;
      const halfW = e.imageRect.w / 2;
      const scale = 1 + (e.borderOffset / halfW);
      e.verticesRest.forEach((v) => {
        v.x = cx + (v.x - cx) * scale;
        v.y = cy + (v.y - cy) * scale;
      });
    }
    this.computeEdgeDistances();
    this.extractDepth();
    this.bindMesh();
  }

  remeshGrid() {
    const e = this.engine;
    const { x, y, w, h } = e.imageRect;
    const size = Math.max(2, Math.round((e.gridSize || 20) * this.densityScale));
    e.verticesRest = [];
    e.triangles = [];
    for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) e.verticesRest.push({ x: x + (i / size) * w, y: y + (j / size) * h, z: 128 });
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const p1 = j * (size + 1) + i, p2 = p1 + 1, p3 = p1 + size + 1, p4 = p3 + 1;
      e.triangles.push([p1, p2, p3], [p2, p4, p3]);
    }
  }

  createMorphologicalGrid(imgData, w, h, offset) {
    const grid = new Uint8Array(w * h);
    const r = Math.abs(Math.round(offset || 0));
    for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
      const opaque = imgData[(iy * w + ix) * 4 + 3] > 15;
      if (!r) {
        grid[iy * w + ix] = opaque ? 1 : 0;
        continue;
      }
      let foundOpaque = opaque;
      let foundTrans = !opaque;
      for (let oy = -r; oy <= r; oy += 2) for (let ox = -r; ox <= r; ox += 2) {
        if (ox * ox + oy * oy > r * r) continue;
        const px = ix + ox, py = iy + oy;
        if (px < 0 || px >= w || py < 0 || py >= h) foundTrans = true;
        else if (imgData[(py * w + px) * 4 + 3] > 15) foundOpaque = true;
        else foundTrans = true;
      }
      grid[iy * w + ix] = offset > 0 ? (foundOpaque ? 1 : 0) : (!foundTrans && foundOpaque ? 1 : 0);
    }
    return grid;
  }

  remeshOptimized() {
    const e = this.engine;
    const { x, y, w, h } = e.imageRect;
    const size = Math.max(2, Math.round((e.gridSize || 20) * this.densityScale));
    const oc = document.createElement('canvas');
    oc.width = Math.max(1, Math.floor(w));
    oc.height = Math.max(1, Math.floor(h));
    const octx = oc.getContext('2d');
    octx.drawImage(e.image, 0, 0, oc.width, oc.height);
    let imgData;
    try {
      imgData = octx.getImageData(0, 0, oc.width, oc.height).data;
    } catch {
      this.remeshGrid();
      return;
    }
    const shapeGrid = this.createMorphologicalGrid(imgData, oc.width, oc.height, e.borderOffset || 0);
    const oc_w = oc.width;
    const oc_h = oc.height;
    // Explicitly free GPU memory for offscreen canvas
    oc.width = 1;
    oc.height = 1;
    const isOpaque = (ix, iy) => ix >= 0 && ix < oc_w && iy >= 0 && iy < oc_h && shapeGrid[iy * oc_w + ix] === 1;
    const points = [];
    const step = Math.max(1, Math.floor((oc_w / size) / (e.edgeDensity || 1)));
    const rings = Math.max(1, Math.ceil((e.edgeDensity || 1) * 1.5));
    for (let iy = 0; iy < oc_h; iy += step) for (let ix = 0; ix < oc_w; ix += step) {
      if (!isOpaque(ix, iy)) continue;
      let nearBoundary = false;
      for (let r = 1; r <= rings; r++) {
        const s = step * r;
        if (!isOpaque(ix - s, iy) || !isOpaque(ix + s, iy) || !isOpaque(ix, iy - s) || !isOpaque(ix, iy + s)) nearBoundary = true;
      }
      if (nearBoundary) points.push({ x: x + (ix / oc_w) * w, y: y + (iy / oc_h) * h, z: 128 });
    }
    const sparseSize = Math.max(3, Math.floor(size / 3));
    for (let j = 1; j < sparseSize; j++) for (let i = 1; i < sparseSize; i++) {
      const px = x + (i / sparseSize) * w, py = y + (j / sparseSize) * h;
      if (isOpaque(Math.floor(((px - x) / w) * oc_w), Math.floor(((py - y) / h) * oc_h))) points.push({ x: px, y: py, z: 128 });
    }
    e.bones.forEach((bone) => {
      const len = Math.hypot(bone.endRest.x - bone.startRest.x, bone.endRest.y - bone.startRest.y);
      const steps = Math.max(3, Math.floor((len / w) * size * 1.5));
      const angle = Math.atan2(bone.endRest.y - bone.startRest.y, bone.endRest.x - bone.startRest.x);
      const perpX = Math.cos(angle + Math.PI / 2);
      const perpY = Math.sin(angle + Math.PI / 2);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = bone.startRest.x + (bone.endRest.x - bone.startRest.x) * t;
        const py = bone.startRest.y + (bone.endRest.y - bone.startRest.y) * t;
        const width1 = (w / size) * 0.8;
        const width2 = (w / size) * 1.6;
        [
          { x: px, y: py },
          { x: px + perpX * width1, y: py + perpY * width1 },
          { x: px - perpX * width1, y: py - perpY * width1 },
          { x: px + perpX * width2, y: py + perpY * width2 },
          { x: px - perpX * width2, y: py - perpY * width2 }
        ].forEach((pt) => {
          if (isOpaque(Math.floor(((pt.x - x) / w) * oc_w), Math.floor(((pt.y - y) / h) * oc_h))) points.push({ ...pt, z: 128 });
        });
      }
    });
    e.jiggles.forEach((jig) => {
      let cx = jig.restX, cy = jig.restY;
      if (jig.boneId || jig.parentId) {
        const bone = e.bones.find((item) => item.id === (jig.boneId || jig.parentId));
        if (bone) {
          cx = bone.startRest.x + jig.localX * Math.cos(bone.angleRest) - jig.localY * Math.sin(bone.angleRest);
          cy = bone.startRest.y + jig.localX * Math.sin(bone.angleRest) + jig.localY * Math.cos(bone.angleRest);
        }
      }
      points.push({ x: cx, y: cy, z: 128 });
      for (let r = 0.3; r <= 1.0; r += 0.3) {
        for (let a = 0; a < TAU; a += Math.PI / 6) points.push({ x: cx + Math.cos(a) * jig.rx * r, y: cy + Math.sin(a) * jig.ry * r, z: 128 });
      }
    });
    e.pins.forEach((pin) => {
      let cx = pin.restX, cy = pin.restY;
      if (pin.parentId) {
        const bone = e.bones.find((item) => item.id === pin.parentId);
        if (bone) {
          cx = bone.startRest.x + pin.localX * Math.cos(bone.angleRest) - pin.localY * Math.sin(bone.angleRest);
          cy = bone.startRest.y + pin.localX * Math.sin(bone.angleRest) + pin.localY * Math.cos(bone.angleRest);
        }
      }
      points.push({ x: cx, y: cy, z: 128 });
      for (let a = 0; a < TAU; a += Math.PI / 4) points.push({ x: cx + Math.cos(a) * pin.radius, y: cy + Math.sin(a) * pin.radius, z: 128 });
      for (let a = 0; a < TAU; a += Math.PI / 4) points.push({ x: cx + Math.cos(a) * pin.radius * 0.5, y: cy + Math.sin(a) * pin.radius * 0.5, z: 128 });
    });
    let unique = [];
    const minSpacing = (w / size) * 0.3;
    points.forEach((p) => {
      if (!unique.some((up) => Math.hypot(up.x - p.x, up.y - p.y) < minSpacing)) unique.push(p);
    });
    if (unique.length > 3500) unique = unique.filter((_, i) => i % Math.ceil(unique.length / 3500) === 0);
    try {
      const triangles = delaunayTriangulate(unique).filter((tri) => {
        const p1 = unique[tri[0]], p2 = unique[tri[1]], p3 = unique[tri[2]];
        const cx = (p1.x + p2.x + p3.x) / 3, cy = (p1.y + p2.y + p3.y) / 3;
        return isOpaque(Math.floor(((cx - x) / w) * oc_w), Math.floor(((cy - y) / h) * oc_h));
      });
      if (unique.length >= 3 && triangles.length) {
        const maxSearch = Math.floor(oc_w * 0.15);
        unique.forEach((v) => {
          const ix = Math.floor(((v.x - x) / w) * oc_w);
          const iy = Math.floor(((v.y - y) / h) * oc_h);
          let dist = maxSearch;
          if (!isOpaque(ix, iy)) {
            dist = 0;
          } else {
            for (let r = 1; r <= maxSearch; r++) {
              let minEuc = maxSearch, found = false;
              for (let d = -r; d <= r; d++) {
                if (!isOpaque(ix + d, iy - r)) { minEuc = Math.min(minEuc, Math.hypot(d, -r)); found = true; }
                if (!isOpaque(ix + d, iy + r)) { minEuc = Math.min(minEuc, Math.hypot(d, r)); found = true; }
                if (!isOpaque(ix - r, iy + d)) { minEuc = Math.min(minEuc, Math.hypot(-r, d)); found = true; }
                if (!isOpaque(ix + r, iy + d)) { minEuc = Math.min(minEuc, Math.hypot(r, d)); found = true; }
              }
              if (found) { dist = minEuc; break; }
            }
          }
          v.edgeDist = dist / oc_w;
        });
        e.verticesRest = unique;
        e.triangles = triangles;
        return;
      }
    } catch {}
    this.remeshGrid();
  }

  computeEdgeDistances() {
    const e = this.engine;
    if (!e.image || !e.verticesRest.length) return;
    const { x, y, w, h } = e.imageRect;
    const oc = document.createElement('canvas');
    oc.width = Math.max(1, Math.floor(w));
    oc.height = Math.max(1, Math.floor(h));
    const octx = oc.getContext('2d');
    octx.drawImage(e.image, 0, 0, oc.width, oc.height);
    let imgData;
    try {
      imgData = octx.getImageData(0, 0, oc.width, oc.height).data;
    } catch {
      oc.width = 1;
      oc.height = 1;
      return;
    }
    const shapeGrid = this.createMorphologicalGrid(imgData, oc.width, oc.height, e.borderOffset || 0);
    const ocW = oc.width, ocH = oc.height;
    oc.width = 1;
    oc.height = 1;
    const isOpaque = (ix, iy) => ix >= 0 && ix < ocW && iy >= 0 && iy < ocH && shapeGrid[iy * ocW + ix] === 1;
    const maxSearch = Math.floor(ocW * 0.15);
    e.verticesRest.forEach((v) => {
      const ix = Math.floor(((v.x - x) / w) * ocW);
      const iy = Math.floor(((v.y - y) / h) * ocH);
      let dist = maxSearch;
      if (!isOpaque(ix, iy)) {
        dist = 0;
      } else {
        for (let r = 1; r <= maxSearch; r++) {
          let minEuc = maxSearch, found = false;
          for (let d = -r; d <= r; d++) {
            if (!isOpaque(ix + d, iy - r)) { minEuc = Math.min(minEuc, Math.hypot(d, -r)); found = true; }
            if (!isOpaque(ix + d, iy + r)) { minEuc = Math.min(minEuc, Math.hypot(d, r)); found = true; }
            if (!isOpaque(ix - r, iy + d)) { minEuc = Math.min(minEuc, Math.hypot(-r, d)); found = true; }
            if (!isOpaque(ix + r, iy + d)) { minEuc = Math.min(minEuc, Math.hypot(r, d)); found = true; }
          }
          if (found) { dist = minEuc; break; }
        }
      }
      v.edgeDist = dist / ocW;
    });
  }

  extractDepth() {
    const e = this.engine;
    if (!e.depthImage) return;
    const oc = document.createElement('canvas');
    oc.width = e.depthImage.width;
    oc.height = e.depthImage.height;
    const octx = oc.getContext('2d');
    if ((e.depthBlur || 0) > 0) octx.filter = `blur(${e.depthBlur}px)`;
    octx.drawImage(e.depthImage, 0, 0);
    let imgData;
    try {
      imgData = octx.getImageData(0, 0, oc.width, oc.height).data;
    } catch {
      oc.width = 1;
      oc.height = 1;
      return;
    }
    e.verticesRest.forEach((v) => {
      const px = Math.max(0, Math.min(oc.width - 1, Math.floor(((v.x - e.imageRect.x) / e.imageRect.w) * oc.width)));
      const py = Math.max(0, Math.min(oc.height - 1, Math.floor(((v.y - e.imageRect.y) / e.imageRect.h) * oc.height)));
      v.z = imgData[(py * oc.width + px) * 4];
    });
    // Explicitly free GPU memory for offscreen canvas
    oc.width = 1;
    oc.height = 1;
  }

  bindMesh() {
    const e = this.engine;
    e.weights = [];
    e.vertexPins = [];
    e.verticesRest.forEach((v) => {
      const itemWeights = [];
      const vPins = [];
      e.bones.forEach((bone, idx) => {
        const d = distPointToSegment(v, bone.startRest, bone.endRest);
        const dx = v.x - bone.startRest.x, dy = v.y - bone.startRest.y;
        const cosA = Math.cos(-bone.angleRest), sinA = Math.sin(-bone.angleRest);
        itemWeights.push({ type: 'bone', idx, w: 1 / Math.pow(d + 1, 3), localX: dx * cosA - dy * sinA, localY: dx * sinA + dy * cosA });
      });
      e.pins.forEach((pin, pinIdx) => {
        let cx = pin.restX, cy = pin.restY;
        if (pin.parentId) {
          const bone = e.bones.find((item) => item.id === pin.parentId);
          if (bone) {
            const cosA = Math.cos(bone.angleRest), sinA = Math.sin(bone.angleRest);
            cx = bone.startRest.x + pin.localX * cosA - pin.localY * sinA;
            cy = bone.startRest.y + pin.localX * sinA + pin.localY * cosA;
          }
        }
        const d = Math.hypot(v.x - cx, v.y - cy);
        if (d < pin.radius) vPins.push({ pinIdx, w: 1 - smoothstep(pin.radius * (1 - (pin.smoothness ?? 1)), pin.radius, d) });
      });
      e.jiggles.forEach((jig, idx) => {
        let cx = jig.restX, cy = jig.restY, angle = 0;
        if (jig.boneId || jig.parentId) {
          const bone = e.bones.find((item) => item.id === (jig.boneId || jig.parentId));
          if (bone) {
            angle = bone.angleRest;
            cx = bone.startRest.x + jig.localX * Math.cos(angle) - jig.localY * Math.sin(angle);
            cy = bone.startRest.y + jig.localX * Math.sin(angle) + jig.localY * Math.cos(angle);
          }
        }
        const dx = v.x - cx, dy = v.y - cy;
        const distSq = (dx / Math.max(1, jig.rx)) ** 2 + (dy / Math.max(1, jig.ry)) ** 2;
        const weight = distSq < 1 ? (1 - smoothstep(jig.smoothness ?? 0, 1, Math.sqrt(distSq))) * 500 : 0;
        if (weight > 0) {
          const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
          itemWeights.push({ type: 'jiggle', idx, w: weight, localX: dx * cosA - dy * sinA, localY: dx * sinA + dy * cosA });
        }
      });
      const top = itemWeights.sort((a, b) => b.w - a.w).slice(0, 4);
      const sum = top.reduce((acc, item) => acc + item.w, 0);
      e.weights.push(sum ? top.map((item) => ({ ...item, w: item.w / sum })) : []);
      e.vertexPins.push(vPins);
    });
  }

  update(dt) {
    const e = this.engine;
    const frames = this.animation?.keyframes || [];
    if (frames.length > 1) {
      e.animProgress += dt * e.animDirection * (this.animation.speed || 1) * this.speedScale;
      if (e.animProgress >= frames.length - 1) {
        e.animProgress = this.animation.pingPong === false ? 0 : frames.length - 1;
        e.animDirection = this.animation.pingPong === false ? 1 : -1;
      }
      if (e.animProgress <= 0) {
        e.animProgress = 0;
        e.animDirection = 1;
      }
      const base = Math.floor(e.animProgress);
      const next = Math.min(frames.length - 1, base + 1);
      const t = smoothstep(0, 1, e.animProgress - base);
      const a = frames[base], b = frames[next];
      e.bones.forEach((bone, i) => {
        const fromTransform = a.boneTransforms?.[i];
        const toTransform = b.boneTransforms?.[i];
        const fromAngle = fromTransform?.angle ?? a.bones?.[i] ?? bone.angleRest;
        const toAngle = toTransform?.angle ?? b.bones?.[i] ?? fromAngle;
        const fromOffsetX = fromTransform?.poseOffsetX ?? 0;
        const toOffsetX = toTransform?.poseOffsetX ?? fromOffsetX;
        const fromOffsetY = fromTransform?.poseOffsetY ?? 0;
        const toOffsetY = toTransform?.poseOffsetY ?? fromOffsetY;
        const fromLength = fromTransform?.length ?? bone.length;
        const toLength = toTransform?.length ?? fromLength;
        bone.angleCurr = fromAngle + shortestAngleDelta(fromAngle, toAngle) * t;
        bone.poseOffsetX = fromOffsetX + (toOffsetX - fromOffsetX) * t;
        bone.poseOffsetY = fromOffsetY + (toOffsetY - fromOffsetY) * t;
        bone.length = Math.max(5, fromLength + (toLength - fromLength) * t);
      });
      e.pitchX = (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * t;
      e.yawY = (a.yaw || 0) + ((b.yaw || 0) - (a.yaw || 0)) * t;
      e.parallaxX = (a.parX || 0) + ((b.parX || 0) - (a.parX || 0)) * t;
      e.parallaxY = (a.parY || 0) + ((b.parY || 0) - (a.parY || 0)) * t;
    }
    this.forwardKinematics();
    this.updateVertices();
  }

  forwardKinematics() {
    const e = this.engine;
    const visit = (bone) => {
      const angle = bone.angleCurr ?? bone.angleRest;
      bone.displayAngle = angle;
      bone.endCurr = { x: bone.startCurr.x + Math.cos(angle) * bone.length, y: bone.startCurr.y + Math.sin(angle) * bone.length };
      e.bones.filter((child) => child.parentId === bone.id).forEach((child) => {
        child.startCurr = { x: bone.endCurr.x + (child.poseOffsetX || 0), y: bone.endCurr.y + (child.poseOffsetY || 0) };
        visit(child);
      });
    };
    e.bones.filter((bone) => !bone.parentId).forEach((root) => {
      root.startCurr = { x: root.startRest.x + (root.poseOffsetX || 0), y: root.startRest.y + (root.poseOffsetY || 0) };
      visit(root);
    });
  }

  updateVertices() {
    const e = this.engine;
    const centerX = e.imageRect.x + e.imageRect.w / 2, centerY = e.imageRect.y + e.imageRect.h / 2;
    const lissajous = this.animation?.lissajous || {};
    let lissaX = 0, lissaY = 0, lissaParX = 0, lissaParY = 0;
    if (this.lissajousEnabled && lissajous.active) {
      const freqX = lissajous.freqX ?? 1;
      const freqY = lissajous.freqY ?? 2;
      const phase = lissajous.phase ?? 0;
      const ratio = lissajous.ratio ?? 1;
      const intensity = lissajous.intensity ?? 1;
      const t = Date.now() * 0.001;
      const ptX = Math.sin(freqX * t + phase);
      const ptY = Math.sin(freqY * t);
      const rx = ratio > 1 ? 1 / ratio : 1;
      const ry = ratio < 1 ? ratio : 1;
      const padX = ptX * (intensity / 10) * rx;
      const padY = ptY * (intensity / 10) * ry;
      if (lissajous.affects !== 'MESH_ONLY') {
        lissaParX = padX;
        lissaParY = padY;
      }
      if (lissajous.affects === 'BONES_AND_DEPTH' || lissajous.affects === 'MESH_ONLY') {
        lissaX = padX * 100;
        lissaY = padY * 100;
      }
    }
    e.pins.forEach((pin) => {
      if (pin.parentId) {
        const bone = e.bones.find((item) => item.id === pin.parentId);
        if (bone) {
          const angle = bone.displayAngle ?? bone.angleCurr ?? bone.angleRest;
          const cosA = Math.cos(angle), sinA = Math.sin(angle);
          pin.currX = bone.startCurr.x + pin.localX * cosA - pin.localY * sinA;
          pin.currY = bone.startCurr.y + pin.localX * sinA + pin.localY * cosA;
          return;
        }
      }
      pin.currX = pin.restX;
      pin.currY = pin.restY;
    });
    e.jiggles.forEach((jig) => {
      const bone = e.bones.find((item) => item.id === (jig.boneId || jig.parentId));
      let baseAngle = 0, targetX = jig.restX, targetY = jig.restY;
      if (bone) {
        baseAngle = bone.displayAngle ?? bone.angleCurr ?? bone.angleRest;
        const cosA = Math.cos(baseAngle), sinA = Math.sin(baseAngle);
        targetX = bone.startCurr.x + jig.localX * cosA - jig.localY * sinA;
        targetY = bone.startCurr.y + jig.localX * sinA + jig.localY * cosA;
      }
      if (jig.physX === undefined || Number.isNaN(jig.physX)) {
        jig.physX = targetX; jig.physY = targetY; jig.velX = 0; jig.velY = 0;
        jig.physAngle = baseAngle; jig.velAngle = 0;
      }
      const stiffness = jig.stiffness ?? 0.15;
      const damping = jig.damping ?? 0.85;
      jig.velX = ((jig.velX || 0) + (targetX - jig.physX) * stiffness) * damping;
      jig.velY = ((jig.velY || 0) + (targetY - jig.physY) * stiffness) * damping;
      jig.physX += jig.velX;
      jig.physY += jig.velY;
      const lagX = jig.physX - targetX, lagY = jig.physY - targetY;
      const distLag = Math.hypot(lagX, lagY);
      const limit = jig.limit ?? 30;
      if (distLag > limit) {
        jig.physX = targetX + (lagX / distLag) * limit;
        jig.physY = targetY + (lagY / distLag) * limit;
        jig.velX *= 0.5;
        jig.velY *= 0.5;
      }
      const targetAngle = baseAngle - ((jig.physX - targetX) * (jig.rotBouncy ?? 0.02));
      jig.velAngle = ((jig.velAngle || 0) + shortestAngleDelta(jig.physAngle || 0, targetAngle) * stiffness) * damping;
      jig.physAngle = (jig.physAngle || 0) + jig.velAngle;
      const speed = Math.hypot(jig.velX, jig.velY);
      const baseScale = jig.volume ?? 1;
      const targetScaleX = baseScale + speed * (jig.scaleX ?? 0.015);
      const targetScaleY = baseScale + speed * (jig.scaleY ?? -0.015);
      jig.velScaleX = ((jig.velScaleX || 0) + (targetScaleX - (jig.physScaleX || baseScale)) * stiffness) * damping;
      jig.velScaleY = ((jig.velScaleY || 0) + (targetScaleY - (jig.physScaleY || baseScale)) * stiffness) * damping;
      jig.physScaleX = (jig.physScaleX || baseScale) + jig.velScaleX;
      jig.physScaleY = (jig.physScaleY || baseScale) + jig.velScaleY;
    });
    e.verticesCurrent = e.verticesRest.map((v, i) => {
      let x = v.x, y = v.y;
      let totalPinDepthFix = 0;
      if (e.weights[i]?.length) {
        x = 0; y = 0;
        e.weights[i].forEach((w) => {
          if (w.type === 'jiggle') {
            const jig = e.jiggles[w.idx];
            if (!jig) return;
            const angle = jig.physAngle || 0;
            const sx = jig.physScaleX || jig.volume || 1;
            const sy = jig.physScaleY || jig.volume || 1;
            const localX = w.localX * sx;
            const localY = w.localY * sy;
            x += w.w * (localX * Math.cos(angle) - localY * Math.sin(angle) + jig.physX);
            y += w.w * (localX * Math.sin(angle) + localY * Math.cos(angle) + jig.physY);
          } else {
            const bone = e.bones[w.idx];
            const angle = bone.displayAngle ?? bone.angleRest;
            x += w.w * (w.localX * Math.cos(angle) - w.localY * Math.sin(angle) + bone.startCurr.x);
            y += w.w * (w.localX * Math.sin(angle) + w.localY * Math.cos(angle) + bone.startCurr.y);
          }
        });
      }
      if (e.vertexPins[i]?.length) {
        e.vertexPins[i].forEach((vp) => {
          const pin = e.pins[vp.pinIdx];
          const bone = e.bones.find((item) => item.id === pin?.parentId);
          if (!pin || !bone) return;
          const dx = v.x - bone.startRest.x, dy = v.y - bone.startRest.y;
          const localX = dx * Math.cos(-bone.angleRest) - dy * Math.sin(-bone.angleRest);
          const localY = dx * Math.sin(-bone.angleRest) + dy * Math.cos(-bone.angleRest);
          const angle = bone.displayAngle ?? bone.angleRest;
          const rigidX = bone.startCurr.x + localX * Math.cos(angle) - localY * Math.sin(angle);
          const rigidY = bone.startCurr.y + localX * Math.sin(angle) + localY * Math.cos(angle);
          const weight = Math.min(1, vp.w * (pin.intensity ?? 1) * (pin.posIntensity ?? 1));
          x += (rigidX - x) * weight;
          y += (rigidY - y) * weight;
          totalPinDepthFix += vp.w * (pin.depthFix ?? 0.8);
        });
      }
      x += lissaX;
      y -= lissaY;
      const deformOffsetZ = Math.hypot(x - v.x, y - v.y) * (e.deformZIntensity ?? 0.5);
      const normY = (v.y - e.imageRect.y) / e.imageRect.h;
      let normZ = (v.z ?? 128) / 255;
      if (e.invertDepth) normZ = 1 - normZ;
      normZ = Math.pow(normZ, e.depthGamma || 1);
      if ((e.depthMapSmoothness ?? 0) > 0) {
        const s = e.depthMapSmoothness / 2;
        normZ = smoothstep(0.5 - s, 0.5 + s, normZ);
      }
      if ((e.edgeDepth ?? 0) > 0 && v.edgeDist !== undefined) {
        const edgeFactor = smoothstep(0, 1, Math.min(1, v.edgeDist / Math.max(0.01, e.edgeBevel ?? 0.05)));
        normZ = Math.max(0, normZ - e.edgeDepth * (1 - edgeFactor));
      }
      let mask = 1 - smoothstep((e.depthGradientY || 0.85) - (e.depthGradientSmoothness || 0.4) / 2, (e.depthGradientY || 0.85) + (e.depthGradientSmoothness || 0.4) / 2, normY);
      mask *= Math.max(0, 1 - Math.min(1, totalPinDepthFix));
      if (this.lissajousEnabled && lissajous.active) normZ += (lissaX * 0.05 + lissaY * 0.05) * mask;
      let zOffset = (0.5 - normZ) * 2 * (e.depthMultiplier ?? 1) * mask * 80;
      zOffset -= deformOffsetZ * mask;
      const yaw = (e.yawY || 0) * Math.PI / 4 * mask, pitch = (e.pitchX || 0) * Math.PI / 4 * mask;
      const lx = x - centerX, ly = y - centerY;
      let x2 = lx * Math.cos(yaw) - zOffset * Math.sin(yaw) + zOffset * ((e.parallaxX || 0) + lissaParX) * 1.5;
      const z2 = lx * Math.sin(yaw) + zOffset * Math.cos(yaw);
      let y3 = ly * Math.cos(pitch) + z2 * Math.sin(pitch) + zOffset * ((e.parallaxY || 0) + lissaParY) * 1.5;
      const z3 = -ly * Math.sin(pitch) + z2 * Math.cos(pitch);
      const perspective = 600;
      const scale = perspective / (perspective + z3);
      return { x: centerX + x2 * scale, y: centerY + y3 * scale };
    });
  }

  getViewportTransform() {
    const rect = this.engine.imageRect;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ax = this.anchor.includes('left') ? 0 : this.anchor.includes('right') ? 1 : 0.5;
    const ay = this.anchor.includes('top') ? 0 : this.anchor.includes('bottom') ? 1 : 0.5;
    let sx = 1, sy = 1;
    if (this.scaleMode === 'contain') sx = sy = Math.min(cw / rect.w, ch / rect.h);
    else if (this.scaleMode === 'cover') sx = sy = Math.max(cw / rect.w, ch / rect.h);
    else if (this.scaleMode === 'stretch') {
      sx = cw / rect.w;
      sy = ch / rect.h;
    }
    sx *= this.displayScale;
    sy *= this.displayScale;
    return { sx, sy, tx: cw * ax - (rect.x + rect.w * ax) * sx, ty: ch * ay - (rect.y + rect.h * ay) * sy };
  }

  applyViewport(ctx) {
    const t = this.getViewportTransform();
    ctx.setTransform(t.sx, 0, 0, t.sy, t.tx, t.ty);
  }

  drawDebug() {
    const e = this.engine, ctx = this.ctx, mode = this.debugMode;
    if (mode < 0) return;
    ctx.save();
    this.applyViewport(ctx);
    ctx.font = '11px sans-serif';
    if (mode === 0) {
      ctx.strokeStyle = '#22c55e';
      ctx.fillStyle = '#fde047';
      e.bones.forEach((bone, i) => {
        const start = bone.startCurr || bone.startRest, end = bone.endCurr || bone.endRest;
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
        ctx.fillText(String(i), end.x, end.y);
      });
    } else if (mode === 1) {
      ctx.strokeStyle = '#ec4899';
      ctx.fillStyle = '#fde047';
      e.jiggles.forEach((jig, i) => {
        ctx.beginPath(); ctx.ellipse(jig.physX || jig.restX, jig.physY || jig.restY, jig.rx, jig.ry, 0, 0, TAU); ctx.stroke();
        ctx.fillText(String(i), jig.physX || jig.restX, jig.physY || jig.restY);
      });
    } else if (mode === 2) {
      ctx.strokeStyle = '#38bdf8';
      ctx.fillStyle = '#fde047';
      e.pins.forEach((pin, i) => {
        ctx.beginPath(); ctx.arc(pin.currX || pin.restX, pin.currY || pin.restY, pin.radius, 0, TAU); ctx.stroke();
        ctx.fillText(String(i), pin.currX || pin.restX, pin.currY || pin.restY);
      });
    } else {
      e.triangles.forEach((tri) => {
        const p1 = e.verticesCurrent[tri[0]], p2 = e.verticesCurrent[tri[1]], p3 = e.verticesCurrent[tri[2]];
        const t1 = e.verticesRest[tri[0]], t2 = e.verticesRest[tri[1]], t3 = e.verticesRest[tri[2]];
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
        if (mode === 5) {
          const y = ((t1.y + t2.y + t3.y) / 3 - e.imageRect.y) / e.imageRect.h;
          const mask = 1 - smoothstep((e.depthGradientY || 0.85) - (e.depthGradientSmoothness || 0.4) / 2, (e.depthGradientY || 0.85) + (e.depthGradientSmoothness || 0.4) / 2, y);
          ctx.fillStyle = `rgba(${Math.floor(mask * 255)},50,${255 - Math.floor(mask * 255)},0.65)`;
          ctx.fill();
        } else if (mode === 6) {
          const z = Math.floor(((t1.z || 128) + (t2.z || 128) + (t3.z || 128)) / 3);
          ctx.fillStyle = `rgb(${z},${z},${z})`;
          ctx.fill();
        }
        ctx.strokeStyle = mode === 4 ? 'rgba(250,204,21,0.85)' : 'rgba(255,255,255,0.45)';
        ctx.stroke();
      });
      if (mode === 4) {
        ctx.fillStyle = '#fde047';
        e.verticesCurrent.forEach((v, i) => ctx.fillText(String(i), v.x, v.y));
      }
    }
    ctx.restore();
  }

  render() {
    const e = this.engine, ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    this.applyViewport(ctx);
    if (e.image && this.debugMode !== 5 && this.debugMode !== 6) e.triangles.forEach((tri) => drawTexturedTriangle(ctx, e.image, e.imageRect, e.verticesCurrent[tri[0]], e.verticesCurrent[tri[1]], e.verticesCurrent[tri[2]], e.verticesRest[tri[0]], e.verticesRest[tri[1]], e.verticesRest[tri[2]]));
    ctx.restore();
    this.drawDebug();
  }
}

window.AnimatitaPlayer = AnimatitaPlayer;
