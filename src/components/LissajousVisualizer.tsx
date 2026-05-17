import { useEffect, useRef } from 'react';

export const LissajousVisualizer = ({ engine }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        let id;
        const canvas = canvasRef.current;
        if (!canvas || !engine) return;
        const ctx = canvas.getContext('2d');

        const loop = () => {
            if (!ctx || !canvasRef.current || !engine) return;
            const w = canvasRef.current.width;
            const h = canvasRef.current.height;
            ctx.clearRect(0, 0, w, h);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath();
            ctx.moveTo(w / 2, 0);
            ctx.lineTo(w / 2, h);
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
            ctx.stroke();

            ctx.beginPath();
            const segments = 200;
            const ratio = engine.lissajousRatio || 1;
            const rx = ratio < 1 ? 1 : 1 / ratio;
            const ry = ratio < 1 ? ratio : 1;
            const maxDuration = Math.PI * 2 * 10;

            for (let i = 0; i <= segments; i++) {
                const t = (i / segments) * maxDuration;
                const ptX = Math.sin(engine.lissajousFreqX * t + engine.lissajousPhase);
                const ptY = Math.sin(engine.lissajousFreqY * t);
                const px = w / 2 + ptX * (w / 2.5) * rx;
                const py = h / 2 + ptY * (h / 2.5) * ry;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1;
            ctx.stroke();

            const tCurr = Date.now() * 0.001;
            const ptXCurr = Math.sin(engine.lissajousFreqX * tCurr + engine.lissajousPhase);
            const ptYCurr = Math.sin(engine.lissajousFreqY * tCurr);
            const pxCurr = w / 2 + ptXCurr * (w / 2.5) * rx;
            const pyCurr = h / 2 + ptYCurr * (h / 2.5) * ry;

            ctx.beginPath();
            ctx.arc(pxCurr, pyCurr, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();

            id = requestAnimationFrame(loop);
        };

        loop();
        return () => cancelAnimationFrame(id);
    }, [engine]);

    return (
        <canvas ref={canvasRef} width={80} height={80} className="bg-slate-800 border border-slate-600 rounded shadow-inner mb-2 mx-auto block" />
    );
};
