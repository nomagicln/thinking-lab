/*!
 * browser-check.js — 端到端检查
 *
 * 先用 `vite preview` 起一个静态服务（产物是 SPA，file:// 下模块路径会失效），
 * 再用无头 Chrome 通过 CDP 加载、抓控制台错误、断言渲染结果、模拟真实交互。
 *
 * 运行：npm run build && npm run test:browser
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
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ 不存在，请先执行 npm run build')
  process.exit(2)
}

const shotArg = process.argv.indexOf('--shot')
const SHOT = shotArg > -1 ? process.argv[shotArg + 1] : path.join(ROOT, '.preview.png')

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
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m')
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

/* ------------------------------------------------------------------ */

async function main() {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`

  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = child.spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  server.stderr.on('data', (d) => {
    const s = String(d)
    if (/error/i.test(s)) console.error('[vite]', s.trim())
  })

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
    try { server.kill() } catch { /* noop */ }
  }

  try {
    if (!(await waitFor(url))) throw new Error('vite preview 未就绪')

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
    const consoleErrors = []
    const pageErrors = []

    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending[msg.id]) {
        pending[msg.id](msg)
        delete pending[msg.id]
        return
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const ex = msg.params.exceptionDetails
        pageErrors.push((ex.exception && ex.exception.description) || ex.text)
      }
    }

    const send = (method, params) =>
      new Promise((res) => {
        const mid = ++id
        pending[mid] = (m) => res(m.error ? { __error: m.error } : m.result)
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }))
      })

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      })
      if (!r || r.__error) throw new Error(JSON.stringify(r))
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
      return r.result.value
    }

    await send('Runtime.enable')
    await send('Page.enable')
    await send('Page.navigate', { url })
    await sleep(4200)

    /* ---------------- 加载 ---------------- */
    section('页面加载')
    check('无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
    check('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    /* ---------------- 结论 ---------------- */
    section('结论区')
    const verdict = await evaluate("document.querySelector('.verdict__name')?.textContent")
    check('冠军是一报还一报', verdict === '一报还一报', String(verdict))
    check('渲染出冠军分数', /50\d/.test(await evaluate("document.querySelector('.verdict__score')?.textContent") || ''))
    check('结论横幅展示冠军的 5 条特质',
      (await evaluate("document.querySelectorAll('.verdict__profile .traitbar').length")) === 5)
    check('运行统计里有耗时',
      /计算耗时/.test(await evaluate("document.getElementById('run-stats')?.textContent") || ''))

    /* ---------------- 排名 ---------------- */
    section('排名区')
    check('排名条数量 = 参赛人数', (await evaluate("document.querySelectorAll('.rank-row').length")) === 11)
    check('第一行是冠军',
      /一报还一报/.test(await evaluate("document.querySelector('.rank-row .rank-row__name')?.textContent") || ''))
    check('每行 5 点迷你特质指标',
      (await evaluate("document.querySelectorAll('.rank-row:first-child .trait-mini__dot').length")) === 5)

    /* ---------------- 矩阵 ---------------- */
    section('对阵矩阵')
    check('热力图格子 = n²', (await evaluate("document.querySelectorAll('#sec-matrix .heatmap__cell').length")) === 121)
    check('非对角格子有数值', (await evaluate("document.querySelectorAll('#sec-matrix .heatmap__val').length")) === 110)
    const legend = await evaluate(`(function(){
      var svg = document.querySelector('#sec-matrix svg');
      var vb = svg.viewBox.baseVal, maxY = 0;
      svg.querySelectorAll('.heatmap__legend').forEach(function(t){
        var b = t.getBBox(); if (b.y + b.height > maxY) maxY = b.y + b.height;
      });
      return { h: vb.height, bottom: maxY };
    })()`)
    check('图例文字未被裁切', legend.bottom <= legend.h,
      `内容底 ${legend.bottom.toFixed(1)} / 高度 ${legend.h}`)

    /* ---------------- 收敛 / 生态 ---------------- */
    section('收敛曲线与生态演化')
    check('收敛曲线条数 = 策略数',
      (await evaluate("document.querySelectorAll('#sec-convergence .lines__path').length")) === 11)
    const yTicks = await evaluate(
      "Array.from(document.querySelectorAll('#sec-convergence .lines__tick')).map(t=>parseFloat(t.textContent)).filter(isFinite)"
    )
    check('纵轴量级是累计总分而非每轮均分', Math.max(...yTicks) > 100, `最大刻度 ${Math.max(...yTicks)}`)
    check('生态堆叠带 = 策略数',
      (await evaluate("document.querySelectorAll('#sec-ecology .stream__band').length")) === 11)
    check('终局份额表有数据',
      (await evaluate("document.querySelectorAll('#sec-ecology .eco-final__row').length")) === 11)

    /* ---------------- 多人回放 ---------------- */
    section('多人同步回放')
    check('默认参与者为 4 位（不止两人）',
      (await evaluate("document.querySelectorAll('#pb-participants .chip.is-on').length")) === 4)
    check('候选芯片覆盖全部参赛选手',
      (await evaluate("document.querySelectorAll('#pb-participants .chip').length")) === 11)
    check('每条泳道一个 canvas',
      (await evaluate("document.querySelectorAll('#sec-playback .pb__lane').length")) === 4 &&
        (await evaluate("document.querySelectorAll('#sec-playback .pb__canvas').length")) === 4)
    check('canvas 真的画上了像素', await evaluate(`(function(){
      var c = document.querySelector('#sec-playback .pb__canvas');
      if (!c || !c.width) return false;
      var d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(4, c.height)).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    })()`))
    check('本轮快照矩阵 = K²', (await evaluate("document.querySelectorAll('#sec-playback .pb__grid-cell').length")) === 16)
    check('快照显示了本轮出手',
      (await evaluate(
        "document.querySelectorAll('#sec-playback .pb__grid-cell.is-c, #sec-playback .pb__grid-cell.is-d').length"
      )) === 12)

    section('回放：增减参与者')
    await evaluate("document.getElementById('pb-all').click()")
    await sleep(1200)
    check('「全部」把 11 位都放进回放',
      (await evaluate("document.querySelectorAll('#sec-playback .pb__lane').length")) === 11)
    check('快照矩阵随之扩到 11×11',
      (await evaluate("document.querySelectorAll('#sec-playback .pb__grid-cell').length")) === 121)
    await evaluate("document.getElementById('pb-top').click()")
    await sleep(1000)
    check('「前四名」收回到 4 位',
      (await evaluate("document.querySelectorAll('#sec-playback .pb__lane').length")) === 4)

    section('回放：逐轮推进')
    await evaluate("document.querySelectorAll('#sec-playback .pb-bar__btns button')[2].click()")
    await sleep(300)
    const round = await evaluate("document.querySelector('.pb__round')?.textContent")
    check('单步推进改变了轮次标签', /第 \d+ \/ \d+ 轮/.test(round || ''), round)
    check('显示了本轮全局合作统计',
      /次出手/.test(await evaluate("document.querySelector('.pb__tally')?.textContent") || ''))
    check('泳道实时更新累计分',
      /^\d+$/.test(await evaluate("document.querySelector('.pb__score')?.textContent") || ''))
    await evaluate("document.getElementById('btn-play').click()")
    await sleep(700)
    check('播放按钮进入暂停态',
      (await evaluate("document.getElementById('btn-play')?.textContent")) === '暂停')
    await evaluate("document.getElementById('btn-play').click()")
    await sleep(200)

    /* ---------------- 策略档案 ---------------- */
    section('策略档案')
    check('档案卡片覆盖全部 17 位策略',
      (await evaluate("document.querySelectorAll('#sec-dossier .dossier-card').length")) === 17)
    check('每张卡片 5 条特质横杠',
      (await evaluate("document.querySelectorAll('#sec-dossier .traitbar').length")) === 85)
    check('五个轴名称正确',
      (await evaluate(
        "Array.from(document.querySelectorAll('#sec-dossier .traitbar__label')).slice(0,5).map(e=>e.textContent).join(',')"
      )) === '友善,报复,宽容,破局,可预测')

    const sigs = await evaluate(`(function(){
      var seen = {}, dup = [];
      document.querySelectorAll('#sec-dossier .dossier-card').forEach(function(c){
        var v = Array.from(c.querySelectorAll('.traitbar__val')).map(function(e){return e.textContent;}).join('/');
        var cid = c.id.replace('dossier-','');
        if (seen[v]) dup.push(seen[v] + '=' + cid); else seen[v] = cid;
      });
      return { distinct: Object.keys(seen).length, dup: dup };
    })()`)
    check('档案里出现至少 14 种不同的特质组合', sigs.distinct >= 14, sigs.distinct + ' 种')
    check('唯一的重复只有无噪音下等价的 tft / ctft',
      sigs.dup.length === 1 && /ctft/.test(sigs.dup[0]) && /tft/.test(sigs.dup[0]),
      sigs.dup.join(';') || '无重复')

    const pair = await evaluate(`(function(){
      function vals(id){
        return Array.from(document.querySelectorAll('#dossier-' + id + ' .traitbar__val')).map(e=>e.textContent);
      }
      return { tft: vals('tft'), fbf: vals('fbf') };
    })()`)
    check('一报还一报与坚定而公平的特质不再相同', pair.tft.join() !== pair.fbf.join(),
      `TFT [${pair.tft.join(' ')}] vs FBF [${pair.fbf.join(' ')}]`)
    check('差异体现在「破局」这一条上', pair.tft[3] !== pair.fbf[3],
      `破局 TFT ${pair.tft[3]} vs FBF ${pair.fbf[3]}`)
    check('行为重合的策略带有说明',
      (await evaluate("document.querySelectorAll('#sec-dossier .dossier-card__note').length")) >= 1)

    /* ---------------- 交互 ---------------- */
    section('交互：非法收益矩阵')
    await evaluate(setInput('in-T', '1'))
    await sleep(900)
    const bad = await evaluate("document.querySelectorAll('#constraints .constraint.is-bad').length")
    check('非法矩阵被标红', bad >= 1, bad + ' 条约束不成立')

    section('交互：切换收益矩阵预设')
    await evaluate("document.querySelectorAll('#matrix-presets .chip')[4].click()")
    await sleep(1500)
    check('预设把 T 改成 10', (await evaluate("document.getElementById('in-T').value")) === '10',
      'T=' + (await evaluate("document.getElementById('in-T').value")))
    const alldRank = await evaluate(`(function(){
      var rows = Array.from(document.querySelectorAll('.rank-row__name'));
      for (var i = 0; i < rows.length; i++) if (/永远背叛/.test(rows[i].textContent)) return i + 1;
      return -1;
    })()`)
    check('诱惑变大后「永远背叛」名次上升', alldRank > 0 && alldRank < 11,
      '第 ' + alldRank + ' 名（默认第 11 名）')
    await evaluate("document.querySelectorAll('#matrix-presets .chip')[0].click()")
    await sleep(1400)

    section('交互：调高误操作率')
    await evaluate(setInput('in-noise', '10'))
    await sleep(1500)
    check('运行统计反映新的误操作率',
      /10%/.test(await evaluate("document.getElementById('run-stats')?.textContent") || ''))
    await evaluate(setInput('in-noise', '0'))
    await sleep(1300)

    section('交互：切换阵容与几何模式')
    await evaluate("document.querySelectorAll('#roster-presets .chip')[5].click()")
    await sleep(1800)
    check('切到「全员对决」后 17 位选手进场',
      (await evaluate("document.querySelectorAll('.rank-row').length")) === 17)
    await evaluate("document.querySelectorAll('#roster-presets .chip')[0].click()")
    await sleep(1600)
    check('切回经典阵容恢复 11 位',
      (await evaluate("document.querySelectorAll('.rank-row').length")) === 11)

    await evaluate("document.querySelectorAll('.seg button')[1].click()")
    await sleep(1600)
    check('几何延续模式下仍出结果',
      (await evaluate("document.querySelectorAll('.rank-row').length")) === 11)
    check('固定轮数滑块被隐藏', (await evaluate("!!document.getElementById('in-rounds')")) === false)
    await evaluate("document.querySelectorAll('.seg button')[0].click()")
    await sleep(1400)

    section('交互：点击矩阵格子 → 只看这一对')
    const expectPair = await evaluate(`(function(){
      var heads = Array.from(document.querySelectorAll('#sec-matrix .heatmap__head')).map(t => t.textContent);
      var n = 11, col = heads.slice(0, n), row = heads.slice(n, n * 2), k = 13;
      return [row[Math.floor(k / n)], col[k % n]];
    })()`)
    await evaluate(
      "document.querySelectorAll('#sec-matrix .heatmap__cell')[13].dispatchEvent(new MouseEvent('click',{bubbles:true}))"
    )
    await sleep(900)
    const laneShorts = await evaluate(
      "Array.from(document.querySelectorAll('#sec-playback .pb__short')).map(e=>e.textContent)"
    )
    check('点矩阵格子后收窄为这一对', laneShorts.length === 2, laneShorts.join(' 对 '))
    check('泳道正好是被点的那一对',
      laneShorts.slice().sort().join() === expectPair.slice().sort().join(),
      `期望 ${expectPair.join(' 对 ')}，实际 ${laneShorts.join(' 对 ')}`)
    check('快照矩阵缩为 2×2',
      (await evaluate("document.querySelectorAll('#sec-playback .pb__grid-cell').length")) === 4)

    /* ---------------- 滚动揭示 ---------------- */
    section('滚动揭示不会锁死正文')
    await evaluate(`(async function(){
      var root = document.documentElement;
      var prev = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      var h = root.scrollHeight;
      for (var y = 0; y <= h; y += 400) {
        window.scrollTo(0, y);
        await new Promise(function(r){ requestAnimationFrame(function(){ setTimeout(r, 40); }); });
      }
      window.scrollTo(0, 0);
      root.style.scrollBehavior = prev;
      return true;
    })()`)
    await sleep(1500)
    const secStat = await evaluate(`(function(){
      var all = Array.from(document.querySelectorAll('.sec'));
      var hidden = all.filter(function(s){ return parseFloat(getComputedStyle(s).opacity) < 0.9; })
                       .map(function(s){ return s.id; });
      return { total: all.length, hidden: hidden };
    })()`)
    check('滚动一遍后所有章节均可见', secStat.hidden.length === 0,
      secStat.hidden.length
        ? '仍隐藏：' + secStat.hidden.join(',')
        : `${secStat.total}/${secStat.total} 可见`)

    /* ---------------- 截图 ---------------- */
    const shot = await Promise.race([
      send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }),
      sleep(25000).then(() => null)
    ])
    if (shot && shot.data) {
      fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
      console.log('\n  截图已保存：' + SHOT)
    } else {
      console.log('\n  \x1b[90m（整页截图超时，跳过）\x1b[0m')
    }

    ws.close()
  } finally {
    cleanup()
  }

  console.log('\n' + '─'.repeat(60))
  if (fail === 0) console.log(`\x1b[32m浏览器端全部通过：${pass} 项\x1b[0m`)
  else console.log(`\x1b[31m${fail} 项失败 / 共 ${pass + fail} 项\x1b[0m`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('检查脚本自身出错：', e)
  process.exit(2)
})
