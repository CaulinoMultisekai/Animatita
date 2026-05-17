import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, 'animatita-player.js');
const outDir = resolve(here, '../../dist/player');
const outFile = resolve(outDir, 'animatita-player.js');
const exampleFile = resolve(outDir, 'example.html');

await mkdir(outDir, { recursive: true });
const playerSource = await readFile(source, 'utf8');
const exportableSnippets = [
  'TAU',
  'smoothstep',
  'shortestAngleDelta',
  'distPointToSegment',
  'delaunayTriangulate',
  'drawTexturedTriangle',
  'loadImage'
];
const replaceRequired = (sourceText, oldText, newText) => {
  if (!sourceText.includes(oldText)) {
    throw new Error(`Player generation optimization target not found:\n${oldText.slice(0, 120)}`);
  }
  return sourceText.replace(oldText, newText);
};

const replaceMethod = (sourceText, methodName, newMethod) => {
  const marker = `  ${methodName}(`;
  const start = sourceText.indexOf(marker);
  if (start === -1) throw new Error(`Player method not found: ${methodName}`);
  let depth = 0;
  let seenBody = false;
  for (let end = start; end < sourceText.length; end++) {
    if (sourceText[end] === '{') {
      depth++;
      seenBody = true;
    } else if (sourceText[end] === '}') {
      depth--;
      if (seenBody && depth === 0) {
        return `${sourceText.slice(0, start)}${newMethod}${sourceText.slice(end + 1)}`;
      }
    }
  }
  throw new Error(`Player method body not closed: ${methodName}`);
};

const applyV2Optimizations = (sourceText) => {
  let output = sourceText;

  output = replaceRequired(
    output,
    `const drawTexturedTriangle = (ctx, img, imgRect, p0, p1, p2, t0, t1, t2) => {
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
  ctx.closePath();`,
    `const drawTexturedTriangle = (ctx, img, imgRect, p0, p1, p2, t0, t1, t2, screenScale = 1) => {
  const cx = (p0.x + p1.x + p2.x) * 0.33333333;
  const cy = (p0.y + p1.y + p2.y) * 0.33333333;
  const pad = 1.35 / screenScale;

  const dx0 = p0.x - cx, dy0 = p0.y - cy;
  const len0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 0.001;
  const sf0 = (len0 + pad) / len0;
  const cp0x = cx + dx0 * sf0, cp0y = cy + dy0 * sf0;

  const dx1 = p1.x - cx, dy1 = p1.y - cy;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 0.001;
  const sf1 = (len1 + pad) / len1;
  const cp1x = cx + dx1 * sf1, cp1y = cy + dy1 * sf1;

  const dx2 = p2.x - cx, dy2 = p2.y - cy;
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 0.001;
  const sf2 = (len2 + pad) / len2;
  const cp2x = cx + dx2 * sf2, cp2y = cy + dy2 * sf2;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cp0x, cp0y);
  ctx.lineTo(cp1x, cp1y);
  ctx.lineTo(cp2x, cp2y);
  ctx.closePath();`
  );

  output = replaceRequired(output, `  img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
});`, `  img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  if (img.complete) resolve(img);
});`);

  output = replaceRequired(output, `    this.densityScale = 1;`, `    this.densityScale = 0.6;`);
  output = replaceRequired(output, `    this.engine.image = await loadImage(image);
    this.engine.depthImage = await loadImage(depth);
    this.remesh();`, `    const imgPromise = loadImage(image);
    const depthPromise = loadImage(depth);
    this.engine.image = await imgPromise;
    this.engine.depthImage = await depthPromise;
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    await new Promise((resolveTask) => setTimeout(resolveTask, 0));
    this.remesh();`);

  output = replaceRequired(output, `    }
  }

  createMorphologicalGrid`, `    }
    e.verticesCurrent = e.verticesRest.map((v) => ({ x: v.x, y: v.y }));
  }

  createMorphologicalGrid`);

  output = replaceRequired(output, `    const oc = document.createElement('canvas');
    oc.width = Math.max(1, Math.floor(w));
    oc.height = Math.max(1, Math.floor(h));
    const octx = oc.getContext('2d');
    octx.drawImage(e.image, 0, 0, oc.width, oc.height);`, `    const boneMap = new Map(e.bones.map((bone) => [bone.id, bone]));
    const analysisScale = Math.min(1, 512 / Math.max(w, h));
    const oc = document.createElement('canvas');
    oc.width = Math.max(1, Math.floor(w * analysisScale));
    oc.height = Math.max(1, Math.floor(h * analysisScale));
    const octx = oc.getContext('2d');
    if (oc.width <= 0 || oc.height <= 0) {
      this.remeshGrid();
      return;
    }
    octx.drawImage(e.image, 0, 0, oc.width, oc.height);`);

  output = replaceRequired(output, `        e.verticesRest = unique;
        e.triangles = triangles;
        return;`, `        e.verticesRest = unique;
        e.triangles = triangles;
        e.verticesCurrent = e.verticesRest.map((v) => ({ x: v.x, y: v.y }));
        return;`);

  output = replaceRequired(output, `    const oc = document.createElement('canvas');
    oc.width = Math.max(1, Math.floor(w));
    oc.height = Math.max(1, Math.floor(h));
    const octx = oc.getContext('2d');
    octx.drawImage(e.image, 0, 0, oc.width, oc.height);`, `    const analysisScale = Math.min(1, 256 / Math.max(w, h));
    const oc = document.createElement('canvas');
    oc.width = Math.max(1, Math.floor(w * analysisScale));
    oc.height = Math.max(1, Math.floor(h * analysisScale));
    const octx = oc.getContext('2d');
    if (oc.width <= 0 || oc.height <= 0) {
      oc.width = 1;
      oc.height = 1;
      return;
    }
    octx.drawImage(e.image, 0, 0, oc.width, oc.height);`);

  output = replaceRequired(output, `    if ((e.depthBlur || 0) > 0) octx.filter = \`blur(\${e.depthBlur}px)\`;
    octx.drawImage(e.depthImage, 0, 0);`, `    if ((e.depthBlur || 0) > 0) octx.filter = \`blur(\${e.depthBlur}px)\`;
    if (oc.width <= 0 || oc.height <= 0) {
      oc.width = 1;
      oc.height = 1;
      return;
    }
    octx.drawImage(e.depthImage, 0, 0);`);

  output = replaceRequired(output, `      v.z = imgData[(py * oc.width + px) * 4];
    });`, `      v.z = imgData[(py * oc.width + px) * 4];
      v._normY = (v.y - this.engine.imageRect.y) / this.engine.imageRect.h;
      v._baseNormZ = (v.z ?? 128) / 255;
    });`);

  output = replaceRequired(output, `      e.vertexPins.push(vPins);
    });
  }`, `      e.vertexPins.push(vPins);

      const depthGradY = e.depthGradientY || 0.85;
      const depthGradSmooth = (e.depthGradientSmoothness || 0.4) / 2;
      let normZ = v._baseNormZ ?? ((v.z ?? 128) / 255);
      if (e.invertDepth) normZ = 1 - normZ;
      if (e.depthGamma && e.depthGamma !== 1) normZ = Math.pow(normZ, e.depthGamma);
      if ((e.depthMapSmoothness ?? 0) > 0) {
        const s = e.depthMapSmoothness / 2;
        const xVal = (normZ - (0.5 - s)) / ((0.5 + s) - (0.5 - s));
        const tx = Math.max(0, Math.min(1, xVal));
        normZ = tx * tx * (3 - 2 * tx);
      }
      if ((e.edgeDepth ?? 0) > 0 && v.edgeDist !== undefined) {
        const edgeFactor = smoothstep(0, 1, Math.min(1, v.edgeDist / Math.max(0.01, e.edgeBevel ?? 0.05)));
        normZ = Math.max(0, normZ - e.edgeDepth * (1 - edgeFactor));
      }
      v._normZ = normZ;

      let totalPinDepthFix = 0;
      vPins.forEach((vp) => {
        const pin = e.pins[vp.pinIdx];
        if (pin) totalPinDepthFix += vp.w * (pin.depthFix ?? 0.8);
      });
      let mask = 1 - smoothstep(depthGradY - depthGradSmooth, depthGradY + depthGradSmooth, v._normY ?? ((v.y - e.imageRect.y) / e.imageRect.h));
      mask *= Math.max(0, 1 - Math.min(1, totalPinDepthFix));
      v._mask = mask;
    });
  }`);

  output = output.replace(`  bindMesh() {
    const e = this.engine;
    e.weights = [];`, `  bindMesh() {
    const e = this.engine;
    const boneMap = new Map(e.bones.map((bone) => [bone.id, bone]));
    e.weights = [];`);

  output = replaceMethod(output, 'update', `  update(dt) {
    const pStart = performance.now();
    this.elapsed = (this.elapsed || 0) + dt * this.speedScale;
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
    if (window.__perfMetrics) {
      const dur = performance.now() - pStart;
      window.__perfMetrics.portraitUpdate = ((window.__perfMetrics.portraitUpdate || 0) * 0.95) + (dur * 0.05);
    }
  }`);

  output = output.replace(`const t = Date.now() * 0.001;`, `const t = this.elapsed || 0;`);
  output = output.replace(`    const centerX = e.imageRect.x + e.imageRect.w / 2, centerY = e.imageRect.y + e.imageRect.h / 2;`, `    const boneMap = new Map();
    e.bones.forEach((bone) => {
      boneMap.set(bone.id, bone);
      const angle = bone.displayAngle ?? bone.angleCurr ?? bone.angleRest;
      bone._cosA = Math.cos(angle);
      bone._sinA = Math.sin(angle);
      bone._cosRest = Math.cos(-bone.angleRest);
      bone._sinRest = Math.sin(-bone.angleRest);
    });
    const centerX = e.imageRect.x + e.imageRect.w / 2, centerY = e.imageRect.y + e.imageRect.h / 2;`);
  output = output.replaceAll(`e.bones.find((item) => item.id === pin.parentId)`, `boneMap.get(pin.parentId)`);
  output = output.replaceAll(`e.bones.find((item) => item.id === (jig.boneId || jig.parentId))`, `boneMap.get(jig.boneId || jig.parentId)`);
  output = output.replaceAll(`e.bones.find((item) => item.id === pin?.parentId)`, `boneMap.get(pin?.parentId)`);
  output = output.replace(`      jig.physScaleX = (jig.physScaleX || baseScale) + jig.velScaleX;
      jig.physScaleY = (jig.physScaleY || baseScale) + jig.velScaleY;
    });
    e.verticesCurrent = e.verticesRest.map((v, i) => {`, `      jig.physScaleX = (jig.physScaleX || baseScale) + jig.velScaleX;
      jig.physScaleY = (jig.physScaleY || baseScale) + jig.velScaleY;
      jig._cosA = Math.cos(jig.physAngle || 0);
      jig._sinA = Math.sin(jig.physAngle || 0);
      jig._sx = jig.physScaleX || jig.volume || 1;
      jig._sy = jig.physScaleY || jig.volume || 1;
    });
    e.verticesCurrent = e.verticesRest.map((v, i) => {`);
  output = output.replace(`            const angle = jig.physAngle || 0;
            const sx = jig.physScaleX || jig.volume || 1;
            const sy = jig.physScaleY || jig.volume || 1;
            const localX = w.localX * sx;
            const localY = w.localY * sy;
            x += w.w * (localX * Math.cos(angle) - localY * Math.sin(angle) + jig.physX);
            y += w.w * (localX * Math.sin(angle) + localY * Math.cos(angle) + jig.physY);`, `            const localX = w.localX * jig._sx;
            const localY = w.localY * jig._sy;
            x += w.w * (localX * jig._cosA - localY * jig._sinA + jig.physX);
            y += w.w * (localX * jig._sinA + localY * jig._cosA + jig.physY);`);
  output = output.replace(`            const angle = bone.displayAngle ?? bone.angleRest;
            x += w.w * (w.localX * Math.cos(angle) - w.localY * Math.sin(angle) + bone.startCurr.x);
            y += w.w * (w.localX * Math.sin(angle) + w.localY * Math.cos(angle) + bone.startCurr.y);`, `            x += w.w * (w.localX * bone._cosA - w.localY * bone._sinA + bone.startCurr.x);
            y += w.w * (w.localX * bone._sinA + w.localY * bone._cosA + bone.startCurr.y);`);
  output = output.replace(`          const localX = dx * Math.cos(-bone.angleRest) - dy * Math.sin(-bone.angleRest);
          const localY = dx * Math.sin(-bone.angleRest) + dy * Math.cos(-bone.angleRest);
          const angle = bone.displayAngle ?? bone.angleRest;
          const rigidX = bone.startCurr.x + localX * Math.cos(angle) - localY * Math.sin(angle);
          const rigidY = bone.startCurr.y + localX * Math.sin(angle) + localY * Math.cos(angle);`, `          const localX = dx * bone._cosRest - dy * bone._sinRest;
          const localY = dx * bone._sinRest + dy * bone._cosRest;
          const rigidX = bone.startCurr.x + localX * bone._cosA - localY * bone._sinA;
          const rigidY = bone.startCurr.y + localX * bone._sinA + localY * bone._cosA;`);
  output = output.replace(`      const normY = (v.y - e.imageRect.y) / e.imageRect.h;
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
      mask *= Math.max(0, 1 - Math.min(1, totalPinDepthFix));`, `      let normZ = v._normZ ?? ((v.z ?? 128) / 255);
      let mask = v._mask ?? 1;
      mask *= Math.max(0, 1 - Math.min(1, totalPinDepthFix));`);

  output = replaceMethod(output, 'render', `  render() {
    const pStart = performance.now();
    const e = this.engine, ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    this.applyViewport(ctx);
    const transform = ctx.getTransform();
    const screenScale = Math.max(0.001, Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d));
    if (e.image && this.debugMode !== 5 && this.debugMode !== 6) {
      const len = e.triangles.length;
      const vc = e.verticesCurrent;
      const vr = e.verticesRest;
      for (let i = 0; i < len; i++) {
        const tri = e.triangles[i];
        drawTexturedTriangle(ctx, e.image, e.imageRect, vc[tri[0]], vc[tri[1]], vc[tri[2]], vr[tri[0]], vr[tri[1]], vr[tri[2]], screenScale);
      }
    }
    ctx.restore();
    this.drawDebug();
    if (window.__perfMetrics) {
      const dur = performance.now() - pStart;
      window.__perfMetrics.portraitRender = ((window.__perfMetrics.portraitRender || 0) * 0.95) + (dur * 0.05);
    }
  }`);

  return output;
};

const optimizedPlayerSource = applyV2Optimizations(playerSource);
const playerBundle = optimizedPlayerSource.replace(
  new RegExp(`^(?!export\\s)const (${exportableSnippets.join('|')})\\b`, 'gm'),
  'export const $1'
);
await writeFile(outFile, playerBundle, 'utf8');
await writeFile(exampleFile, `<!doctype html>
<meta charset="utf-8">
<canvas id="stage" width="800" height="800"></canvas>
<script type="module">
  import { AnimatitaPlayer } from './animatita-player.js';

  const player = new AnimatitaPlayer(document.getElementById('stage'));
  window.player = player;
  // await player.load(characterJsonFileOrUrlOrText, imageFileOrUrl, optionalDepthFileOrUrl);
  // player.setMeshDensity(0.5);
  // player.setAnimationSpeed(1.25);
  // player.setDebug(true);
  // player.setAnimation('default');
  // player.play();
</script>
`, 'utf8');

console.log(`Generated ${outFile}`);
