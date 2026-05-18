import React, { useState, useEffect, useRef } from 'react';
import { readPsd, initializeCanvas } from 'ag-psd';
import { LissajousVisualizer } from './components/LissajousVisualizer';
import { Pad2D } from './components/Pad2D';
import { JIGGLE_PRESETS } from './constants/jigglePresets';
import { createInitialEngine } from './engine/initialEngine';
import { drawTexturedTriangle } from './utils/canvas';
import { delaunayTriangulate, distPointToSegment, hslToRgb, smoothstep } from './utils/math';
import { AnimatitaPlayer } from '../dist/player/animatita-player.js';

const BONE_COLOR_PALETTE = [
    ['Red', '#ef4444'], ['Blue', '#3b82f6'], ['Green', '#22c55e'], ['Yellow', '#eab308'],
    ['Magenta', '#d946ef'], ['Cyan', '#06b6d4'], ['Orange', '#f97316'], ['Violet', '#8b5cf6'],
    ['Lime', '#84cc16'], ['Pink', '#ec4899'], ['Teal', '#14b8a6'], ['Indigo', '#6366f1'],
    ['Light Red', '#fca5a5'], ['Light Blue', '#93c5fd'], ['Light Green', '#86efac'], ['Light Yellow', '#fde68a'],
    ['Light Magenta', '#f0abfc'], ['Light Cyan', '#67e8f9'], ['Light Orange', '#fdba74'], ['Light Violet', '#c4b5fd'],
    ['Light Lime', '#bef264'], ['Light Pink', '#f9a8d4'], ['Light Teal', '#5eead4'], ['Light Indigo', '#a5b4fc'],
    ['Dark Red', '#991b1b'], ['Dark Blue', '#1e40af'], ['Dark Green', '#166534'], ['Dark Yellow', '#a16207'],
    ['Dark Magenta', '#86198f'], ['Dark Cyan', '#0e7490'], ['Dark Orange', '#c2410c'], ['Dark Violet', '#5b21b6'],
    ['Dark Lime', '#4d7c0f'], ['Dark Pink', '#be185d'], ['Dark Teal', '#0f766e'], ['Dark Indigo', '#3730a3']
];

initializeCanvas(
    (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    },
    (width, height) => new ImageData(width, height)
);

export default function AnimatorApp() {
    const canvasRef = useRef(null);
    const playerPreviewCanvasRef = useRef(null);
    const playerPreviewRef = useRef(null);
    const containerRef = useRef(null);
    const timelineRef = useRef(null);
    const [, setForceRender] = useState(0); 
    
    // UI States
    const [uiMode, setUiMode] = useState('EDIT');
    const [editTool, setEditTool] = useState('BONE'); 
    const [selectedItem, setSelectedItem] = useState(null); 
    const [cursorStyle, setCursorStyle] = useState('crosshair');
    const [leftPanelTab, setLeftPanelTab] = useState('MESH');
    const [utilityPanelTab, setUtilityPanelTab] = useState('IO');
    const [layers, setLayers] = useState([]);
    const [activeLayerId, setActiveLayerId] = useState(null);
    const [hierarchyVersion, setHierarchyVersion] = useState(0);
    const [inactiveLayerOpacity, setInactiveLayerOpacity] = useState(0.35);
    const [dragLayerId, setDragLayerId] = useState(null);
    
    const [gridSize, setGridSize] = useState(15);
    const [edgeDensity, setEdgeDensity] = useState(1.0);
    const [wireframe, setWireframe] = useState(true);
    const [meshType, setMeshType] = useState('OPTIMIZED');
    
    const [showWeights, setShowWeights] = useState(false);
    const [showDepthMask, setShowDepthMask] = useState(false);
    const [showDepthView, setShowDepthView] = useState(false);
    const [showBones, setShowBones] = useState(true);
    const [showJiggles, setShowJiggles] = useState(true);
    const [showPins, setShowPins] = useState(true);
    const [borderOffset, setBorderOffset] = useState(0); 
    
    // 3D & Depth State
    const [useMouseRotation, setUseMouseRotation] = useState(false);
    const [useMouseParallax, setUseMouseParallax] = useState(false);
    const [mouseRotationIntensity, setMouseRotationIntensity] = useState(0.25);
    const [mouseParallaxIntensity, setMouseParallaxIntensity] = useState(0.25);
    const [depthGamma, setDepthGamma] = useState(0.3);
    const [depthMultiplier, setDepthMultiplier] = useState(0.2);
    const [invertDepth, setInvertDepth] = useState(false);
    const [depthBlur, setDepthBlur] = useState(0);
    const [depthMapSmoothness, setDepthMapSmoothness] = useState(0.0);
    const [edgeDepth, setEdgeDepth] = useState(0.0);
    const [edgeBevel, setEdgeBevel] = useState(0.05);
    const [depthGradientY, setDepthGradientY] = useState(0.85);
    const [depthGradientSmoothness, setDepthGradientSmoothness] = useState(0.4);
    const [deformZIntensity, setDeformZIntensity] = useState(0.5);

    // Anim Procedural (Lissajous)
    const [lissajousActive, setLissajousActive] = useState(false);
    const [lissajousFreqX, setLissajousFreqX] = useState(1);
    const [lissajousFreqY, setLissajousFreqY] = useState(2);
    const [lissajousPhase, setLissajousPhase] = useState(0);
    const [lissajousRatio, setLissajousRatio] = useState(1.0);
    const [lissajousIntensity, setLissajousIntensity] = useState(1.0);
    const [lissajousAffects, setLissajousAffects] = useState('DEPTH_ONLY'); // 'DEPTH_ONLY' or 'BONES_AND_DEPTH'

    // Transform Tool
    const [transformTool, setTransformTool] = useState('ROTATE');
    
    // Physics Globals
    const [useBonePhysics, setUseBonePhysics] = useState(true);
    const [secPhysStiffness, setSecPhysStiffness] = useState(0.15);
    const [secPhysDamping, setSecPhysDamping] = useState(0.85);

    // A/B Testing
    const [keyframes, setKeyframes] = useState([]);
    const [selectedKeyframe, setSelectedKeyframe] = useState(0);
    const [autoRecord, setAutoRecord] = useState(true);
    const [interpolation, setInterpolation] = useState('SMOOTH');
    const [pingPong, setPingPong] = useState(true);
    const [animPlaying, setAnimPlaying] = useState(false);
    const [animSpeedMult, setAnimSpeedMult] = useState(1.5);
    const [animations, setAnimations] = useState([]);
    const [currentAnimationTitle, setCurrentAnimationTitle] = useState('default');
    const [rangeHud, setRangeHud] = useState(null);

    // Motor State Ref
    const engine = useRef(createInitialEngine()).current;
    const fineRangeDrag = useRef(null);
    const layersRef = useRef([]);
    const activeLayerIdRef = useRef(null);
    const layerImageCache = useRef({});
    const uiModeRef = useRef(uiMode);

    const getBoneColorInfo = (bone, fallbackIndex = 0) => {
        const paletteIndex = bone?.colorIndex ?? fallbackIndex;
        const [name, color] = BONE_COLOR_PALETTE[((paletteIndex % BONE_COLOR_PALETTE.length) + BONE_COLOR_PALETTE.length) % BONE_COLOR_PALETTE.length];
        return {
            name: bone?.name || `${name} Bone`,
            color: bone?.color || color,
            paletteName: name,
            colorIndex: paletteIndex
        };
    };

    const createBoneLabel = () => {
        const index = engine.bones.length;
        const [name, color] = BONE_COLOR_PALETTE[index % BONE_COLOR_PALETTE.length];
        const suffix = Math.floor(index / BONE_COLOR_PALETTE.length) + 1;
        return {
            name: suffix > 1 ? `${name} Bone ${suffix}` : `${name} Bone`,
            color,
            colorIndex: index
        };
    };

    const normalizeBoneLabels = () => {
        engine.bones.forEach((bone, index) => {
            const info = getBoneColorInfo(bone, index);
            bone.name = info.name;
            bone.color = info.color;
            bone.colorIndex = info.colorIndex;
        });
    };

    const syncActiveLayerSnapshot = () => {
        const id = activeLayerIdRef.current;
        if (!id) return;
        const activeLayer = layersRef.current.find(layer => layer.id === id);
        const targetId = activeLayer?.boneSourceId || id;
        const targetLayer = layersRef.current.find(layer => layer.id === targetId) || activeLayer;
        const dx = (targetLayer?.imageRect?.x || 0) - (activeLayer?.imageRect?.x || 0);
        const dy = (targetLayer?.imageRect?.y || 0) - (activeLayer?.imageRect?.y || 0);
        const offsetPoint = (pt) => pt ? ({ ...pt, x: pt.x + dx, y: pt.y + dy }) : pt;
        const previewSrc = captureActiveLayerRender();
        layersRef.current = layersRef.current.map(layer => {
            if (layer.id !== targetId) {
                if (layer.id === id) {
                    return {
                        ...layer,
                        previewSrc: previewSrc || layer.previewSrc,
                        imageRect: { ...engine.imageRect },
                        meshOffsetX: engine.meshOffsetX || 0,
                        meshOffsetY: engine.meshOffsetY || 0,
                        meshRotation: engine.meshRotation || 0,
                        meshScale: engine.meshScale || 1,
                        verticesRest: engine.verticesRest ? engine.verticesRest.map(v => ({ ...v })) : [],
                        verticesCurrent: engine.verticesCurrent ? engine.verticesCurrent.map(v => ({ ...v })) : [],
                        triangles: engine.triangles ? engine.triangles.map(t => [...t]) : [],
                        weights: engine.weights ? engine.weights.map(w => w.map(o => ({ ...o }))) : [],
                        vertexPins: engine.vertexPins ? engine.vertexPins.map(p => p.map(o => ({ ...o }))) : []
                    };
                }
                return layer;
            }
            return {
                ...layer,
                previewSrc: layer.id === id ? (previewSrc || layer.previewSrc) : layer.previewSrc,
                bones: engine.bones.map(b => ({ ...b, startRest: offsetPoint(b.startRest), endRest: offsetPoint(b.endRest), startCurr: offsetPoint(b.startCurr), endCurr: offsetPoint(b.endCurr) })),
                jiggles: engine.jiggles.map(j => ({ ...j, restX: (j.restX || 0) + dx, restY: (j.restY || 0) + dy, physX: (j.physX || j.restX || 0) + dx, physY: (j.physY || j.restY || 0) + dy })),
                pins: engine.pins.map(p => ({ ...p, restX: (p.restX || 0) + dx, restY: (p.restY || 0) + dy, currX: p.currX !== undefined ? p.currX + dx : p.currX, currY: p.currY !== undefined ? p.currY + dy : p.currY })),
                imageRect: { ...engine.imageRect },
                meshOffsetX: engine.meshOffsetX || 0,
                meshOffsetY: engine.meshOffsetY || 0,
                meshRotation: engine.meshRotation || 0,
                meshScale: engine.meshScale || 1,
                verticesRest: engine.verticesRest ? engine.verticesRest.map(v => ({ ...v })) : [],
                verticesCurrent: engine.verticesCurrent ? engine.verticesCurrent.map(v => ({ ...v })) : [],
                triangles: engine.triangles ? engine.triangles.map(t => [...t]) : [],
                weights: engine.weights ? engine.weights.map(w => w.map(o => ({ ...o }))) : [],
                vertexPins: engine.vertexPins ? engine.vertexPins.map(p => p.map(o => ({ ...o }))) : []
            };
        });
        setLayers(layersRef.current);
    };

    const loadImageFromSrc = (src) => new Promise((resolve) => {
        if (!src) return resolve(null);
        if (layerImageCache.current[src]) return resolve(layerImageCache.current[src]);
        const img = new Image();
        img.onload = () => {
            layerImageCache.current[src] = img;
            resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });

    const captureActiveLayerRender = () => {
        const id = activeLayerIdRef.current;
        const activeLayer = layersRef.current.find(layer => layer.id === id);
        if (!id || !activeLayer || activeLayer.isStatic) return null;
        const canvas = canvasRef.current;
        if (!canvas || !engine.image || !engine.imageRect) return null;
        const out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = canvas.height;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (engine.triangles.length > 0 && engine.verticesCurrent.length > 0) {
            engine.triangles.forEach(tri => {
                const p1 = engine.verticesCurrent[tri[0]];
                const p2 = engine.verticesCurrent[tri[1]];
                const p3 = engine.verticesCurrent[tri[2]];
                const t1 = engine.verticesRest[tri[0]];
                const t2 = engine.verticesRest[tri[1]];
                const t3 = engine.verticesRest[tri[2]];
                if (p1 && p2 && p3 && t1 && t2 && t3) drawTexturedTriangle(ctx, engine.image, engine.imageRect, p1, p2, p3, t1, t2, t3);
            });
        } else {
            ctx.drawImage(engine.image, engine.imageRect.x, engine.imageRect.y, engine.imageRect.w, engine.imageRect.h);
        }
        const dataUrl = out.toDataURL('image/png');
        const img = new Image();
        img.src = dataUrl;
        layerImageCache.current[dataUrl] = img;
        return dataUrl;
    };

    const applyLayer = async (layerId) => {
        syncActiveLayerSnapshot();
        const layer = layersRef.current.find(l => l.id === layerId);
        if (!layer) return;
        const sourceLayer = layer.boneSourceId && layer.boneSourceId !== layer.id
            ? layersRef.current.find(l => l.id === layer.boneSourceId) || layer
            : layer;
        const rigDx = 0;
        const rigDy = 0;
        const offsetPoint = (pt) => pt ? ({ ...pt, x: pt.x + rigDx, y: pt.y + rigDy }) : pt;
        const [image, depthImage] = await Promise.all([loadImageFromSrc(layer.imageSrc), loadImageFromSrc(layer.depthSrc)]);
        if (image) engine.image = image;
        engine.depthImage = depthImage;
        engine.imageRect = layer.imageRect || {
            x: Math.max(0, ((canvasRef.current?.width || 800) - layer.width) / 2),
            y: Math.max(0, ((canvasRef.current?.height || 600) - layer.height) / 2),
            w: layer.width,
            h: layer.height
        };
        engine.meshOffsetX = layer.meshOffsetX || 0;
        engine.meshOffsetY = layer.meshOffsetY || 0;
        engine.meshRotation = layer.meshRotation || 0;
        engine.meshScale = layer.meshScale || 1;
        engine.bones = (sourceLayer.bones || []).map(b => ({ ...b, startRest: offsetPoint(b.startRest), endRest: offsetPoint(b.endRest), startCurr: offsetPoint(b.startCurr), endCurr: offsetPoint(b.endCurr) }));
        engine.jiggles = (sourceLayer.jiggles || []).map(j => ({ ...j, restX: (j.restX || 0) + rigDx, restY: (j.restY || 0) + rigDy, physX: (j.physX || j.restX || 0) + rigDx, physY: (j.physY || j.restY || 0) + rigDy }));
        engine.pins = (sourceLayer.pins || []).map(p => ({ ...p, restX: (p.restX || 0) + rigDx, restY: (p.restY || 0) + rigDy, currX: p.currX !== undefined ? p.currX + rigDx : p.currX, currY: p.currY !== undefined ? p.currY + rigDy : p.currY }));
        activeLayerIdRef.current = layerId;
        setActiveLayerId(layerId);
        setSelectedItem(null);
        if (layer.verticesRest && layer.verticesRest.length > 0) {
            engine.verticesRest = layer.verticesRest.map(v => ({ ...v }));
            engine.verticesCurrent = layer.verticesCurrent ? layer.verticesCurrent.map(v => ({ ...v })) : engine.verticesRest.map(v => ({ ...v }));
            engine.triangles = layer.triangles ? layer.triangles.map(t => [...t]) : [];
            engine.weights = layer.weights ? layer.weights.map(w => w.map(o => ({ ...o }))) : [];
            engine.vertexPins = layer.vertexPins ? layer.vertexPins.map(p => p.map(o => ({ ...o }))) : [];
        } else {
            applyRemesh(meshType, gridSize);
        }
        setHierarchyVersion(v => v + 1);
    };

    const shortestAngleDelta = (from, to) => {
        let diff = to - from;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return diff;
    };

    const applyInterpolation = (t, type = interpolation) => {
        if (type === 'LINEAR') return t;
        if (type === 'EASE_IN') return t * t;
        if (type === 'EASE_OUT') return 1 - Math.pow(1 - t, 2);
        return smoothstep(0, 1, t);
    };

    const captureKeyframe = () => ({
        bones: engine.bones.map(b => b.angleCurr),
        boneTransforms: engine.bones.map(b => ({
            angle: b.angleCurr,
            poseOffsetX: b.poseOffsetX || 0,
            poseOffsetY: b.poseOffsetY || 0,
            length: b.length
        })),
        pitch: engine.pitchX,
        yaw: engine.yawY,
        parX: engine.parallaxX,
        parY: engine.parallaxY
    });

    const buildCurrentAnimation = (title = currentAnimationTitle) => ({
        title: title || 'default',
        keyframes,
        interpolation,
        pingPong,
        speed: animSpeedMult,
        lissajous: {
            active: lissajousActive,
            freqX: lissajousFreqX,
            freqY: lissajousFreqY,
            phase: lissajousPhase,
            ratio: lissajousRatio,
            intensity: lissajousIntensity,
            affects: lissajousAffects
        }
    });

    const saveCurrentAnimationToList = (title = currentAnimationTitle) => {
        const current = buildCurrentAnimation(title);
        setAnimations(prev => {
            const idx = prev.findIndex(anim => anim.title === current.title);
            if (idx === -1) return [...prev, current];
            const next = [...prev];
            next[idx] = current;
            return next;
        });
        return current;
    };

    const applyAnimation = (animation) => {
        if (!animation) return;
        setCurrentAnimationTitle(animation.title || 'default');
        setKeyframes(animation.keyframes || []);
        setSelectedKeyframe(0);
        setInterpolation(animation.interpolation || 'SMOOTH');
        setPingPong(animation.pingPong !== undefined ? !!animation.pingPong : true);
        setAnimSpeedMult(animation.speed || 1.5);
        const lissa = animation.lissajous || {};
        setLissajousActive(!!lissa.active);
        setLissajousFreqX(lissa.freqX !== undefined ? lissa.freqX : 1);
        setLissajousFreqY(lissa.freqY !== undefined ? lissa.freqY : 2);
        setLissajousPhase(lissa.phase !== undefined ? lissa.phase : 0);
        setLissajousRatio(lissa.ratio !== undefined ? lissa.ratio : 1.0);
        setLissajousIntensity(lissa.intensity !== undefined ? lissa.intensity : 1.0);
        setLissajousAffects(lissa.affects || 'DEPTH_ONLY');
        engine.animProgress = 0;
        engine.timelineScrub = false;
        setAnimPlaying(false);
    };

    const switchAnimation = (title) => {
        saveCurrentAnimationToList();
        const next = animations.find(anim => anim.title === title);
        if (next) applyAnimation(next);
    };

    const addAnimation = () => {
        saveCurrentAnimationToList();
        const title = prompt('Title for the new animation', `anim_${animations.length + 1}`);
        if (!title) return;
        const animation = {
            ...buildCurrentAnimation(title),
            title,
            keyframes: [],
            lissajous: { active: false, freqX: 1, freqY: 2, phase: 0, ratio: 1, intensity: 1, affects: 'DEPTH_ONLY' }
        };
        setAnimations(prev => [...prev.filter(anim => anim.title !== title), animation]);
        applyAnimation(animation);
    };

    const formatRangeValue = (input) => {
        const value = Number(input.value);
        const step = Number(input.step || 1);
        const decimals = input.step === 'any' ? 3 : Math.min(4, Math.max(0, (`${step}`.split('.')[1] || '').length));
        return Number.isFinite(value) ? value.toFixed(decimals).replace(/\.?0+$/, '') : input.value;
    };

    const showRangeHud = (input) => {
        const rect = input.getBoundingClientRect();
        setRangeHud({
            value: formatRangeValue(input),
            x: rect.left + rect.width / 2,
            y: rect.top - 8
        });
    };

    const setRangeValue = (input, value) => {
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        const next = Math.min(max, Math.max(min, value));
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, String(next));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        showRangeHud(input);
    };

    const handleRangePointerDown = (e) => {
        if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'range') return;
        showRangeHud(e.target);
        if (!e.shiftKey) return;
        e.preventDefault();
        fineRangeDrag.current = {
            input: e.target,
            startX: e.clientX,
            startValue: Number(e.target.value),
            min: Number(e.target.min || 0),
            max: Number(e.target.max || 100),
            width: Math.max(1, e.target.getBoundingClientRect().width)
        };
    };

    const handleRangePointerMove = (e) => {
        const active = fineRangeDrag.current;
        if (!active) {
            if (e.target instanceof HTMLInputElement && e.target.type === 'range') showRangeHud(e.target);
            return;
        }
        const delta = (e.clientX - active.startX) / active.width;
        setRangeValue(active.input, active.startValue + delta * (active.max - active.min) * 0.1);
    };

    const stopFineRangeDrag = () => {
        fineRangeDrag.current = null;
    };

    useEffect(() => { uiModeRef.current = uiMode; }, [uiMode]);

    // Control Keys Listener
    useEffect(() => {
        const handleKeyDown = (e) => { 
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'Tab') {
                e.preventDefault();
                const modes = ['EDIT', 'PREVIEW', 'PLAYER_PREVIEW'];
                const currentIndex = modes.indexOf(uiModeRef.current);
                setWorkspaceMode(modes[(currentIndex + 1) % modes.length]);
                return;
            }
            if (e.code === 'Space') engine.isSpacePressed = true; 
            const key = e.key.toLowerCase();
            if (key === 'q') setTransformTool('SELECT');
            if (key === 'w') setTransformTool('TRANSLATE');
            if (key === 'e') setTransformTool('ROTATE');
            if (key === 'r') setTransformTool('SCALE');
            if (key === '1') { setEditTool('BONE'); setTransformTool('SELECT'); }
            if (key === '2') { setEditTool('JIGGLE'); setTransformTool('SELECT'); }
            if (key === '3') { setEditTool('PIN'); setTransformTool('SELECT'); }
        };
        const handleKeyUp = (e) => { if (e.code === 'Space') engine.isSpacePressed = false; };
        const handleBlur = () => { engine.isSpacePressed = false; };
        window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp); window.addEventListener('blur', handleBlur);
        return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); window.removeEventListener('blur', handleBlur); }
    }, []);

    useEffect(() => {
        const syncRangeProgress = (input) => {
            const min = Number(input.min || 0);
            const max = Number(input.max || 100);
            const value = Number(input.value || 0);
            const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
            input.style.setProperty('--range-progress', `${Math.min(100, Math.max(0, pct))}%`);
        };
        const syncAllRanges = () => {
            document.querySelectorAll('input[type="range"]').forEach(syncRangeProgress);
        };
        const handleInput = (e) => {
            if (e.target instanceof HTMLInputElement && e.target.type === 'range') syncRangeProgress(e.target);
        };
        syncAllRanges();
        document.addEventListener('input', handleInput, true);
        return () => document.removeEventListener('input', handleInput, true);
    });

    // Sync React -> Ref
    useEffect(() => { engine.borderOffset = borderOffset; }, [borderOffset]);
    useEffect(() => { engine.edgeDensity = edgeDensity; }, [edgeDensity]);
    useEffect(() => { layersRef.current = layers; }, [layers]);
    useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);
    useEffect(() => {
        engine.useMouseRotation = useMouseRotation;
        if (!useMouseRotation) {
            engine.pitchX = 0;
            engine.yawY = 0;
            setForceRender(Date.now());
        }
    }, [useMouseRotation]);
    useEffect(() => {
        engine.useMouseParallax = useMouseParallax;
        if (!useMouseParallax) {
            engine.parallaxX = 0;
            engine.parallaxY = 0;
            setForceRender(Date.now());
        }
    }, [useMouseParallax]);
    useEffect(() => { engine.mouseRotationIntensity = mouseRotationIntensity; }, [mouseRotationIntensity]);
    useEffect(() => { engine.mouseParallaxIntensity = mouseParallaxIntensity; }, [mouseParallaxIntensity]);
    useEffect(() => { engine.depthGamma = depthGamma; engine.depthMultiplier = depthMultiplier; engine.invertDepth = invertDepth; engine.deformZIntensity = deformZIntensity; engine.depthMapSmoothness = depthMapSmoothness; engine.edgeDepth = edgeDepth; engine.edgeBevel = edgeBevel; }, [depthGamma, depthMultiplier, invertDepth, deformZIntensity, depthMapSmoothness, edgeDepth, edgeBevel]);
    useEffect(() => { 
        if (engine.depthBlur !== depthBlur) {
            engine.depthBlur = depthBlur;
            extractDepth();
            setForceRender(Date.now());
        }
    }, [depthBlur]);
    useEffect(() => { engine.depthGradientY = depthGradientY; engine.depthGradientSmoothness = depthGradientSmoothness; }, [depthGradientY, depthGradientSmoothness]);
    useEffect(() => { 
        engine.lissajousActive = lissajousActive; 
        engine.lissajousFreqX = lissajousFreqX; 
        engine.lissajousFreqY = lissajousFreqY; 
        engine.lissajousPhase = lissajousPhase; 
        engine.lissajousRatio = lissajousRatio; 
        engine.lissajousIntensity = lissajousIntensity; 
        engine.lissajousAffects = lissajousAffects; 
    }, [lissajousActive, lissajousFreqX, lissajousFreqY, lissajousPhase, lissajousRatio, lissajousIntensity, lissajousAffects]);
    useEffect(() => { engine.useBonePhysics = useBonePhysics; engine.secPhysStiffness = secPhysStiffness; engine.secPhysDamping = secPhysDamping; }, [useBonePhysics, secPhysStiffness, secPhysDamping]);
    useEffect(() => {
        engine.keyframes = keyframes;
        engine.selectedKeyframe = selectedKeyframe;
        engine.interpolation = interpolation;
        engine.pingPong = pingPong;
    }, [keyframes, selectedKeyframe, interpolation, pingPong]);
    useEffect(() => { engine.animPlaying = animPlaying; engine.animSpeedMult = animSpeedMult; engine.lastAnimTime = Date.now(); }, [animPlaying, animSpeedMult]);
    useEffect(() => { engine.showBones = showBones; engine.showJiggles = showJiggles; engine.showPins = showPins; }, [showBones, showJiggles, showPins]);
    useEffect(() => {
        let last = '';
        const id = window.setInterval(() => {
            const next = [
                engine.bones.map(b => `${b.id}:${b.parentId || ''}`).join('|'),
                engine.jiggles.map(j => `${j.id}:${j.boneId || j.parentId || ''}`).join('|'),
                engine.pins.map(p => `${p.id}:${p.parentId || ''}`).join('|')
            ].join('::');
            if (next !== last) {
                last = next;
                setHierarchyVersion(v => v + 1);
                syncActiveLayerSnapshot();
            }
        }, 80);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (uiMode !== 'PLAYER_PREVIEW') {
            playerPreviewRef.current?.destroy?.();
            playerPreviewRef.current = null;
            return;
        }
        const canvas = playerPreviewCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.parentElement?.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(rect?.width || 800));
        canvas.height = Math.max(1, Math.floor(rect?.height || 600));

        const activeLayer = layersRef.current.find(layer => layer.id === activeLayerIdRef.current);
        const imageSource = activeLayer?.imageSrc || engine.image?.src;
        const depthSource = activeLayer?.depthSrc || engine.depthImage?.src;
        if (!imageSource) return;

        let cancelled = false;
        const player = new AnimatitaPlayer(canvas);
        playerPreviewRef.current = player;
        const data = buildCharacterBundleData(false);
        player.load(JSON.stringify(data), imageSource, depthSource).then(() => {
            if (cancelled) {
                player.destroy();
                return;
            }
            player.setScaleMode('contain');
            player.setAnimation(data.currentAnimation);
            player.play();
        });
        return () => {
            cancelled = true;
            player.destroy();
            if (playerPreviewRef.current === player) playerPreviewRef.current = null;
        };
    }, [uiMode, activeLayerId, layers, keyframes, animations, currentAnimationTitle, interpolation, pingPong, animSpeedMult, lissajousActive, lissajousFreqX, lissajousFreqY, lissajousPhase, lissajousRatio, lissajousIntensity, lissajousAffects, meshType, gridSize, edgeDensity, borderOffset, depthGamma, depthMultiplier, invertDepth, depthBlur, depthMapSmoothness, depthGradientY, depthGradientSmoothness, deformZIntensity, edgeDepth, edgeBevel, useBonePhysics, secPhysStiffness, secPhysDamping]);

    // === INITIALIZATION ===
    useEffect(() => {
        const defCanvas = document.createElement('canvas'); defCanvas.width = 400; defCanvas.height = 400;
        const ctx = defCanvas.getContext('2d'); ctx.clearRect(0,0,400,400); 
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(200, 80, 50, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#3b82f6'; ctx.fillRect(160, 140, 80, 140);
        ctx.fillStyle = '#facc15'; ctx.fillRect(100, 140, 40, 100); ctx.fillRect(260, 140, 40, 100);
        ctx.fillStyle = '#22c55e'; ctx.fillRect(160, 290, 30, 100); ctx.fillRect(210, 290, 30, 100);
        const img = new Image(); img.src = defCanvas.toDataURL();
        img.onload = () => { engine.image = img; applyRemesh(meshType, gridSize); };
    }, []);

    const getMouseWorld = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const screenX = e.clientX - rect.left; const screenY = e.clientY - rect.top;
        const cw = canvasRef.current.width / 2; const ch = canvasRef.current.height / 2;
        return { x: (screenX - cw - (engine.panX || 0)) / engine.zoom + cw, y: (screenY - ch - (engine.panY || 0)) / engine.zoom + ch, screenX, screenY, cw, ch };
    };

    const handleWheel = (e) => {
        const oldZoom = engine.zoom;
        let newZoom = oldZoom + e.deltaY * -0.001;
        newZoom = Math.max(0.2, Math.min(newZoom, 8));
        
        const ratio = newZoom / oldZoom;
        engine.panX = (engine.panX || 0) * ratio;
        engine.panY = (engine.panY || 0) * ratio;
        engine.zoom = newZoom;
    };

    const getPinnedCenter = (item) => {
        const parentId = item.parentId || item.boneId;
        const bone = engine.bones.find(b => b.id === parentId);
        if (!bone) return {
            x: item.currX !== undefined ? item.currX : item.restX,
            y: item.currY !== undefined ? item.currY : item.restY
        };
        const start = engine.mode === 'PREVIEW' ? bone.startCurr : bone.startRest;
        const angle = engine.mode === 'PREVIEW' ? (bone.displayAngle || bone.angleCurr) : bone.angleRest;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        return {
            x: start.x + item.localX * cosA - item.localY * sinA,
            y: start.y + item.localX * sinA + item.localY * cosA
        };
    };

    const movePinnedItem = (item, dx, dy) => {
        const oldRestX = item.restX;
        const oldRestY = item.restY;
        item.restX += dx;
        item.restY += dy;
        item.currX = (item.currX !== undefined ? item.currX : oldRestX) + dx;
        item.currY = (item.currY !== undefined ? item.currY : oldRestY) + dy;
        item.physX = (item.physX !== undefined ? item.physX : oldRestX) + dx;
        item.physY = (item.physY !== undefined ? item.physY : oldRestY) + dy;

        const bone = engine.bones.find(b => b.id === (item.parentId || item.boneId));
        if (bone) {
            const angle = engine.mode === 'PREVIEW' ? (bone.displayAngle || bone.angleCurr) : bone.angleRest;
            const start = engine.mode === 'PREVIEW' ? bone.startCurr : bone.startRest;
            const cosA = Math.cos(-angle);
            const sinA = Math.sin(-angle);
            item.localX = (item.restX - start.x) * cosA - (item.restY - start.y) * sinA;
            item.localY = (item.restX - start.x) * sinA + (item.restY - start.y) * cosA;
        }
    };

    const snapBoneParents = () => {
        const snapDist = 18 / engine.zoom;
        const moveBoneRecursive = (bone, dx, dy) => {
            bone.startRest.x += dx; bone.startRest.y += dy; bone.endRest.x += dx; bone.endRest.y += dy;
            bone.startCurr.x += dx; bone.startCurr.y += dy; bone.endCurr.x += dx; bone.endCurr.y += dy;
            engine.bones.filter(c => c.parentId === bone.id).forEach(c => moveBoneRecursive(c, dx, dy));
        };
        engine.bones.forEach(child => {
            let best = null;
            engine.bones.forEach(parent => {
                if (parent.id === child.id) return;
                const d = Math.hypot(child.startRest.x - parent.endRest.x, child.startRest.y - parent.endRest.y);
                if (d < snapDist && (!best || d < best.d)) best = { parent, d };
            });
            if (!best) return;
            let p = best.parent;
            while (p) {
                if (p.parentId === child.id) return;
                p = engine.bones.find(b => b.id === p.parentId);
            }
            const dx = best.parent.endRest.x - child.startRest.x;
            const dy = best.parent.endRest.y - child.startRest.y;
            child.parentId = best.parent.id;
            moveBoneRecursive(child, dx, dy);
        });
    };

    const extractDepth = () => {
        if (!engine.depthImage || engine.verticesRest.length === 0) return;
        const w = engine.depthImage.width; const h = engine.depthImage.height;
        const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
        const octx = oc.getContext('2d'); 
        if (engine.depthBlur > 0) octx.filter = `blur(${engine.depthBlur}px)`;
        octx.drawImage(engine.depthImage, 0, 0, w, h);
        let imgData; try { imgData = octx.getImageData(0, 0, w, h).data; } catch(e) { return; }
        engine.verticesRest.forEach(v => {
            const { x, y, w: rectW, h: rectH } = engine.imageRect;
            let px = Math.floor(((v.x - x) / rectW) * w); let py = Math.floor(((v.y - y) / rectH) * h);
            px = Math.max(0, Math.min(px, w - 1)); py = Math.max(0, Math.min(py, h - 1));
            v.z = imgData[(py * w + px) * 4];
        });
    };

    const createMorphologicalGrid = (imgData, w, h, offset) => {
        let grid = new Uint8Array(w * h); const r = Math.abs(Math.round(offset));
        for (let iy = 0; iy < h; iy++) {
            for (let ix = 0; ix < w; ix++) {
                const isOp = imgData[(iy * w + ix) * 4 + 3] > 15;
                if (offset === 0) { grid[iy*w + ix] = isOp ? 1 : 0; continue; }
                if (offset > 0 && isOp) { grid[iy*w + ix] = 1; continue; }
                if (offset < 0 && !isOp) { grid[iy*w + ix] = 0; continue; }
                let foundOpaque = false; let foundTrans = false;
                for (let oy = -r; oy <= r; oy+=2) {
                    for (let ox = -r; ox <= r; ox+=2) {
                        if (ox*ox + oy*oy <= r*r) {
                            const px = ix + ox; const py = iy + oy;
                            if (px>=0 && px<w && py>=0 && py<h) { if (imgData[(py*w + px)*4 + 3] > 15) foundOpaque = true; else foundTrans = true; } 
                            else foundTrans = true;
                        }
                    }
                }
                if (offset > 0) grid[iy*w + ix] = foundOpaque ? 1 : 0;
                else grid[iy*w + ix] = (!foundTrans && foundOpaque) ? 1 : 0;
            }
        }
        return grid;
    };

    // === MESH GENERATION ===
    const handleRemeshGrid = (size) => {
        const { x, y, w, h } = engine.imageRect; engine.verticesRest = []; engine.triangles = [];
        for (let j = 0; j <= size; j++) { for (let i = 0; i <= size; i++) engine.verticesRest.push({ x: x + (i / size) * w, y: y + (j / size) * h }); }
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                const p1 = j * (size + 1) + i; const p2 = p1 + 1; const p3 = p1 + (size + 1); const p4 = p3 + 1;
                engine.triangles.push([p1, p2, p3]); engine.triangles.push([p2, p4, p3]);
            }
        }
        engine.verticesCurrent = engine.verticesRest.map(v => ({ ...v }));
    };

    const handleOptimizedRemesh = (size) => {
        if (!engine.image) return;
        const { x, y, w, h } = engine.imageRect;
        const oc = document.createElement('canvas'); oc.width = Math.floor(w); oc.height = Math.floor(h);
        const octx = oc.getContext('2d'); octx.drawImage(engine.image, 0, 0, oc.width, oc.height);
        let imgData; try { imgData = octx.getImageData(0, 0, oc.width, oc.height).data; } catch(e) { handleRemeshGrid(size); return; }

        const shapeGrid = createMorphologicalGrid(imgData, oc.width, oc.height, engine.borderOffset);
        const isShapeOpaque = (ix, iy) => { if(ix<0 || ix>=oc.width || iy<0 || iy>=oc.height) return false; return shapeGrid[iy * oc.width + ix] === 1; };

        let points = [];
        const baseStep = oc.width / size;
        const step = Math.max(1, Math.floor(baseStep / (engine.edgeDensity || 1.0)));
        
        // How many point rings to generate along the boundary to avoid stretched triangles
        const rings = Math.max(1, Math.ceil((engine.edgeDensity || 1.0) * 1.5));
        
        for (let iy = 0; iy < oc.height; iy += step) {
            for (let ix = 0; ix < oc.width; ix += step) {
                if (isShapeOpaque(ix, iy)) {
                    let isNearBoundary = false;
                    for (let r = 1; r <= rings; r++) {
                        const s = step * r;
                        if (!isShapeOpaque(ix - s, iy) || !isShapeOpaque(ix + s, iy) || 
                            !isShapeOpaque(ix, iy - s) || !isShapeOpaque(ix, iy + s)) {
                            isNearBoundary = true;
                            break;
                        }
                    }
                    if (isNearBoundary) points.push({ x: x + (ix/oc.width)*w, y: y + (iy/oc.height)*h });
                }
            }
        }

        const sparseSize = Math.max(3, Math.floor(size / 3));
        for(let j=1; j<sparseSize; j++) {
            for(let i=1; i<sparseSize; i++) {
                const px = x + (i/sparseSize)*w; const py = y + (j/sparseSize)*h;
                if (isShapeOpaque(Math.floor(((px - x)/w)*oc.width), Math.floor(((py - y)/h)*oc.height))) points.push({ x: px, y: py });
            }
        }

        engine.bones.forEach(b => {
            const bLen = Math.hypot(b.endRest.x - b.startRest.x, b.endRest.y - b.startRest.y);
            const steps = Math.max(3, Math.floor((bLen / w) * size * 1.5));
            const angle = Math.atan2(b.endRest.y - b.startRest.y, b.endRest.x - b.startRest.x);
            const perpX = Math.cos(angle + Math.PI/2); const perpY = Math.sin(angle + Math.PI/2);
            for(let i=0; i<=steps; i++) {
                const t = i / steps; const bx = b.startRest.x + (b.endRest.x - b.startRest.x) * t; const by = b.startRest.y + (b.endRest.y - b.startRest.y) * t;
                const width1 = (w / size) * 0.8; const width2 = (w / size) * 1.6;
                [{ x: bx, y: by }, { x: bx + perpX * width1, y: by + perpY * width1 }, { x: bx - perpX * width1, y: by - perpY * width1 }, { x: bx + perpX * width2, y: by + perpY * width2 }, { x: bx - perpX * width2, y: by - perpY * width2 }]
                .forEach(pt => { if (isShapeOpaque(Math.floor(((pt.x - x)/w)*oc.width), Math.floor(((pt.y - y)/h)*oc.height))) points.push(pt); });
            }
        });
        
        // EXTRA DENSITY AROUND JIGGLES
        engine.jiggles.forEach(br => {
            let cx = br.restX; let cy = br.restY;
            if(br.boneId) {
                const bone = engine.bones.find(b => b.id === br.boneId);
                if (bone) { cx = bone.startRest.x + br.localX * Math.cos(bone.angleRest) - br.localY * Math.sin(bone.angleRest); cy = bone.startRest.y + br.localX * Math.sin(bone.angleRest) + br.localY * Math.cos(bone.angleRest); }
            }
            points.push({x: cx, y: cy});
            for(let r=0.3; r<=1.0; r+=0.3) {
                for(let a=0; a<Math.PI*2; a+=Math.PI/6) { points.push({x: cx + Math.cos(a)*br.rx*r, y: cy + Math.sin(a)*br.ry*r}); }
            }
        });

        engine.pins.forEach(pin => {
            let cx = pin.restX; let cy = pin.restY;
            if(pin.parentId) {
                 const bone = engine.bones.find(b => b.id === pin.parentId);
                 if (bone) { cx = bone.startRest.x + pin.localX * Math.cos(bone.angleRest) - pin.localY * Math.sin(bone.angleRest); cy = bone.startRest.y + pin.localX * Math.sin(bone.angleRest) + pin.localY * Math.cos(bone.angleRest); }
            }
            points.push({x: cx, y: cy});
            for(let a=0; a<Math.PI*2; a+=Math.PI/4) points.push({x: cx + Math.cos(a)*pin.radius, y: cy + Math.sin(a)*pin.radius});
            for(let a=0; a<Math.PI*2; a+=Math.PI/4) points.push({x: cx + Math.cos(a)*pin.radius*0.5, y: cy + Math.sin(a)*pin.radius*0.5});
        });

        let uniquePts = []; const minSpacing = (w/size) * 0.3;
        points.forEach(p => { if (!uniquePts.some(up => Math.hypot(up.x - p.x, up.y - p.y) < minSpacing)) uniquePts.push({ x: p.x + (Math.random()-0.5)*0.1, y: p.y + (Math.random()-0.5)*0.1 }); });
        if (uniquePts.length > 3500) uniquePts = uniquePts.filter((_, i) => i % Math.ceil(uniquePts.length / 3500) === 0);
        
        try {
            if (uniquePts.length < 3) throw new Error("Poucos pontos");
            const rawTriangles = delaunayTriangulate(uniquePts);
            let validTriangles = [];
            rawTriangles.forEach(t => {
                const p1 = uniquePts[t[0]]; const p2 = uniquePts[t[1]]; const p3 = uniquePts[t[2]];
                const cx = (p1.x + p2.x + p3.x) / 3; const cy = (p1.y + p2.y + p3.y) / 3;
                if (isShapeOpaque(Math.floor(((cx - x)/w)*oc.width), Math.floor(((cy - y)/h)*oc.height))) validTriangles.push(t);
            });
            if (validTriangles.length > 0) { engine.verticesRest = uniquePts; engine.triangles = validTriangles; engine.verticesCurrent = engine.verticesRest.map(v => ({...v})); return; }
        } catch (e) { console.warn("Delaunay falhou", e); }
        handleRemeshGrid(size); 
    };

    const applyRemesh = (type, size) => {
        engine.weights = []; engine.localPos = [];
        if (type === 'OPTIMIZED') handleOptimizedRemesh(size); else handleRemeshGrid(size);
        if (engine.borderOffset !== 0 && engine.verticesRest.length > 0) {
            const cx = engine.imageRect.x + engine.imageRect.w / 2; const cy = engine.imageRect.y + engine.imageRect.h / 2; const halfW = engine.imageRect.w / 2;
            const scale = 1 + (engine.borderOffset / halfW); 
            engine.verticesRest.forEach(v => { v.x = cx + (v.x - cx) * scale; v.y = cy + (v.y - cy) * scale; });
        }
        
        if (engine.image && engine.verticesRest.length > 0) {
            const { x, y, w, h } = engine.imageRect;
            const oc = document.createElement('canvas'); oc.width = Math.floor(w); oc.height = Math.floor(h);
            const octx = oc.getContext('2d'); octx.drawImage(engine.image, 0, 0, oc.width, oc.height);
            let imgData; try { imgData = octx.getImageData(0, 0, oc.width, oc.height).data; } catch(e) { }
            if (imgData) {
                const shapeGrid = createMorphologicalGrid(imgData, oc.width, oc.height, engine.borderOffset);
                const isShapeOpaque = (ix, iy) => { if(ix<0 || ix>=oc.width || iy<0 || iy>=oc.height) return false; return shapeGrid[iy * oc.width + ix] === 1; };
                const maxSearch = Math.floor(oc.width * 0.15); 
                engine.verticesRest.forEach(v => {
                    let ix = Math.floor(((v.x - x) / w) * oc.width);
                    let iy = Math.floor(((v.y - y) / h) * oc.height);
                    let dist = maxSearch;
                    if (!isShapeOpaque(ix, iy)) { dist = 0; } else {
                        for (let r = 1; r <= maxSearch; r++) {
                            let minEuc = maxSearch; let found = false;
                            for (let dx = -r; dx <= r; dx++) {
                                if (!isShapeOpaque(ix + dx, iy - r)) { minEuc = Math.min(minEuc, Math.hypot(dx, -r)); found = true; }
                                if (!isShapeOpaque(ix + dx, iy + r)) { minEuc = Math.min(minEuc, Math.hypot(dx, r)); found = true; }
                                if (!isShapeOpaque(ix - r, iy + dx)) { minEuc = Math.min(minEuc, Math.hypot(-r, dx)); found = true; }
                                if (!isShapeOpaque(ix + r, iy + dx)) { minEuc = Math.min(minEuc, Math.hypot(r, dx)); found = true; }
                            }
                            if (found) { dist = minEuc; break; }
                        }
                    }
                    v.edgeDist = dist / oc.width; 
                });
            }
        }
        engine.verticesCurrent = engine.verticesRest.map(v => ({...v}));
        
        extractDepth(); bindMesh(); 
    };

    // === MATHEMATICAL RIGGING ===
    const bindMesh = () => {
        engine.weights = [];
        engine.vertexPins = [];
        if (engine.bones.length === 0 && engine.pins.length === 0 && engine.jiggles.length === 0) return;
        
        engine.verticesRest.forEach((v, i) => {
            let itemWeights = [];
            let v_pins = [];
            
            // BONES
            engine.bones.forEach((bone, bIdx) => {
                const d = distPointToSegment(v, bone.startRest, bone.endRest);
                const dx = v.x - bone.startRest.x; const dy = v.y - bone.startRest.y;
                const cosA = Math.cos(-bone.angleRest); const sinA = Math.sin(-bone.angleRest);
                itemWeights.push({ 
                    type: 'bone', idx: bIdx, 
                    w: 1 / Math.pow(d + 1, 3),
                    localX: dx * cosA - dy * sinA, localY: dx * sinA + dy * cosA 
                });
            });
            
            // PINS
            engine.pins.forEach((pin, pIdx) => {
                let pinCX = pin.restX; let pinCY = pin.restY; let angleRef = 0;
                if(pin.parentId) {
                    const bone = engine.bones.find(b=>b.id === pin.parentId);
                    if(bone) { 
                        angleRef = bone.angleRest;
                        pinCX = bone.startRest.x + pin.localX * Math.cos(angleRef) - pin.localY * Math.sin(angleRef); 
                        pinCY = bone.startRest.y + pin.localX * Math.sin(angleRef) + pin.localY * Math.cos(angleRef); 
                    }
                }
                const dx = v.x - pinCX; const dy = v.y - pinCY;
                const d = Math.hypot(dx, dy);
                if (d < pin.radius) {
                    const pinSmooth = pin.smoothness !== undefined ? pin.smoothness : 1.0;
                    const falloffStart = pin.radius * (1.0 - pinSmooth);
                    const wRaw = 1.0 - smoothstep(falloffStart, pin.radius, d);
                    if (wRaw > 0.001) v_pins.push({ pinIdx: pIdx, w: wRaw });
                }
            });
            
            // JIGGLES
            engine.jiggles.forEach((jig, jIdx) => {
                let jigCX = jig.restX; let jigCY = jig.restY; let angleRef = 0;
                if(jig.boneId || jig.parentId) {
                    const bone = engine.bones.find(b=>b.id === (jig.boneId || jig.parentId));
                    if(bone) { 
                        angleRef = bone.angleRest;
                        jigCX = bone.startRest.x + jig.localX * Math.cos(angleRef) - jig.localY * Math.sin(angleRef); 
                        jigCY = bone.startRest.y + jig.localX * Math.sin(angleRef) + jig.localY * Math.cos(angleRef); 
                    }
                }
                const dx = v.x - jigCX; const dy = v.y - jigCY;
                const distSq = (dx*dx)/(jig.rx*jig.rx) + (dy*dy)/(jig.ry*jig.ry);
                const softEdge = jig.smoothness !== undefined ? jig.smoothness : 0.0;
                const wRaw = distSq < 1 ? (1.0 - smoothstep(softEdge, 1, Math.sqrt(distSq))) : 0;
                const weight = wRaw > 0 ? (wRaw * 500) : 0;
                if (weight > 0) {
                    itemWeights.push({ 
                        type: 'jiggle', idx: jIdx, w: weight,
                        localX: dx * Math.cos(-angleRef) - dy * Math.sin(-angleRef),
                        localY: dx * Math.sin(-angleRef) + dy * Math.cos(-angleRef)
                    });
                }
            });

            itemWeights.sort((a, b) => b.w - a.w);
            const topItems = itemWeights.slice(0, 4);
            const totalWeight = topItems.reduce((sum, curr) => sum + curr.w, 0);
            
            let finalWeights = [];
            if (totalWeight > 0) topItems.forEach(bw => { finalWeights.push({ ...bw, w: bw.w / totalWeight }); });
            engine.weights.push(finalWeights);
            engine.vertexPins.push(v_pins);
        });
    };

    const computeForwardKinematics = () => {
        const traverse = (bone) => {
            const displayAngle = (engine.useBonePhysics && bone.physAngle !== undefined && !isNaN(bone.physAngle)) ? bone.physAngle : bone.angleCurr;
            bone.displayAngle = displayAngle;
            bone.endCurr = { x: bone.startCurr.x + Math.cos(displayAngle) * bone.length, y: bone.startCurr.y + Math.sin(displayAngle) * bone.length };
            engine.bones.filter(b => b.parentId === bone.id).forEach(child => {
                child.startCurr = {
                    x: bone.endCurr.x + (child.poseOffsetX || 0),
                    y: bone.endCurr.y + (child.poseOffsetY || 0)
                };
                traverse(child);
            });
        };
        engine.bones.filter(b => !b.parentId).forEach(root => {
            root.startCurr = {
                x: root.startRest.x + (root.poseOffsetX || 0),
                y: root.startRest.y + (root.poseOffsetY || 0)
            };
            traverse(root);
        });
    };

    const updateVertices = () => {
        if (engine.verticesRest.length === 0) return;
        
        let lowestY = engine.imageRect.y + engine.imageRect.h;
        let centerX = engine.imageRect.x + engine.imageRect.w / 2; let centerY = engine.imageRect.y + engine.imageRect.h / 2;
        let lissaX = 0, lissaY = 0, lissaParX = 0, lissaParY = 0;
        const isEditingBoneDrag = engine.mode === 'EDIT' && engine.isDragging && (
            engine.draggingItem?.itemType === 'BONE' ||
            engine.draggingItem?.type === 'BONE_START' ||
            engine.draggingItem?.type === 'BONE_END'
        );

        const maxAngle = Math.PI / 4; 

        // --- TIMELINE KEYFRAMES ---
        const frames = engine.keyframes || [];
        if (engine.mode === 'PREVIEW' && frames.length > 0 && !engine.draggingBoneId && !engine.draggingItem && (engine.animPlaying || engine.timelineScrub)) {
            if (engine.animPlaying && frames.length > 1) {
                const now = Date.now(); const delta = (now - engine.lastAnimTime) / 1000; engine.lastAnimTime = now;
                engine.animProgress += delta * engine.animDirection * engine.animSpeedMult;
                if (engine.animProgress >= frames.length - 1) {
                    if (engine.pingPong) { engine.animProgress = frames.length - 1; engine.animDirection = -1; }
                    else engine.animProgress = 0;
                }
                if (engine.animProgress <= 0) { engine.animProgress = 0; engine.animDirection = 1; }
                if (timelineRef.current) timelineRef.current.value = engine.animProgress;
            } else {
                engine.lastAnimTime = Date.now();
            }

            const baseIdx = Math.min(frames.length - 1, Math.max(0, Math.floor(engine.animProgress)));
            const nextIdx = Math.min(frames.length - 1, baseIdx + 1);
            const a = frames[baseIdx];
            const b = frames[nextIdx];
            const t = applyInterpolation(nextIdx === baseIdx ? 0 : engine.animProgress - baseIdx, engine.interpolation);
            engine.bones.forEach((bone, i) => {
                const fromTransform = a.boneTransforms?.[i];
                const toTransform = b.boneTransforms?.[i];
                const fromAngle = fromTransform?.angle ?? (a.bones[i] !== undefined ? a.bones[i] : bone.angleRest);
                const toAngle = toTransform?.angle ?? (b.bones[i] !== undefined ? b.bones[i] : fromAngle);
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
            if (!engine.useMouseRotation && !engine.animPlaying) {
                engine.pitchX = a.pitch + ((b.pitch || 0) - (a.pitch || 0)) * t;
                engine.yawY = a.yaw + shortestAngleDelta(a.yaw || 0, b.yaw || 0) * t;
            }
            if (!engine.useMouseParallax && !engine.animPlaying) {
                engine.parallaxX = (a.parX || 0) + ((b.parX || 0) - (a.parX || 0)) * t;
                engine.parallaxY = (a.parY || 0) + ((b.parY || 0) - (a.parY || 0)) * t;
            }
        } else if (engine.mode === 'PREVIEW' && engine.poseA && engine.poseB && !engine.draggingBoneId && !engine.draggingItem && engine.timelineScrub) {
            const t = smoothstep(0, 1, engine.animProgress);
            engine.bones.forEach((b, i) => { b.angleCurr = engine.poseA.bones[i] + shortestAngleDelta(engine.poseA.bones[i], engine.poseB.bones[i]) * t; });
        } else if (engine.mode === 'PREVIEW') { engine.lastAnimTime = Date.now(); }

        if (engine.mode === 'PREVIEW' && engine.lissajousActive) {
            const t = Date.now() * 0.001; // Runs continuously
            const ptX = Math.sin(engine.lissajousFreqX * t + engine.lissajousPhase);
            const ptY = Math.sin(engine.lissajousFreqY * t);
            const ratio = engine.lissajousRatio;
            const rx = ratio < 1 ? 1 : 1/ratio;
            const ry = ratio < 1 ? ratio : 1;
            
            const lissaX_pad = ptX * (engine.lissajousIntensity / 10) * rx;
            const lissaY_pad = ptY * (engine.lissajousIntensity / 10) * ry;
            
            if (engine.lissajousAffects !== 'MESH_ONLY') {
                lissaParX = lissaX_pad;
                lissaParY = lissaY_pad;
            }
            
            if (engine.lissajousAffects === 'BONES_AND_DEPTH' || engine.lissajousAffects === 'MESH_ONLY') {
                lissaX = lissaX_pad * 100;
                lissaY = lissaY_pad * 100;
            }
        }

        let pitchAngle = (engine.pitchX || 0) * maxAngle; let yawAngle = (engine.yawY || 0) * maxAngle;

        // --- TIP PHYSICS ---
        if (engine.mode === 'PREVIEW') {
            engine.bones.forEach(b => {
                const isExtremity = !engine.bones.some(child => child.parentId === b.id);
                if (engine.useBonePhysics && isExtremity) {
                    if (isNaN(b.physAngle) || b.physAngle === undefined) b.physAngle = b.angleCurr;
                    if (isNaN(b.velAngle) || b.velAngle === undefined) b.velAngle = 0;
                    let diff = b.angleCurr - b.physAngle;
                    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
                    const force = diff * engine.secPhysStiffness;
                    b.velAngle = (b.velAngle + force) * engine.secPhysDamping; 
                    b.physAngle += b.velAngle;
                } else {
                    b.physAngle = b.angleCurr; b.velAngle = 0;
                }
            });
        }
        computeForwardKinematics(); 

        // --- UPDATE PINS AND JIGGLES (Physics) ---
        if (engine.mode === 'PREVIEW') {
            engine.pins.forEach(pin => {
                if (pin.parentId) {
                    const bone = engine.bones.find(b => b.id === pin.parentId);
                    if (bone) {
                        const cosA = Math.cos(bone.displayAngle); const sinA = Math.sin(bone.displayAngle);
                        pin.currX = bone.startCurr.x + pin.localX * cosA - pin.localY * sinA;
                        pin.currY = bone.startCurr.y + pin.localX * sinA + pin.localY * cosA;
                    }
                } else { pin.currX = pin.restX; pin.currY = pin.restY; }
            });

            engine.jiggles.forEach(br => {
                const bone = engine.bones.find(b => b.id === (br.boneId || br.parentId)); 
                let baseAngle = 0; let targetX = br.restX; let targetY = br.restY;
                if (bone) {
                    baseAngle = bone.displayAngle;
                    const cosA = Math.cos(baseAngle); const sinA = Math.sin(baseAngle);
                    targetX = bone.startCurr.x + br.localX * cosA - br.localY * sinA;
                    targetY = bone.startCurr.y + br.localX * sinA + br.localY * cosA;
                }
                
                if (br.physX === undefined || isNaN(br.physX)) { 
                    br.physX = targetX; br.physY = targetY; br.velX = 0; br.velY = 0; 
                    br.physAngle = baseAngle; br.velAngle = 0;
                    br.physScale = 1.0; br.velScale = 0;
                }
                
                // Position Spring
                const forceX = (targetX - br.physX) * br.stiffness; 
                const forceY = (targetY - br.physY) * br.stiffness;
                br.velX = ((br.velX || 0) + forceX) * br.damping; 
                br.velY = ((br.velY || 0) + forceY) * br.damping;
                br.physX += br.velX; br.physY += br.velY;
                
                // Limits
                const lagX = br.physX - targetX; const lagY = br.physY - targetY;
                const distLag = Math.hypot(lagX, lagY);
                const limit = br.limit !== undefined ? br.limit : 30;
                if (distLag > limit) {
                    br.physX = targetX + (lagX / distLag) * limit;
                    br.physY = targetY + (lagY / distLag) * limit;
                    br.velX *= 0.5; br.velY *= 0.5;
                }
                const lagXAfter = br.physX - targetX;

                // Rotation physics
                const targetAngle = baseAngle - (lagXAfter * (br.rotBouncy !== undefined ? br.rotBouncy : 0.02));
                let diffTilt = targetAngle - (br.physAngle || 0);
                while(diffTilt > Math.PI) diffTilt -= Math.PI*2; 
                while(diffTilt < -Math.PI) diffTilt += Math.PI*2;
                br.velAngle = ((br.velAngle || 0) + diffTilt * br.stiffness) * br.damping;
                br.physAngle = (br.physAngle || 0) + br.velAngle;
                
                // Scale physics
                const speed = Math.hypot(br.velX, br.velY);
                const vBase = br.volume !== undefined ? br.volume : 1.0;
                const targetScaleX = vBase + (speed * (br.scaleX !== undefined ? br.scaleX : 0.015));
                const targetScaleY = vBase + (speed * (br.scaleY !== undefined ? br.scaleY : -0.015));
                br.velScaleX = ((br.velScaleX || 0) + (targetScaleX - (br.physScaleX || vBase)) * br.stiffness) * br.damping;
                br.velScaleY = ((br.velScaleY || 0) + (targetScaleY - (br.physScaleY || vBase)) * br.stiffness) * br.damping;
                br.physScaleX = (br.physScaleX || vBase) + br.velScaleX;
                br.physScaleY = (br.physScaleY || vBase) + br.velScaleY;
            });
        }

        // --- DEFORMAR VERTICES ---
        engine.verticesCurrent = engine.verticesRest.map((v, i) => {
            if (isEditingBoneDrag) return { ...v };
            let finalX = v.x; let finalY = v.y;
            let totalPinDepthFix = 0;
            
            if (engine.weights[i] && engine.weights[i].length > 0) {
                finalX = 0; finalY = 0;
                engine.weights[i].forEach(wObj => {
                    if (wObj.w > 0.001) {
                        if (wObj.type === 'bone') {
                            const bone = engine.bones[wObj.idx];
                            const cosA = Math.cos(bone.displayAngle); const sinA = Math.sin(bone.displayAngle);
                            finalX += wObj.w * (wObj.localX * cosA - wObj.localY * sinA + bone.startCurr.x);
                            finalY += wObj.w * (wObj.localX * sinA + wObj.localY * cosA + bone.startCurr.y);
                        } 
                        else if (wObj.type === 'jiggle') {
                            const jig = engine.jiggles[wObj.idx];
                            let cx = jig.restX; let cy = jig.restY; let angleRef = 0; 
                            let sx = jig.volume !== undefined ? jig.volume : 1.0; 
                            let sy = jig.volume !== undefined ? jig.volume : 1.0;
                            if (engine.mode === 'PREVIEW') {
                                cx = jig.physX; cy = jig.physY;
                                angleRef = jig.physAngle || 0;
                                sx = jig.physScaleX || sx;
                                sy = jig.physScaleY || sy;
                            } else {
                                if(jig.boneId || jig.parentId) {
                                  const bone = engine.bones.find(b=>b.id === (jig.boneId || jig.parentId));
                                  if (bone) angleRef = bone.angleRest;
                                }
                            }
                            const cosA = Math.cos(angleRef); const sinA = Math.sin(angleRef);
                            // Scale then rotate calculation
                            const scaledX = wObj.localX * sx;
                            const scaledY = wObj.localY * sy;
                            finalX += wObj.w * (scaledX * cosA - scaledY * sinA + cx);
                            finalY += wObj.w * (scaledX * sinA + scaledY * cosA + cy);
                        }
                    }
                });
            }

            if (engine.vertexPins[i] && engine.vertexPins[i].length > 0) {
                engine.vertexPins[i].forEach(vp => {
                    const pin = engine.pins[vp.pinIdx];
                    if (!pin) return;
                    
                    const bone = engine.bones.find(b => b.id === pin.parentId);
                    let rigidX = v.x; let rigidY = v.y;
                    let currStart = { x: v.x, y: v.y };
                    if (bone) {
                        // Compute where this vertex would be if it stayed perfectly perfectly rigid with the bone
                        const dx = v.x - bone.startRest.x; const dy = v.y - bone.startRest.y;
                        const cos0 = Math.cos(-bone.angleRest); const sin0 = Math.sin(-bone.angleRest);
                        const localX = dx * cos0 - dy * sin0;
                        const localY = dx * sin0 + dy * cos0;
                        
                        const displayAngle = engine.mode === 'PREVIEW' ? bone.displayAngle : bone.angleRest;
                        currStart = engine.mode === 'PREVIEW' ? bone.startCurr : bone.startRest;
                        
                        const cos1 = Math.cos(displayAngle); const sin1 = Math.sin(displayAngle);
                        rigidX = currStart.x + localX * cos1 - localY * sin1;
                        rigidY = currStart.y + localX * sin1 + localY * cos1;
                    }
                    
                    const strXY = pin.intensity !== undefined ? pin.intensity : 1.0;
                    
                    const rotI = pin.rotIntensity !== undefined ? pin.rotIntensity : 1.0;
                    const posI = pin.posIntensity !== undefined ? pin.posIntensity : 1.0;
                    
                    // Blend Rotation
                    const lbsDX = finalX - currStart.x;
                    const lbsDY = finalY - currStart.y;
                    const lbsDist = Math.hypot(lbsDX, lbsDY);
                    const lbsAngle = Math.atan2(lbsDY, lbsDX);
                    const strictAngle = Math.atan2(rigidY - currStart.y, rigidX - currStart.x);
                    
                    let diffAngle = strictAngle - lbsAngle;
                    while(diffAngle > Math.PI) diffAngle -= Math.PI*2;
                    while(diffAngle < -Math.PI) diffAngle += Math.PI*2;
                    
                    const finalRotAngle = lbsAngle + diffAngle * (vp.w * rotI * strXY);
                    
                    const rotCorrectedX = currStart.x + Math.cos(finalRotAngle) * lbsDist;
                    const rotCorrectedY = currStart.y + Math.sin(finalRotAngle) * lbsDist;
                    
                    // Blend Position
                    const weightXY = Math.min(1.0, vp.w * posI * strXY);
                    finalX = rotCorrectedX + (rigidX - rotCorrectedX) * weightXY;
                    finalY = rotCorrectedY + (rigidY - rotCorrectedY) * weightXY;
                    
                    totalPinDepthFix += vp.w * (pin.depthFix !== undefined ? pin.depthFix : 0.8);
                });
            }

            // 3. Lissajous Deformation
            const normY = (v.y - engine.imageRect.y) / engine.imageRect.h; 
            if (engine.mode === 'PREVIEW' && engine.lissajousActive && (engine.lissajousAffects === 'BONES_AND_DEPTH' || engine.lissajousAffects === 'MESH_ONLY')) {
                finalX += lissaX;
                finalY -= lissaY;
            }

            // Mesh deformation affects Z
            const deformOffsetZ = Math.hypot(finalX - v.x, finalY - v.y) * engine.deformZIntensity;

            // 4. Perfect Convex 3D Projection (Real Z-buffer)
            let z = v.z !== undefined ? v.z : 128;
            let normZ = z / 255.0; 
            if (engine.invertDepth) normZ = 1.0 - normZ; // Invert option
            normZ = Math.pow(normZ, engine.depthGamma); 
            if (engine.depthMapSmoothness > 0) {
                const s = engine.depthMapSmoothness / 2;
                normZ = smoothstep(0.5 - s, 0.5 + s, normZ);
            }
            
            if (engine.edgeDepth > 0.0 && v.edgeDist !== undefined) {
                const bevel = Math.max(0.01, engine.edgeBevel);
                let edgeFactor = Math.min(1.0, v.edgeDist / bevel);
                edgeFactor = smoothstep(0, 1, edgeFactor);
                // Reduce normZ when close to the edge
                normZ = normZ - engine.edgeDepth * (1.0 - edgeFactor);
                if (normZ < 0) normZ = 0;
            }
            
            const startDrop = engine.depthGradientY - engine.depthGradientSmoothness / 2;
            const endDrop = engine.depthGradientY + engine.depthGradientSmoothness / 2;
            let depthMask = 1.0 - smoothstep(startDrop, endDrop, normY);
            
            // Pin smooths out depth distortions based on weight
            depthMask *= Math.max(0, 1.0 - Math.min(1.0, totalPinDepthFix));

            if (engine.mode === 'PREVIEW' && engine.lissajousActive) {
                normZ += (lissaX * 0.05 + lissaY * 0.05) * depthMask;
            }

            // Convert normZ (0 to 1) into a Z offset. For convex depth, white (1) should move toward negative Z (closer to the camera)
            let z_offset = (0.5 - normZ) * 2.0 * engine.depthMultiplier * depthMask * 80;
            z_offset -= deformOffsetZ * depthMask; // Mesh puxada pra frente

            let lx = finalX - centerX; let ly = finalY - centerY; let lz = z_offset;

            // Yaw rotation (Y axis)
            let x2 = lx * Math.cos(yawAngle * depthMask) - lz * Math.sin(yawAngle * depthMask);
            let z2 = lx * Math.sin(yawAngle * depthMask) + lz * Math.cos(yawAngle * depthMask);

            // Pitch rotation (X axis)
            let y3 = ly * Math.cos(pitchAngle * depthMask) + z2 * Math.sin(pitchAngle * depthMask);
            let z3 = -ly * Math.sin(pitchAngle * depthMask) + z2 * Math.cos(pitchAngle * depthMask);

            // Linear parallax
            x2 += z_offset * ((engine.parallaxX || 0) + lissaParX) * 1.5;
            y3 += z_offset * ((engine.parallaxY || 0) + lissaParY) * 1.5;

            // 3D camera projection
            const perspective = 600;
            const scale = perspective / (perspective + z3);
            finalX = centerX + x2 * scale; finalY = centerY + y3 * scale;
            
            return { x: finalX, y: finalY };
        });
    };

    const getMeshCenter = () => ({
        x: engine.imageRect.x + engine.imageRect.w / 2,
        y: engine.imageRect.y + engine.imageRect.h / 2
    });

    const getMeshGuideRect = () => {
        const scale = engine.meshScale || 1;
        return {
            x: engine.imageRect.x - (engine.meshOffsetX || 0),
            y: engine.imageRect.y - (engine.meshOffsetY || 0),
            w: engine.imageRect.w / scale,
            h: engine.imageRect.h / scale
        };
    };

    const pointInMesh = (point) => (
        point.x >= engine.imageRect.x &&
        point.x <= engine.imageRect.x + engine.imageRect.w &&
        point.y >= engine.imageRect.y &&
        point.y <= engine.imageRect.y + engine.imageRect.h
    );

    const transformPointAround = (point, center, scale, angle) => {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        return {
            x: center.x + (dx * cosA - dy * sinA) * scale,
            y: center.y + (dx * sinA + dy * cosA) * scale
        };
    };

    const translateMesh = (dx, dy) => {
        engine.meshOffsetX = (engine.meshOffsetX || 0) + dx;
        engine.meshOffsetY = (engine.meshOffsetY || 0) + dy;
        engine.imageRect.x += dx;
        engine.imageRect.y += dy;
        engine.verticesRest.forEach(v => { v.x += dx; v.y += dy; });
        engine.verticesCurrent.forEach(v => { v.x += dx; v.y += dy; });
        engine.bones.forEach(b => {
            b.startRest.x += dx; b.startRest.y += dy; b.endRest.x += dx; b.endRest.y += dy;
            b.startCurr.x += dx; b.startCurr.y += dy; b.endCurr.x += dx; b.endCurr.y += dy;
        });
        engine.jiggles.forEach(j => { j.restX += dx; j.restY += dy; j.physX += dx; j.physY += dy; });
        engine.pins.forEach(p => { p.restX += dx; p.restY += dy; });
    };

    const transformMeshAroundCenter = (scale, angle) => {
        engine.meshScale = (engine.meshScale || 1) * scale;
        engine.meshRotation = (engine.meshRotation || 0) + angle;
        const center = getMeshCenter();
        const nextRectTopLeft = transformPointAround({ x: engine.imageRect.x, y: engine.imageRect.y }, center, scale, 0);
        engine.imageRect.x = nextRectTopLeft.x;
        engine.imageRect.y = nextRectTopLeft.y;
        engine.imageRect.w = Math.max(10, engine.imageRect.w * scale);
        engine.imageRect.h = Math.max(10, engine.imageRect.h * scale);
        engine.verticesRest.forEach(v => Object.assign(v, transformPointAround(v, center, scale, angle)));
        engine.verticesCurrent.forEach(v => Object.assign(v, transformPointAround(v, center, scale, angle)));
        engine.bones.forEach(b => {
            b.startRest = transformPointAround(b.startRest, center, scale, angle);
            b.endRest = transformPointAround(b.endRest, center, scale, angle);
            b.startCurr = { ...b.startRest };
            b.endCurr = { ...b.endRest };
            b.length = Math.hypot(b.endRest.x - b.startRest.x, b.endRest.y - b.startRest.y);
            b.angleRest = Math.atan2(b.endRest.y - b.startRest.y, b.endRest.x - b.startRest.x);
            b.angleCurr = b.angleRest;
        });
        engine.jiggles.forEach(j => {
            const next = transformPointAround({ x: j.restX, y: j.restY }, center, scale, angle);
            j.restX = next.x; j.restY = next.y; j.physX = next.x; j.physY = next.y;
            j.rx = Math.max(5, j.rx * scale); j.ry = Math.max(5, j.ry * scale);
        });
        engine.pins.forEach(p => {
            const next = transformPointAround({ x: p.restX, y: p.restY }, center, scale, angle);
            p.restX = next.x; p.restY = next.y; p.radius = Math.max(5, p.radius * scale);
        });
        snapBoneParents();
        engine.jiggles.forEach(j => {
            const bone = engine.bones.find(b => b.id === (j.boneId || j.parentId));
            if (!bone) return;
            const cosA = Math.cos(-bone.angleRest); const sinA = Math.sin(-bone.angleRest);
            j.localX = (j.restX - bone.startRest.x) * cosA - (j.restY - bone.startRest.y) * sinA;
            j.localY = (j.restX - bone.startRest.x) * sinA + (j.restY - bone.startRest.y) * cosA;
        });
        engine.pins.forEach(p => {
            const bone = engine.bones.find(b => b.id === p.parentId);
            if (!bone) return;
            const cosA = Math.cos(-bone.angleRest); const sinA = Math.sin(-bone.angleRest);
            p.localX = (p.restX - bone.startRest.x) * cosA - (p.restY - bone.startRest.y) * sinA;
            p.localY = (p.restX - bone.startRest.x) * sinA + (p.restY - bone.startRest.y) * cosA;
        });
        bindMesh();
    };

    // === MOUSE EVENTS ===
    const handleMouseDown = (e) => {
        if (e.button === 1) {
            e.preventDefault();
            engine.isPanning = true;
            engine.isCreating = false;
            engine.isDragging = false;
            engine.draggingBoneId = null;
            engine.draggingItem = null;
            engine.panStartScreen = { x: e.clientX, y: e.clientY };
            engine.panStartOffset = { x: engine.panX || 0, y: engine.panY || 0 };
            return;
        }
        if (e.button !== 0) return;

        const mouse = getMouseWorld(e);
        
        // DELETE ITEM (Ctrl + Shift + Click)
        if (engine.mode === 'EDIT' && e.ctrlKey && e.shiftKey) {
            let minDist = 30 / engine.zoom; let foundType = null; let foundIdx = -1; let deletedId = null;
            engine.bones.forEach((b, i) => {
                if (Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y) < minDist || Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y) < minDist) { minDist = Math.min(Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y), Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y)); foundType = 'BONE'; foundIdx = i; }
            });
            engine.jiggles.forEach((br, i) => {
                let cx = br.restX; let cy = br.restY;
                if(br.boneId) { const b = engine.bones.find(bo=>bo.id===br.boneId); if(b) { cx = b.startRest.x + br.localX * Math.cos(b.angleRest) - br.localY * Math.sin(b.angleRest); cy = b.startRest.y + br.localX * Math.sin(b.angleRest) + br.localY * Math.cos(b.angleRest); } }
                if (Math.hypot(mouse.x - cx, mouse.y - cy) < minDist) { minDist = Math.hypot(mouse.x - cx, mouse.y - cy); foundType = 'JIGGLE'; foundIdx = i; }
            });
            engine.pins.forEach((pin, i) => { 
                let cx = pin.restX; let cy = pin.restY;
                if(pin.parentId) { const b = engine.bones.find(bo=>bo.id===pin.parentId); if(b) { cx = b.startRest.x + pin.localX * Math.cos(b.angleRest) - pin.localY * Math.sin(b.angleRest); cy = b.startRest.y + pin.localX * Math.sin(b.angleRest) + pin.localY * Math.cos(b.angleRest); } }
                if (Math.hypot(mouse.x - cx, mouse.y - cy) < minDist) { minDist = Math.hypot(mouse.x - cx, mouse.y - cy); foundType = 'PIN'; foundIdx = i; } 
            });

            if (foundType === 'BONE') { const bId = engine.bones[foundIdx].id; deletedId = bId; engine.bones.splice(foundIdx, 1); engine.bones.forEach(b => { if (b.parentId === bId) b.parentId = null; }); } 
            else if (foundType === 'JIGGLE') { deletedId = engine.jiggles[foundIdx].id; engine.jiggles.splice(foundIdx, 1); }
            else if (foundType === 'PIN') { deletedId = engine.pins[foundIdx].id; engine.pins.splice(foundIdx, 1); }
            
            if (foundType) { if (selectedItem && selectedItem.id === deletedId) setSelectedItem(null); applyRemesh(meshType, gridSize); return; }
        }

        // REPARENT ITEM (Alt + Click)
        if (engine.mode === 'EDIT' && e.altKey && selectedItem && (selectedItem.type === 'JIGGLE' || selectedItem.type === 'PIN')) {
            let closestBone = null; let minDist = 25 / engine.zoom;
            engine.bones.forEach((b) => {
                const d = distPointToSegment(mouse, b.startRest, b.endRest);
                if (d < minDist) { minDist = d; closestBone = b; }
            });
            if (closestBone) {
                if (selectedItem.type === 'JIGGLE') {
                    const j = engine.jiggles.find(x => x.id === selectedItem.id);
                    if (j) {
                        j.boneId = closestBone.id; j.parentId = closestBone.id;
                        const cosA = Math.cos(-closestBone.angleRest); const sinA = Math.sin(-closestBone.angleRest);
                        j.localX = (j.restX - closestBone.startRest.x) * cosA - (j.restY - closestBone.startRest.y) * sinA;
                        j.localY = (j.restX - closestBone.startRest.x) * sinA + (j.restY - closestBone.startRest.y) * cosA;
                        bindMesh();
                    }
                } else if (selectedItem.type === 'PIN') {
                    const p = engine.pins.find(x => x.id === selectedItem.id);
                    if (p) {
                        p.parentId = closestBone.id;
                        const cosA = Math.cos(-closestBone.angleRest); const sinA = Math.sin(-closestBone.angleRest);
                        p.localX = (p.restX - closestBone.startRest.x) * cosA - (p.restY - closestBone.startRest.y) * sinA;
                        p.localY = (p.restX - closestBone.startRest.x) * sinA + (p.restY - closestBone.startRest.y) * cosA;
                        bindMesh();
                    }
                }
            }
            return;
        }

        if (engine.mode === 'EDIT') {
            if (!engine.isSpacePressed && selectedItem && transformTool !== 'SELECT') {
                const item =
                    selectedItem.type === 'BONE' ? engine.bones.find(b => b.id === selectedItem.id) :
                    selectedItem.type === 'PIN' ? engine.pins.find(p => p.id === selectedItem.id) :
                    selectedItem.type === 'JIGGLE' ? engine.jiggles.find(j => j.id === selectedItem.id) :
                    selectedItem.type === 'MESH' ? engine.imageRect :
                    null;
                if (item) {
                    engine.isDragging = true;
                    engine.draggingItem = { type: `EDIT_${transformTool}`, item, itemType: selectedItem.type };
                    engine.newStartPos = { ...mouse };
                    if (selectedItem.type === 'BONE' && transformTool === 'SCALE') {
                        engine.scaleStartLength = item.length;
                        engine.scaleStartMouseDist = Math.max(1, Math.hypot(mouse.x - (item.startRest.x + item.endRest.x) / 2, mouse.y - (item.startRest.y + item.endRest.y) / 2));
                    }
                    if (selectedItem.type === 'MESH') {
                        const center = getMeshCenter();
                        engine.scaleStartMouseDist = Math.max(1, Math.hypot(mouse.x - center.x, mouse.y - center.y));
                        engine.rotateStartAngle = Math.atan2(mouse.y - center.y, mouse.x - center.x);
                        engine.meshDragStartOffsetX = engine.meshOffsetX || 0;
                        engine.meshDragStartOffsetY = engine.meshOffsetY || 0;
                    }
                    return;
                }
            }

            if (engine.isSpacePressed) {
                // MOVE AND RESIZE TOOL
                let found = null; let minDist = 30 / engine.zoom;
                
                // 1. Resize jiggles/pins (edges)
                engine.pins.forEach(pin => { 
                    let cx = pin.restX; let cy = pin.restY;
                    if(pin.parentId) { const b = engine.bones.find(bo=>bo.id===pin.parentId); if(b) { cx = b.startRest.x + pin.localX * Math.cos(b.angleRest) - pin.localY * Math.sin(b.angleRest); cy = b.startRest.y + pin.localX * Math.sin(b.angleRest) + pin.localY * Math.cos(b.angleRest); } }
                    const d = Math.hypot(mouse.x - cx, mouse.y - cy);
                    if(Math.abs(d - pin.radius) < 8/engine.zoom) { minDist = 0; found = { type: 'PIN_EDGE', item: pin }; } 
                    else if(d < minDist && d < pin.radius) { minDist = d; found = { type: 'PIN_CENTER', item: pin }; } 
                });
                engine.jiggles.forEach(br => {
                    let cx = br.restX; let cy = br.restY;
                    if(br.boneId) { const b = engine.bones.find(bo=>bo.id===br.boneId); if(b) { cx = b.startRest.x + br.localX * Math.cos(b.angleRest) - br.localY * Math.sin(b.angleRest); cy = b.startRest.y + br.localX * Math.sin(b.angleRest) + br.localY * Math.cos(b.angleRest); } }
                    const dx = mouse.x - cx; const dy = mouse.y - cy; const d = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx); const edgeD = Math.hypot(br.rx * Math.cos(ang), br.ry * Math.sin(ang));
                    if(Math.abs(d - edgeD) < 8/engine.zoom) { minDist = 0; found = { type: 'JIGGLE_EDGE', item: br }; }
                    else if(d < minDist && d < edgeD) { minDist = d; found = { type: 'JIGGLE_CENTER', item: br }; }
                });

                // 2. Moving bones
                if (!found) {
                    engine.bones.forEach(b => {
                        if (Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y) < minDist) { minDist = Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y); found = { type: 'BONE_END', item: b }; }
                        if (!b.parentId && Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y) < minDist) { minDist = Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y); found = { type: 'BONE_START', item: b }; }
                    });
                }
                if (found) { engine.isDragging = true; engine.draggingItem = found; engine.newStartPos = { ...mouse }; }
            } else {
                // SELECTION CHECK BEFORE CREATING
                let clicked = null;
                engine.pins.forEach(pin => {
                    let cx = pin.restX; let cy = pin.restY;
                    if(pin.parentId) { const b = engine.bones.find(bo=>bo.id===pin.parentId); if(b) { cx = b.startRest.x + pin.localX * Math.cos(b.angleRest) - pin.localY * Math.sin(b.angleRest); cy = b.startRest.y + pin.localX * Math.sin(b.angleRest) + pin.localY * Math.cos(b.angleRest); } }
                    if (Math.hypot(mouse.x - cx, mouse.y - cy) < Math.max(pin.radius, 15/engine.zoom)) clicked = { type: 'PIN', id: pin.id };
                });
                engine.jiggles.forEach(br => {
                    let cx = br.restX; let cy = br.restY;
                    if(br.boneId) { const b = engine.bones.find(bo=>bo.id===br.boneId); if(b) { cx = b.startRest.x + br.localX * Math.cos(b.angleRest) - br.localY * Math.sin(b.angleRest); cy = b.startRest.y + br.localX * Math.sin(b.angleRest) + br.localY * Math.cos(b.angleRest); } }
                    if (Math.hypot(mouse.x - cx, mouse.y - cy) < Math.max(br.rx, br.ry, 20/engine.zoom)) clicked = { type: 'JIGGLE', id: br.id };
                });

                let selDist = 15 / engine.zoom;
                engine.bones.forEach(b => {
                    const dSegment = distPointToSegment(mouse, b.startRest, b.endRest);
                    if (dSegment < selDist) { selDist = dSegment; clicked = { type: 'BONE', id: b.id }; }
                });
                if (editTool === 'BONE') {
                    let closestJoint = null; let minDist = 22 / engine.zoom;
                    engine.bones.forEach(b => {
                        const dEnd = Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y);
                        const dStart = Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y);
                        if (dEnd < minDist) {
                            minDist = dEnd;
                            closestJoint = { id: b.id, pos: b.endRest };
                        } else if (!b.parentId && dStart < minDist) {
                            minDist = dStart;
                            closestJoint = { id: null, pos: b.startRest };
                        }
                    });
                    if (closestJoint) {
                        engine.isCreating = true;
                        engine.newStartPos = { ...closestJoint.pos };
                        engine.newParentId = closestJoint.id;
                        return;
                    }
                }

                if (clicked) { setSelectedItem(clicked); engine.isCreating = false; return; }
                setSelectedItem(null); 
                
                // CREATE TOOL
                if (editTool === 'BONE') {
                    let closestJoint = null; let minDist = 20 / engine.zoom; 
                    engine.bones.forEach(b => {
                        const dEnd = Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y); const dStart = Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y);
                        if (dEnd < minDist) { minDist = dEnd; closestJoint = { id: b.id, pos: b.endRest }; } else if (dStart < minDist) { minDist = dStart; closestJoint = { id: null, pos: b.startRest }; }
                    });
                    engine.isCreating = true;
                    if (closestJoint) { engine.newStartPos = { ...closestJoint.pos }; engine.newParentId = closestJoint.id; } else { engine.newStartPos = { x: mouse.x, y: mouse.y }; engine.newParentId = null; }
                } else if (editTool === 'JIGGLE' || editTool === 'PIN') {
                    let closestBone = null; let minDist = Infinity;
                    engine.bones.forEach(b => { 
                        const d = distPointToSegment(mouse, b.startRest, b.endRest); 
                        if (d < minDist) { minDist = d; closestBone = b; } 
                    });
                    engine.isCreating = true; engine.newStartPos = { x: mouse.x, y: mouse.y }; 
                    engine.newParentId = closestBone ? closestBone.id : null;
                }
            }
        } else if (engine.mode === 'PREVIEW') {
            if (selectedItem && transformTool !== 'SELECT') {
                const item =
                    selectedItem.type === 'BONE' ? engine.bones.find(b => b.id === selectedItem.id) :
                    selectedItem.type === 'PIN' ? engine.pins.find(p => p.id === selectedItem.id) :
                    selectedItem.type === 'JIGGLE' ? engine.jiggles.find(j => j.id === selectedItem.id) :
                    null;
                if (item) {
                    engine.draggingItem = { type: selectedItem.type, item };
                    engine.draggingBoneId = selectedItem.type === 'BONE' ? selectedItem.id : null;
                    engine.newStartPos = { ...mouse };
                    engine.animPlaying = false;
                    engine.timelineScrub = false;
                    if (selectedItem.type === 'BONE' && transformTool === 'SCALE') {
                        engine.scaleStartLength = item.length;
                        engine.scaleStartMouseDist = Math.max(1, Math.hypot(mouse.x - (item.startCurr.x + item.endCurr.x) / 2, mouse.y - (item.startCurr.y + item.endCurr.y) / 2));
                    }
                    setAnimPlaying(false);
                    return;
                }
            }
            let clicked = null;
            engine.pins.forEach(pin => {
                let cx = pin.restX; let cy = pin.restY;
                if(pin.parentId) {
                    const bone = engine.bones.find(bo=>bo.id===pin.parentId);
                    if(bone) {
                        const bStart = bone.startCurr;
                        const displayAngle = bone.displayAngle || bone.angleCurr;
                        const cosA = Math.cos(displayAngle); const sinA = Math.sin(displayAngle);
                        cx = bStart.x + pin.localX * cosA - pin.localY * sinA; cy = bStart.y + pin.localX * sinA + pin.localY * cosA;
                    }
                }
                if (Math.hypot(mouse.x - cx, mouse.y - cy) < Math.max(pin.radius, 15/engine.zoom)) clicked = { type: 'PIN', id: pin.id };
            });
            engine.jiggles.forEach(br => {
                let cx = br.physX; let cy = br.physY;
                if (Math.hypot(mouse.x - cx, mouse.y - cy) < Math.max(br.rx, br.ry, 20/engine.zoom)) clicked = { type: 'JIGGLE', id: br.id };
            });

            if (clicked) { setSelectedItem(clicked); return; } else { setSelectedItem(null); }

            let selected = null; let minDist = 25 / engine.zoom;
            engine.bones.forEach(b => { 
                const d = Math.hypot(mouse.x - b.endCurr.x, mouse.y - b.endCurr.y); 
                if (d < minDist) { minDist = d; selected = b.id; } 
                const d2 = Math.hypot(mouse.x - b.startCurr.x, mouse.y - b.startCurr.y);
                if (d2 < minDist) { minDist = d2; selected = b.id; }
                // Select anywhere along bone segment
                const dSegment = distPointToSegment(mouse, b.startCurr, b.endCurr);
                if (dSegment < minDist) { minDist = dSegment; selected = b.id; }
            });
            if (selected) { 
                setSelectedItem({ type: 'BONE', id: selected });
                if (transformTool !== 'SELECT') {
                    engine.draggingBoneId = selected; 
                    engine.draggingItem = { type: 'BONE', item: engine.bones.find(b => b.id === selected) };
                    engine.newStartPos = { ...mouse }; 
                    setAnimPlaying(false); 
                }
            }
        }
    };

    const handleMouseMove = (e) => {
        if (engine.isPanning) {
            e.preventDefault();
            const start = engine.panStartScreen || { x: e.clientX, y: e.clientY };
            const offset = engine.panStartOffset || { x: engine.panX || 0, y: engine.panY || 0 };
            engine.panX = offset.x + e.clientX - start.x;
            engine.panY = offset.y + e.clientY - start.y;
            setCursorStyle('grabbing');
            return;
        }

        const mouse = getMouseWorld(e);
        engine.mousePos = { x: mouse.x, y: mouse.y };

        // CURSOR STYLE
        let curs = 'crosshair';
        if (engine.mode === 'EDIT' && engine.isSpacePressed) {
            curs = 'grab';
            engine.pins.forEach(pin => { 
                let cx = pin.restX; let cy = pin.restY;
                if(pin.parentId) { const b = engine.bones.find(bo=>bo.id===pin.parentId); if(b) { cx = b.startRest.x + pin.localX * Math.cos(b.angleRest) - pin.localY * Math.sin(b.angleRest); cy = b.startRest.y + pin.localX * Math.sin(b.angleRest) + pin.localY * Math.cos(b.angleRest); } }
                if(Math.abs(Math.hypot(mouse.x - cx, mouse.y - cy) - pin.radius) < 8/engine.zoom) curs = 'nwse-resize'; 
            });
            engine.jiggles.forEach(br => {
                let cx = br.restX; let cy = br.restY;
                if(br.boneId) { const b = engine.bones.find(bo=>bo.id===br.boneId); if(b) { cx = b.startRest.x + br.localX * Math.cos(b.angleRest) - br.localY * Math.sin(b.angleRest); cy = b.startRest.y + br.localX * Math.sin(b.angleRest) + br.localY * Math.cos(b.angleRest); } }
                const dx = mouse.x - cx; const dy = mouse.y - cy; const d = Math.hypot(dx, dy); const ang = Math.atan2(dy, dx); const edgeD = Math.hypot(br.rx * Math.cos(ang), br.ry * Math.sin(ang));
                if(Math.abs(d - edgeD) < 8/engine.zoom) curs = 'nwse-resize'; 
            });
        }
        if (engine.isDragging || engine.draggingBoneId) curs = 'grabbing';
        setCursorStyle(curs);

        if (engine.useMouseRotation && e.buttons === 0 && !engine.draggingBoneId) { 
            engine.pitchX = ((mouse.screenY - mouse.ch) / mouse.ch) * engine.mouseRotationIntensity * -1; 
            engine.yawY = ((mouse.screenX - mouse.cw) / mouse.cw) * engine.mouseRotationIntensity; 
        }
        if (engine.useMouseParallax && e.buttons === 0 && !engine.draggingBoneId) {
            engine.parallaxX = ((mouse.cw - mouse.screenX) / mouse.cw) * engine.mouseParallaxIntensity * -1; 
            engine.parallaxY = ((mouse.screenY - mouse.ch) / mouse.ch) * engine.mouseParallaxIntensity;
        }

        if (engine.mode === 'EDIT') {
            if (engine.isDragging && engine.draggingItem) {
                const dx = mouse.x - engine.newStartPos.x; const dy = mouse.y - engine.newStartPos.y;
                engine.newStartPos = { ...mouse };
                const { type, item } = engine.draggingItem;
                
                if (type === 'EDIT_TRANSLATE') {
                    if (engine.draggingItem.itemType === 'MESH') {
                        translateMesh(dx, dy);
                    } else if (engine.draggingItem.itemType === 'BONE') {
                        const moveBoneRecursive = (bone, vx, vy) => {
                            bone.startRest.x += vx; bone.startRest.y += vy; bone.endRest.x += vx; bone.endRest.y += vy;
                            bone.startCurr.x += vx; bone.startCurr.y += vy; bone.endCurr.x += vx; bone.endCurr.y += vy;
                            engine.bones.filter(c => c.parentId === bone.id).forEach(c => moveBoneRecursive(c, vx, vy));
                        };
                        moveBoneRecursive(item, dx, dy);
                    } else {
                        movePinnedItem(item, dx, dy);
                    }
                } else if (type === 'EDIT_ROTATE' && engine.draggingItem.itemType === 'MESH') {
                    const center = getMeshCenter();
                    const nextAngle = Math.atan2(mouse.y - center.y, mouse.x - center.x);
                    const deltaAngle = shortestAngleDelta(engine.rotateStartAngle || nextAngle, nextAngle);
                    engine.rotateStartAngle = nextAngle;
                    transformMeshAroundCenter(1, deltaAngle);
                } else if (type === 'EDIT_ROTATE' && engine.draggingItem.itemType === 'BONE') {
                    const newAngle = Math.atan2(mouse.y - item.startRest.y, mouse.x - item.startRest.x);
                    const deltaAngle = newAngle - item.angleRest;
                    item.angleRest = newAngle;
                    item.angleCurr = newAngle;
                    item.endRest = { x: item.startRest.x + Math.cos(item.angleRest) * item.length, y: item.startRest.y + Math.sin(item.angleRest) * item.length };
                    item.endCurr = { ...item.endRest };
                    const rotateChildren = (parent, delta) => {
                        engine.bones.filter(c => c.parentId === parent.id).forEach(c => {
                            c.startRest = { ...parent.endRest };
                            c.startCurr = { ...parent.endCurr };
                            c.angleRest += delta;
                            c.angleCurr = c.angleRest;
                            c.endRest = { x: c.startRest.x + Math.cos(c.angleRest) * c.length, y: c.startRest.y + Math.sin(c.angleRest) * c.length };
                            c.endCurr = { ...c.endRest };
                            rotateChildren(c, delta);
                        });
                    };
                    rotateChildren(item, deltaAngle);
                    bindMesh();
                } else if (type === 'EDIT_SCALE') {
                    if (engine.draggingItem.itemType === 'MESH') {
                        const center = getMeshCenter();
                        const currDist = Math.max(1, Math.hypot(mouse.x - center.x, mouse.y - center.y));
                        const scale = currDist / (engine.scaleStartMouseDist || currDist);
                        engine.scaleStartMouseDist = currDist;
                        transformMeshAroundCenter(scale, 0);
                    } else if (engine.draggingItem.itemType === 'BONE') {
                        const startDist = engine.scaleStartMouseDist || 1;
                        const mid = { x: (item.startRest.x + item.endRest.x) / 2, y: (item.startRest.y + item.endRest.y) / 2 };
                        const currDist = Math.max(1, Math.hypot(mouse.x - mid.x, mouse.y - mid.y));
                        item.length = Math.max(5, (engine.scaleStartLength || item.length) * (currDist / startDist));
                        item.endRest = { x: item.startRest.x + Math.cos(item.angleRest) * item.length, y: item.startRest.y + Math.sin(item.angleRest) * item.length };
                        item.endCurr = { ...item.endRest };
                        engine.bones.filter(c => c.parentId === item.id).forEach(c => {
                            const vx = item.endRest.x - c.startRest.x;
                            const vy = item.endRest.y - c.startRest.y;
                            const moveBoneRecursive = (bone, mx, my) => {
                                bone.startRest.x += mx; bone.startRest.y += my; bone.endRest.x += mx; bone.endRest.y += my;
                                bone.startCurr.x += mx; bone.startCurr.y += my; bone.endCurr.x += mx; bone.endCurr.y += my;
                                engine.bones.filter(child => child.parentId === bone.id).forEach(child => moveBoneRecursive(child, mx, my));
                            };
                            moveBoneRecursive(c, vx, vy);
                        });
                    } else if (engine.draggingItem.itemType === 'PIN') {
                        item.radius = Math.max(5, item.radius + dx);
                    } else if (engine.draggingItem.itemType === 'JIGGLE') {
                        item.rx = Math.max(5, item.rx + dx);
                        item.ry = Math.max(5, item.ry + dy);
                    }
                    bindMesh();
                } else if (type === 'BONE_START') {
                    const moveBoneRecursive = (bone, vx, vy) => {
                        bone.startRest.x += vx; bone.startRest.y += vy; bone.endRest.x += vx; bone.endRest.y += vy;
                        bone.startCurr.x += vx; bone.startCurr.y += vy; bone.endCurr.x += vx; bone.endCurr.y += vy;
                        engine.bones.filter(c => c.parentId === bone.id).forEach(c => moveBoneRecursive(c, vx, vy));
                    };
                    moveBoneRecursive(item, dx, dy);
                } else if (type === 'BONE_END') {
                    item.endRest.x += dx; item.endRest.y += dy; item.endCurr.x += dx; item.endCurr.y += dy;
                    item.length = Math.hypot(item.endRest.x - item.startRest.x, item.endRest.y - item.startRest.y);
                    item.angleRest = Math.atan2(item.endRest.y - item.startRest.y, item.endRest.x - item.startRest.x); item.angleCurr = item.angleRest;
                    const moveBoneRecursive = (bone, vx, vy) => {
                        bone.startRest.x += vx; bone.startRest.y += vy; bone.endRest.x += vx; bone.endRest.y += vy;
                        bone.startCurr.x += vx; bone.startCurr.y += vy; bone.endCurr.x += vx; bone.endCurr.y += vy;
                        engine.bones.filter(c => c.parentId === bone.id).forEach(c => moveBoneRecursive(c, vx, vy));
                    };
                    engine.bones.filter(c => c.parentId === item.id).forEach(c => moveBoneRecursive(c, dx, dy));
                } else if (type === 'JIGGLE_CENTER' || type === 'PIN_CENTER') {
                    const bone = engine.bones.find(b => b.id === item.boneId || b.id === item.parentId);
                    item.restX += dx; item.restY += dy;
                    if(bone) {
                        const cosA = Math.cos(-bone.angleRest); const sinA = Math.sin(-bone.angleRest);
                        item.localX = (item.restX - bone.startRest.x) * cosA - (item.restY - bone.startRest.y) * sinA;
                        item.localY = (item.restX - bone.startRest.x) * sinA + (item.restY - bone.startRest.y) * cosA;
                    }
                } else if (type === 'JIGGLE_EDGE') {
                    item.rx = Math.max(5, Math.abs(mouse.x - item.restX)); item.ry = Math.max(5, Math.abs(mouse.y - item.restY));
                } else if (type === 'PIN_EDGE') {
                    item.radius = Math.max(5, Math.hypot(mouse.x - item.restX, mouse.y - item.restY));
                }
            } else {
                engine.hoveredJoint = null;
                engine.bones.forEach(b => {
                    if (Math.hypot(mouse.x - b.endRest.x, mouse.y - b.endRest.y) < 20/engine.zoom) engine.hoveredJoint = b.endRest;
                    if (!b.parentId && Math.hypot(mouse.x - b.startRest.x, mouse.y - b.startRest.y) < 20/engine.zoom) engine.hoveredJoint = b.startRest;
                });
            }
        } else if (engine.mode === 'PREVIEW' && (engine.draggingBoneId || engine.draggingItem)) {
            const activeDrag = engine.draggingItem;
            if (activeDrag && (activeDrag.type === 'PIN' || activeDrag.type === 'JIGGLE')) {
                const item = activeDrag.item;
                const dx = mouse.x - engine.newStartPos.x;
                const dy = mouse.y - engine.newStartPos.y;
                engine.newStartPos = { ...mouse };
                if (transformTool === 'SCALE') {
                    if (activeDrag.type === 'PIN') item.radius = Math.max(5, item.radius + dx);
                    else {
                        item.rx = Math.max(5, item.rx + dx);
                        item.ry = Math.max(5, item.ry + dy);
                    }
                    bindMesh();
                } else {
                    movePinnedItem(item, dx, dy);
                    bindMesh();
                }
                return;
            }

            const bone = engine.bones.find(b => b.id === (engine.draggingBoneId || activeDrag?.item?.id));
            if (!bone) return;
            if (transformTool === 'TRANSLATE') {
                const dx = mouse.x - engine.newStartPos.x;
                const dy = mouse.y - engine.newStartPos.y;
                engine.newStartPos = { ...mouse };
                bone.poseOffsetX = (bone.poseOffsetX || 0) + dx;
                bone.poseOffsetY = (bone.poseOffsetY || 0) + dy;
            } else if (transformTool === 'ROTATE') {
                const targetAngle = Math.atan2(mouse.y - bone.startCurr.y, mouse.x - bone.startCurr.x);
                const deltaAngle = shortestAngleDelta(bone.angleCurr, targetAngle);
                bone.angleCurr += deltaAngle;
                bone.endCurr = { x: bone.startCurr.x + Math.cos(bone.angleCurr) * bone.length, y: bone.startCurr.y + Math.sin(bone.angleCurr) * bone.length };
                const traverse = (p) => {
                    engine.bones.filter(b => b.parentId === p.id).forEach(c => {
                        c.angleCurr += deltaAngle; c.startCurr = { ...p.endCurr };
                        c.endCurr = { x: c.startCurr.x + Math.cos(c.angleCurr) * c.length, y: c.startCurr.y + Math.sin(c.angleCurr) * c.length };
                        traverse(c);
                    });
                };
                traverse(bone);
            } else if (transformTool === 'SCALE') {
                const midBefore = { x: (bone.startCurr.x + bone.endCurr.x) / 2, y: (bone.startCurr.y + bone.endCurr.y) / 2 };
                const startDist = engine.scaleStartMouseDist || Math.max(1, Math.hypot(mouse.x - midBefore.x, mouse.y - midBefore.y));
                const currDist = Math.max(1, Math.hypot(mouse.x - midBefore.x, mouse.y - midBefore.y));
                const newLength = Math.max(5, (engine.scaleStartLength || bone.length) * (currDist / startDist));
                bone.length = newLength;
                bone.startCurr = {
                    x: midBefore.x - Math.cos(bone.angleCurr) * bone.length / 2,
                    y: midBefore.y - Math.sin(bone.angleCurr) * bone.length / 2
                };
                bone.endCurr = { x: bone.startCurr.x + Math.cos(bone.angleCurr) * bone.length, y: bone.startCurr.y + Math.sin(bone.angleCurr) * bone.length };
                if (!bone.parentId) {
                    bone.poseOffsetX = bone.startCurr.x - bone.startRest.x;
                    bone.poseOffsetY = bone.startCurr.y - bone.startRest.y;
                } else {
                    const parent = engine.bones.find(b => b.id === bone.parentId);
                    if (parent) {
                        bone.poseOffsetX = bone.startCurr.x - parent.endCurr.x;
                        bone.poseOffsetY = bone.startCurr.y - parent.endCurr.y;
                    }
                }
                const traverse = (p) => {
                    engine.bones.filter(b => b.parentId === p.id).forEach(c => {
                        c.startCurr = { x: p.endCurr.x + (c.poseOffsetX || 0), y: p.endCurr.y + (c.poseOffsetY || 0) };
                        c.endCurr = { x: c.startCurr.x + Math.cos(c.angleCurr) * c.length, y: c.startCurr.y + Math.sin(c.angleCurr) * c.length };
                        traverse(c);
                    });
                };
                traverse(bone);
            }
        }
    };

    const handleMouseUp = () => {
        if (engine.isPanning) {
            engine.isPanning = false;
            engine.panStartScreen = null;
            engine.panStartOffset = null;
            setCursorStyle('crosshair');
            return;
        }

        if (engine.mode === 'EDIT') {
            if (engine.isDragging) {
                const draggedType = engine.draggingItem?.itemType || engine.draggingItem?.type;
                engine.isDragging = false; engine.draggingItem = null;
                snapBoneParents();
                if (draggedType !== 'MESH' && meshType === 'OPTIMIZED') applyRemesh('OPTIMIZED', gridSize);
            } else if (engine.isCreating) {
                const dx = engine.mousePos.x - engine.newStartPos.x; const dy = engine.mousePos.y - engine.newStartPos.y;
                if (editTool === 'BONE' && Math.hypot(dx, dy) > 10 / engine.zoom) { 
                    const label = createBoneLabel();
                    engine.bones.push({
                        id: Math.random().toString(36).substr(2, 9), parentId: engine.newParentId,
                        name: label.name, color: label.color, colorIndex: label.colorIndex,
                        startRest: { ...engine.newStartPos }, endRest: { ...engine.mousePos },
                        startCurr: { ...engine.newStartPos }, endCurr: { ...engine.mousePos },
                        length: Math.hypot(dx, dy), angleRest: Math.atan2(dy, dx), angleCurr: Math.atan2(dy, dx)
                    });
                    if (meshType === 'OPTIMIZED') applyRemesh('OPTIMIZED', gridSize);
                } 
                else if (editTool === 'JIGGLE' && Math.abs(dx)>5 && Math.abs(dy)>5) {
                    const bone = engine.bones.find(b => b.id === engine.newParentId);
                    let localX = engine.newStartPos.x, localY = engine.newStartPos.y;
                    if (bone) {
                        const cosA = Math.cos(-bone.angleRest); const sinA = Math.sin(-bone.angleRest);
                        localX = (engine.newStartPos.x - bone.startRest.x) * cosA - (engine.newStartPos.y - bone.startRest.y) * sinA;
                        localY = (engine.newStartPos.x - bone.startRest.x) * sinA + (engine.newStartPos.y - bone.startRest.y) * cosA;
                    }
                    const newId = Math.random().toString(36).substr(2, 9);
                    engine.jiggles.push({
                        id: newId, boneId: engine.newParentId, localX, localY, rx: Math.abs(dx), ry: Math.abs(dy), 
                        restX: engine.newStartPos.x, restY: engine.newStartPos.y, physX: engine.newStartPos.x, physY: engine.newStartPos.y, velX: 0, velY: 0,
                        volume: 1.0, stiffness: 0.15, damping: 0.85
                    });
                    setSelectedItem({ type: 'JIGGLE', id: newId });
                    if (meshType === 'OPTIMIZED') applyRemesh('OPTIMIZED', gridSize);
                }
                else if (editTool === 'PIN' && Math.hypot(dx, dy) > 5) {
                    const bone = engine.bones.find(b => b.id === engine.newParentId);
                    let localX = engine.newStartPos.x, localY = engine.newStartPos.y;
                    if (bone) {
                        const cosA = Math.cos(-bone.angleRest); const sinA = Math.sin(-bone.angleRest);
                        localX = (engine.newStartPos.x - bone.startRest.x) * cosA - (engine.newStartPos.y - bone.startRest.y) * sinA;
                        localY = (engine.newStartPos.x - bone.startRest.x) * sinA + (engine.newStartPos.y - bone.startRest.y) * cosA;
                    }
                    const newId = Math.random().toString(36).substr(2, 9);
                    engine.pins.push({
                        id: newId, parentId: engine.newParentId, localX, localY,
                        restX: engine.newStartPos.x, restY: engine.newStartPos.y, radius: Math.hypot(dx, dy), intensity: 1.0, depthFix: 0.8, smoothness: 1.0
                    });
                    setSelectedItem({ type: 'PIN', id: newId });
                    if (meshType === 'OPTIMIZED') applyRemesh('OPTIMIZED', gridSize);
                }
                engine.isCreating = false;
            }
        }
        if (engine.mode === 'PREVIEW') {
            const wasDragging = !!(engine.draggingBoneId || engine.draggingItem);
            if (wasDragging && autoRecord && keyframes[selectedKeyframe]) {
                saveKeyframe();
            }
        }
        engine.draggingBoneId = null;
        engine.draggingItem = null;
        engine.scaleStartLength = null;
        engine.scaleStartMouseDist = null;
        engine.rotateStartAngle = null;
    };

    const handleUpdateProp = (prop, value) => {
        if (!selectedItem) return;
        if (selectedItem.type === 'JIGGLE') { const b = engine.jiggles.find(x => x.id === selectedItem.id); if (b) b[prop] = value; } 
        else if (selectedItem.type === 'PIN') { 
            const p = engine.pins.find(x => x.id === selectedItem.id); 
            if (p) {
                p[prop] = value; 
                if (prop === 'smoothness' || prop === 'radius') bindMesh();
            }
        }
        setForceRender(prev => prev + 1);
    };

    const resetSelectedTransform = (kind) => {
        if (!selectedItem) return;
        if (selectedItem.type === 'MESH') {
            if (kind === 'POSITION') { engine.meshOffsetX = 0; engine.meshOffsetY = 0; }
            if (kind === 'ROTATION') engine.meshRotation = 0;
            if (kind === 'SCALE') engine.meshScale = 1;
        } else if (selectedItem.type === 'BONE') {
            const bone = engine.bones.find(b => b.id === selectedItem.id);
            if (!bone) return;
            if (kind === 'POSITION') {
                bone.poseOffsetX = 0;
                bone.poseOffsetY = 0;
            }
            if (kind === 'ROTATION') bone.angleCurr = bone.angleRest;
            if (kind === 'SCALE') {
                bone.length = Math.max(5, Math.hypot(bone.endRest.x - bone.startRest.x, bone.endRest.y - bone.startRest.y));
            }
            computeForwardKinematics();
        }
        engine.animPlaying = false;
        engine.timelineScrub = false;
        setAnimPlaying(false);
        setForceRender(prev => prev + 1);
    };

    // === RENDERING ===
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let animationId;

        const onWheel = (e) => { e.preventDefault(); handleWheel(e); };
        const onAuxClick = (e) => { if (e.button === 1) e.preventDefault(); };
        const onContextMenu = (e) => e.preventDefault();
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('auxclick', onAuxClick);
        canvas.addEventListener('contextmenu', onContextMenu);

        const render = () => {
            const parent = containerRef.current;
            if (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight) {
                canvas.width = parent.clientWidth; canvas.height = parent.clientHeight;
                if(engine.image && engine.verticesRest.length === 0) applyRemesh(meshType, gridSize);
            }

            updateVertices();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const cw = canvas.width / 2; const ch = canvas.height / 2;
            ctx.save(); ctx.translate(cw + (engine.panX || 0), ch + (engine.panY || 0)); ctx.scale(engine.zoom, engine.zoom); ctx.translate(-cw, -ch);

            const area = getMeshGuideRect();
            const meshArea = engine.imageRect;
            ctx.save();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
            ctx.lineWidth = 1 / engine.zoom;
            ctx.setLineDash([8 / engine.zoom, 6 / engine.zoom]);
            ctx.fillRect(area.x, area.y, area.w, area.h);
            ctx.strokeRect(area.x, area.y, area.w, area.h);
            ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
            ctx.lineWidth = 3 / engine.zoom;
            ctx.beginPath();
            ctx.moveTo(area.x, area.y + area.h);
            ctx.lineTo(area.x + area.w, area.y + area.h);
            ctx.stroke();
            const floorCenterX = area.x + area.w / 2;
            const floorY = area.y + area.h;
            const markSize = 9 / engine.zoom;
            ctx.strokeStyle = '#020617';
            ctx.lineWidth = 2 / engine.zoom;
            ctx.beginPath();
            ctx.moveTo(floorCenterX - markSize, floorY);
            ctx.lineTo(floorCenterX + markSize, floorY);
            ctx.moveTo(floorCenterX, floorY - markSize);
            ctx.lineTo(floorCenterX, floorY + markSize);
            ctx.stroke();
            if (selectedItem?.type === 'MESH') {
                const center = getMeshCenter();
                ctx.strokeStyle = '#fbbf24';
                ctx.fillStyle = '#fbbf24';
                ctx.lineWidth = 2 / engine.zoom;
                ctx.strokeRect(meshArea.x, meshArea.y, meshArea.w, meshArea.h);
                ctx.beginPath();
                ctx.arc(center.x, center.y, 5 / engine.zoom, 0, Math.PI * 2);
                ctx.fill();
                if (transformTool === 'TRANSLATE') {
                    ctx.beginPath();
                    ctx.moveTo(center.x, center.y);
                    ctx.lineTo(center.x + 36 / engine.zoom, center.y);
                    ctx.moveTo(center.x, center.y);
                    ctx.lineTo(center.x, center.y - 36 / engine.zoom);
                    ctx.stroke();
                } else if (transformTool === 'ROTATE') {
                    ctx.beginPath();
                    ctx.arc(center.x, center.y, Math.max(meshArea.w, meshArea.h) / 2 + 18 / engine.zoom, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (transformTool === 'SCALE') {
                    const s = 8 / engine.zoom;
                    [[meshArea.x, meshArea.y], [meshArea.x + meshArea.w, meshArea.y], [meshArea.x + meshArea.w, meshArea.y + meshArea.h], [meshArea.x, meshArea.y + meshArea.h]].forEach(([x, y]) => {
                        ctx.fillRect(x - s / 2, y - s / 2, s, s);
                    });
                }
            }
            ctx.restore();

            const activeLayerIndex = layersRef.current.findIndex(layer => layer.id === activeLayerIdRef.current);
            const activeLayer = activeLayerIndex >= 0 ? layersRef.current[activeLayerIndex] : null;

            const deformLayer = (layer) => {
                if (!layer.verticesRest || !layer.weights || layer.verticesRest.length === 0) return;
                
                let centerX = layer.imageRect.x + layer.imageRect.w / 2;
                let centerY = layer.imageRect.y + layer.imageRect.h / 2;
                let lissaX = 0, lissaY = 0, lissaParX = 0, lissaParY = 0;
                
                if (engine.mode === 'PREVIEW' && lissajousActive) {
                    const t = Date.now() * 0.001;
                    const ptX = Math.sin(lissajousFreqX * t + lissajousPhase);
                    const ptY = Math.sin(lissajousFreqY * t);
                    const ratio = lissajousRatio;
                    const rx = ratio < 1 ? 1 : 1 / ratio;
                    const ry = ratio < 1 ? ratio : 1;
                    
                    const lissaX_pad = ptX * (lissajousIntensity / 10) * rx;
                    const lissaY_pad = ptY * (lissajousIntensity / 10) * ry;
                    
                    if (lissajousAffects !== 'MESH_ONLY') {
                        lissaParX = lissaX_pad;
                        lissaParY = lissaY_pad;
                    }
                    if (lissajousAffects === 'BONES_AND_DEPTH' || lissajousAffects === 'MESH_ONLY') {
                        lissaX = lissaX_pad * 100;
                        lissaY = lissaY_pad * 100;
                    }
                }
                
                const maxAngle = Math.PI / 4;
                let pitchAngle = (engine.pitchX || 0) * maxAngle;
                let yawAngle = (engine.yawY || 0) * maxAngle;
                
                layer.verticesCurrent = layer.verticesRest.map((v, i) => {
                    let finalX = v.x; let finalY = v.y;
                    let totalPinDepthFix = 0;
                    
                    if (layer.weights[i] && layer.weights[i].length > 0) {
                        finalX = 0; finalY = 0;
                        layer.weights[i].forEach(wObj => {
                            if (wObj.w > 0.001) {
                                if (wObj.type === 'bone') {
                                    const bone = engine.bones[wObj.idx];
                                    if (bone) {
                                        const cosA = Math.cos(bone.displayAngle ?? bone.angleCurr);
                                        const sinA = Math.sin(bone.displayAngle ?? bone.angleCurr);
                                        finalX += wObj.w * (wObj.localX * cosA - wObj.localY * sinA + (bone.startCurr?.x ?? bone.startRest.x));
                                        finalY += wObj.w * (wObj.localX * sinA + wObj.localY * cosA + (bone.startCurr?.y ?? bone.startRest.y));
                                    } else {
                                        finalX += wObj.w * v.x;
                                        finalY += wObj.w * v.y;
                                    }
                                }
                                else if (wObj.type === 'jiggle') {
                                    const jig = layer.jiggles?.[wObj.idx];
                                    let cx = jig ? jig.restX : v.x;
                                    let cy = jig ? jig.restY : v.y;
                                    let angleRef = 0;
                                    let sx = jig?.volume !== undefined ? jig.volume : 1.0;
                                    let sy = jig?.volume !== undefined ? jig.volume : 1.0;
                                    
                                    if (engine.mode === 'PREVIEW' && jig) {
                                        cx = jig.physX ?? cx;
                                        cy = jig.physY ?? cy;
                                        angleRef = jig.physAngle || 0;
                                        sx = jig.physScaleX || sx;
                                        sy = jig.physScaleY || sy;
                                    } else if (jig && (jig.boneId || jig.parentId)) {
                                        const bone = engine.bones.find(b => b.id === (jig.boneId || jig.parentId));
                                        if (bone) angleRef = bone.angleRest;
                                    }
                                    const cosA = Math.cos(angleRef); const sinA = Math.sin(angleRef);
                                    const scaledX = wObj.localX * sx;
                                    const scaledY = wObj.localY * sy;
                                    finalX += wObj.w * (scaledX * cosA - scaledY * sinA + cx);
                                    finalY += wObj.w * (scaledX * sinA + scaledY * cosA + cy);
                                }
                            }
                        });
                    }
                    
                    if (layer.vertexPins?.[i] && layer.vertexPins[i].length > 0) {
                        layer.vertexPins[i].forEach(vp => {
                            const pin = layer.pins?.[vp.pinIdx];
                            if (!pin) return;
                            
                            const bone = engine.bones.find(b => b.id === pin.parentId);
                            let rigidX = v.x; let rigidY = v.y;
                            let currStart = { ...v };
                            if (bone) {
                                const dx = v.x - bone.startRest.x; const dy = v.y - bone.startRest.y;
                                const cos0 = Math.cos(-bone.angleRest); const sin0 = Math.sin(-bone.angleRest);
                                const localX = dx * cos0 - dy * sin0;
                                const localY = dx * sin0 + dy * cos0;
                                
                                const displayAngle = engine.mode === 'PREVIEW' ? (bone.displayAngle ?? bone.angleCurr) : bone.angleRest;
                                currStart = engine.mode === 'PREVIEW' ? (bone.startCurr ?? bone.startRest) : bone.startRest;
                                
                                const cos1 = Math.cos(displayAngle); const sin1 = Math.sin(displayAngle);
                                rigidX = currStart.x + localX * cos1 - localY * sin1;
                                rigidY = currStart.y + localX * sin1 + localY * cos1;
                            }
                            
                            const strXY = pin.intensity !== undefined ? pin.intensity : 1.0;
                            const rotI = pin.rotIntensity !== undefined ? pin.rotIntensity : 1.0;
                            const posI = pin.posIntensity !== undefined ? pin.posIntensity : 1.0;
                            
                            const lbsDX = finalX - currStart.x;
                            const lbsDY = finalY - currStart.y;
                            const lbsDist = Math.hypot(lbsDX, lbsDY);
                            const lbsAngle = Math.atan2(lbsDY, lbsDX);
                            const strictAngle = Math.atan2(rigidY - currStart.y, rigidX - currStart.x);
                            
                            let diffAngle = strictAngle - lbsAngle;
                            while(diffAngle > Math.PI) diffAngle -= Math.PI*2;
                            while(diffAngle < -Math.PI) diffAngle += Math.PI*2;
                            
                            const finalRotAngle = lbsAngle + diffAngle * (vp.w * rotI * strXY);
                            const rotCorrectedX = currStart.x + Math.cos(finalRotAngle) * lbsDist;
                            const rotCorrectedY = currStart.y + Math.sin(finalRotAngle) * lbsDist;
                            
                            const weightXY = Math.min(1.0, vp.w * posI * strXY);
                            finalX = rotCorrectedX + (rigidX - rotCorrectedX) * weightXY;
                            finalY = rotCorrectedY + (rigidY - rotCorrectedY) * weightXY;
                            
                            totalPinDepthFix += vp.w * (pin.depthFix !== undefined ? pin.depthFix : 0.8);
                        });
                    }
                    
                    const normY = (v.y - layer.imageRect.y) / layer.imageRect.h;
                    if (engine.mode === 'PREVIEW' && lissajousActive && (lissajousAffects === 'BONES_AND_DEPTH' || lissajousAffects === 'MESH_ONLY')) {
                        finalX += lissaX;
                        finalY -= lissaY;
                    }
                    
                    const deformOffsetZ = Math.hypot(finalX - v.x, finalY - v.y) * deformZIntensity;
                    
                    let z = v.z !== undefined ? v.z : 128;
                    let normZ = z / 255.0;
                    if (invertDepth) normZ = 1.0 - normZ;
                    normZ = Math.pow(normZ, depthGamma);
                    if (depthMapSmoothness > 0) {
                        const s = depthMapSmoothness / 2;
                        normZ = smoothstep(0.5 - s, 0.5 + s, normZ);
                    }
                    
                    if (edgeDepth > 0.0 && v.edgeDist !== undefined) {
                        const bevel = Math.max(0.01, edgeBevel);
                        let edgeFactor = Math.min(1.0, v.edgeDist / bevel);
                        edgeFactor = smoothstep(0, 1, edgeFactor);
                        normZ = normZ - edgeDepth * (1.0 - edgeFactor);
                        if (normZ < 0) normZ = 0;
                    }
                    
                    const startDrop = depthGradientY - depthGradientSmoothness / 2;
                    const endDrop = depthGradientY + depthGradientSmoothness / 2;
                    let depthMask = 1.0 - smoothstep(startDrop, endDrop, normY);
                    
                    depthMask *= Math.max(0, 1.0 - Math.min(1.0, totalPinDepthFix));
                    
                    if (engine.mode === 'PREVIEW' && lissajousActive) {
                        normZ += (lissaX * 0.05 + lissaY * 0.05) * depthMask;
                    }
                    
                    let z_offset = (0.5 - normZ) * 2.0 * depthMultiplier * depthMask * 80;
                    z_offset -= deformOffsetZ * depthMask;
                    
                    let lx = finalX - centerX; let ly = finalY - centerY; let lz = z_offset;
                    
                    let x2 = lx * Math.cos(yawAngle * depthMask) - lz * Math.sin(yawAngle * depthMask);
                    let z2 = lx * Math.sin(yawAngle * depthMask) + lz * Math.cos(yawAngle * depthMask);
                    
                    let y3 = ly * Math.cos(pitchAngle * depthMask) + z2 * Math.sin(pitchAngle * depthMask);
                    let z3 = -ly * Math.sin(pitchAngle * depthMask) + z2 * Math.cos(pitchAngle * depthMask);
                    
                    x2 += z_offset * ((engine.parallaxX || 0) + lissaParX) * 1.5;
                    y3 += z_offset * ((engine.parallaxY || 0) + lissaParY) * 1.5;
                    
                    const perspective = 600;
                    const scale = perspective / (perspective + z3);
                    finalX = centerX + x2 * scale; finalY = centerY + y3 * scale;
                    
                    return { x: finalX, y: finalY };
                });
            };

            const drawPsdLayer = (layer, isActive = false) => {
                if (layer.visible === false) return;
                const source = (!isActive && !layer.isStatic && layer.previewSrc) ? layer.previewSrc : layer.imageSrc;
                const img = layerImageCache.current[source];
                if (!img || !layer.imageRect) return;
                
                ctx.save();
                ctx.globalAlpha = (layer.opacity !== undefined ? layer.opacity : 1) * (isActive ? 1 : inactiveLayerOpacity);
                
                if (!isActive && !layer.isStatic && engine.mode === 'PREVIEW' && layer.triangles && layer.triangles.length > 0) {
                    deformLayer(layer);
                    layer.triangles.forEach(tri => {
                        const p1 = layer.verticesCurrent?.[tri[0]];
                        const p2 = layer.verticesCurrent?.[tri[1]];
                        const p3 = layer.verticesCurrent?.[tri[2]];
                        const t1 = layer.verticesRest?.[tri[0]];
                        const t2 = layer.verticesRest?.[tri[1]];
                        const t3 = layer.verticesRest?.[tri[2]];
                        if (p1 && p2 && p3 && t1 && t2 && t3) {
                            drawTexturedTriangle(ctx, img, layer.imageRect, p1, p2, p3, t1, t2, t3);
                        }
                    });
                } else {
                    const isPreview = source === layer.previewSrc;
                    if (isPreview) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    else ctx.drawImage(img, layer.imageRect.x, layer.imageRect.y, layer.imageRect.w, layer.imageRect.h);
                }
                
                ctx.strokeStyle = isActive ? 'rgba(34, 211, 238, 0.85)' : 'rgba(148, 163, 184, 0.32)';
                ctx.lineWidth = 1 / engine.zoom;
                ctx.strokeRect(layer.imageRect.x, layer.imageRect.y, layer.imageRect.w, layer.imageRect.h);
                ctx.restore();
            };
            const layersBelowActive = activeLayerIndex >= 0 ? layersRef.current.slice(activeLayerIndex + 1).reverse() : layersRef.current.slice().reverse();
            layersBelowActive.forEach(drawPsdLayer);

            // DESENHA MALHA E TEXTURA
            if (activeLayer?.isStatic) {
                drawPsdLayer(activeLayer, true);
            } else if (engine.image && engine.triangles.length > 0) {
                engine.triangles.forEach(tri => {
                    const p1 = engine.verticesCurrent[tri[0]]; const p2 = engine.verticesCurrent[tri[1]]; const p3 = engine.verticesCurrent[tri[2]];
                    const t1 = engine.verticesRest[tri[0]]; const t2 = engine.verticesRest[tri[1]]; const t3 = engine.verticesRest[tri[2]];

                    if (!showWeights && !showDepthMask && !showDepthView) {
                        if (activeLayer?.visible !== false) drawTexturedTriangle(ctx, engine.image, engine.imageRect, p1, p2, p3, t1, t2, t3);
                    }
                    
                    if (wireframe || showWeights || showDepthMask || showDepthView) {
                        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
                        ctx.strokeStyle = (showWeights || showDepthMask || showDepthView) ? "rgba(255, 255, 255, 0.15)" : "rgba(255, 255, 255, 0.4)";
                        ctx.lineWidth = 1 / engine.zoom; ctx.stroke(); 
                        
                        if (showWeights && engine.weights[tri[0]]) {
                            let wAvg = new Array(engine.bones.length).fill(0); let pinAvg = 0;
                            [tri[0], tri[1], tri[2]].forEach(vIdx => { 
                                if(engine.weights[vIdx]) engine.weights[vIdx].forEach(wObj => {
                                    if(wObj.type === 'bone') wAvg[wObj.idx] += wObj.w / 3;
                                    else if(wObj.type === 'pin') pinAvg += wObj.w / 3;
                                }); 
                            });
                            let r=0, g=0, b=0;
                            wAvg.forEach((w, bIdx) => { if (w > 0) { const rgb = hslToRgb((bIdx * 137.5) % 360, 0.8, 0.6); r += rgb[0] * w; g += rgb[1] * w; b += rgb[2] * w; } });
                            r += 255 * pinAvg; g += 255 * pinAvg; b += 255 * pinAvg;
                            ctx.fillStyle = `rgba(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)}, 0.6)`; ctx.fill();
                        }

                        if (showDepthView) {
                            let zAvg = ((t1.z||128) + (t2.z||128) + (t3.z||128)) / 3;
                            let normZ = zAvg / 255.0;
                            if (engine.invertDepth) normZ = 1.0 - normZ;
                            normZ = Math.pow(normZ, engine.depthGamma);
                            if (engine.depthMapSmoothness > 0) {
                                const s = engine.depthMapSmoothness / 2;
                                normZ = smoothstep(0.5 - s, 0.5 + s, normZ);
                            }
                            if (engine.edgeDepth > 0.0 && t1.edgeDist !== undefined && t2.edgeDist !== undefined && t3.edgeDist !== undefined) {
                                const bevel = Math.max(0.01, engine.edgeBevel);
                                let distAvg = (t1.edgeDist + t2.edgeDist + t3.edgeDist) / 3;
                                let edgeFactor = Math.min(1.0, distAvg / bevel);
                                edgeFactor = smoothstep(0, 1, edgeFactor);
                                normZ = normZ - engine.edgeDepth * (1.0 - edgeFactor);
                                if (normZ < 0) normZ = 0;
                            }
                            const intensity = Math.floor(normZ * 255);
                            ctx.fillStyle = `rgba(${intensity}, ${intensity}, ${intensity}, 1.0)`; ctx.fill();
                        }

                        if (showDepthMask) {
                            const cy = (p1.y + p2.y + p3.y) / 3;
                            const normY = (cy - engine.imageRect.y) / engine.imageRect.h; 
                            const startDrop = engine.depthGradientY - engine.depthGradientSmoothness / 2;
                            const endDrop = engine.depthGradientY + engine.depthGradientSmoothness / 2;
                            const mask = 1.0 - smoothstep(startDrop, endDrop, normY);
                            const intensity = Math.floor(mask * 255);
                            ctx.fillStyle = `rgba(${intensity}, 50, ${255-intensity}, 0.8)`; ctx.fill(); 
                        }
                    }
                });
            }

            if (activeLayerIndex > 0) {
                layersRef.current.slice(0, activeLayerIndex).reverse().forEach(drawPsdLayer);
            }

            // DESENHAR PINS, JIGGLES E BONES
            // PINS
            if (engine.mode === 'EDIT' || engine.showPins) {
                engine.pins.forEach(pin => {
                    let cx = pin.restX; let cy = pin.restY;
                    if(pin.parentId) {     
                        const bone = engine.bones.find(b => b.id === pin.parentId);
                        if(bone) {
                            const bStart = engine.mode === 'EDIT' ? bone.startRest : bone.startCurr;
                            const displayAngle = engine.mode === 'EDIT' ? bone.angleRest : (bone.displayAngle || bone.angleCurr);
                            const cosA = Math.cos(displayAngle); const sinA = Math.sin(displayAngle);
                            cx = bStart.x + pin.localX * cosA - pin.localY * sinA; cy = bStart.y + pin.localX * sinA + pin.localY * cosA;
                            if(engine.mode === 'EDIT') { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bStart.x, bStart.y); ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)'; ctx.setLineDash([4/engine.zoom, 4/engine.zoom]); ctx.stroke(); ctx.setLineDash([]); }
                        }
                    }
                    if(engine.mode === 'EDIT') { pin.restX = cx; pin.restY = cy; } // Sync rest for UI selection check
                    ctx.beginPath(); ctx.arc(cx, cy, pin.radius, 0, Math.PI*2);
                    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)'; ctx.fill(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2/engine.zoom; ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(cx-5/engine.zoom, cy); ctx.lineTo(cx+5/engine.zoom, cy); ctx.moveTo(cx, cy-5/engine.zoom); ctx.lineTo(cx, cy+5/engine.zoom); ctx.stroke();
                    if(selectedItem && selectedItem.id === pin.id) { ctx.beginPath(); ctx.arc(cx, cy, pin.radius + 4/engine.zoom, 0, Math.PI*2); ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2/engine.zoom; ctx.stroke(); }
                });
            }

            // JIGGLES
            if (engine.mode === 'EDIT' || engine.showJiggles) {
                engine.jiggles.forEach(br => {
                    const bone = engine.bones.find(b => b.id === (br.boneId || br.parentId)); 
                    let cx = br.physX, cy = br.physY;
                    if(bone) {
                        const displayAngle = engine.mode === 'EDIT' ? bone.angleRest : (bone.displayAngle || bone.angleCurr);
                        const cosA = Math.cos(displayAngle); const sinA = Math.sin(displayAngle);
                        const bStart = engine.mode === 'EDIT' ? bone.startRest : bone.startCurr;
                        if(engine.mode === 'EDIT') { cx = bStart.x + br.localX * cosA - br.localY * sinA; cy = bStart.y + br.localX * sinA + br.localY * cosA; }
                        if(engine.mode === 'EDIT') { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bStart.x, bStart.y); ctx.strokeStyle = 'rgba(236, 72, 153, 0.8)'; ctx.setLineDash([4/engine.zoom, 4/engine.zoom]); ctx.stroke(); ctx.setLineDash([]); }
                    }
                    if(engine.mode === 'EDIT') { br.restX = cx; br.restY = cy; }
                    ctx.beginPath(); ctx.ellipse(cx, cy, br.rx, br.ry, 0, 0, Math.PI*2);
                    ctx.fillStyle = 'rgba(236, 72, 153, 0.3)'; ctx.fill(); ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 2/engine.zoom; ctx.stroke();
                    if(engine.mode === 'EDIT') { ctx.beginPath(); ctx.arc(cx, cy, 6/engine.zoom, 0, Math.PI*2); ctx.fillStyle = '#ff00ff'; ctx.fill(); }
                    if(selectedItem && selectedItem.id === br.id) { ctx.beginPath(); ctx.ellipse(cx, cy, br.rx + 4/engine.zoom, br.ry + 4/engine.zoom, 0, 0, Math.PI*2); ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2/engine.zoom; ctx.stroke(); }
                });
            }

            // BONES
            if (engine.mode === 'EDIT' || engine.showBones || (engine.mode === 'PREVIEW' && selectedItem?.type === 'BONE')) {
                engine.bones.forEach((b, bIdx) => {
                    if (engine.mode === 'PREVIEW' && !engine.showBones && selectedItem?.id !== b.id) return;
                    
                    const start = engine.mode === 'EDIT' ? b.startRest : b.startCurr; const end = engine.mode === 'EDIT' ? b.endRest : b.endCurr;
                    const boneInfo = getBoneColorInfo(b, bIdx);
                    
                    if (selectedItem?.type === 'BONE' && selectedItem?.id === b.id) {
                        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
                        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 11 / engine.zoom; ctx.stroke();
                    }

                    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 7 / engine.zoom; ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
                    ctx.strokeStyle = showWeights ? boneInfo.color : boneInfo.color;
                    ctx.lineWidth = 5 / engine.zoom; ctx.stroke();
                    ctx.beginPath(); ctx.arc(start.x, start.y, 4/engine.zoom, 0, Math.PI*2); ctx.fillStyle = '#020617'; ctx.fill();
                    ctx.beginPath(); ctx.arc(end.x, end.y, 6/engine.zoom, 0, Math.PI*2); ctx.fillStyle = boneInfo.color; ctx.fill();

                    if (selectedItem?.type === 'BONE' && selectedItem?.id === b.id) {
                        if (transformTool === 'TRANSLATE') {
                            ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(start.x + 30/engine.zoom, start.y); ctx.strokeStyle = '#f87171'; ctx.lineWidth=3/engine.zoom; ctx.stroke();
                            ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(start.x, start.y - 30/engine.zoom); ctx.strokeStyle = '#4ade80'; ctx.lineWidth=3/engine.zoom; ctx.stroke();
                        } else if (transformTool === 'ROTATE') {
                            ctx.beginPath(); ctx.arc(start.x, start.y, 25/engine.zoom, 0, Math.PI*2); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth=2/engine.zoom; ctx.stroke();
                        } else if (transformTool === 'SCALE') {
                            ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.strokeStyle = '#a78bfa'; ctx.lineWidth=3/engine.zoom; ctx.stroke();
                            ctx.beginPath(); ctx.rect(end.x - 4/engine.zoom, end.y - 4/engine.zoom, 8/engine.zoom, 8/engine.zoom); ctx.fillStyle = '#a78bfa'; ctx.fill();
                        }
                    }
                });
            }

            if (engine.mode === 'EDIT') {
                if (engine.hoveredJoint && editTool === 'BONE' && !engine.isSpacePressed) {
                    ctx.beginPath(); ctx.arc(engine.hoveredJoint.x, engine.hoveredJoint.y, 10/engine.zoom, 0, Math.PI*2);
                    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2/engine.zoom; ctx.stroke();
                }
                if (engine.isCreating && !engine.isSpacePressed) {
                    if (editTool === 'BONE') {
                        ctx.beginPath(); ctx.moveTo(engine.newStartPos.x, engine.newStartPos.y); ctx.lineTo(engine.mousePos.x, engine.mousePos.y);
                        ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)'; ctx.setLineDash([5/engine.zoom, 5/engine.zoom]); ctx.lineWidth = 3/engine.zoom; ctx.stroke(); ctx.setLineDash([]);
                    } else if (editTool === 'JIGGLE' || editTool === 'PIN') {
                        const rx = Math.abs(engine.mousePos.x - engine.newStartPos.x); const ry = Math.abs(engine.mousePos.y - engine.newStartPos.y);
                        const radius = editTool === 'PIN' ? Math.hypot(rx, ry) : rx;
                        ctx.beginPath(); 
                        if(editTool === 'PIN') ctx.arc(engine.newStartPos.x, engine.newStartPos.y, radius, 0, Math.PI*2);
                        else ctx.ellipse(engine.newStartPos.x, engine.newStartPos.y, rx, ry, 0, 0, Math.PI*2);
                        ctx.strokeStyle = editTool === 'PIN' ? '#38bdf8' : '#ec4899'; ctx.setLineDash([5/engine.zoom, 5/engine.zoom]); ctx.lineWidth = 2/engine.zoom; ctx.stroke(); ctx.setLineDash([]);
                    }
                }
            }

            ctx.restore(); animationId = requestAnimationFrame(render);
        };

        render(); return () => {
            cancelAnimationFrame(animationId);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('auxclick', onAuxClick);
            canvas.removeEventListener('contextmenu', onContextMenu);
        };
    }, [wireframe, meshType, gridSize, showWeights, showDepthMask, showDepthView, uiMode, showBones, editTool, selectedItem, transformTool, inactiveLayerOpacity]); 

    // UI CONTROLS
    const setWorkspaceMode = (newMode) => {
        setUiMode(newMode);
        engine.mode = newMode === 'EDIT' ? 'EDIT' : 'PREVIEW';
        if (newMode === 'PREVIEW' || newMode === 'PLAYER_PREVIEW') {
            bindMesh();
            engine.jiggles.forEach(br => { br.velX = 0; br.velY = 0; });
            engine.bones.forEach(b => { b.velAngle = 0; b.physAngle = b.angleRest; });
            setSelectedItem(null);
        } else {
            engine.bones.forEach(b => { b.angleCurr = b.angleRest; b.startCurr = { ...b.startRest }; b.endCurr = { ...b.endRest }; b.physAngle = b.angleRest; b.velAngle = 0; });
            computeForwardKinematics();
            const firstFrame = (engine.keyframes || [])[0] || engine.poseA;
            if(!engine.useMouseRotation) { engine.pitchX = firstFrame ? firstFrame.pitch : 0; engine.yawY = firstFrame ? firstFrame.yaw : 0; }
            if(!engine.useMouseParallax) { engine.parallaxX = firstFrame ? firstFrame.parX : 0; engine.parallaxY = firstFrame ? firstFrame.parY : 0; }
            setAnimPlaying(false);
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image(); img.onload = () => {
                    const ratio = Math.min(600 / img.width, 600 / img.height);
                    const w = img.width * ratio; const h = img.height * ratio;
                    const canvasW = canvasRef.current.width || 800; const canvasH = canvasRef.current.height || 600;
                    engine.image = img; engine.imageRect = { x: (canvasW - w)/2, y: (canvasH - h)/2, w, h };
                    engine.meshOffsetX = 0; engine.meshOffsetY = 0; engine.meshRotation = 0; engine.meshScale = 1;
                    engine.bones = []; engine.jiggles = []; engine.pins = []; applyRemesh(meshType, gridSize);
                    setKeyframes([]); setSelectedKeyframe(0); setAnimPlaying(false); setSelectedItem(null);
                    const layer = {
                        id: `layer_${Date.now()}`,
                        name: file.name.replace(/\.[^.]+$/, '') || 'Image Layer',
                        imageSrc: event.target.result as string,
                        depthSrc: null,
                        width: w,
                        height: h,
                        imageRect: { ...engine.imageRect },
                        boneSourceId: null,
                        bones: [],
                        jiggles: [],
                        pins: []
                    };
                    layersRef.current = [layer];
                    setLayers(layersRef.current);
                    activeLayerIdRef.current = layer.id;
                    setActiveLayerId(layer.id);
                    setHierarchyVersion(v => v + 1);
                };
                img.src = event.target.result as string;
            }; reader.readAsDataURL(file);
        }
    };

    const handleDepthUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader(); reader.onload = (event) => {
                const img = new Image(); img.onload = () => {
                    engine.depthImage = img;
                    extractDepth();
                    layersRef.current = layersRef.current.map(layer => layer.id === activeLayerIdRef.current ? { ...layer, depthSrc: event.target.result as string } : layer);
                    setLayers(layersRef.current);
                }; img.src = event.target.result as string;
            }; reader.readAsDataURL(file);
        }
    };

    const layerCanvasToFullDataUrl = (layer, width, height) => {
        if (!layer.canvas) return null;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const layerCanvas = layer.canvas;
        const alreadyFullFrame = layerCanvas.width === width && layerCanvas.height === height;
        ctx.drawImage(layerCanvas, alreadyFullFrame ? 0 : (layer.left || 0), alreadyFullFrame ? 0 : (layer.top || 0));
        return canvas.toDataURL('image/png');
    };

    const handlePsdUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            const psd = readPsd(buffer, { skipLayerImageData: false, skipThumbnail: true });
            const flatLayers = [];
            const scan = (items = []) => {
                items.forEach(layer => {
                    if (layer.children) scan(layer.children);
                    else if (!layer.hidden && layer.canvas) flatLayers.push(layer);
                });
            };
            scan(psd.children || []);
            const depthByBaseName = new Map();
            const colorLayers = [];
            flatLayers.forEach(layer => {
                const rawName = layer.name || `Layer ${flatLayers.indexOf(layer) + 1}`;
                const lower = rawName.toLowerCase();
                const isDepth = lower.endsWith('_depth');
                const base = isDepth ? rawName.replace(/_depth$/i, '') : rawName;
                const dataUrl = layerCanvasToFullDataUrl(layer, psd.width, psd.height);
                if (!dataUrl) return;
                if (isDepth) depthByBaseName.set(base.toLowerCase(), dataUrl);
                else colorLayers.push({ rawName, base, dataUrl, opacity: layer.opacity !== undefined ? layer.opacity : 1 });
            });
            const canvasW = canvasRef.current?.width || 800;
            const canvasH = canvasRef.current?.height || 600;
            const ratio = Math.min(600 / psd.width, 600 / psd.height, 1);
            const w = psd.width * ratio;
            const h = psd.height * ratio;
            const photoshopStack = colorLayers.slice().reverse();
            const nextLayers = photoshopStack.map((layer, index) => ({
                id: `psd_${Date.now()}_${index}`,
                name: layer.rawName,
                imageSrc: layer.dataUrl,
                depthSrc: depthByBaseName.get(layer.base.toLowerCase()) || null,
                opacity: layer.opacity,
                width: w,
                height: h,
                imageRect: { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h },
                boneSourceId: null,
                bones: [],
                jiggles: [],
                pins: [],
                meshOffsetX: 0,
                meshOffsetY: 0,
                meshRotation: 0,
                meshScale: 1
            }));
            if (!nextLayers.length) {
                alert('PSD sem camadas visíveis compatíveis.');
                return;
            }
            layersRef.current = nextLayers;
            setLayers(nextLayers);
            await Promise.all(nextLayers.map(layer => loadImageFromSrc(layer.imageSrc)));
            await applyLayer(nextLayers[0].id);
            setLeftPanelTab('MESH');
        } catch (err) {
            console.error(err);
            alert('Não foi possível importar o PSD.');
        }
    };

    const addKeyframe = () => {
        engine.timelineScrub = false;
        setKeyframes(prev => {
            const next = [...prev, captureKeyframe()];
            const idx = next.length - 1;
            setSelectedKeyframe(idx);
            engine.animProgress = idx;
            if (timelineRef.current) timelineRef.current.value = idx;
            return next;
        });
    };
    const saveKeyframe = () => {
        engine.timelineScrub = false;
        setKeyframes(prev => {
            const next = [...prev];
            next[selectedKeyframe] = captureKeyframe();
            return next;
        });
    };
    const selectKeyframe = (idx) => {
        const frame = keyframes[idx];
        if (!frame) return;
        setSelectedKeyframe(idx);
        engine.timelineScrub = false;
        engine.animProgress = idx;
        if (timelineRef.current) timelineRef.current.value = idx;
        engine.bones.forEach((b, i) => {
            const transform = frame.boneTransforms?.[i];
            b.angleCurr = transform?.angle ?? (frame.bones[i] !== undefined ? frame.bones[i] : b.angleRest);
            b.poseOffsetX = transform?.poseOffsetX ?? 0;
            b.poseOffsetY = transform?.poseOffsetY ?? 0;
            if (transform?.length !== undefined) b.length = Math.max(5, transform.length);
        });
        computeForwardKinematics();
        engine.pitchX = frame.pitch || 0; engine.yawY = frame.yaw || 0;
        engine.parallaxX = frame.parX || 0; engine.parallaxY = frame.parY || 0;
        setAnimPlaying(false);
    };
    const deleteKeyframe = () => {
        engine.timelineScrub = false;
        setKeyframes(prev => {
            const next = prev.filter((_, i) => i !== selectedKeyframe);
            const idx = Math.max(0, Math.min(selectedKeyframe, next.length - 1));
            setSelectedKeyframe(idx);
            engine.animProgress = idx;
            if (timelineRef.current) timelineRef.current.value = idx;
            return next;
        });
        setAnimPlaying(false);
    };
    const hasPoseA = keyframes.length > 0;
    const hasPoseB = keyframes.length > 1;
    const savePoseA = () => {
        setKeyframes(prev => {
            const next = [...prev];
            next[0] = captureKeyframe();
            return next;
        });
    };
    const savePoseB = () => {
        setKeyframes(prev => {
            const next = [...prev];
            next[1] = captureKeyframe();
            return next;
        });
    };
    const togglePlay = () => { if(keyframes.length > 1) { engine.timelineScrub = true; setAnimPlaying(!animPlaying); } };
    const resetPose = () => { engine.poseA = null; engine.poseB = null; setKeyframes([]); setSelectedKeyframe(0); setAnimPlaying(false); engine.animProgress = 0; engine.timelineScrub = false; };

    const buildCharacterBundleData = (syncSnapshot = true) => {
        if (syncSnapshot) syncActiveLayerSnapshot();
        normalizeBoneLabels();
        const current = buildCurrentAnimation();
        const allAnimations = [...animations.filter(anim => anim.title !== current.title), current];
        return {
            format: 'animatita-character',
            version: 1,
            layers: layersRef.current,
            activeLayerId: activeLayerIdRef.current,
            character: {
                bones: engine.bones,
                jiggles: engine.jiggles,
                pins: engine.pins,
                imageRect: engine.imageRect,
                settings: {
                    meshType, gridSize, edgeDensity, borderOffset,
                    meshOffsetX: engine.meshOffsetX || 0,
                    meshOffsetY: engine.meshOffsetY || 0,
                    meshRotation: engine.meshRotation || 0,
                    meshScale: engine.meshScale || 1,
                    depthGamma, depthMultiplier, invertDepth, depthBlur, depthMapSmoothness,
                    depthGradientY, depthGradientSmoothness, deformZIntensity, edgeDepth, edgeBevel,
                    useBonePhysics, secPhysStiffness, secPhysDamping
                }
            },
            animations: allAnimations,
            currentAnimation: current.title
        };
    };

    const exportCharacterBundle = () => {
        const data = buildCharacterBundleData();
        const allAnimations = data.animations;
        setAnimations(allAnimations);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'animatita_character.json'; a.click();
    };

    const importEverything = (e) => {
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(String(ev.target.result));
                const character = data.character || data;
                const settings = character.settings || data.settings || {};
                if (Array.isArray(data.layers) && data.layers.length) {
                    layersRef.current = data.layers;
                    setLayers(data.layers);
                    data.layers.forEach(layer => loadImageFromSrc(layer.imageSrc));
                    data.layers.forEach(layer => { if (layer.previewSrc) loadImageFromSrc(layer.previewSrc); });
                    if (data.activeLayerId) {
                        applyLayer(data.activeLayerId);
                    }
                }
                engine.bones = character.bones || data.bones || [];
                engine.jiggles = character.jiggles || data.jiggles || [];
                engine.pins = character.pins || data.pins || [];
                normalizeBoneLabels();
                if (character.imageRect) engine.imageRect = character.imageRect;
                engine.meshOffsetX = settings.meshOffsetX || 0;
                engine.meshOffsetY = settings.meshOffsetY || 0;
                engine.meshRotation = settings.meshRotation || 0;
                engine.meshScale = settings.meshScale || 1;

                const importedAnimations = data.animations || [{
                    title: 'default',
                    keyframes: data.keyframes || ([data.poseA, data.poseB].filter(Boolean)),
                    interpolation: settings.interpolation || 'SMOOTH',
                    pingPong: settings.pingPong !== undefined ? !!settings.pingPong : true,
                    speed: settings.animSpeedMult || 1.5,
                    lissajous: {
                        active: !!settings.lissajousActive,
                        freqX: settings.lissajousFreqX !== undefined ? settings.lissajousFreqX : 1,
                        freqY: settings.lissajousFreqY !== undefined ? settings.lissajousFreqY : 2,
                        phase: settings.lissajousPhase !== undefined ? settings.lissajousPhase : 0,
                        ratio: settings.lissajousRatio !== undefined ? settings.lissajousRatio : 1.0,
                        intensity: settings.lissajousIntensity !== undefined ? settings.lissajousIntensity : 1.0,
                        affects: settings.lissajousAffects || 'DEPTH_ONLY'
                    }
                }];
                setAnimations(importedAnimations);
                applyAnimation(importedAnimations.find(anim => anim.title === data.currentAnimation) || importedAnimations[0]);

                if(data.imgUrl && (!engine.image || data.imgUrl !== engine.image.src)) {
                    const img = new Image();
                    img.onload = () => {
                        const ratio = Math.min(600 / img.width, 600 / img.height);
                        const w = img.width * ratio; const h = img.height * ratio;
                        engine.image = img; engine.imageRect = character.imageRect || { x: (600 - w)/2, y: (600 - h)/2, w, h };
                        applyRemesh(settings.meshType || 'OPTIMIZED', settings.gridSize || 25);
                        setForceRender(Date.now());
                    };
                    img.src = data.imgUrl;
                }

                setMeshType(settings.meshType || 'OPTIMIZED'); setGridSize(settings.gridSize || 25);
                setEdgeDensity(settings.edgeDensity || 1.0);
                setBorderOffset(settings.borderOffset || 0);
                setDepthGamma(settings.depthGamma !== undefined ? settings.depthGamma : 1.0);
                setDepthMultiplier(settings.depthMultiplier !== undefined ? settings.depthMultiplier : 1.0);
                setInvertDepth(!!settings.invertDepth);
                setDepthBlur(settings.depthBlur !== undefined ? settings.depthBlur : 0);
                setDepthMapSmoothness(settings.depthMapSmoothness !== undefined ? settings.depthMapSmoothness : 0.0);
                setEdgeDepth(settings.edgeDepth !== undefined ? settings.edgeDepth : 0.0);
                setEdgeBevel(settings.edgeBevel !== undefined ? settings.edgeBevel : 0.05);
                setDepthGradientY(settings.depthGradientY !== undefined ? settings.depthGradientY : 0.85);
                setDepthGradientSmoothness(settings.depthGradientSmoothness !== undefined ? settings.depthGradientSmoothness : 0.4);
                setDeformZIntensity(settings.deformZIntensity !== undefined ? settings.deformZIntensity : 0.5);
                setUseBonePhysics(!!settings.useBonePhysics); setSecPhysStiffness(settings.secPhysStiffness || 0.15); setSecPhysDamping(settings.secPhysDamping || 0.85);
                setSelectedItem(null);
                setForceRender(Date.now());
                applyRemesh(settings.meshType || 'OPTIMIZED', settings.gridSize || 25);
            } catch(e) { alert("Invalid project file."); }
        };
        reader.readAsText(file);
    };

    const renderHierarchyTree = (parentId, depth) => {
        const childrenBones = engine.bones.filter(b => b.parentId === parentId || (!b.parentId && parentId === null));
        const jiggles = engine.jiggles.filter(j => j.boneId === parentId || (!j.boneId && parentId === null));
        const pins = engine.pins.filter(p => p.parentId === parentId || (!p.parentId && parentId === null));
        
        if (childrenBones.length === 0 && jiggles.length === 0 && pins.length === 0) return null;

        return (
            <div className={`space-y-1 ${depth === 0 ? 'mt-1' : ''}`}>
                {childrenBones.map((b, idx) => {
                    const boneIndex = engine.bones.indexOf(b);
                    const info = getBoneColorInfo(b, boneIndex >= 0 ? boneIndex : idx);
                    return (
                    <div key={b.id} style={{ marginLeft: `${depth > 0 ? 12 : 0}px` }}>
                        <div
                            className={`cursor-pointer font-medium text-[10px] mb-1 ${selectedItem?.type === 'BONE' && selectedItem?.id === b.id ? 'font-bold' : 'opacity-80 hover:opacity-100'}`}
                            style={{ color: info.color }}
                            onClick={() => setSelectedItem({ type: 'BONE', id: b.id })}
                        >
                            <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: info.color }} />
                            {info.name}
                        </div>
                        {renderHierarchyTree(b.id, depth + 1)}
                    </div>
                    );
                })}
                {jiggles.map((j) => (
                    <div key={j.id} style={{ marginLeft: `${depth > 0 ? 12 : 0}px` }}>
                        <div 
                            className={`cursor-pointer text-[10px] ${selectedItem?.type === 'JIGGLE' && selectedItem?.id === j.id ? 'font-bold text-white' : 'text-pink-400 opacity-70 hover:opacity-100'}`}
                            onClick={() => setSelectedItem({ type: 'JIGGLE', id: j.id })}
                        >
                            ⚪ Jiggle {j.id.substr(0,4)}
                        </div>
                    </div>
                ))}
                {pins.map((p) => (
                    <div key={p.id} style={{ marginLeft: `${depth > 0 ? 12 : 0}px` }}>
                        <div 
                            className={`cursor-pointer text-[10px] ${selectedItem?.type === 'PIN' && selectedItem?.id === p.id ? 'font-bold text-white' : 'text-sky-400 opacity-70 hover:opacity-100'}`}
                            onClick={() => setSelectedItem({ type: 'PIN', id: p.id })}
                        >
                            🔴 Pin {p.id.substr(0,4)}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div
            className="flex flex-col h-screen w-full bg-slate-900 text-slate-200 font-sans overflow-hidden"
            onPointerDownCapture={handleRangePointerDown}
            onPointerMoveCapture={handleRangePointerMove}
            onPointerUpCapture={stopFineRangeDrag}
            onPointerLeaveCapture={stopFineRangeDrag}
            onMouseLeave={() => setRangeHud(null)}
        >
            {rangeHud && (
                <div
                    className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full rounded bg-slate-950/95 border border-slate-600 px-2 py-0.5 text-[10px] font-bold text-white shadow"
                    style={{ left: rangeHud.x, top: rangeHud.y }}
                >
                    {rangeHud.value}
                </div>
            )}

            {/* Barra de Navegação Superior Estilo Desktop Suite com Dica de Hotkey */}
            <div className="bg-slate-950 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between shadow-xl z-30">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                        <h1 className="text-sm font-extrabold text-white tracking-wider uppercase">Animator Pro</h1>
                        <span className="text-[8px] text-emerald-400 font-bold tracking-widest">3D GRAPHICS ENGINE</span>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md text-slate-400 text-[10px] shadow-inner">
                        <span>Tip: Press</span>
                        <kbd className="bg-slate-800 text-slate-200 px-1.5 py-0.5 rounded text-[9px] font-mono border border-slate-700 font-bold shadow-sm">TAB</kbd>
                        <span>to switch tabs quickly</span>
                    </div>
                </div>

                <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 shadow-inner">
                    <button 
                        onClick={() => setWorkspaceMode('EDIT')} 
                        className={`px-5 py-1.5 rounded-md text-[11px] font-bold tracking-wide transition-all ${uiMode === 'EDIT' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                        📝 Editor
                    </button>
                    <button 
                        onClick={() => setWorkspaceMode('PREVIEW')} 
                        className={`px-5 py-1.5 rounded-md text-[11px] font-bold tracking-wide transition-all ${uiMode === 'PREVIEW' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                        🎬 Animation
                    </button>
                    <button 
                        onClick={() => setWorkspaceMode('PLAYER_PREVIEW')} 
                        className={`px-5 py-1.5 rounded-md text-[11px] font-bold tracking-wide transition-all ${uiMode === 'PLAYER_PREVIEW' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                        👁️ Preview
                    </button>
                </div>

                <div className="text-[9px] text-slate-500 font-bold tracking-widest">
                    PRO SUITE
                </div>
            </div>

            <div className="flex flex-1 min-h-0 w-full overflow-hidden">
                <div className="w-[340px] bg-slate-800 p-5 flex flex-col gap-4 shadow-xl z-10 border-r border-slate-700 overflow-y-auto custom-scrollbar">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-1">Animator Pro</h1>
                        <p className="text-[10px] text-emerald-400 font-semibold tracking-wider">3D ENGINE • DELAUNAY • PADS</p>
                    </div>

                {/* IMPORT */}
                <div className="bg-slate-700 p-4 rounded-lg space-y-3">
                    <label className="block text-sm font-medium">Import</label>
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <label className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] font-bold text-slate-200 text-center cursor-pointer block transition-all shadow-inner">
                                🖼️ TEXTURE
                                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                            </label>
                            <label className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] font-bold text-slate-200 text-center cursor-pointer block transition-all shadow-inner">
                                🗺️ DEPTHMAP
                                <input type="file" accept="image/*" onChange={handleDepthUpload} className="hidden" />
                            </label>
                        </div>
                        <label className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] font-bold text-slate-200 text-center cursor-pointer block transition-all shadow-inner">
                            🔵 IMPORT PSD LAYERS
                            <input type="file" accept=".psd,image/vnd.adobe.photoshop" onChange={handlePsdUpload} className="hidden" />
                        </label>
                        <label className="w-full py-2 bg-slate-600 hover:bg-slate-500 rounded text-[10px] font-bold text-white shadow text-center cursor-pointer block transition-all">
                            📥 IMPORT JSON PROJECT
                            <input type="file" accept=".json" onChange={importEverything} className="hidden" />
                        </label>
                        {layers.length > 0 && (
                            <div className="space-y-2">
                                <div>
                                    <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>Inactive opacity</span><span>{Math.round(inactiveLayerOpacity * 100)}%</span></div>
                                    <input type="range" min="0.05" max="1" step="0.05" value={inactiveLayerOpacity} onChange={(e) => setInactiveLayerOpacity(Number(e.target.value))} className="w-full accent-cyan-400" />
                                </div>
                            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto custom-scrollbar">
                                {layers.map(layer => (
                                    <div
                                        key={layer.id}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => {
                                            if (!dragLayerId || dragLayerId === layer.id) return;
                                            const current = [...layersRef.current];
                                            const from = current.findIndex(item => item.id === dragLayerId);
                                            const to = current.findIndex(item => item.id === layer.id);
                                            if (from < 0 || to < 0) return;
                                            const [moved] = current.splice(from, 1);
                                            current.splice(to, 0, moved);
                                            layersRef.current = current;
                                            setLayers(current);
                                            setDragLayerId(null);
                                        }}
                                        className={`rounded border p-2 ${activeLayerId === layer.id ? 'border-cyan-300 bg-slate-800' : 'border-slate-600 bg-slate-900/60'}`}
                                    >
                                        <div className="flex items-center gap-2">
                                        <button
                                            draggable
                                            onDragStart={() => setDragLayerId(layer.id)}
                                            onDragEnd={() => setDragLayerId(null)}
                                            className="px-2 py-1 rounded bg-slate-900 text-slate-400 hover:text-white cursor-grab"
                                            title="Drag layer"
                                        >≡</button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                layersRef.current = layersRef.current.map(item => item.id === layer.id ? { ...item, visible: item.visible === false ? true : false } : item);
                                                setLayers(layersRef.current);
                                                setForceRender(Date.now());
                                            }}
                                            className={`px-2 py-1 rounded text-[10px] transition-all ${layer.visible !== false ? 'bg-slate-900 text-cyan-400' : 'bg-slate-900/40 text-slate-600 opacity-40'}`}
                                            title={layer.visible !== false ? "Ocultar camada" : "Mostrar camada"}
                                        >
                                            👁️
                                        </button>
                                        <button onClick={() => applyLayer(layer.id)} className="min-w-0 flex-1 text-left flex items-center gap-2">
                                            <img src={layer.imageSrc} className="w-9 h-9 object-contain bg-black/30 rounded" />
                                            <span className="min-w-0 flex-1"><span className="block text-[9px] font-bold text-slate-200 truncate">{layer.name}</span><span className={`inline-block mt-1 rounded px-1.5 py-0.5 text-[8px] font-bold ${layer.depthSrc ? 'bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-400/50' : 'text-slate-500'}`}>{layer.depthSrc ? 'DEPTH LINKED' : 'no depth'}</span></span>
                                        </button>
                                        </div>
                                        <label className="mt-2 flex items-center gap-2 text-[8px] font-bold text-slate-300">
                                            <input type="checkbox" checked={!!layer.isStatic} onChange={(ev) => {
                                                layersRef.current = layersRef.current.map(item => item.id === layer.id ? { ...item, isStatic: ev.target.checked, previewSrc: null } : item);
                                                setLayers(layersRef.current);
                                                if (activeLayerIdRef.current === layer.id) setForceRender(Date.now());
                                            }} />
                                            Static layer
                                        </label>
                                        <select className="mt-2 w-full bg-slate-800 text-[8px] rounded border border-slate-600 px-1 py-1 text-slate-300" value={layer.boneSourceId || layer.id} onChange={(ev) => { const sourceId = ev.target.value === layer.id ? null : ev.target.value; layersRef.current = layersRef.current.map(item => item.id === layer.id ? { ...item, boneSourceId: sourceId } : item); setLayers(layersRef.current); if (activeLayerIdRef.current === layer.id) applyLayer(layer.id); }}>
                                            <option value={layer.id}>Own bones</option>
                                            {layers.filter(item => item.id !== layer.id).map(item => (<option key={item.id} value={item.id}>Use {item.name}</option>))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-slate-700 p-4 rounded-lg space-y-3">
                    <div className="flex border-b border-slate-600/40 mb-2">
                        <button onClick={() => setLeftPanelTab('MESH')} className={`flex-1 py-2 text-[9px] font-bold transition-all border-b-2 -mb-px text-center ${leftPanelTab === 'MESH' ? 'border-indigo-500 text-indigo-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'}`}>MESH</button>
                        <button onClick={() => setLeftPanelTab('3D')} className={`flex-1 py-2 text-[9px] font-bold transition-all border-b-2 -mb-px text-center ${leftPanelTab === '3D' ? 'border-fuchsia-500 text-fuchsia-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'}`}>3D</button>
                        <button onClick={() => setLeftPanelTab('PHYSICS')} className={`flex-1 py-2 text-[9px] font-bold transition-all border-b-2 -mb-px text-center ${leftPanelTab === 'PHYSICS' ? 'border-sky-500 text-sky-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'}`}>Physics</button>
                    </div>
                    {leftPanelTab === 'MESH' && (<><label className="block text-sm font-medium">2. Morphological Mesh</label><div className="flex gap-1 mb-2"><button onClick={() => { setMeshType('OPTIMIZED'); if(uiMode === 'EDIT') applyRemesh('OPTIMIZED', gridSize); }} className={`flex-1 py-1.5 text-[9px] font-bold rounded ${meshType === 'OPTIMIZED' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>Edge Optimized</button><button onClick={() => { setMeshType('GRID'); if(uiMode === 'EDIT') applyRemesh('GRID', gridSize); }} className={`flex-1 py-1.5 text-[9px] font-bold rounded ${meshType === 'GRID' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>Full Grid</button></div><div className="flex gap-2"><div className="flex-1"><div className="flex justify-between text-[10px] mb-1"><span>XYZ density:</span><span>{gridSize}</span></div><input type="range" min="4" max="80" value={gridSize} onChange={(e) => { setGridSize(Number(e.target.value)); if(uiMode === 'EDIT') applyRemesh(meshType, Number(e.target.value)); }} disabled={uiMode === 'PREVIEW'} className="w-full accent-indigo-500" /></div><div className="flex-1"><div className="flex justify-between text-[10px] mb-1"><span>Physical margin:</span><span>{borderOffset > 0 ? '+' : ''}{borderOffset}</span></div><input type="range" min="-15" max="15" value={borderOffset} onChange={(e) => { setBorderOffset(Number(e.target.value)); if(uiMode === 'EDIT') applyRemesh(meshType, gridSize); }} disabled={uiMode === 'PREVIEW'} className="w-full accent-emerald-500" /></div></div>{meshType === 'OPTIMIZED' && (<div className="flex gap-2 flex-col"><div className="flex-1"><div className="flex justify-between text-[10px] mb-1"><span>Edge density (multiplier):</span><span>{edgeDensity.toFixed(1)}x</span></div><input type="range" min="0.5" max="4.0" step="0.1" value={edgeDensity} onChange={(e) => { setEdgeDensity(Number(e.target.value)); engine.edgeDensity = Number(e.target.value); if(uiMode === 'EDIT') applyRemesh(meshType, gridSize); }} disabled={uiMode === 'PREVIEW'} className="w-full accent-indigo-400" /></div><div className="flex gap-2"><div className="flex-1"><div className="flex justify-between text-[10px] mb-1"><span className="text-fuchsia-300">Edge depth:</span><span>{edgeDepth.toFixed(2)}</span></div><input type="range" min="0" max="1.0" step="0.05" value={edgeDepth} onChange={(e) => setEdgeDepth(Number(e.target.value))} className="w-full accent-fuchsia-500" /></div><div className="flex-1"><div className="flex justify-between text-[10px] mb-1"><span className="text-fuchsia-300">Edge bevel size:</span><span>{edgeBevel.toFixed(2)}</span></div><input type="range" min="0.01" max="0.2" step="0.01" value={edgeBevel} onChange={(e) => setEdgeBevel(Number(e.target.value))} className="w-full accent-fuchsia-500" /></div></div></div>)}</>)}
                    {leftPanelTab === '3D' && (<><div className="flex gap-3 justify-center py-2 bg-slate-800/50 rounded border border-slate-600"><Pad2D label="Rot 3D (Yaw/Pitch)" engine={engine} propX="yawY" propY="pitchX" onChange={() => { if (uiMode === 'PREVIEW' && autoRecord && keyframes[selectedKeyframe]) saveKeyframe(); }} /><Pad2D label="Depth XY (Parallax)" engine={engine} propX="parallaxX" propY="parallaxY" onChange={() => { if (uiMode === 'PREVIEW' && autoRecord && keyframes[selectedKeyframe]) saveKeyframe(); }} /></div><div className="border-t border-slate-600 pt-2"><label className="flex items-center gap-2 text-[10px] font-semibold text-sky-300 mb-1 cursor-pointer"><input type="checkbox" checked={useMouseRotation} onChange={(e) => setUseMouseRotation(e.target.checked)} className="rounded bg-slate-800 border-sky-500" /> Mouse-driven rotation</label><label className="flex items-center gap-2 text-[10px] font-semibold text-amber-300 mb-2 cursor-pointer"><input type="checkbox" checked={useMouseParallax} onChange={(e) => setUseMouseParallax(e.target.checked)} className="rounded bg-slate-800 border-amber-500" /> Mouse-driven parallax</label><div className="flex gap-2"><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">3D rotation strength</label><input type="range" min="0" max="0.5" step="0.01" value={mouseRotationIntensity} onChange={(e) => setMouseRotationIntensity(Number(e.target.value))} className="w-full accent-sky-400" /></div><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Depth strength</label><input type="range" min="0" max="0.5" step="0.01" value={mouseParallaxIntensity} onChange={(e) => setMouseParallaxIntensity(Number(e.target.value))} className="w-full accent-amber-400" /></div></div></div><div className="border-t border-slate-600 pt-2 space-y-2"><label className="flex items-center gap-2 text-[10px] cursor-pointer text-slate-200"><input type="checkbox" checked={invertDepth} onChange={(e) => setInvertDepth(e.target.checked)} className="rounded bg-slate-800" /> Invert depth (convex / concave)</label><div className="flex gap-2"><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Gamma curve (Z)</label><input type="range" min="0.1" max="3" step="0.1" value={depthGamma} onChange={(e) => setDepthGamma(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Depth multiplier</label><input type="range" min="0" max="1" step="0.05" value={depthMultiplier} onChange={(e) => setDepthMultiplier(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div></div><div className="flex gap-2"><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Depth map blur</label><input type="range" min="0" max="20" step="1" value={depthBlur} onChange={(e) => setDepthBlur(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Relief smoothness</label><input type="range" min="0" max="0.5" step="0.01" value={depthMapSmoothness} onChange={(e) => setDepthMapSmoothness(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div></div><div className="flex gap-2"><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Y mask threshold</label><input type="range" min="0" max="1" step="0.01" value={depthGradientY} onChange={(e) => setDepthGradientY(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Mask smoothness</label><input type="range" min="0.01" max="1" step="0.01" value={depthGradientSmoothness} onChange={(e) => setDepthGradientSmoothness(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div></div><div><label className="text-[9px] text-slate-400 block mb-1">Physical deformation affects Z (3D)</label><input type="range" min="0" max="2" step="0.1" value={deformZIntensity} onChange={(e) => setDeformZIntensity(Number(e.target.value))} className="w-full accent-fuchsia-400" /></div></div></>)}
                    {leftPanelTab === 'PHYSICS' && (<><label className="block text-sm font-medium">3. Rigging Tools</label><div className="pt-2 space-y-2"><label className="flex items-center gap-2 text-[10px] font-semibold text-sky-300"><input type="checkbox" checked={useBonePhysics} onChange={(e) => setUseBonePhysics(e.target.checked)} className="rounded bg-slate-800 border-sky-500" /> Secondary physics (tips)</label><div className={`flex gap-2 transition-opacity ${useBonePhysics ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Secondary spring</label><input type="range" min="0.01" max="0.5" step="0.01" value={secPhysStiffness} onChange={(e) => setSecPhysStiffness(Number(e.target.value))} className="w-full accent-sky-400" /></div><div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Amortecimento</label><input type="range" min="0.5" max="0.99" step="0.01" value={secPhysDamping} onChange={(e) => setSecPhysDamping(Number(e.target.value))} className="w-full accent-sky-400" /></div></div></div><button onClick={() => setWorkspaceMode(uiMode === 'EDIT' ? 'PREVIEW' : 'EDIT')} className={`w-full py-3 rounded-lg font-bold transition-all duration-300 mt-2 ${uiMode === 'EDIT' ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/50' : 'bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_15px_rgba(225,29,72,0.5)]'}`}>{uiMode === 'EDIT' ? 'TEST PHYSICS ENGINE' : 'RETURN TO EDIT'}</button></>)}
                </div>
            </div>
            {/* VIEWPORT AND BOTTOM TIMELINE PANEL */}
            <div className="flex-1 flex flex-col min-w-0 h-full relative">
                <div ref={containerRef} className="flex-1 relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 to-slate-950 overflow-hidden" style={{ cursor: cursorStyle }}>
                    <canvas 
                        ref={canvasRef} 
                        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} 
                        className={`absolute inset-0 ${uiMode === 'PLAYER_PREVIEW' ? 'hidden' : 'block'}`}
                    />
                    {uiMode === 'PLAYER_PREVIEW' && (
                        <canvas
                            ref={playerPreviewCanvasRef}
                            className="absolute inset-0 block bg-black"
                        />
                    )}
                    
                    {uiMode === 'EDIT' && (
                        <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur border border-slate-700 p-2 rounded-lg flex gap-1 shadow-xl">
                            <button onClick={() => { setEditTool('BONE'); setTransformTool('SELECT'); }} className={`px-3 py-1.5 rounded text-[10px] font-bold ${editTool === 'BONE' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>1 + Bones</button>
                            <button onClick={() => { setEditTool('JIGGLE'); setTransformTool('SELECT'); }} className={`px-3 py-1.5 rounded text-[10px] font-bold ${editTool === 'JIGGLE' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>2 + Jiggles</button>
                            <button onClick={() => { setEditTool('PIN'); setTransformTool('SELECT'); }} className={`px-3 py-1.5 rounded text-[10px] font-bold ${editTool === 'PIN' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>3 + Pins</button>
                        </div>
                    )}

                    {uiMode !== 'PLAYER_PREVIEW' && <div className="absolute top-16 left-4 bg-slate-900/80 backdrop-blur border border-slate-700 p-2 rounded-lg flex gap-1 shadow-xl">
                        <button onClick={() => setTransformTool('SELECT')} className={`px-3 py-1.5 rounded text-[10px] font-bold ${transformTool === 'SELECT' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Select (Q)">Q: Select</button>
                        <button onClick={() => setTransformTool('TRANSLATE')} className={`px-3 py-1.5 rounded text-[10px] font-bold ${transformTool === 'TRANSLATE' ? 'bg-red-500 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Move (W)">W: Move</button>
                        <button onClick={() => setTransformTool('ROTATE')} className={`px-3 py-1.5 rounded text-[10px] font-bold ${transformTool === 'ROTATE' ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Rotate (E)">E: Rot</button>
                        <button onClick={() => setTransformTool('SCALE')} className={`px-3 py-1.5 rounded text-[10px] font-bold ${transformTool === 'SCALE' ? 'bg-purple-500 text-white' : 'text-slate-400 hover:bg-slate-800'}`} title="Scale (R)">R: Scale</button>
                    </div>}
                    
                    <div className="absolute top-4 right-6 pointer-events-none opacity-60 text-[11px] font-bold text-white bg-black/50 px-3 py-2 rounded flex flex-col gap-1 text-right shadow">
                        <span><b className="text-amber-400">Scroll:</b> Zoom</span>
                        <span><b className="text-sky-400">Ctrl+Shift+Click:</b> Delete item</span>
                        {uiMode === 'PLAYER_PREVIEW' ? (
                            <span><b className="text-emerald-400">Preview:</b> Runtime player</span>
                        ) : uiMode === 'EDIT' ? (
                            <>
                                <span><b className="text-pink-400">Alt+Click on bone:</b> Reparent. (Pin/Jiggle)</span>
                                <span><b className="text-amber-300">1/2/3:</b> Bones / Jiggles / Pins</span>
                                <span><b className="text-emerald-400">Hold SPACE:</b> Move and select</span>
                            </>
                        ) : (
                            <span><b className="text-rose-400">Drag bone:</b> Kinematic animation</span>
                        )}
                    </div>
                </div>

                {/* PREMIUM TIMELINE COMPONENT */}
                {uiMode === 'PREVIEW' && (
                    <div className="bg-slate-900 border-t border-slate-700/85 px-6 py-4 flex flex-col gap-3 shadow-2xl relative select-none">
                        {/* Upper controls line */}
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                            <div className="flex items-center gap-4">
                                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Animation Timeline
                                </span>
                                
                                {/* Play/Pause/Stop group */}
                                <div className="flex items-center bg-slate-950/40 rounded-lg p-0.5 border border-slate-800">
                                    <button
                                        onClick={togglePlay}
                                        disabled={keyframes.length < 2}
                                        className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none ${
                                            animPlaying 
                                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-[0_0_8px_rgba(239,68,68,0.2)]' 
                                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                        }`}
                                    >
                                        {animPlaying ? (
                                            <>
                                                <span className="w-2 h-2 bg-rose-400 rounded-sm" />
                                                Pause Loop
                                            </>
                                        ) : (
                                            <>
                                                <span className="border-y-4 border-y-transparent border-l-[7px] border-l-emerald-400 inline-block w-0 h-0" />
                                                Play Loop
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={resetPose}
                                        className="px-2.5 py-1.5 rounded text-[10px] font-bold text-slate-400 hover:text-white transition-colors"
                                        title="Reset skeleton and clearing keyframes"
                                    >
                                        Clear
                                    </button>
                                </div>
                                
                                {/* Speed controller */}
                                <div className="flex items-center gap-2 bg-slate-950/30 px-3 py-1 rounded-lg border border-slate-800/80">
                                    <span className="text-[9px] text-slate-400 font-bold uppercase">Speed:</span>
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="4"
                                        step="0.1"
                                        value={animSpeedMult}
                                        onChange={(e) => setAnimSpeedMult(Number(e.target.value))}
                                        className="w-20 accent-emerald-400 h-1 cursor-pointer"
                                    />
                                    <span className="text-[10px] text-emerald-400 font-mono font-bold">{animSpeedMult.toFixed(1)}x</span>
                                </div>
                            </div>
                            
                            {/* Right controls group: Keyframe CRUD, Interpolation, AutoKey */}
                            <div className="flex items-center gap-3">
                                {/* Auto Key Switch */}
                                <label className={`flex items-center gap-2 px-3 py-1 rounded-lg border transition-all cursor-pointer select-none ${
                                    autoRecord 
                                        ? 'bg-red-500/10 border-red-500/30 text-red-300 shadow-[0_0_10px_rgba(239,68,68,0.05)]' 
                                        : 'bg-slate-950/40 border-slate-800 text-slate-500 hover:text-slate-400'
                                }`}>
                                    <input
                                        type="checkbox"
                                        checked={autoRecord}
                                        onChange={(e) => setAutoRecord(e.target.checked)}
                                        className="hidden"
                                    />
                                    <span className={`w-2 h-2 rounded-full relative flex items-center justify-center ${autoRecord ? 'bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]' : 'bg-slate-700'}`} />
                                    <span className="text-[9px] font-bold uppercase tracking-wider">Auto Key</span>
                                </label>

                                {/* Frame modifications */}
                                <div className="flex items-center gap-1 bg-slate-950/40 p-0.5 rounded-lg border border-slate-800">
                                    <button
                                        onClick={addKeyframe}
                                        className="px-2.5 py-1 rounded text-[9px] font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow transition-all uppercase"
                                    >
                                        + Add Frame
                                    </button>
                                    <button
                                        onClick={saveKeyframe}
                                        disabled={!keyframes[selectedKeyframe]}
                                        className="px-2.5 py-1 rounded text-[9px] font-bold bg-amber-500 hover:bg-amber-400 text-black shadow transition-all uppercase disabled:opacity-40"
                                    >
                                        Overwrite
                                    </button>
                                    <button
                                        onClick={deleteKeyframe}
                                        disabled={!keyframes.length}
                                        className="px-2.5 py-1 rounded text-[9px] font-bold bg-rose-950/60 hover:bg-rose-900 text-rose-300 shadow transition-all uppercase disabled:opacity-40"
                                    >
                                        Delete
                                    </button>
                                </div>

                                {/* Interpolation settings */}
                                <div className="flex items-center gap-1.5">
                                    <select
                                        className="bg-slate-950/60 text-[10px] rounded border border-slate-800 px-2 py-1 text-slate-300 font-bold focus:outline-none"
                                        value={interpolation}
                                        onChange={(e) => setInterpolation(e.target.value)}
                                    >
                                        <option value="SMOOTH">Smooth Ease</option>
                                        <option value="LINEAR">Linear</option>
                                        <option value="EASE_IN">Ease In</option>
                                        <option value="EASE_OUT">Ease Out</option>
                                    </select>
                                    
                                    <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase bg-slate-950/40 rounded border border-slate-800 px-2 py-1 text-slate-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={pingPong}
                                            onChange={(e) => setPingPong(e.target.checked)}
                                            className="accent-emerald-400 rounded bg-slate-800"
                                        />
                                        Ping Pong
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* Timeline Track (Adobe Animate / Spine 2D Inspired Grid) */}
                        <div className="flex flex-col gap-1.5 bg-slate-950/30 p-3 rounded-lg border border-slate-850">
                            <div className="flex items-center gap-3">
                                {/* Track indicator label */}
                                <span className="w-16 text-[9px] font-bold text-slate-500 uppercase tracking-widest text-right">Pose Track</span>
                                
                                {/* Visual Frame list with dots / diamond flags */}
                                <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-1.5 custom-scrollbar">
                                    {keyframes.map((_, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => selectKeyframe(idx)}
                                            className={`group relative min-w-8 h-8 rounded border flex flex-col items-center justify-center transition-all ${
                                                selectedKeyframe === idx
                                                    ? 'bg-emerald-500 text-black border-emerald-400 font-extrabold shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                                                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white'
                                            }`}
                                        >
                                            <span className="text-[9px] font-mono">{idx + 1}</span>
                                            {/* Diamond Keyframe symbol inside the cell */}
                                            <span className={`w-1.5 h-1.5 rotate-45 border mt-0.5 ${
                                                selectedKeyframe === idx
                                                    ? 'bg-black border-black'
                                                    : 'bg-emerald-400 border-emerald-300 shadow-[0_0_4px_#34d399]'
                                            }`} />
                                        </button>
                                    ))}
                                    {!keyframes.length && (
                                        <span className="text-[10px] text-slate-500 italic py-1 tracking-wider">No frames in animation timeline. Click "+ Add Frame" to begin!</span>
                                    )}
                                </div>
                            </div>
                            
                            {/* Timeline Scrubbing Slider */}
                            {keyframes.length > 1 && (
                                <div className="flex items-center gap-3 mt-1">
                                    <span className="w-16 text-[8px] font-bold text-emerald-400 uppercase tracking-wider text-right font-mono">
                                        {Math.round(engine.animProgress * 100) / 100}
                                    </span>
                                    <div className="flex-1 relative flex items-center">
                                        <input
                                            ref={timelineRef}
                                            type="range"
                                            min="0"
                                            max={Math.max(1, keyframes.length - 1)}
                                            step="0.001"
                                            defaultValue="0"
                                            className="w-full accent-emerald-400 h-1 cursor-pointer rounded-lg bg-slate-800"
                                            onMouseDown={() => {
                                                engine.animPlaying = false;
                                                engine.timelineScrub = true;
                                                setAnimPlaying(false);
                                            }}
                                            onChange={(e) => {
                                                engine.timelineScrub = true;
                                                engine.animProgress = Number(e.target.value);
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* PAINEL DIREITO */}
            <div className="w-[300px] bg-slate-800 p-5 flex flex-col gap-4 shadow-xl z-20 border-l border-slate-700 overflow-y-auto custom-scrollbar">
                
                <div className="bg-slate-700 p-3 rounded-lg flex flex-col gap-3">
                    <div className="flex border-b border-slate-600/40 mb-2">
                        <button onClick={() => setUtilityPanelTab('IO')} className={`flex-1 py-2 text-[9px] font-bold transition-all border-b-2 -mb-px text-center ${utilityPanelTab === 'IO' ? 'border-emerald-500 text-emerald-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'}`}>Export</button>
                        <button onClick={() => setUtilityPanelTab('DEBUG')} className={`flex-1 py-2 text-[9px] font-bold transition-all border-b-2 -mb-px text-center ${utilityPanelTab === 'DEBUG' ? 'border-amber-500 text-amber-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'}`}>Debug</button>
                        <button onClick={() => setUtilityPanelTab('LISSAJOUS')} className={`flex-1 py-2 text-[9px] font-bold transition-all border-b-2 -mb-px text-center ${utilityPanelTab === 'LISSAJOUS' ? 'border-fuchsia-500 text-fuchsia-400 bg-slate-800/40' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/10'}`}>Lissajous</button>
                    </div>

                    {utilityPanelTab === 'IO' && (
                        <div className="flex flex-col gap-2">
                            <button onClick={exportCharacterBundle} className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-[10px] font-bold text-white shadow">
                                EXPORT CHARACTER + ANIM
                            </button>
                            <div className="flex gap-2">
                                <select className="flex-1 bg-slate-800 text-[10px] rounded border border-slate-600 px-2 py-1.5 text-slate-300" value={currentAnimationTitle} onChange={(e) => switchAnimation(e.target.value)}>
                                    {[...animations.filter(anim => anim.title !== currentAnimationTitle), buildCurrentAnimation()].map(anim => (
                                        <option key={anim.title} value={anim.title}>{anim.title}</option>
                                    ))}
                                </select>
                                <button onClick={addAnimation} className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded text-[10px] font-bold text-white shadow">
                                    + ANIM
                                </button>
                            </div>
                            <button onClick={() => {
                                engine.bones = [];
                                engine.jiggles = [];
                                engine.pins = [];
                                engine.poseA = null;
                                engine.poseB = null;
                                setKeyframes([]);
                                setAnimations([]);
                                setCurrentAnimationTitle('default');
                                setSelectedKeyframe(0);
                                setSelectedItem(null);
                                applyRemesh(meshType, gridSize);
                                setForceRender(Date.now());
                            }} className="w-full py-1.5 bg-rose-600/80 hover:bg-rose-500 rounded text-[10px] font-bold text-white shadow uppercase border border-rose-500/50">
                                CLEAR ALL (Bones and Pins)
                            </button>
                        </div>
                    )}

                    {utilityPanelTab === 'DEBUG' && (
                        <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-slate-200 font-bold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={showBones} onChange={(e) => setShowBones(e.target.checked)} className="rounded bg-slate-800 border-slate-500" /> Show visible bones</label>
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-pink-300 font-bold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={showJiggles} onChange={(e) => setShowJiggles(e.target.checked)} className="rounded bg-slate-800 border-pink-500" /> Show jiggles</label>
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-sky-300 font-bold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} className="rounded bg-slate-800 border-sky-500" /> Show pins</label>
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-slate-300 font-semibold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} className="rounded bg-slate-800" /> Show wireframe</label>
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-amber-400 font-semibold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={showWeights} onChange={(e) => setShowWeights(e.target.checked)} className="rounded bg-slate-800 border-amber-500" /> LBS physics debug</label>
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-fuchsia-400 font-semibold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={showDepthMask} onChange={(e) => setShowDepthMask(e.target.checked)} className="rounded bg-slate-800 border-fuchsia-500" /> Depth mask debug</label>
                            <label className="flex items-center gap-2 text-[10px] cursor-pointer text-stone-300 font-semibold bg-slate-800 px-2 py-1.5 rounded shadow"><input type="checkbox" checked={showDepthView} onChange={(e) => setShowDepthView(e.target.checked)} className="rounded bg-slate-800 border-stone-400" /> Debug Depth Map</label>
                        </div>
                    )}

                    {utilityPanelTab === 'LISSAJOUS' && (
                        <div className={`transition-opacity duration-300 ${uiMode === 'PREVIEW' ? 'opacity-100 ring-1 ring-emerald-500 rounded p-2' : 'opacity-75'}`}>
                            <label className="flex items-center gap-2 text-[11px] font-bold text-white mb-3"><input type="checkbox" checked={lissajousActive} onChange={(e) => setLissajousActive(e.target.checked)} className="rounded bg-slate-900 border-emerald-500" /> Lissajous Curve (Loop)</label>
                            <div className="space-y-3">
                                <LissajousVisualizer engine={engine} />
                                <select className="bg-slate-800 text-[10px] rounded border border-slate-600 px-2 py-1.5 w-full text-slate-300 mb-2" value={lissajousAffects} onChange={(e) => setLissajousAffects(e.target.value)}>
                                    <option value="DEPTH_ONLY">Affects depth only</option>
                                    <option value="MESH_ONLY">Affects mesh only</option>
                                    <option value="BONES_AND_DEPTH">Affects mesh and depth</option>
                                </select>
                                <div className="flex gap-2">
                                    <div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Freq X (lobes)</label><input type="range" min="1" max="10" step="1" value={lissajousFreqX} onChange={(e) => setLissajousFreqX(Number(e.target.value))} className="w-full accent-emerald-500" /></div>
                                    <div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Freq Y (lobes)</label><input type="range" min="1" max="10" step="1" value={lissajousFreqY} onChange={(e) => setLissajousFreqY(Number(e.target.value))} className="w-full accent-emerald-500" /></div>
                                </div>
                                <div className="flex gap-2">
                                    <div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Intensity (overall)</label><input type="range" min="0" max="10" step="0.1" value={lissajousIntensity} onChange={(e) => setLissajousIntensity(Number(e.target.value))} className="w-full accent-emerald-500" /></div>
                                    <div className="flex-[1.5]"><label className="text-[9px] text-slate-400 block mb-1">Ratio (0.01=flat, 3.0=tall)</label><input type="range" min="0.01" max="3" step="0.01" value={lissajousRatio} onChange={(e) => setLissajousRatio(Number(e.target.value))} className="w-full accent-emerald-500" /></div>
                                </div>
                                <div><label className="text-[9px] text-slate-400 block mb-1">Phase (initial offset)</label><input type="range" min="0" max={Math.PI*2} step="0.1" value={lissajousPhase} onChange={(e) => setLissajousPhase(Number(e.target.value))} className="w-full accent-emerald-500" /></div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-slate-700 p-3 rounded-lg flex flex-col max-h-[150px] overflow-y-auto custom-scrollbar">
                    <div className="text-[10px] font-bold text-slate-300 mb-2 border-b border-slate-600 pb-1">HIERARCHY</div>
                    <button
                        onClick={() => setSelectedItem({ type: 'MESH', id: 'mesh' })}
                        className={`text-left text-[10px] mb-1 ${selectedItem?.type === 'MESH' ? 'font-bold text-amber-300' : 'text-slate-300 opacity-70 hover:opacity-100'}`}
                    >
                        MESH / ACTIVE AREA
                    </button>
                    {renderHierarchyTree(null, 0) || <div className="text-[9px] text-slate-500 italic">No objects created.</div>}
                </div>

                {/* SECTION 5: INDIVIDUAL PROPERTIES */}
                <div className="bg-slate-700 p-4 rounded-lg flex flex-col flex-1">
                    <label className="block text-[11px] font-bold text-amber-400 mb-3 border-b border-slate-600 pb-2">Selection Properties</label>
                    {selectedItem ? (
                        <div className="space-y-4 flex-1">
                            {selectedItem.type === 'MESH' && (
                                <>
                                    <span className="text-[10px] text-amber-300 font-bold block mb-1">MESH / ACTIVE AREA</span>
                                    <div className="grid grid-cols-3 gap-1">
                                        <button onClick={() => resetSelectedTransform('POSITION')} className="py-1 rounded bg-slate-800 hover:bg-slate-600 text-[9px] font-bold text-slate-200">Reset Pos</button>
                                        <button onClick={() => resetSelectedTransform('ROTATION')} className="py-1 rounded bg-slate-800 hover:bg-slate-600 text-[9px] font-bold text-slate-200">Reset Rot</button>
                                        <button onClick={() => resetSelectedTransform('SCALE')} className="py-1 rounded bg-slate-800 hover:bg-slate-600 text-[9px] font-bold text-slate-200">Reset Scale</button>
                                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-300">
                                        <div className="bg-slate-800 rounded px-2 py-1">Offset X: {Math.round(engine.meshOffsetX || 0)}</div>
                                        <div className="bg-slate-800 rounded px-2 py-1">Offset Y: {Math.round(engine.meshOffsetY || 0)}</div>
                                        <div className="bg-slate-800 rounded px-2 py-1">Rot: {(((engine.meshRotation || 0) * 180 / Math.PI) % 360).toFixed(1)} deg</div>
                                        <div className="bg-slate-800 rounded px-2 py-1">Scale: {(engine.meshScale || 1).toFixed(2)}x</div>
                                    </div>
                                    <div className="text-[9px] text-slate-400">
                                        Use W to move, E to rotate, and R to scale on the canvas.
                                    </div>
                                </>
                            )}
                            {selectedItem.type === 'BONE' && (() => {
                                const b = engine.bones.find(x => x.id === selectedItem.id); if(!b) return null;
                                const info = getBoneColorInfo(b, engine.bones.indexOf(b));
                                const parent = engine.bones.find(x => x.id === b.parentId);
                                const parentInfo = parent ? getBoneColorInfo(parent, engine.bones.indexOf(parent)) : null;
                                return (
                                <>
                                    <span className="text-[10px] font-bold flex items-center gap-2 mb-1" style={{ color: info.color }}>
                                        <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: info.color }} />
                                        {info.name}
                                    </span>
                                    <div className="grid grid-cols-3 gap-1">
                                        <button onClick={() => resetSelectedTransform('POSITION')} className="py-1 rounded bg-slate-800 hover:bg-slate-600 text-[9px] font-bold text-slate-200">Reset Pos</button>
                                        <button onClick={() => resetSelectedTransform('ROTATION')} className="py-1 rounded bg-slate-800 hover:bg-slate-600 text-[9px] font-bold text-slate-200">Reset Rot</button>
                                        <button onClick={() => resetSelectedTransform('SCALE')} className="py-1 rounded bg-slate-800 hover:bg-slate-600 text-[9px] font-bold text-slate-200">Reset Scale</button>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>Length</span><span>{Math.round(b.length)}px</span></div>
                                    </div>
                                    {b.parentId ? (
                                        <div className="text-[9px] text-slate-400">Parent: {parentInfo?.name || b.parentId}</div>
                                    ) : (
                                        <div className="text-[9px] font-bold" style={{ color: info.color }}>Root Bone</div>
                                    )}
                                </>);
                            })()}
                            {selectedItem.type === 'JIGGLE' && (() => {
                                const b = engine.jiggles.find(x => x.id === selectedItem.id); if(!b) return null;
                                return (
                                <>
                                    <span className="text-[10px] text-pink-400 font-bold flex justify-between items-center mb-1">
                                        <span>JIGGLE PHYSICS</span>
                                        <select className="bg-slate-800 text-[8px] rounded border border-slate-600 px-1 py-1" value={b.preset || 'Custom'} onChange={(e) => {
                                            const p = JIGGLE_PRESETS[e.target.value];
                                            if (p) {
                                                handleUpdateProp('preset', e.target.value);
                                                handleUpdateProp('stiffness', p.stiffness);
                                                handleUpdateProp('damping', p.damping);
                                                handleUpdateProp('rotBouncy', p.rotBouncy);
                                                handleUpdateProp('scaleX', p.scaleX);
                                                handleUpdateProp('scaleY', p.scaleY);
                                                handleUpdateProp('limit', p.limit);
                                            }
                                        }}>
                                            {Object.keys(JIGGLE_PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
                                        </select>
                                    </span>
                                    <div><label className="text-[9px] text-slate-400 block mb-1">Outline smoothness</label><input type="range" min="0" max="0.99" step="0.01" value={b.smoothness !== undefined ? b.smoothness : 0.0} onChange={(e) => handleUpdateProp('smoothness', Number(e.target.value))} className="w-full accent-pink-500" /></div>
                                    <div><label className="text-[9px] text-slate-400 block mb-1">Relative scale (volume)</label><input type="range" min="0.5" max="3" step="0.1" value={b.volume !== undefined ? b.volume : 1.0} onChange={(e) => handleUpdateProp('volume', Number(e.target.value))} className="w-full accent-pink-500" /></div>
                                    <div><label className="text-[9px] text-slate-400 block mb-1">Spring & stiffness</label><input type="range" min="0.01" max="0.5" step="0.01" value={b.stiffness} onChange={(e) => { handleUpdateProp('stiffness', Number(e.target.value)); handleUpdateProp('preset', 'Custom'); }} className="w-full accent-pink-500" /></div>
                                    <div><label className="text-[9px] text-slate-400 block mb-1">Damping / friction</label><input type="range" min="0.5" max="0.99" step="0.01" value={b.damping} onChange={(e) => { handleUpdateProp('damping', Number(e.target.value)); handleUpdateProp('preset', 'Custom'); }} className="w-full accent-pink-500" /></div>
                                    <div><label className="text-[9px] text-slate-400 block mb-1">Rotational inertia (bouncy)</label><input type="range" min="-0.1" max="0.1" step="0.005" value={b.rotBouncy !== undefined ? b.rotBouncy : 0.02} onChange={(e) => { handleUpdateProp('rotBouncy', Number(e.target.value)); handleUpdateProp('preset', 'Custom'); }} className="w-full accent-pink-500" /></div>
                                    <div className="flex gap-2">
                                        <div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Squash X</label><input type="range" min="-0.05" max="0.05" step="0.002" value={b.scaleX !== undefined ? b.scaleX : 0.015} onChange={(e) => { handleUpdateProp('scaleX', Number(e.target.value)); handleUpdateProp('preset', 'Custom'); }} className="w-full accent-pink-500" /></div>
                                        <div className="flex-1"><label className="text-[9px] text-slate-400 block mb-1">Squash Y</label><input type="range" min="-0.05" max="0.05" step="0.002" value={b.scaleY !== undefined ? b.scaleY : -0.015} onChange={(e) => { handleUpdateProp('scaleY', Number(e.target.value)); handleUpdateProp('preset', 'Custom'); }} className="w-full accent-pink-500" /></div>
                                    </div>
                                    <div><label className="text-[9px] text-slate-400 block mb-1">Max distance limit</label><input type="range" min="5" max="100" step="1" value={b.limit !== undefined ? b.limit : 30} onChange={(e) => { handleUpdateProp('limit', Number(e.target.value)); handleUpdateProp('preset', 'Custom'); }} className="w-full accent-pink-500" /></div>
                                </>);
                            })()}
                            {selectedItem.type === 'PIN' && (() => {
                                const p = engine.pins.find(x => x.id === selectedItem.id); if(!p) return null;
                                return (
                                <>
                                    <span className="text-[10px] text-sky-400 font-bold block mb-1">PIN CONTROL</span>
                                    <div>
                                        <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>Overall intensity</span><span>{Math.round((p.intensity !== undefined ? p.intensity : 1.0) * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.05" value={p.intensity !== undefined ? p.intensity : 1.0} onChange={(e) => handleUpdateProp('intensity', Number(e.target.value))} className="w-full accent-sky-500" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>LBS lock (XY position)</span><span>{Math.round((p.posIntensity !== undefined ? p.posIntensity : 1.0) * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.05" value={p.posIntensity !== undefined ? p.posIntensity : 1.0} onChange={(e) => handleUpdateProp('posIntensity', Number(e.target.value))} className="w-full accent-sky-500" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>LBS lock (angular rotation)</span><span>{Math.round((p.rotIntensity !== undefined ? p.rotIntensity : 1.0) * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.05" value={p.rotIntensity !== undefined ? p.rotIntensity : 1.0} onChange={(e) => handleUpdateProp('rotIntensity', Number(e.target.value))} className="w-full accent-sky-500" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>Isolamento Procedural 3D Depth</span><span>{Math.round((p.depthFix !== undefined ? p.depthFix : 0.8) * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.05" value={p.depthFix !== undefined ? p.depthFix : 0.8} onChange={(e) => handleUpdateProp('depthFix', Number(e.target.value))} className="w-full accent-sky-500" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-[9px] text-slate-400 mb-1"><span>Smoothness (falloff)</span><span>{Math.round((p.smoothness !== undefined ? p.smoothness : 1.0) * 100)}%</span></div>
                                        <input type="range" min="0" max="1" step="0.05" value={p.smoothness !== undefined ? p.smoothness : 1.0} onChange={(e) => handleUpdateProp('smoothness', Number(e.target.value))} className="w-full accent-sky-500" />
                                    </div>
                                </>);
                            })()}
                        </div>
                    ) : (
                        <div className="text-[10px] text-slate-400 flex-1 flex items-center justify-center text-center italic opacity-60 px-4">
                            Click the mesh, a bone, jiggle, or pin on the canvas to edit it.
                        </div>
                    )}
                </div>
            </div>
            </div> {/* Fecha o container flex-1 do corpo principal criado para acomodar o cabeçalho superior */}
            
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
            `}} />
        </div>
    );
}
