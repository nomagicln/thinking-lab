/*!
 * browser-check.cjs — 端到端检查（覆盖全部四个页面）
 *
 * 先用 `vite preview` 起静态服务（产物是多页 SPA，file:// 下模块路径会失效），
 * 再用无头 Chrome 通过 CDP 逐页加载：抓控制台错误、断言渲染结果、模拟真实交互。
 *
 * 运行：npm run build && npm run test:browser
 * 也可以直接检查线上站点：node test/browser-check.cjs --url https://nomagicln.github.io/thinking-lab/
 */

'use strict'

const child = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const net = require('net')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

const CHROME_CANDIDATES = [
  path.join(
    os.homedir(),
    '.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell'
  ),
  path.join(
    os.homedir(),
    '.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell'
  ),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
if (!CHROME) {
  console.error('找不到可用的 Chrome 可执行文件')
  process.exit(2)
}

const shotArg = process.argv.indexOf('--shot')
const SHOT = shotArg > -1 ? process.argv[shotArg + 1] : path.join(ROOT, '.preview.png')

// --url <地址> 直接检查已部署的站点（跳过本地 preview）
const urlArg = process.argv.indexOf('--url')
const REMOTE_URL = urlArg > -1 ? process.argv[urlArg + 1] : null

// --page <名称> 只检查某一页（hub / axelrod / boids / maxwell-demon）
const pageArg = process.argv.indexOf('--page')
const ONLY_PAGE = pageArg > -1 ? process.argv[pageArg + 1].replace(/^\/+|\/+$/g, '') : null

if (!REMOTE_URL && !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ 不存在，请先执行 npm run build（或用 --url 检查线上站点）')
  process.exit(2)
}

let pass = 0
let fail = 0

function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log('  \x1b[32m✓\x1b[0m ' + name + (detail ? '  \x1b[90m' + detail + '\x1b[0m' : ''))
  } else {
    fail++
    console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? '  \x1b[90m' + detail + '\x1b[0m' : ''))
  }
}
const group = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function waitFor(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(150)
  }
  return false
}

/** React 受控 input 必须走原生 setter，否则 onChange 收不到 */
const setInput = (id, value) => `(function(){
  var el = document.getElementById('${id}');
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '${value}');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`

/** 画布上是否真的落了像素 */
const CANVAS_HAS_PIXELS = (sel) => `(function(){
  var c = document.querySelector('${sel}');
  if (!c || !c.width || !c.height) return false;
  var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  // 整幅抽样：只看顶部若干行会误判（boids 的上方通常是空的）
  for (var i = 3; i < d.length; i += 4 * 37) if (d[i] > 0) return true;
  return false;
})()`


/**
 * 导航链接检查 —— 每页都跑。
 *
 * 这里必须真的 fetch 一遍：链接拼错（比如从 /boids/ 页面链到 ./axelrod/，
 * 解析成 /boids/axelrod/）在 DOM 里看不出任何异常，只有请求才会 404。
 */
async function checkNav(ev, base, pageName) {
  group('导航链接')
  const raw = await ev(`(async function(){
    var as = Array.from(document.querySelectorAll('.labnav a'));
    var out = [];
    for (var i = 0; i < as.length; i++) {
      var href = as[i].getAttribute('href');
      try {
        var r = await fetch(as[i].href, { method: 'GET' });
        out.push({ label: as[i].textContent.trim(), href: href, status: r.status });
      } catch (e) {
        out.push({ label: as[i].textContent.trim(), href: href, status: 0 });
      }
    }
    return JSON.stringify(out);
  })()`)
  const links = JSON.parse(raw)
  check(`${pageName}：导航链接数量正常`, links.length >= 3, links.map((l) => l.href).join(' '))
  const broken = links.filter((l) => l.status !== 200)
  check(`${pageName}：每个导航链接都能打开（不是拼错的子路径）`,
    broken.length === 0,
    broken.length ? broken.map((l) => l.href + '→' + l.status).join(' ') : links.map((l) => l.href).join(' '))
  const dangling = links.filter((l) => l.status === 200 && /\/(axelrod|boids|maxwell-demon)\/\1\//.test(new URL(l.href, base).pathname))
  check(`${pageName}：没有重复拼接的路径段`, dangling.length === 0)
}

/* ================================================================== *
 * 各页断言
 * ================================================================== */

async function checkHub(ev) {
  group('实验室首页')
  check('三张实验卡片', (await ev("document.querySelectorAll('.hub-card').length")) === 3)
  const hrefs = await ev("Array.from(document.querySelectorAll('.hub-card')).map(a=>a.getAttribute('href')).join(',')")
  check('卡片指向三个实验', hrefs === './axelrod/,./boids/,./maxwell-demon/', hrefs)
  check('导航列出三个实验', (await ev("document.querySelectorAll('.labnav__item').length")) === 3)
  check('首页不高亮任何一项', (await ev("document.querySelectorAll('.labnav__item.is-current').length")) === 0)
  check('每张卡片都有主题图案', (await ev("document.querySelectorAll('.hub-card__motif').length")) === 3)
  check('卡片主色互不相同',
    (await ev(`(function(){
      var s = new Set(Array.from(document.querySelectorAll('.hub-card')).map(c=>getComputedStyle(c).getPropertyValue('--card-accent').trim()));
      return s.size;
    })()`)) === 3)
}

async function checkAxelrod(ev) {
  group('阿克塞尔罗德 · 结论与排名')
  check('冠军是一报还一报', (await ev("document.querySelector('.verdict__name')?.textContent")) === '一报还一报')
  check('结论横幅展示 5 条特质', (await ev("document.querySelectorAll('.verdict__profile .traitbar').length")) === 5)
  check('排名条 = 参赛人数', (await ev("document.querySelectorAll('.rank-row').length")) === 11)
  check('每行 5 点迷你特质', (await ev("document.querySelectorAll('.rank-row:first-child .trait-mini__dot').length")) === 5)

  group('阿克塞尔罗德 · 图表')
  check('热力图格子 = n²', (await ev("document.querySelectorAll('#sec-matrix .heatmap__cell').length")) === 121)
  check('收敛曲线纵轴是累计总分',
    Math.max(...(await ev("Array.from(document.querySelectorAll('#sec-convergence .lines__tick')).map(t=>parseFloat(t.textContent)).filter(isFinite)"))) > 100)
  check('生态堆叠带 = 策略数', (await ev("document.querySelectorAll('#sec-ecology .stream__band').length")) === 11)

  group('阿克塞尔罗德 · 多人回放与档案')
  check('默认 4 位参与者', (await ev("document.querySelectorAll('#pb-participants .chip.is-on').length")) === 4)
  check('每条泳道一个 canvas', (await ev("document.querySelectorAll('#sec-playback .pb__lane').length")) === 4)
  check('快照矩阵 = K²', (await ev("document.querySelectorAll('#sec-playback .pb__grid-cell').length")) === 16)
  check('档案 17 张卡片', (await ev("document.querySelectorAll('#sec-dossier .dossier-card').length")) === 17)
  const sigs = await ev(`(function(){
    var seen = {}, dup = [];
    document.querySelectorAll('#sec-dossier .dossier-card').forEach(function(c){
      var v = Array.from(c.querySelectorAll('.traitbar__val')).map(e=>e.textContent).join('/');
      var cid = c.id.replace('dossier-','');
      if (seen[v]) dup.push(seen[v] + '=' + cid); else seen[v] = cid;
    });
    return { distinct: Object.keys(seen).length, dup: dup };
  })()`)
  check('特质组合至少 14 种且只重复 tft/ctft',
    sigs.distinct >= 14 && sigs.dup.length === 1 && /ctft/.test(sigs.dup[0]),
    `${sigs.distinct} 种，重复 ${sigs.dup.join(';') || '无'}`)
  const pair = await ev(`(function(){
    function vals(id){ return Array.from(document.querySelectorAll('#dossier-'+id+' .traitbar__val')).map(e=>e.textContent); }
    return { tft: vals('tft'), fbf: vals('fbf') };
  })()`)
  check('TFT 与 FBF 特质不同', pair.tft.join() !== pair.fbf.join(),
    `TFT [${pair.tft.join(' ')}] vs FBF [${pair.fbf.join(' ')}]`)

  group('阿克塞尔罗德 · 交互')
  await ev(setInput('in-T', '1'))
  await sleep(800)
  check('非法矩阵被标红', (await ev("document.querySelectorAll('#constraints .constraint.is-bad').length")) >= 1)
  await ev("document.querySelectorAll('#matrix-presets .chip')[4].click()")
  await sleep(1400)
  check('预设把 T 改成 10', (await ev("document.getElementById('in-T').value")) === '10')
  await ev("document.querySelectorAll('#matrix-presets .chip')[0].click()")
  await sleep(1300)
  await ev("document.getElementById('pb-all').click()")
  await sleep(1100)
  check('「全部」把 11 位放进回放', (await ev("document.querySelectorAll('#sec-playback .pb__lane').length")) === 11)
}

async function checkBoids(ev) {
  group('Boids · 仿真与读数')
  check('画布已绘制像素', await ev(CANVAS_HAS_PIXELS('#sec-flock canvas')))
  check('四项读数', (await ev("document.querySelectorAll('#flock-readouts .readout').length")) === 4)
  const pol = parseFloat(await ev("document.querySelectorAll('#flock-readouts .readout__value')[0].textContent"))
  check('极化度是 0..1 的合法值', pol >= 0 && pol <= 1, String(pol))
  check('鸟的数量上限 ≥ 2000（加了空间网格之后才有意义）',
    Number(await ev("document.getElementById('in-count').max")) >= 2000,
    'max=' + (await ev("document.getElementById('in-count').max")))
  check('已自动选中一只鸟', /已选中第 \d+ 只/.test(await ev("document.getElementById('selection-note').textContent") || ''))

  group('Boids · 规则分解')
  check('规则分解有 3 条力', (await ev("document.querySelectorAll('#sec-rules .rule-row').length")) === 3)
  const ruleVals = await ev("Array.from(document.querySelectorAll('#sec-rules .rule-row__val')).map(e=>parseFloat(e.textContent))")
  check('三条力都是有限数值', ruleVals.length === 3 && ruleVals.every((v) => Number.isFinite(v)), ruleVals.join(' / '))

  group('Boids · 秩序与消融')
  check('秩序图拆成两张（不同量纲不共用一轴）', (await ev("document.querySelectorAll('#sec-order .chart-pair .lines').length")) === 2)
  check('消融表 4 行配置', (await ev("document.querySelectorAll('#sec-order .ablation__row').length")) === 5, '含表头')
  const abl = await ev(`(function(){
    var rows = Array.from(document.querySelectorAll('#sec-order .ablation__row')).slice(1);
    return rows.map(function(r){
      var c = r.querySelectorAll('.ablation__cell');
      return { name: r.querySelector('.ablation__name').textContent,
               pol: parseFloat(c[0].textContent),
               radius: parseFloat(c[1].textContent),
               nnd: parseFloat(c[2].textContent) };
    });
  })()`)
  const pick = (frag) => abl.find((r) => r.name.includes(frag))
  const sep = pick('只有分离')
  const ali = pick('只有对齐')
  const coh = pick('只有聚合')
  const all = pick('三条全开')

  // 这四条断言都是「跨种子稳定」的事实（6 个种子实测）：
  //   分离 极0.09 径140 邻17.9 ｜ 对齐 极1.00 径110 邻13.1
  //   聚合 极0.43 径43  邻6.4   ｜ 全开 极0.99 径36  邻8.2
  // 注意「只有聚合半径最小」是错的 —— 全开才是最紧的，因为默认权重里
  // 分离 1.8 反而把队伍收得更拢。断言必须跟着实测走，不能跟着直觉走。
  check('只有分离 → 一盘散沙（最近邻最大、几乎没有共同方向）',
    !!sep && abl.every((r) => sep.nnd >= r.nnd - 0.01) && sep.radius >= Math.max(...abl.map((r) => r.radius)) - 0.5 && sep.pol < 0.3,
    sep && `最近邻 ${sep.nnd} 半径 ${sep.radius} 极化度 ${sep.pol}`)
  check('只有对齐 → 方向最整齐', !!ali && abl.every((r) => ali.pol >= r.pol - 0.005),
    ali && `极化度 ${ali.pol}`)
  check('只有聚合 → 团紧了但方向是乱的（聚拢 ≠ 有序）',
    !!coh && coh.pol < 0.7 && coh.radius < ali.radius,
    coh && `极化度 ${coh.pol} 半径 ${coh.radius}，对比只有对齐的半径 ${ali && ali.radius}`)
  check('三条全开是唯一「既有序又紧密」的配置',
    !!all && all.pol > 0.9 && all.radius <= Math.min(...abl.map((r) => r.radius)) + 0.5,
    all && `极化度 ${all.pol} 半径 ${all.radius}`)

  group('Boids · 相变')
  check('相变曲线已渲染',
    (await ev("document.querySelectorAll('#phase-result .lines__path').length")) >= 1)
  const pols = await ev(`(function(){
    var p = document.querySelector('#phase-result .lines__path');
    return p ? p.getAttribute('d').split('L').length : 0;
  })()`)
  check('曲线点数 = 噪声档位', pols >= 10, pols + ' 点')
  check('标出了临界噪声', /临界噪声/.test(await ev("document.querySelector('#phase-result .lines__marker')?.textContent") || ''))
  // 断言「曲线整体下降」，而不是拿某个绝对像素值当阈值 ——
  // 后者会随图表高度、边距、档位数一起漂移，是个假断言。
  // 用 SVG 自己的几何 API 取首尾点，避免在字符串里嵌正则（转义层数一多就会错）。
  const drop = await ev(`(function(){
    var p = document.querySelector('#phase-result .lines__path');
    if (!p || !p.getTotalLength) return null;
    var total = p.getTotalLength();
    if (!total) return null;
    var a = p.getPointAtLength(0);
    var b = p.getPointAtLength(total);
    return { firstY: a.y, lastY: b.y };
  })()`)
  check('低噪声端在图上明显高于高噪声端（有序 → 无序）',
    !!drop && drop.lastY > drop.firstY + 60,
    drop ? '首点 y=' + drop.firstY.toFixed(0) + ' 末点 y=' + drop.lastY.toFixed(0) : '取不到路径')

  group('Boids · 侧栏（曾经滚不到底）')
  await ev('localStorage.clear()')
  await ev('window.scrollTo(0, 0)')
  await sleep(300)
  const railBox = await ev(`(function(){
    var st = document.querySelector('.rail__sticky');
    var rail = document.querySelector('.rail');
    return JSON.stringify({
      clientH: st.clientHeight,
      scrollH: st.scrollHeight,
      railH: Math.round(rail.getBoundingClientRect().height)
    });
  })()`)
  const rb = JSON.parse(railBox)
  check('侧栏内容高于视口（确实需要内部滚动）', rb.scrollH > rb.clientH, `${rb.scrollH} > ${rb.clientH}`)
  // 关键回归点：sticky 元素必须比它的容器矮，否则没有可移动空间，根本不吸附
  check('sticky 容器比粘性元素高（否则位移空间为 0）', rb.railH > rb.clientH + 50, `容器 ${rb.railH} vs 元素 ${rb.clientH}`)

  await ev('window.scrollTo(0, 2000)')
  await sleep(500)
  const stuck = await ev(`(function(){
    var st = document.querySelector('.rail__sticky');
    var b = st.getBoundingClientRect();
    return JSON.stringify({ top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight });
  })()`)
  const sk = JSON.parse(stuck)
  check('页面滚到 2000 后侧栏仍吸附在视口顶部',
    Math.abs(sk.top - 22) < 5 && sk.bottom <= sk.vh + 2, `top=${sk.top} bottom=${sk.bottom}`)

  const reached = await ev(`(function(){
    var st = document.querySelector('.rail__sticky');
    st.scrollTop = 999999;
    var need = st.scrollHeight - st.clientHeight;
    var last = st.querySelector('.panel:last-of-type');
    var lb = last.getBoundingClientRect(), sb = st.getBoundingClientRect();
    return JSON.stringify({ asked: Math.round(st.scrollTop), need: need, lastVisible: lb.bottom <= sb.bottom + 1 });
  })()`)
  const rc = JSON.parse(reached)
  check('侧栏能滚到底，最后一组参数可见', rc.lastVisible && Math.abs(rc.asked - rc.need) < 2,
    `滚了 ${rc.asked} / 需要 ${rc.need}`)

  group('Boids · 折叠')
  const heads = await ev("document.querySelectorAll('.rail .panel__head').length")
  check('每组参数都有折叠开关', heads >= 4, heads + ' 组')
  await ev("document.querySelectorAll('.rail .panel__head')[0].click()")
  await sleep(250)
  check('点标题即折叠该组', (await ev("document.querySelectorAll('.rail .panel.is-folded').length")) === 1)
  check('折叠后内容真的隐藏',
    (await ev("document.querySelectorAll('.rail .panel.is-folded .panel__body[hidden]').length")) === 1)
  await ev("Array.from(document.querySelectorAll('.railtools__btn')).find(b=>b.textContent.includes('全部折叠')).click()")
  await sleep(300)
  const allFolded = await ev("document.querySelectorAll('.rail .panel.is-folded').length")
  check('「全部折叠」一次收起所有参数组', allFolded >= 4, allFolded + ' 组已折叠')
  const shrunk = await ev("document.querySelector('.rail__sticky').scrollHeight")
  check('折叠后侧栏内容显著变短（不再需要滚动）', shrunk < rb.scrollH * 0.6, `${rb.scrollH} → ${shrunk}`)
  await ev("Array.from(document.querySelectorAll('.railtools__btn')).find(b=>b.textContent.includes('全部展开')).click()")
  await sleep(300)
  check('「全部展开」恢复', (await ev("document.querySelectorAll('.rail .panel.is-folded').length")) === 0)

  check('章节也能折叠', (await ev("document.querySelectorAll('.sec__fold').length")) >= 3,
    (await ev("document.querySelectorAll('.sec__fold').length")) + ' 个章节可折叠')

  group('Boids · 交互')
  await ev("document.getElementById('btn-play').click()")
  await sleep(400)
  check('暂停按钮切换文案', (await ev("document.getElementById('btn-play').textContent")) === '继续')
  await ev("document.getElementById('btn-play').click()")
  await sleep(300)
  await ev(setInput('in-ali', '0'))
  await sleep(600)
  check('对齐权重可调到 0', (await ev("document.getElementById('in-ali').value")) === '0')
  await ev("document.getElementById('btn-reset').click()")
  await sleep(900)
  check('重新放飞后仍在运行', (await ev("document.querySelectorAll('#sec-flock canvas').length")) === 1)
}

async function checkMaxwell(ev) {
  group('麦克斯韦妖 · 观察窗与账本')
  check('画布已绘制像素', await ev(CANVAS_HAS_PIXELS('#sec-chamber canvas')))
  check('五项读数', (await ev("document.querySelectorAll('#demon-readouts .readout').length")) === 5)

  const ledger = await ev(`(function(){
    var rows = Array.from(document.querySelectorAll('#sec-ledger .ledger__row'));
    return rows.map(function(r){
      return { label: r.querySelector('.ledger__label b').textContent, value: r.querySelector('.ledger__value').textContent };
    });
  })()`)
  check('账本 4 行（气体 / 擦除 / 测量 / 净熵）', ledger.length === 4, ledger.map((r) => r.label).join(' / '))
  check('净熵行存在', ledger.some((r) => r.label === '净熵变'))

  const ratio = parseFloat(await ev("document.querySelectorAll('#demon-readouts .readout__value')[2].textContent"))
  check('妖已制造出温差（冷热比 > 1）', ratio > 1, '冷热比 ' + ratio)

  group('麦克斯韦妖 · 温差与容量扫描')
  check('温度曲线已渲染', (await ev("document.querySelectorAll('#sec-temp .lines__path').length")) === 2)
  const cap = await ev(`(function(){
    var rows = Array.from(document.querySelectorAll('#sec-capacity .ablation__row')).slice(1);
    return rows.map(function(r){
      var c = r.querySelectorAll('.ablation__cell');
      return { name: r.querySelector('.ablation__name').textContent, net: parseFloat(c[2].textContent) };
    });
  })()`)
  check('容量表 8 档', cap.length === 8, cap.map((r) => r.name).join(' '))
  const finite = cap.filter((r) => !r.name.includes('无限'))
  const inf = cap.find((r) => r.name.includes('无限'))
  check('所有有限容量：净熵为正（Landauer 买单）',
    finite.length === 7 && finite.every((r) => r.net > 0),
    finite.map((r) => `${r.name}:${r.net}`).join(' '))
  check('无限记忆：净熵为负（悖论出现）', inf && inf.net < 0, inf && `无限:${inf.net}`)
  check('容量越大擦除越少（末档擦除显著低于首档）',
    (await ev(`(function(){
      var rows = Array.from(document.querySelectorAll('#sec-capacity .ablation__row')).slice(1);
      var erase = rows.map(function(r){ return parseFloat(r.querySelectorAll('.ablation__cell')[1].textContent); });
      return erase[erase.length - 1] < erase[0] * 0.6;
    })()`)) === true)

  group('麦克斯韦妖 · 交互')
  await ev("document.getElementById('btn-play').click()")
  await sleep(400)
  check('暂停按钮切换文案', (await ev("document.getElementById('btn-play').textContent")) === '继续')
  await ev("document.getElementById('btn-play').click()")
  await sleep(300)
  // 切成「不设妖」的对照组
  await ev("document.querySelectorAll('#sec-chamber ~ * .seg button, .rail .seg button')[3].click()")
  await sleep(1200)
  check('可切到「不设妖」对照组',
    (await ev("document.getElementById('chamber-note').textContent") || '').includes('不设妖'))
}

/* ================================================================== */

async function main() {
  let base = REMOTE_URL
  let server = null

  if (!base) {
    const port = await freePort()
    base = `http://127.0.0.1:${port}/`
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    server = child.spawn(
      process.execPath,
      [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    server.stderr.on('data', (d) => {
      const s = String(d)
      if (/error/i.test(s)) console.error('[vite]', s.trim())
    })
  } else {
    console.log(`\n\x1b[1m目标：${base}\x1b[0m`)
  }

  const debugPort = await freePort()
  const chrome = child.spawn(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1440,900',
      `--remote-debugging-port=${debugPort}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )

  const cleanup = () => {
    try { chrome.kill() } catch { /* noop */ }
    try { if (server) server.kill() } catch { /* noop */ }
  }

  try {
    if (!(await waitFor(base))) throw new Error('预览服务未就绪')

    let wsUrl
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
        const page = list.find((t) => t.type === 'page')
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl
          break
        }
      } catch { /* 还没起来 */ }
      await sleep(150)
    }
    if (!wsUrl) throw new Error('Chrome 调试端口未就绪')

    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = {}
    let pageErrors = []

    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data)
      if (m.id && pending[m.id]) {
        pending[m.id](m)
        delete pending[m.id]
        return
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').split('\n')[0])
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const ex = m.params.exceptionDetails
        pageErrors.push(((ex.exception && ex.exception.description) || ex.text).split('\n')[0])
      }
    }

    const send = (method, params) =>
      new Promise((res) => {
        const mid = ++id
        pending[mid] = (m) => res(m.error ? { __error: m.error } : m.result)
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }))
      })

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (!r || r.__error) throw new Error(JSON.stringify(r))
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
      return r.result.value
    }

    await send('Runtime.enable')
    await send('Page.enable')

    const PAGES = [
      { id: '', name: 'hub', wait: 2600, fn: checkHub },
      { id: 'axelrod/', name: 'axelrod', wait: 4200, fn: checkAxelrod },
      { id: 'boids/', name: 'boids', wait: 11000, fn: checkBoids },
      { id: 'maxwell-demon/', name: 'maxwell-demon', wait: 9000, fn: checkMaxwell }
    ].filter((p) => !ONLY_PAGE || p.name === ONLY_PAGE)

    for (const page of PAGES) {
      pageErrors = []
      await send('Page.navigate', { url: base + page.id })
      await sleep(page.wait)

      console.log(`\n\x1b[1m\x1b[4m${page.name}\x1b[0m`)
      check(`${page.name} 无未捕获异常`, pageErrors.length === 0, pageErrors[0] || '')
      await checkNav(evaluate, base, page.name)
      await page.fn(evaluate)
    }

    /* 截图（只截首页，避免超大图） */
    const shot = await Promise.race([
      send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }),
      sleep(25000).then(() => null)
    ])
    if (shot && shot.data) {
      fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
      console.log('\n  截图已保存：' + SHOT)
    }

    ws.close()
  } finally {
    cleanup()
  }

  console.log('\n' + '─'.repeat(60))
  if (fail === 0) console.log(`\x1b[32m端到端全部通过：${pass} 项\x1b[0m`)
  else console.log(`\x1b[31m${fail} 项失败 / 共 ${pass + fail} 项\x1b[0m`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('检查脚本自身出错：', e)
  process.exit(2)
})
