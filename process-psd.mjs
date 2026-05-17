import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readPsd, initializeCanvas } from 'ag-psd';
import { Canvas, ImageData } from 'skia-canvas';
import sharp from 'sharp';

// Inicializa o motor de renderização do ag-psd usando Skia-Canvas
initializeCanvas(
  (w, h) => new Canvas(w, h),
  (w, h) => new ImageData(w, h)
);

const OUTPUT_DIR = './public/assets/images/cgi';
const HASH_FILE = path.join(OUTPUT_DIR, '.cgi_hashes.json');
const CGI_DIR = './public/cgi';

function getFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function processPsd(filePath) {
  const psdName = path.basename(filePath, '.psd');
  const fileHash = getFileHash(filePath);

  // Check hashes
  let hashes = {};
  if (fs.existsSync(HASH_FILE)) {
    try {
      hashes = JSON.parse(fs.readFileSync(HASH_FILE, 'utf8'));
    } catch (e) {}
  }

  if (hashes[psdName] === fileHash) {
    console.log(`⏩ Ignorando ${psdName} (Sem alterações).`);
    return;
  }

  console.log(`🚀 Processando ${psdName} (Skia-Canvas Full Frame Engine)...`);
  const buffer = fs.readFileSync(filePath);
  
  // useCanvas: true permite que o ag-psd use nosso polyfill para renderizar as camadas
  const psd = readPsd(buffer, { skipLayerImageData: false, skipThumbnail: true, useCanvas: true });

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const metadata = {
    name: psdName,
    width: psd.width,
    height: psd.height,
    layers: []
  };

  let hasErrors = false;
  const scan = async (layers, groupMask = null) => {
    if (!layers) return;
    for (const layer of layers) {
      if (layer.children) {
        await scan(layer.children, layer.mask || groupMask);
        continue;
      }

      if (layer.canvas && !layer.hidden) {
        try {
          const finalCanvas = new Canvas(psd.width, psd.height);
          const ctx = finalCanvas.getContext('2d');

          const applyMask = (targetCtx, mask) => {
            if (!mask || !mask.canvas) return;
            const maskCanvas = mask.canvas;
            const maskCtx = maskCanvas.getContext('2d');
            const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
            for (let i = 0; i < maskData.data.length; i += 4) {
              maskData.data[i + 3] = maskData.data[i];
            }
            maskCtx.putImageData(maskData, 0, 0);

            targetCtx.globalCompositeOperation = 'destination-in';
            targetCtx.drawImage(maskCanvas, mask.left || 0, mask.top || 0);
            targetCtx.globalCompositeOperation = 'source-over';
          };

          ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
          if (layer.mask) applyMask(ctx, layer.mask);
          if (groupMask) applyMask(ctx, groupMask);

          const pngBuffer = await finalCanvas.toBuffer('png');
          const isDepth = layer.name.toLowerCase().includes('depth');
          let webpOptions = { quality: 90 }; // Old method for large images
          let sharpInstance = sharp(pngBuffer);

          if (isDepth) {
            sharpInstance = sharpInstance.grayscale();
            webpOptions = { quality: 50, effort: 6 };
          }

          const { data } = await sharpInstance
            .webp(webpOptions)
            .toBuffer({ resolveWithObject: true });

          const safeName = layer.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
          const outputFileName = `${psdName}_${safeName}.webp`;
          const thumbFileName = `${psdName}_${safeName}.thumb.webp`;
          
          fs.writeFileSync(path.join(OUTPUT_DIR, outputFileName), data);

          // Generate thumbnail
          const thumbData = await sharp(pngBuffer)
            .resize({ width: 16, kernel: 'nearest' })
            .webp({ nearLossless: true, quality: 50, effort: 6 })
            .toBuffer();
          fs.writeFileSync(path.join(OUTPUT_DIR, thumbFileName), thumbData);

          metadata.layers.push({
              name: layer.name,
              file: outputFileName,
              left: 0,
              top: 0,
              width: psd.width,
              height: psd.height,
              opacity: layer.opacity !== undefined ? layer.opacity : 1
          });

          console.log(`✅ ${layer.name} exportada.`);
        } catch (err) {
          console.error(`❌ Falha em ${layer.name}:`, err.message);
          hasErrors = true;
        }
      }
    }
  };

  if (psd.children) await scan(psd.children);

  fs.writeFileSync(path.join(OUTPUT_DIR, `${psdName}.json`), JSON.stringify(metadata, null, 2));
  
  // Update hash only if no errors
  if (!hasErrors) {
    hashes[psdName] = fileHash;
    fs.writeFileSync(HASH_FILE, JSON.stringify(hashes, null, 2));
    console.log(`🏁 Concluído!`);
  } else {
    console.error(`⚠️ ${psdName} processado com erros. Hash não atualizado.`);
  }
}

async function main() {
  if (!fs.existsSync(CGI_DIR)) {
    console.error(`❌ Pasta não encontrada: ${CGI_DIR}`);
    return;
  }

  const files = fs.readdirSync(CGI_DIR).filter(f => f.endsWith('.psd'));
  for (const file of files) {
    await processPsd(path.join(CGI_DIR, file));
  }
}

main();
