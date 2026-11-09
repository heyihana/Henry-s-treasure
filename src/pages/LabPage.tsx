import { useEffect, useMemo, useState } from 'react';
import { equityOption } from '../app/charts';
import { computeStrategy } from '../app/compute';
import { uid } from '../app/format';
import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { usePalette } from '../app/theme';
import { SummaryTiles } from '../components/BacktestParts';
import { EChart } from '../components/EChart';
import { Empty, Panel, Spinner, Tabs } from '../components/ui';
import { runBacktest } from '../lib/backtest/engine';
import { rangeToIndex } from '../lib/backtest/run';
import type { BacktestResult } from '../lib/backtest/types';
import type { CustomStrategy } from '../lib/strategies';
import { INDICATOR_CATALOG, INDICATOR_MAP } from '../lib/strategies/catalog';
import { CODE_TEMPLATE, parseCodeParams } from '../lib/strategies/code';
import { describeGroup, OP_LABELS, SAMPLE_RULES, type CompareOp, type Condition, type ConditionGroup, type Operand, type RuleSet } from '../lib/strategies/rules';

type TabId = 'rules' | 'code' | 'mine';

const RULE_TEMPLATES: { name: string; rules: RuleSet }[] = [
  { name: '均线金叉 + RSI 过滤', rules: SAMPLE_RULES },
  {
    name: '放量突破 20 日新高',
    rules: {
      entry: {
        logic: 'and',
        conditions: [
          { left: { kind: 'ind', ind: 'CLOSE', params: [] }, op: '>', right: { kind: 'ind', ind: 'HHV', params: [20] } },
          { left: { kind: 'ind', ind: 'VOL', params: [] }, op: '>', right: { kind: 'ind', ind: 'VMA', params: [20] } },
        ],
      },
      exit: { logic: 'or', conditions: [{ left: { kind: 'ind', ind: 'CLOSE', params: [] }, op: '<', right: { kind: 'ind', ind: 'LLV', params: [10] } }] },
    },
  },
  {
    name: 'MACD 零轴上金叉，跌破 MA20 离场',
    rules: {
      entry: {
        logic: 'and',
        conditions: [
          { left: { kind: 'ind', ind: 'MACD', params: [12, 26, 9], output: 'dif' }, op: 'crossOver', right: { kind: 'ind', ind: 'MACD', params: [12, 26, 9], output: 'dea' } },
          { left: { kind: 'ind', ind: 'MACD', params: [12, 26, 9], output: 'dif' }, op: '>', right: { kind: 'const', value: 0 } },
        ],
      },
      exit: { logic: 'or', conditions: [{ left: { kind: 'ind', ind: 'CLOSE', params: [] }, op: 'crossUnder', right: { kind: 'ind', ind: 'MA', params: [20] } }] },
    },
  },
  {
    name: '布林下轨 + KDJ 超卖抄底',
    rules: {
      entry: {
        logic: 'and',
        conditions: [
          { left: { kind: 'ind', ind: 'CLOSE', params: [] }, op: '<', right: { kind: 'ind', ind: 'BOLL', params: [20, 2], output: 'lower' } },
          { left: { kind: 'ind', ind: 'KDJ', params: [9, 3, 3], output: 'j' }, op: '<', right: { kind: 'const', value: 0 } },
        ],
      },
      exit: { logic: 'or', conditions: [{ left: { kind: 'ind', ind: 'CLOSE', params: [] }, op: '>', right: { kind: 'ind', ind: 'BOLL', params: [20, 2], output: 'mid' } }] },
    },
  },
];

function defaultOperand(id: string): Operand {
  const spec = INDICATOR_MAP[id];
  return { kind: 'ind', ind: id, params: spec.params.map((p) => p.default), output: spec.outputs?.[0].key };
}

function OperandEditor({ value, onChange, allowConst }: { value: Operand; onChange: (o: Operand) => void; allowConst?: boolean }) {
  const kindVal = value.kind === 'const' ? '__CONST' : value.ind;
  const spec = value.kind === 'ind' ? INDICATOR_MAP[value.ind] : undefined;
  return (
    <span className="operand">
      <select
        className="select"
        aria-label="指标"
        value={kindVal}
        onChange={(e) => onChange(e.target.value === '__CONST' ? { kind: 'const', value: 0 } : defaultOperand(e.target.value))}
      >
        {allowConst && <option value="__CONST">数值</option>}
        {INDICATOR_CATALOG.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {value.kind === 'const' ? (
        <input
          className="input p num"
          type="number"
          aria-label="数值"
          value={value.value}
          onChange={(e) => onChange({ kind: 'const', value: Number(e.target.value) || 0 })}
        />
      ) : (
        <>
          {spec?.params.map((ps, i) => (
            <input
              key={i}
              className="input p num"
              type="number"
              title={ps.label}
              aria-label={ps.label}
              min={ps.min}
              max={ps.max}
              step={ps.step}
              value={value.params[i] ?? ps.default}
              onChange={(e) => {
                const params = [...value.params];
                params[i] = Number(e.target.value);
                onChange({ ...value, params });
              }}
            />
          ))}
          {spec?.outputs && (
            <select className="select" aria-label="输出" value={value.output} onChange={(e) => onChange({ ...value, output: e.target.value })}>
              {spec.outputs.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </span>
  );
}

function GroupEditor({ title, group, onChange }: { title: string; group: ConditionGroup; onChange: (g: ConditionGroup) => void }) {
  const update = (i: number, c: Condition) => onChange({ ...group, conditions: group.conditions.map((x, j) => (j === i ? c : x)) });
  return (
    <div className="fields">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <b className="small">{title}</b>
        <div className="seg">
          <button type="button" className={group.logic === 'and' ? 'on' : ''} onClick={() => onChange({ ...group, logic: 'and' })}>
            全部满足（且）
          </button>
          <button type="button" className={group.logic === 'or' ? 'on' : ''} onClick={() => onChange({ ...group, logic: 'or' })}>
            任一满足（或）
          </button>
        </div>
      </div>
      {group.conditions.map((c, i) => (
        <div key={i} className="fields" style={{ gap: 4 }}>
          {i > 0 && <span className="logic-tag">{group.logic === 'and' ? '且' : '或'}</span>}
          <div className="cond">
            <OperandEditor value={c.left} onChange={(o) => update(i, { ...c, left: o })} />
            <select className="select" aria-label="比较方式" value={c.op} onChange={(e) => update(i, { ...c, op: e.target.value as CompareOp })}>
              {(Object.keys(OP_LABELS) as CompareOp[]).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            <OperandEditor value={c.right} allowConst onChange={(o) => update(i, { ...c, right: o })} />
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          onChange({
            ...group,
            conditions: [...group.conditions, { left: defaultOperand('CLOSE'), op: '>', right: defaultOperand('MA') }],
          })
        }
      >
        + 添加条件
      </button>
    </div>
  );
}

function usePreview(custom: CustomStrategy | null, enabled: boolean) {
  const stock = useApp((s) => s.stock)!;
  const config = useApp((s) => s.config);
  const range = useApp((s) => s.range);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!custom || !enabled) return;
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const params = Object.fromEntries((custom.kind === 'code' ? parseCodeParams(custom.code ?? '') : []).map((p) => [p.key, p.default]));
        const out = await computeStrategy({ type: 'custom', custom }, stock.bars, params);
        const { start, end } = rangeToIndex(stock.bars, range);
        if (!alive) return;
        setResult(runBacktest(stock.bars, out.position, config, { start, end, period: stock.period }));
        setError(null);
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setResult(null);
        }
      } finally {
        if (alive) setBusy(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [custom, enabled, stock, config, range]);
  return { result, error, busy, stock };
}

function Preview({ name, result, error, busy, stockName }: { name: string; result: BacktestResult | null; error: string | null; busy: boolean; stockName: string }) {
  const p = usePalette();
  const opt = useMemo(
    () =>
      result &&
      equityOption(
        {
          dates: result.dates,
          series: [
            { name, data: result.equity, color: p.accent },
            { name: '买入持有', data: result.benchmark, color: p.fg3 },
          ],
        },
        p,
      ),
    [result, name, p],
  );
  return (
    <Panel title={<>在「{stockName}」上的预览 {busy && <Spinner />}</>}>
      {error ? (
        <div className="banner error">{error}</div>
      ) : result ? (
        <div className="stack">
          <SummaryTiles m={result.metrics} />
          {opt && <EChart option={opt} height={260} />}
        </div>
      ) : (
        <Empty>正在计算…</Empty>
      )}
    </Panel>
  );
}

export default function LabPage() {
  const customs = useApp((s) => s.customStrategies);
  const saveCustom = useApp((s) => s.saveCustom);
  const deleteCustom = useApp((s) => s.deleteCustom);
  const setStrategy = useApp((s) => s.setStrategy);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<TabId>('rules');

  // 规则策略编辑状态
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('我的均线策略');
  const [rules, setRules] = useState<RuleSet>(SAMPLE_RULES);
  // 代码策略编辑状态
  const [codeId, setCodeId] = useState<string | null>(null);
  const [codeName, setCodeName] = useState('我的代码策略');
  const [code, setCode] = useState(CODE_TEMPLATE);
  const [codeDraft, setCodeDraft] = useState<CustomStrategy | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const ruleDraft = useMemo<CustomStrategy>(
    () => ({ id: ruleId ?? 'draft-rule', name: ruleName, kind: 'rule', rules, createdAt: 0, updatedAt: 0 }),
    [ruleId, ruleName, rules],
  );
  const rulePreview = usePreview(ruleDraft, tab === 'rules');
  const codePreview = usePreview(codeDraft, tab === 'code');

  const save = (kind: 'rule' | 'code', thenBacktest: boolean) => {
    const now = Date.now();
    const isRule = kind === 'rule';
    const id = (isRule ? ruleId : codeId) ?? uid();
    const existing = customs.find((c) => c.id === id);
    const c: CustomStrategy = {
      id,
      name: (isRule ? ruleName : codeName).trim() || '未命名策略',
      kind,
      rules: isRule ? rules : undefined,
      code: isRule ? undefined : code,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveCustom(c);
    if (isRule) setRuleId(id);
    else setCodeId(id);
    toast(`已保存「${c.name}」`);
    if (thenBacktest) {
      setStrategy(`custom:${id}`);
      navigate('backtest');
    }
  };

  const edit = (c: CustomStrategy) => {
    if (c.kind === 'rule') {
      setRuleId(c.id);
      setRuleName(c.name);
      setRules(c.rules ?? SAMPLE_RULES);
      setTab('rules');
    } else {
      setCodeId(c.id);
      setCodeName(c.name);
      setCode(c.code ?? CODE_TEMPLATE);
      setCodeDraft(null);
      setTab('code');
    }
  };

  const codeParams = useMemo(() => parseCodeParams(code), [code]);
  const stockName = useApp((s) => s.stock?.meta.name ?? '');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>策略工坊</h1>
          <p>不会编程也能用条件组合搭建策略；熟悉 JavaScript 可以直接写代码。保存后的策略会出现在回测、优化、对比和扫描的策略列表里，数据只保存在你的浏览器中。</p>
        </div>
      </div>
      <section className="panel">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'rules', label: '条件构建器' },
            { id: 'code', label: '代码策略' },
            { id: 'mine', label: `我的策略 (${customs.length})` },
          ]}
        />
      </section>

      {tab === 'rules' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Panel
            title={ruleId ? '编辑条件策略' : '新建条件策略'}
            extra={
              <select
                className="select"
                aria-label="载入模板"
                style={{ width: 'auto', height: 30, fontSize: 'var(--fs-xs)' }}
                value=""
                onChange={(e) => {
                  const t = RULE_TEMPLATES[Number(e.target.value)];
                  if (t) {
                    setRules(t.rules);
                    setRuleName(t.name);
                    setRuleId(null);
                  }
                }}
              >
                <option value="">载入模板…</option>
                {RULE_TEMPLATES.map((t, i) => (
                  <option key={t.name} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
            }
          >
            <div className="fields">
              <div className="field">
                <label htmlFor="rule-name">策略名称</label>
                <input id="rule-name" className="input" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
              </div>
              <GroupEditor title="买入条件（空仓时满足即买入）" group={rules.entry} onChange={(g) => setRules({ ...rules, entry: g })} />
              <GroupEditor title="卖出条件（持仓时满足即卖出）" group={rules.exit} onChange={(g) => setRules({ ...rules, exit: g })} />
              <div className="banner">
                <span className="grow small">
                  <b>买入：</b>
                  {describeGroup(rules.entry)}
                  <br />
                  <b>卖出：</b>
                  {describeGroup(rules.exit)}
                </span>
              </div>
              <p className="field-hint">“N日最高价/最低价”不含当日，可直接用于突破判断；止损止盈在「交易规则与风控」中统一设置。</p>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => save('rule', false)}>
                  保存
                </button>
                <button type="button" className="btn btn-primary" onClick={() => save('rule', true)}>
                  保存并回测
                </button>
                {ruleId && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setRuleId(null);
                      setRuleName('新条件策略');
                    }}
                  >
                    另存为新策略
                  </button>
                )}
              </div>
            </div>
          </Panel>
          <Preview name={ruleName} stockName={stockName} {...rulePreview} />
        </div>
      )}

      {tab === 'code' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <Panel title={codeId ? '编辑代码策略' : '新建代码策略'}>
            <div className="fields">
              <div className="field">
                <label htmlFor="code-name">策略名称</label>
                <input id="code-name" className="input" value={codeName} onChange={(e) => setCodeName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="code-editor">策略代码（JavaScript）</label>
                <textarea
                  id="code-editor"
                  className="textarea"
                  rows={24}
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const s = el.selectionStart;
                      const v = el.value;
                      setCode(v.slice(0, s) + '  ' + v.slice(el.selectionEnd));
                      requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + 2));
                    }
                  }}
                />
              </div>
              <div className="small dim">
                识别到参数：
                {codeParams.length ? codeParams.map((p) => <span key={p.key} className="badge" style={{ marginLeft: 4 }}>{`${p.label} = ${p.default}`}</span>) : '无'}
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCodeDraft({ id: codeId ?? 'draft-code', name: codeName, kind: 'code', code, createdAt: 0, updatedAt: Date.now() })}
                >
                  运行测试
                </button>
                <button type="button" className="btn" onClick={() => save('code', false)}>
                  保存
                </button>
                <button type="button" className="btn" onClick={() => save('code', true)}>
                  保存并回测
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setCode(CODE_TEMPLATE)}>
                  重置为模板
                </button>
              </div>
              <p className="field-hint">代码在独立的后台线程中运行，超过 8 秒会被自动终止。</p>
            </div>
          </Panel>
          {codeDraft ? (
            <Preview name={codeName} stockName={stockName} {...codePreview} />
          ) : (
            <Panel title="预览">
              <Empty>点击「运行测试」在当前股票上回测这段代码。</Empty>
            </Panel>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <Panel title="我的策略" flush>
          {customs.length === 0 ? (
            <Empty>还没有保存的策略。去「条件构建器」或「代码策略」创建一个吧。</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th className="left">类型</th>
                    <th className="left">规则</th>
                    <th>更新时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customs.map((c) => (
                    <tr key={c.id}>
                      <td className="text">{c.name}</td>
                      <td className="text left">
                        <span className="badge">{c.kind === 'rule' ? '条件' : '代码'}</span>
                      </td>
                      <td className="text left xs dim" style={{ whiteSpace: 'normal', minWidth: 220 }}>
                        {c.kind === 'rule' && c.rules ? `买：${describeGroup(c.rules.entry)}；卖：${describeGroup(c.rules.exit)}` : `${(c.code ?? '').split('\n').length} 行代码`}
                      </td>
                      <td className="xs">{new Date(c.updatedAt).toLocaleString('zh-CN')}</td>
                      <td>
                        <div className="btn-row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setStrategy(`custom:${c.id}`);
                              navigate('backtest');
                            }}
                          >
                            回测
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => edit(c)}>
                            编辑
                          </button>
                          {confirmDel === c.id ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => {
                                  deleteCustom(c.id);
                                  setConfirmDel(null);
                                  toast(`已删除「${c.name}」`);
                                }}
                              >
                                确认删除
                              </button>
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(null)}>
                                取消
                              </button>
                            </>
                          ) : (
                            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmDel(c.id)}>
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
      <p className="xs muted">预览使用「策略回测」页设置的回测区间与交易规则。</p>
    </div>
  );
}
