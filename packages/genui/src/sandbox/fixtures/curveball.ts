/**
 * curveball.ts — a "curveball" corpus widget the declarative catalog CANNOT express:
 * an interactive, animated canvas soundscape mixer (range sliders drive a live canvas
 * visualization via requestAnimationFrame + per-layer state). Pure vanilla JS/DOM/canvas —
 * no forbidden APIs, no external assets, works offline. Proves "raw HTML → anything".
 *
 * Corpus provenance: VIBE benchmark prompt #57 "Build a web soundscape mixer that feels
 * like a physical desktop console." (Weird / Curveball tier.)
 */

export const CURVEBALL_SOUNDSCAPE_DESCRIPTION =
  "Interactive animated soundscape mixer (canvas + range sliders + rAF state) — impossible in the declarative catalog.";

export const CURVEBALL_SOUNDSCAPE_CODE = `
const root = document.getElementById('island-root');
root.innerHTML = '';
const wrap = document.createElement('div');
wrap.style.cssText = 'padding:16px;display:grid;gap:12px;background:#0f172a;color:#e2e8f0;border-radius:12px';

const title = document.createElement('h2');
title.textContent = 'Soundscape Mixer';
title.style.cssText = 'margin:0;font-size:16px';
wrap.appendChild(title);

const canvas = document.createElement('canvas');
canvas.width = 480; canvas.height = 160;
canvas.style.cssText = 'width:100%;background:#020617;border-radius:8px';
canvas.setAttribute('role', 'img');
canvas.setAttribute('aria-label', 'Animated soundscape visualization');
wrap.appendChild(canvas);

const layers = [
  { name: 'Rain', color: '#38bdf8', freq: 2.0, amp: 0.6 },
  { name: 'Wind', color: '#a78bfa', freq: 1.2, amp: 0.4 },
  { name: 'Fire', color: '#fb7185', freq: 3.4, amp: 0.3 }
];

const controls = document.createElement('div');
controls.style.cssText = 'display:grid;gap:8px';
layers.forEach(function (layer, i) {
  const id = 'layer-' + i;
  const row = document.createElement('label');
  row.setAttribute('for', id);
  row.style.cssText = 'display:grid;grid-template-columns:64px 1fr 40px;gap:8px;align-items:center;font-size:13px';
  const nm = document.createElement('span'); nm.textContent = layer.name;
  const input = document.createElement('input');
  input.type = 'range'; input.min = '0'; input.max = '100';
  input.value = String(Math.round(layer.amp * 100)); input.id = id;
  input.setAttribute('aria-label', layer.name + ' level');
  const val = document.createElement('span'); val.textContent = input.value; val.style.textAlign = 'right';
  input.addEventListener('input', function () { layer.amp = Number(input.value) / 100; val.textContent = input.value; });
  row.appendChild(nm); row.appendChild(input); row.appendChild(val);
  controls.appendChild(row);
});
wrap.appendChild(controls);
root.appendChild(wrap);

const ctx = canvas.getContext('2d');
let t = 0;
function draw() {
  t += 0.03;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  layers.forEach(function (layer) {
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += 4) {
      const y = canvas.height / 2 + Math.sin(x * 0.03 * layer.freq + t * layer.freq) * layer.amp * 60;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = layer.color; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4 + layer.amp * 0.6; ctx.stroke();
  });
  ctx.globalAlpha = 1;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
`.trim();
