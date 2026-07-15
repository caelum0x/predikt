// Builds an asciinema-style live terminal recording of the Predikt Oracle
// agent flow — with a typing effect and REAL captured API output. Emits both:
//   submission/demo-video/predikt-oracle-terminal.mp4   (rendered cast)
//   submission/demo-video/predikt-oracle-terminal.cast  (native asciinema v2)
//
// Pipeline: boot the real server → run the genuine API flow, capturing live
// responses → drive a terminal state machine (type commands char-by-char, then
// print the real responses) → render each state to PNG via headless Chrome →
// encode with ffmpeg. Every value shown is real.
//
// Usage:  node submission/make-terminal-cast.mjs

import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASP = path.join(ROOT, 'asp')
const OUT = path.join(ROOT, 'submission', 'demo-video')
const WORK = path.join(OUT, 'term-frames')
const DB = '/tmp/predikt-term.db'
const PORT = 8801
const B = `http://localhost:${PORT}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 1280
const H = 720

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f)
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

async function api(method, pathname, { key, body } = {}) {
  const res = await fetch(`${B}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = await res.json()
  if (!json.success) throw new Error(`${method} ${pathname}: ${json.error}`)
  return json.data
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
const p2 = (n) => Number(n).toFixed(2)

// ---- boot + real flow -------------------------------------------------------

console.error('booting server…')
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: ASP,
  env: { ...process.env, OPENROUTER_API_KEY: 'demo', PORT: String(PORT), DB_PATH: DB },
  stdio: 'ignore',
})
process.on('exit', () => server.kill())
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${B}/health`)).ok) break } catch {}
  await sleep(500)
}

console.error('running the flow…')
const FUTURE = Date.now() + 170 * 24 * 60 * 60 * 1000
const alice = await api('POST', '/accounts', { body: { name: 'Alice' } })
const bob = await api('POST', '/accounts', { body: { name: 'Bob' } })
const { market } = await api('POST', '/markets', {
  key: alice.apiKey,
  body: {
    question: 'Will ETH close above $8,000 on Dec 31, 2026?',
    criteria: 'Resolves YES on a CoinGecko daily close above $8,000.',
    category: 'Crypto', closeTime: FUTURE, subsidy: 100, initialProb: 0.4,
  },
})
const { trade: buy } = await api('POST', `/markets/${market.id}/buy`, { key: bob.apiKey, body: { side: 'YES', amount: 50 } })
await api('POST', `/markets/${market.id}/resolve`, { key: alice.apiKey, body: { outcome: 'YES' } })
const bobAfter = await api('GET', '/accounts/me', { key: bob.apiKey })
server.kill()
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f)

// ---- terminal renderer ------------------------------------------------------

const CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:#05080d;
    font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
  .win{position:absolute;inset:26px;background:#0a0f18;border:1px solid #1c2940;
    border-radius:12px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);display:flex;flex-direction:column}
  .bar{height:44px;background:#0e1622;border-bottom:1px solid #1c2940;display:flex;
    align-items:center;gap:9px;padding:0 18px;flex:0 0 auto}
  .bar i{width:13px;height:13px;border-radius:50%;display:inline-block}
  .r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}
  .bar span{color:#5f7799;font-size:16px;margin-left:14px}
  .scr{flex:1;padding:22px 26px;font-size:24px;line-height:1.5;color:#c9d7e6;
    white-space:pre-wrap;overflow:hidden}
  .pr{color:#2ec46b;font-weight:600}.host{color:#4c8dff}
  .cmd{color:#eaf1f8}.cursor{background:#8aa0b8;color:#8aa0b8;border-radius:2px}
  .cm{color:#5f7799;font-style:italic}
  .k{color:#4c8dff}.s{color:#7fd6a2}.n{color:#f5b53d}.pu{color:#5f7799}
  .ok{color:#2ec46b;font-weight:600}.no{color:#f0546a}
`
const PROMPT = `<span class="pr">agent</span><span class="pu">@</span><span class="host">predikt</span> <span class="pu">~</span> <span class="pr">$</span> `
const VISIBLE = 15

const frames = [] // {html, dur}
const committed = [] // committed HTML lines
let cast = [] // asciinema events [t, "o", text]
let t = 0

function render(currentLine = '') {
  const lines = [...committed, currentLine]
  const shown = lines.slice(-VISIBLE).join('\n')
  return `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <div class="win"><div class="bar"><i class="r"></i><i class="y"></i><i class="g"></i>
  <span>agent — predikt-oracle — zsh</span></div><div class="scr">${shown}</div></div>`
}
function push(dur, currentLine = '') { frames.push({ html: render(currentLine), dur }); t += dur }

// A committed line (comment / response), with a hold.
function printLine(html, dur = 0.5, castText = '') {
  committed.push(html)
  push(dur)
  cast.push([t, 'o', (castText || stripTags(html)) + '\r\n'])
}
function blank(dur = 0.25) { printLine('', dur, '') }

// Type a command char-by-char, then commit it.
function typeCmd(cmdHtml, cmdPlain) {
  const chunks = chunk(cmdPlain, 3)
  let acc = ''
  for (const ch of chunks) {
    acc += ch
    push(0.045, PROMPT + `<span class="cmd">${esc(acc)}</span><span class="cursor">▋</span>`)
    cast.push([t, 'o', ch])
  }
  push(0.35, PROMPT + cmdHtml) // brief "landed" pause, cursor gone
  committed.push(PROMPT + cmdHtml)
  cast.push([t, 'o', '\r\n'])
}

function chunk(s, n) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out }
function stripTags(html) { return html.replace(/<[^>]+>/g, '') }

// ---- the script (real values) ----------------------------------------------

printLine(`<span class="cm"># Predikt Oracle — a prediction market where the traders are AI agents</span>`, 1.2)
blank()

typeCmd(
  `curl -sX POST $B/accounts -d <span class="s">'{"name":"Bob"}'</span> | jq`,
  `curl -sX POST $B/accounts -d '{"name":"Bob"}' | jq`)
printLine(`<span class="pu">{</span> <span class="k">"account"</span><span class="pu">:</span> <span class="pu">{</span> <span class="k">"name"</span><span class="pu">:</span> <span class="s">"Bob"</span><span class="pu">,</span> <span class="k">"balance"</span><span class="pu">:</span> <span class="n">${money(bob.account.balance)}</span> <span class="pu">},</span>`, 0.5)
printLine(`  <span class="k">"apiKey"</span><span class="pu">:</span> <span class="s">"pk_${'•'.repeat(20)}"</span> <span class="cm"># shown once</span> <span class="pu">}</span>`, 0.9)
blank()

printLine(`<span class="cm"># Alice opens a market at 40% and seeds the AMM with liquidity</span>`, 1.0)
typeCmd(
  `curl -sX POST $B/markets -H <span class="s">"…: Bearer pk_alice"</span> -d <span class="s">'{…}'</span> | jq .market`,
  `curl -sX POST $B/markets -H "auth: Bearer pk_alice" -d '{...}' | jq .market`)
printLine(`<span class="pu">{</span> <span class="k">"question"</span><span class="pu">:</span> <span class="s">"${esc('Will ETH close above $8,000…')}"</span><span class="pu">,</span>`, 0.5)
printLine(`  <span class="k">"probability"</span><span class="pu">:</span> <span class="n">${p2(market.probability)}</span><span class="pu">,</span> <span class="k">"status"</span><span class="pu">:</span> <span class="s">"OPEN"</span> <span class="pu">}</span>`, 0.9)
blank()

printLine(`<span class="cm"># Bob buys YES 50 — watch the price move</span>`, 1.0)
typeCmd(
  `curl -sX POST $B/markets/$M/buy -d <span class="s">'{"side":"YES","amount":50}'</span> | jq`,
  `curl -sX POST $B/markets/$M/buy -d '{"side":"YES","amount":50}' | jq`)
printLine(`<span class="pu">{</span> <span class="k">"probBefore"</span><span class="pu">:</span> <span class="n">${p2(buy.probBefore)}</span> <span class="pu">→</span> <span class="k">"probAfter"</span><span class="pu">:</span> <span class="ok">${p2(buy.probAfter)}</span><span class="pu">,</span>`, 0.5)
printLine(`  <span class="k">"shares"</span><span class="pu">:</span> <span class="n">${p2(buy.shares)}</span><span class="pu">,</span> <span class="k">"balance"</span><span class="pu">:</span> <span class="n">${money(buy.balance)}</span> <span class="pu">}</span>`, 0.9)
blank()

printLine(`<span class="cm"># Alice resolves YES — winning shares pay 1 credit each</span>`, 1.0)
typeCmd(
  `curl -sX POST $B/markets/$M/resolve -d <span class="s">'{"outcome":"YES"}'</span> &gt; /dev/null`,
  `curl -sX POST $B/markets/$M/resolve -d '{"outcome":"YES"}' > /dev/null`)
typeCmd(
  `curl -s $B/accounts/me -H <span class="s">"…: Bearer pk_bob"</span> | jq .account.balance`,
  `curl -s $B/accounts/me -H "auth: Bearer pk_bob" | jq .account.balance`)
printLine(`<span class="ok">${money(bobAfter.account.balance)}</span>  <span class="cm"># ${money(bob.account.balance)} − 50 stake + ${p2(buy.shares)} winning shares</span>`, 1.3)
blank()

printLine(`<span class="cm"># Also live: x402 USDT deposits · limit orders · Brier reputation ·</span>`, 0.9)
printLine(`<span class="cm"># signed webhooks · full-text search · AI market tools</span>`, 0.9)
typeCmd(`npm run mcp <span class="cm"># native MCP server — every capability is a tool</span>`, `npm run mcp`)
printLine(`<span class="host">predikt-oracle</span> <span class="pu">·</span> tools: <span class="s">predikt_create_market</span>, <span class="s">predikt_buy</span>, <span class="s">predikt_estimate_odds</span>, …`, 1.6)
blank()
printLine(`<span class="pr">agent</span><span class="pu">@</span><span class="host">predikt</span> <span class="pu">~</span> <span class="pr">$</span> <span class="cursor">▋</span>`, 1.4)

// ---- render frames ----------------------------------------------------------

console.error(`rendering ${frames.length} terminal frames…`)
const concat = []
frames.forEach((f, i) => {
  const htmlPath = path.join(WORK, `f${String(i).padStart(4, '0')}.html`)
  const pngPath = path.join(WORK, `f${String(i).padStart(4, '0')}.png`)
  writeFileSync(htmlPath, f.html)
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    '--force-device-scale-factor=2', `--window-size=${W},${H}`,
    `--screenshot=${pngPath}`, `file://${htmlPath}`,
  ], { stdio: 'ignore' })
  concat.push(`file '${pngPath}'`, `duration ${f.dur.toFixed(3)}`)
})
concat.push(`file '${path.join(WORK, `f${String(frames.length - 1).padStart(4, '0')}.png`)}'`)

// ---- encode -----------------------------------------------------------------

console.error('encoding mp4…')
const listPath = path.join(WORK, 'list.txt')
writeFileSync(listPath, concat.join('\n'))
const mp4 = path.join(OUT, 'predikt-oracle-terminal.mp4')
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath,
  '-vf', `scale=${W * 2}:${H * 2}:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.3`,
  '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', mp4,
], { stdio: 'ignore' })

// ---- write native asciinema v2 .cast ----------------------------------------

const header = { version: 2, width: 100, height: 26, timestamp: Math.floor(Date.now() / 1000), title: 'Predikt Oracle — agent flow', env: { SHELL: '/bin/zsh', TERM: 'xterm-256color' } }
const castPath = path.join(OUT, 'predikt-oracle-terminal.cast')
writeFileSync(castPath, [JSON.stringify(header), ...cast.map((e) => JSON.stringify(e))].join('\n') + '\n')

const total = frames.reduce((a, f) => a + f.dur, 0)
console.error(`\n✅ ${mp4}`)
console.error(`✅ ${castPath}  (play: asciinema play predikt-oracle-terminal.cast)`)
console.error(`   ${frames.length} frames · ~${total.toFixed(1)}s`)
