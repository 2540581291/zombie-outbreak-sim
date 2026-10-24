import { writeFileSync } from 'node:fs';
const URL0 = process.argv[2], OUT = process.argv[3], FX = Number(process.argv[4]), FZ = Number(process.argv[5]);
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pend = new Map(); const errs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: URL0 });
await sleeps(50000);
await ev("document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyB',key:'b',bubbles:true}))");
await sleeps(600);
await ev(`window.dispatchEvent(new CustomEvent('zos:focus',{detail:{x:${FX},z:${FZ}}}))`);
await sleeps(2500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
ws.close(); process.exit(0);