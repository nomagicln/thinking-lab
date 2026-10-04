# thinking-lab

一些关于「人怎么想、怎么合作、怎么犯错」的小实验。每个实验独立成目录，能跑就顺手放上来。

在线访问：**https://nomagicln.github.io/thinking-lab/**

---

## 实验列表

| 目录 | 内容 | 在线 |
|---|---|---|
| [`axelrod-experiment/`](axelrod-experiment/) | 重复囚徒困境锦标赛：可视化复现 Axelrod (1980)，17 位策略、多人同步回放、生态演化，参数全可调 | [打开](https://nomagicln.github.io/thinking-lab/) |

---

## 关于 axelrod-experiment

罗伯特·阿克塞尔罗德 1980 年向学界征集「重复囚徒困境」参赛程序，让它们两两相遇两百个回合。
结果最简单的那份赢了 —— Anatol Rapoport 的「一报还一报」。

这个应用把那个实验摊开：循环赛排名、17×17 对阵得分矩阵、累计总分收敛曲线、
复制者动力学生态演化、多人逐轮同步回放，以及一份从实际对局中**测量**出来的策略档案。

- 技术栈：React 19 + TypeScript + Vite，零运行时依赖的纯前端
- 计算内核与视图完全分离，`src/lib/engine.ts` 是纯函数，可在 Node 里独立测试
- 69 项科学自检 + 49 项端到端检查，CI 里跑通才允许部署

```bash
cd axelrod-experiment
npm install
npm run dev          # 本地开发
npm run verify       # 类型检查 + 科学自检 + 构建 + 端到端
```

细节见 [`axelrod-experiment/README.md`](axelrod-experiment/README.md)。

---

## 部署

推送到 `main` 即触发 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：
先类型检查、跑科学自检、构建，再发布 `axelrod-experiment/dist` 到 GitHub Pages。
自检挂掉就不会部署。
