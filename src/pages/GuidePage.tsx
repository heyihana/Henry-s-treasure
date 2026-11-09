import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { Panel } from '../components/ui';
import { BUILTIN_STRATEGIES } from '../lib/strategies';

const METRICS: [string, string][] = [
  ['年化收益', '把总收益折算成每年的复合收益率：(1 + 总收益)^(1/年数) − 1。不同长度的回测之间应比较年化收益。'],
  ['最大回撤', '净值从历史最高点到之后最低点的最大跌幅，衡量“最坏情况下会亏多少”。实盘中往往比回测更大。'],
  ['夏普比率', '（日均收益 − 无风险收益）/ 日收益标准差 × √252。每承担一单位波动获得的超额收益，> 1 较好，> 2 优秀。'],
  ['索提诺比率', '与夏普类似，但只把下跌波动视为风险，更适合收益分布不对称的策略。'],
  ['卡玛比率', '年化收益 / 最大回撤的绝对值。衡量收益与最大亏损的性价比，> 1 意味着一年左右能赚回最大回撤。'],
  ['Alpha / Beta', 'Beta 是策略相对标的本身的敏感度；Alpha 是扣除 Beta 部分后的年化超额收益。择时策略理想的状态是低 Beta、正 Alpha。'],
  ['信息比率', '策略相对基准的超额收益 / 跟踪误差，衡量跑赢基准的稳定程度。'],
  ['胜率 / 盈亏比', '胜率是盈利交易占比；盈亏比是平均盈利 / 平均亏损。趋势策略常见“低胜率、高盈亏比”，均值回归策略相反。'],
  ['利润因子', '所有盈利交易之和 / 所有亏损交易之和，> 1.5 通常认为策略具备一定优势。'],
  ['持仓时间占比', '有仓位的交易日占比。占比低而收益接近买入持有，说明策略有效避开了下跌。'],
  ['VaR', '在险价值。蒙特卡洛中的 95% VaR 表示“只有 5% 的情形会比这个结果更差”。'],
];

export default function GuidePage() {
  const setStrategy = useApp((s) => s.setStrategy);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>使用说明</h1>
          <p>Henry's Treasure 是一个完全在浏览器里运行的量化研究工具：行情来自公开接口，所有计算都在本地完成，不需要注册，也不会上传你的策略。</p>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Panel title="五分钟上手">
          <ol className="steps">
            <li>
              在<strong>行情分析</strong>搜索股票（代码、名称或拼音首字母均可），查看 K 线、技术指标和综合诊断。
            </li>
            <li>
              进入<strong>策略回测</strong>，选择一个内置策略，拖动参数滑块，净值曲线与买卖点会实时更新。
            </li>
            <li>
              在<strong>参数优化</strong>用热力图寻找稳健的参数区域，并用样本外验证检查是否过度拟合。
            </li>
            <li>
              用<strong>策略对比</strong>把多个策略放在一起比较，用<strong>组合轮动</strong>测试 ETF 动量轮动。
            </li>
            <li>
              在<strong>策略工坊</strong>搭建自己的条件策略或代码策略，再到<strong>自选扫描</strong>里批量查看今天的信号。
            </li>
            <li>
              用<strong>巴菲特工具箱</strong>估算内在价值和安全边际，在<strong>量化书房</strong>里读新书要点，并一键跳到对应功能验证。
            </li>
          </ol>
        </Panel>
        <Panel title="回测假设">
          <div className="prose small">
            <p>
              <strong>无未来函数：</strong>策略在第 N 根 K 线收盘后才产生信号，默认在第 N+1 根开盘价成交。也可改为当日收盘价成交，但会偏乐观。
            </p>
            <p>
              <strong>A 股规则：</strong>T+1（当天买入次日才能卖出）、100 股整手、佣金万 2.5（最低 5 元）、卖出印花税 0.05%、0.1% 滑点；开盘涨停无法买入、跌停无法卖出。港股、美股有对应预设。
            </p>
            <p>
              <strong>只做多：</strong>不做空、不加杠杆，仓位在 0~100% 之间。网格策略使用部分仓位。
            </p>
            <p>
              <strong>风控：</strong>止损、止盈和移动止损在盘中按最高 / 最低价触发；跳空越过触发价时按开盘价成交。风控离场后，需等策略信号先归零才会再次入场。
            </p>
            <p>
              <strong>局限：</strong>未考虑停牌、分红再投资细节、冲击成本和幸存者偏差。回测结果是上限而不是预期。
            </p>
          </div>
        </Panel>
      </div>

      <Panel title={`内置策略（${BUILTIN_STRATEGIES.length}）`}>
        <div className="guide-grid">
          {BUILTIN_STRATEGIES.map((s) => (
            <article key={s.id} className="panel" style={{ background: 'var(--panel-2)' }}>
              <div className="panel-head">
                <h3 className="panel-title">{s.name}</h3>
                <span className="badge gold">{s.category}</span>
              </div>
              <div className="panel-body stack" style={{ gap: 8 }}>
                <p className="small">{s.summary}</p>
                <p className="xs dim">{s.description}</p>
                {s.params.length > 0 && (
                  <p className="xs muted">
                    参数：{s.params.map((p) => `${p.label}（默认 ${p.options ? p.options.find((o) => o.value === p.default)?.label : p.default}）`).join('、')}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    setStrategy(s.id);
                    navigate('backtest');
                  }}
                >
                  回测这个策略
                </button>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="指标释义" flush>
        <div className="table-wrap">
          <table className="data">
            <tbody>
              {METRICS.map(([k, v]) => (
                <tr key={k}>
                  <td className="text" style={{ width: 120, verticalAlign: 'top' }}>
                    <b>{k}</b>
                  </td>
                  <td className="text left dim" style={{ whiteSpace: 'normal' }}>
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Panel title="数据来源">
          <div className="prose small">
            <p>
              <strong>东方财富：</strong>主数据源，覆盖沪深京 A 股、ETF、指数、港股和美股的日 / 周 / 月 K 线，支持前复权、后复权。
            </p>
            <p>
              <strong>腾讯财经：</strong>A 股和港股的备用数据源，东方财富不可用时自动切换。
            </p>
            <p>
              <strong>本地缓存：</strong>行情会在浏览器中缓存 6 小时，减少重复请求；点击“刷新”可强制更新。
            </p>
            <p>
              <strong>演示数据：</strong>6 只用随机过程生成的“演示股票”（趋势、震荡、周期、指数等形态），离线也能完整体验所有功能。它们不代表任何真实证券。
            </p>
          </div>
        </Panel>
        <Panel title="导入自己的数据（CSV）">
          <div className="prose small">
            <p>任何来源的日线数据都可以导入，表头支持中文或英文，日期支持 2024-01-02、2024/1/2、20240102 等格式：</p>
            <pre className="textarea" style={{ whiteSpace: 'pre', fontSize: 12 }}>
              {`日期,开盘,最高,最低,收盘,成交量
2024-01-02,1715.00,1718.19,1678.10,1685.01,32156
2024-01-03,1681.11,1695.22,1676.33,1694.00,20834`}
            </pre>
            <p>
              英文表头可用 <code>date,open,high,low,close,volume</code>。在任意页面的工具条点击「导入 CSV」即可。
            </p>
          </div>
        </Panel>
      </div>

      <div className="banner warn">
        <span className="grow small">
          <b>风险提示：</b>本站提供的所有数据、分析与回测结果仅用于学习和研究，不构成任何投资建议。历史回测表现不代表未来收益，参数优化存在过度拟合风险。投资有风险，决策需独立判断。
        </span>
      </div>
    </div>
  );
}
