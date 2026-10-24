import { writeFileSync } from 'node:fs';
const sleeps = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8777/' });
await sleeps(32000);
const click = await send('Runtime.evaluate', { expression: "document.getElementById('g-chaos').click()", returnByValue: true });
console.log('click:', JSON.stringify(click).slice(0, 160));
await sleeps(900);
const body = await send('Runtime.evaluate', {
  expression: "(()=>{const b=document.querySelector('.sp-body'); return b ? (b.scrollWidth + ' / ' + b.clientWidth + ' / ' + Math.round(b.getBoundingClientRect().width)) : 'no body';})()",
  returnByValue: true,
});
console.log('body:', JSON.stringify(body).slice(0, 300));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('C:/项目/生化危机模拟器/shots/_chaos_ev2.png', Buffer.from(shot.result.data, 'base64'));
ws.close(); process.exit(0);
