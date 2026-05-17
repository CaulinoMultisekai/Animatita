import { useEffect, useRef } from 'react';

export const Pad2D = ({ label, engine, propX, propY, onChange }) => {
    const padRef = useRef(null);
    const dotRef = useRef(null);

    useEffect(() => {
        let id;
        const loop = () => {
            if (dotRef.current && engine) {
                const x = engine[propX] || 0;
                const y = engine[propY] || 0;
                dotRef.current.style.left = `${(x + 1) * 50}%`;
                dotRef.current.style.top = `${(y + 1) * 50}%`;
            }
            id = requestAnimationFrame(loop);
        };
        id = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(id);
    }, [engine, propX, propY]);

    const handleMouse = (e) => {
        if (e.buttons !== 1) return;
        const rect = padRef.current.getBoundingClientRect();
        let nx = (e.clientX - rect.left) / rect.width;
        let ny = (e.clientY - rect.top) / rect.height;
        nx = Math.max(0, Math.min(1, nx)) * 2 - 1;
        ny = Math.max(0, Math.min(1, ny)) * 2 - 1;
        engine[propX] = nx;
        engine[propY] = ny;
        if (onChange) onChange();
    };

    return (
        <div className="flex flex-col items-center flex-1">
            <span className="text-[9px] text-slate-400 mb-1">{label}</span>
            <div ref={padRef} onMouseDown={handleMouse} onMouseMove={handleMouse} className="w-16 h-16 bg-slate-800 border border-slate-600 relative cursor-crosshair rounded shadow-inner">
                <div className="absolute w-full h-px bg-slate-700 top-1/2" />
                <div className="absolute h-full w-px bg-slate-700 left-1/2" />
                <div ref={dotRef} className="absolute w-2 h-2 bg-sky-400 rounded-full shadow-[0_0_5px_#38bdf8]" style={{ transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
            </div>
        </div>
    );
};
