# Henry's Treasure · 量化策略实验室

一个完全运行在浏览器里的股票量化分析与策略回测网站。支持 A 股、港股、美股和 ETF，不需要后端服务器，可以免费部署到 GitHub Pages。

## 功能

| 页面 | 能做什么 |
| --- | --- |
| **行情分析** | K 线 + 成交量 + MACD / RSI / KDJ 副图，MA / 布林带叠加；区间涨跌、波动率、回撤、52 周高低；八项技术面诊断与 0~100 综合评分 |
| **策略回测** | 13 个内置策略，拖动参数实时出结果；净值 / 回撤 / 仓位曲线、K 线买卖点、最新信号提示；24 项绩效指标、交易明细、月度收益热力表、蒙特卡洛压力测试；导出 CSV |
| **参数优化** | 1~2 个参数网格搜索（Web Worker 后台计算），热力图 / 敏感性曲线，样本内 / 样本外切分识别过度拟合 |
| **策略对比** | 同一股票、同一规则下并排比较多个策略的净值、回撤和指标排行 |
| **组合轮动** | ETF / 股票动量轮动：回看周期、调仓频率、前 N 名、绝对动量避险、等权或波动率倒数加权 |
| **自选扫描** | 批量计算自选股的涨跌、波动、RSI、趋势、技术评分、策略最新信号与历史回测表现 |
| **策略工坊** | 无代码的条件构建器（如“MA5 上穿 MA20 且 RSI < 70”），或直接写 JavaScript 策略；保存后全站可用 |

### 内置策略

双均线交叉、MACD 金叉死叉、海龟交易（唐奇安通道 + ATR 止损）、均线多头排列 + 放量、SuperTrend、布林带突破、动量策略、RSI 超买超卖、布林带均值回归、KDJ、乖离率抄底、动态网格交易、买入持有基准。

### 回测引擎

- **无未来函数**：第 N 根 K 线收盘产生信号，默认第 N+1 根开盘成交（可改为当日收盘）
- **A 股规则**：T+1、100 股整手、佣金万 2.5 最低 5 元、卖出印花税 0.05%、滑点、涨停不能买 / 跌停不能卖
- 港股、美股规则预设，也可完全自定义
- 止损、止盈、移动止损（盘中触发，跳空按开盘价成交）
- 支持 0~100% 的部分仓位（网格策略）
- 指标用回测区间之前的数据预热

### 数据

- **东方财富**（主）与**腾讯财经**（A 股 / 港股备用），浏览器通过 JSONP 直接获取，支持日 / 周 / 月 K、前复权 / 后复权 / 不复权
- 行情在 IndexedDB 中缓存 6 小时
- **CSV 导入**：支持中英文表头（日期 / 开盘 / 最高 / 最低 / 收盘 / 成交量）
- **演示数据**：6 只随机生成的演示标的，离线也能体验全部功能

> 自定义策略、自选股、参数和设置只保存在本机浏览器（localStorage），不会上传到任何服务器。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev        # 开发模式 http://localhost:5173
npm test           # 运行单元测试（指标、回测引擎、优化器、数据解析）
npm run build      # 生成静态站点到 dist/
npm run build:single  # 生成单个 HTML 文件到 dist-single/，双击即可离线打开
```

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/deploy.yml`：

1. 在 GitHub 仓库 **Settings → Pages → Build and deployment** 中把 **Source** 设为 **GitHub Actions**。
2. 把代码合并到 `main` 分支，Actions 会自动测试、构建并发布。
3. 访问 `https://<你的用户名>.github.io/<仓库名>/`。

`dist/` 是纯静态文件，也可以直接上传到 Vercel、Netlify、Cloudflare Pages 或任何静态服务器。

## 目录结构

```
src/
  lib/                 与界面无关的量化核心（可单独测试）
    indicators/        技术指标：MA EMA MACD RSI BOLL KDJ ATR CCI OBV WR SuperTrend…
    backtest/          回测引擎、绩效指标
    strategies/        内置策略、条件构建器、代码策略
    data/              东方财富 / 腾讯 / CSV / 演示数据、缓存
    optimize.ts        网格搜索与样本外验证
    montecarlo.ts      分块自助法蒙特卡洛
    portfolio.ts       动量轮动组合回测
    analysis.ts        技术诊断与统计
  app/                 状态管理、路由、主题、图表配置
  components/          通用组件
  pages/               八个页面
  workers/             Web Worker（参数优化、代码策略沙箱）
```

## 编写代码策略

在「策略工坊 → 代码策略」中编写，返回每根 K 线收盘后的目标仓位（0~1）：

```js
// @param fast 10 2 60 1 短期均线
// @param slow 30 5 250 1 长期均线
const a = ta.sma(close, params.fast);
const b = ta.sma(close, params.slow);
return ta.stateMachine(close.length,
  (i) => ta.crossOver(a, b, i),   // 入场
  (i) => ta.crossUnder(a, b, i),  // 离场
);
```

`// @param 名称 默认值 最小值 最大值 步长 显示名` 声明的参数会出现在参数面板，并可用于参数优化。代码在独立的 Web Worker 中执行，超时 8 秒自动终止。

## 免责声明

本项目仅用于学习和研究，所有数据、分析与回测结果不构成任何投资建议。历史表现不代表未来收益，投资有风险，入市需谨慎。
