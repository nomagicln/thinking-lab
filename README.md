# thinking-lab

一些关于「人怎么想、怎么合作、怎么犯错」的小实验。每个实验都做成一页可交互的应用，
计算内核是不依赖界面的纯函数，可以单独跑测试。

在线访问：**https://nomagicln.github.io/thinking-lab/**

---

## 实验

| 实验 | 它在问什么 | 在线 |
|---|---|---|
| **阿克塞尔罗德实验**<br><sub>Axelrod 1980</sub> | 一群自私的策略反复打交道，为什么最后是「一报还一报」这种最不精明的策略赢了？ | [打开](https://nomagicln.github.io/thinking-lab/axelrod/) |
| **Boids 鸟群模型**<br><sub>Reynolds 1987</sub> | 每只鸟只看得见身边几步的同伴、只遵守三条规则，秩序是怎么自己长出来的？又在什么条件下崩塌？ | [打开](https://nomagicln.github.io/thinking-lab/boids/) |
| **麦克斯韦妖**<br><sub>Maxwell 1867 · Landauer 1961</sub> | 妖用信息造出了温差，看上去违反了第二定律。信息到底能不能换熵？ | [打开](https://nomagicln.github.io/thinking-lab/maxwell-demon/) |

---

## 共同的做法

三个实验共用一套外壳（顶部导航、报头、章节、版式），各自只换一个主色 ——
像同一栋楼里的不同房间，换实验时能感到换了房间，但不会觉得换了个网站。

更重要的共同点是**计算与视图分离**：

```
shared/          实验外壳与设计系统（导航、章节、图表、控件、配色）
axelrod/         实验一：lib/engine.ts 是纯函数，React 只负责画
boids/           实验二
maxwell-demon/   实验三
test/            端到端检查（无头 Chrome over CDP，覆盖全部四页）
```

每个实验的 `lib/engine.ts` 都不 import React、不碰 DOM、不用 `Math.random()`，
随机数一律由外部传入 `() => number`，因此**同 seed 必得同结果**，
也让科学断言可以写成确定性的测试而不是「跑起来没报错」。

---

## 本地运行

```bash
npm install
npm run dev          # 开发服务器（四页都在）
npm run build        # 产出静态站点到 dist/
npm run preview      # 预览构建产物

npm run typecheck    # TypeScript 严格模式
npm test             # 138 项科学自检（vitest）
npm run test:e2e     # 构建后跑 57 项端到端检查（无头 Chrome）
npm run verify       # 以上全部
```

也可以直接检查线上站点：

```bash
node test/browser-check.cjs --url https://nomagicln.github.io/thinking-lab/
```

---

## 部署

推送到 `main` 即触发 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：
类型检查 → 科学自检 → 多页构建 → 发布到 GitHub Pages。**自检挂掉就不会部署。**

---

## 一点说明

这三个模型的共同点是「规则很简单，结果很不直观」。
界面上每个参数都是活的，而且每个实验都特意留了能把它拆坏的地方 ——
把 Boids 的分离权重归零看它挤成一坨、把麦克斯韦妖的记忆容量拉到无限看悖论复活。

光看结论不算真懂，能拆开重来才算。
