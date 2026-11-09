import type { EOption } from '../components/EChart';
import type { Fill } from '../lib/backtest/types';
import type { Overlay } from '../lib/strategies/types';
import type { Bar } from '../lib/types';
import { fmtMoney, fmtPct, fmtPrice } from './format';
import type { Palette } from './theme';

const axisCommon = (p: Palette) => ({
  axisLine: { lineStyle: { color: p.line } },
  axisTick: { show: false },
  axisLabel: { color: p.fg3, fontFamily: p.mono, fontSize: 10 },
  splitLine: { lineStyle: { color: p.line, opacity: 0.6 } },
});

const tooltipBase = (p: Palette) => ({
  trigger: 'axis' as const,
  confine: true,
  backgroundColor: p.panel,
  borderColor: p.lineStrong,
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: p.fg, fontSize: 12, fontFamily: p.body },
  extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,.18); border-radius: 8px;',
});

const fmtAxisNum = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (a >= 1e4) return (v / 1e4).toFixed(a >= 1e6 ? 0 : 1) + '万';
  return a < 10 ? v.toFixed(2) : v.toFixed(0);
};

const dot = (color: string) =>
  `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>`;

export interface KlineInput {
  bars: Bar[];
  overlays?: Overlay[];
  subLevels?: number[];
  fills?: Fill[];
  /** 默认展示最近多少根 */
  visible?: number;
  showVolume?: boolean;
  /** 回测区间起点，之前的区域会被淡化 */
  rangeStart?: number;
  /** 是否显示图例 */
  legend?: boolean;
}

export function klineOption(input: KlineInput, p: Palette): EOption {
  const { bars, overlays = [], subLevels = [], fills = [], visible = 160, showVolume = true } = input;
  const n = bars.length;
  const dates = bars.map((b) => b.date);
  const main = overlays.filter((o) => o.pane === 'main');
  const sub = overlays.filter((o) => o.pane === 'sub');
  const hasSub = sub.length > 0;

  // 网格布局（百分比）
  const top = input.legend === false ? 12 : 28;
  const grids: { top: number | string; height: string }[] = [];
  if (hasSub && showVolume) {
    grids.push({ top, height: '50%' }, { top: '64%', height: '10%' }, { top: '77%', height: '13%' });
  } else if (hasSub || showVolume) {
    grids.push({ top, height: hasSub ? '56%' : '62%' }, { top: hasSub ? '70%' : '76%', height: hasSub ? '19%' : '13%' });
  } else {
    grids.push({ top, height: '76%' });
  }
  const gridDefs = grids.map((g) => ({ left: 8, right: 56, top: g.top, height: g.height, containLabel: false }));
  const xAxes = gridDefs.map((_, i) => ({
    type: 'category' as const,
    data: dates,
    gridIndex: i,
    boundaryGap: true,
    ...axisCommon(p),
    axisLabel: { ...axisCommon(p).axisLabel, show: i === gridDefs.length - 1 },
    splitLine: { show: false },
    axisPointer: { label: { show: i === gridDefs.length - 1 } },
  }));
  const yAxes = gridDefs.map((_, i) => ({
    type: 'value' as const,
    gridIndex: i,
    scale: true,
    position: 'right' as const,
    splitNumber: i === 0 ? 4 : 2,
    ...axisCommon(p),
    axisLabel: { ...axisCommon(p).axisLabel, formatter: (v: number) => fmtAxisNum(v) },
    splitLine: { lineStyle: { color: p.line, opacity: 0.5 } },
  }));

  const series: Record<string, unknown>[] = [
    {
      name: 'K线',
      type: 'candlestick',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: bars.map((b) => [b.open, b.close, b.low, b.high]),
      itemStyle: { color: p.up, color0: p.down, borderColor: p.up, borderColor0: p.down },
      barMaxWidth: 12,
      markArea:
        input.rangeStart && input.rangeStart > 0
          ? {
              silent: true,
              itemStyle: { color: p.panel2, opacity: 0.55 },
              data: [[{ xAxis: dates[0] }, { xAxis: dates[input.rangeStart - 1] }]],
            }
          : undefined,
    },
  ];

  main.forEach((o, i) => {
    series.push({
      name: o.name,
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: o.data.map((v) => (Number.isFinite(v) ? v : null)),
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 1.2, color: o.color ?? p.series[i % p.series.length], type: o.kind === 'dashed' ? 'dashed' : 'solid' },
      itemStyle: { color: o.color ?? p.series[i % p.series.length] },
      emphasis: { disabled: true },
    });
  });

  if (fills.length) {
    const buys = fills.filter((f) => f.side === 'buy');
    const sells = fills.filter((f) => f.side === 'sell');
    series.push(
      {
        name: '买入',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbol: 'triangle',
        symbolSize: 9,
        symbolOffset: [0, 9],
        itemStyle: { color: p.up, borderColor: p.panel, borderWidth: 1 },
        data: buys.map((f) => ({ value: [f.index, bars[f.index].low], fill: f })),
        z: 5,
      },
      {
        name: '卖出',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 9,
        symbolOffset: [0, -9],
        itemStyle: { color: p.down, borderColor: p.panel, borderWidth: 1 },
        data: sells.map((f) => ({ value: [f.index, bars[f.index].high], fill: f })),
        z: 5,
      },
    );
  }

  let gi = 1;
  if (showVolume) {
    series.push({
      name: '成交量',
      type: 'bar',
      xAxisIndex: gi,
      yAxisIndex: gi,
      data: bars.map((b, i) => ({
        value: b.volume,
        itemStyle: { color: b.close >= (i ? bars[i - 1].close : b.open) ? p.up : p.down, opacity: 0.7 },
      })),
      barMaxWidth: 10,
    });
    gi++;
  }
  if (hasSub) {
    sub.forEach((o, i) => {
      const color = o.color ?? p.series[i % p.series.length];
      if (o.kind === 'bar') {
        series.push({
          name: o.name,
          type: 'bar',
          xAxisIndex: gi,
          yAxisIndex: gi,
          data: o.data.map((v) => ({
            value: Number.isFinite(v) ? v : null,
            itemStyle: { color: v >= 0 ? p.up : p.down, opacity: 0.75 },
          })),
          barMaxWidth: 6,
        });
      } else {
        series.push({
          name: o.name,
          type: 'line',
          xAxisIndex: gi,
          yAxisIndex: gi,
          data: o.data.map((v) => (Number.isFinite(v) ? v : null)),
          showSymbol: false,
          lineStyle: { width: 1.2, color },
          itemStyle: { color },
          emphasis: { disabled: true },
          markLine:
            i === 0 && subLevels.length
              ? {
                  silent: true,
                  symbol: 'none',
                  label: { show: false },
                  lineStyle: { color: p.fg3, type: 'dashed', width: 1 },
                  data: subLevels.map((y) => ({ yAxis: y })),
                }
              : undefined,
        });
      }
    });
  }

  const startPct = n > visible ? Math.max(0, 100 - (visible / n) * 100) : 0;
  const allX = gridDefs.map((_, i) => i);

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    legend: {
      show: input.legend !== false,
      top: 0,
      left: 8,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { color: p.fg2, fontSize: 11 },
      data: [...main.map((o) => o.name), ...(fills.length ? ['买入', '卖出'] : [])],
      inactiveColor: p.fg3,
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: p.fg2, color: p.bg, fontFamily: p.mono, fontSize: 10 } },
    tooltip: {
      ...tooltipBase(p),
      axisPointer: { type: 'cross', lineStyle: { color: p.fg3, type: 'dashed' }, crossStyle: { color: p.fg3 } },
      formatter: (params: { dataIndex: number; seriesName: string; color: string; value: unknown; data: unknown }[]) => {
        if (!params.length) return '';
        const i = params[0].dataIndex;
        const b = bars[i];
        if (!b) return '';
        const prev = i > 0 ? bars[i - 1].close : b.open;
        const chg = b.close / prev - 1;
        const c = chg >= 0 ? p.up : p.down;
        const row = (k: string, v: string, color?: string) =>
          `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:${p.fg3}">${k}</span><span style="font-family:${p.mono};${color ? `color:${color}` : ''}">${v}</span></div>`;
        let html = `<div style="font-weight:600;margin-bottom:4px">${b.date}</div>`;
        html += row('开', fmtPrice(b.open)) + row('高', fmtPrice(b.high)) + row('低', fmtPrice(b.low)) + row('收', fmtPrice(b.close), c);
        html += row('涨跌', fmtPct(chg), c) + row('成交量', fmtMoney(b.volume, 1));
        for (const s of params) {
          if (['K线', '成交量', '买入', '卖出'].includes(s.seriesName)) continue;
          const v = Array.isArray(s.value) ? s.value[1] : typeof s.value === 'object' && s.value ? (s.value as { value: number }).value : s.value;
          if (typeof v === 'number' && Number.isFinite(v)) html += row(s.seriesName, Math.abs(v) >= 1000 ? fmtAxisNum(v) : v.toFixed(Math.abs(v) < 10 ? 3 : 2));
        }
        const f = fills.filter((x) => x.index === i);
        for (const x of f) {
          html += `<div style="margin-top:4px;color:${x.side === 'buy' ? p.up : p.down}">${x.side === 'buy' ? '买入' : '卖出'} ${x.shares} 股 @ ${fmtPrice(x.price)}${x.reason !== 'signal' ? '（' + REASON[x.reason] + '）' : ''}</div>`;
        }
        return html;
      },
    },
    grid: gridDefs,
    xAxis: xAxes,
    yAxis: yAxes,
    dataZoom: [
      { type: 'inside', xAxisIndex: allX, start: startPct, end: 100, minValueSpan: 20 },
      {
        type: 'slider',
        xAxisIndex: allX,
        start: startPct,
        end: 100,
        bottom: 4,
        height: 16,
        borderColor: p.line,
        backgroundColor: p.panel2,
        fillerColor: 'rgba(128,128,128,0.15)',
        dataBackground: { lineStyle: { color: p.fg3, opacity: 0.5 }, areaStyle: { color: p.fg3, opacity: 0.1 } },
        selectedDataBackground: { lineStyle: { color: p.accent }, areaStyle: { color: p.accent, opacity: 0.15 } },
        handleStyle: { color: p.panel, borderColor: p.fg3 },
        moveHandleStyle: { color: p.fg3 },
        textStyle: { color: p.fg3, fontSize: 10 },
        labelFormatter: '',
      },
    ],
    series,
  };
}

export const REASON: Record<string, string> = {
  signal: '信号',
  stopLoss: '止损',
  takeProfit: '止盈',
  trailingStop: '移动止损',
  open: '持仓中',
};

export interface EquitySeries {
  name: string;
  data: number[];
  color?: string;
  width?: number;
  dashed?: boolean;
}

export interface EquityInput {
  dates: string[];
  series: EquitySeries[];
  drawdown?: number[];
  exposure?: number[];
  /** 是否显示为净值（除以首个值） */
  normalize?: boolean;
  height?: number;
}

export function equityOption(input: EquityInput, p: Palette): EOption {
  const { dates, series, drawdown, exposure, normalize = true } = input;
  const hasDD = !!drawdown;
  const hasExp = !!exposure;
  const grids = [{ left: 8, right: 56, top: 30, bottom: hasDD ? (hasExp ? '42%' : '32%') : 36 }];
  if (hasDD) grids.push({ left: 8, right: 56, top: hasExp ? '62%' : '72%', bottom: hasExp ? '22%' : 36 } as never);
  if (hasExp) grids.push({ left: 8, right: 56, top: '82%', bottom: 36 } as never);
  const xAxis = grids.map((_, i) => ({
    type: 'category' as const,
    data: dates,
    gridIndex: i,
    boundaryGap: false,
    ...axisCommon(p),
    axisLabel: { ...axisCommon(p).axisLabel, show: i === grids.length - 1 },
    splitLine: { show: false },
  }));
  const yAxis: Record<string, unknown>[] = [
    {
      type: 'value',
      gridIndex: 0,
      scale: true,
      position: 'right',
      splitNumber: 4,
      ...axisCommon(p),
      axisLabel: { ...axisCommon(p).axisLabel, formatter: (v: number) => (normalize ? v.toFixed(2) : fmtAxisNum(v)) },
    },
  ];
  if (hasDD)
    yAxis.push({
      type: 'value',
      gridIndex: 1,
      position: 'right',
      max: 0,
      splitNumber: 2,
      ...axisCommon(p),
      axisLabel: { ...axisCommon(p).axisLabel, formatter: (v: number) => (v * 100).toFixed(0) + '%' },
    });
  if (hasExp)
    yAxis.push({
      type: 'value',
      gridIndex: grids.length - 1,
      position: 'right',
      min: 0,
      max: 1,
      splitNumber: 1,
      ...axisCommon(p),
      axisLabel: { ...axisCommon(p).axisLabel, formatter: (v: number) => (v * 100).toFixed(0) + '%' },
    });

  const s: Record<string, unknown>[] = series.map((x, i) => {
    const base = x.data.find((v) => Number.isFinite(v) && v !== 0) ?? 1;
    const color = x.color ?? p.series[i % p.series.length];
    return {
      name: x.name,
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: x.data.map((v) => (Number.isFinite(v) ? (normalize ? v / base : v) : null)),
      showSymbol: false,
      lineStyle: { width: x.width ?? (i === 0 ? 2 : 1.3), color, type: x.dashed ? 'dashed' : 'solid' },
      itemStyle: { color },
      emphasis: { focus: 'series' },
      areaStyle:
        i === 0 && series.length <= 2
          ? {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: hexAlpha(color, 0.22) },
                  { offset: 1, color: hexAlpha(color, 0) },
                ],
              },
            }
          : undefined,
    };
  });
  if (hasDD)
    s.push({
      name: '回撤',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: drawdown!,
      showSymbol: false,
      lineStyle: { width: 1, color: p.down },
      itemStyle: { color: p.down },
      areaStyle: { color: hexAlpha(p.down, 0.25) },
    });
  if (hasExp)
    s.push({
      name: '仓位',
      type: 'line',
      step: 'end',
      xAxisIndex: grids.length - 1,
      yAxisIndex: grids.length - 1,
      data: exposure!,
      showSymbol: false,
      lineStyle: { width: 1, color: p.blue },
      itemStyle: { color: p.blue },
      areaStyle: { color: hexAlpha(p.blue, 0.2) },
    });

  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    legend: {
      top: 0,
      left: 8,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { color: p.fg2, fontSize: 11 },
      data: series.map((x) => x.name),
      inactiveColor: p.fg3,
      type: 'scroll',
      pageTextStyle: { color: p.fg3 },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      ...tooltipBase(p),
      axisPointer: { type: 'line', lineStyle: { color: p.fg3, type: 'dashed' } },
      valueFormatter: undefined,
      formatter: (params: { seriesName: string; value: number; color: string; dataIndex: number }[]) => {
        if (!params.length) return '';
        let html = `<div style="font-weight:600;margin-bottom:4px">${dates[params[0].dataIndex]}</div>`;
        for (const x of params) {
          if (!Number.isFinite(x.value)) continue;
          const v =
            x.seriesName === '回撤' || x.seriesName === '仓位'
              ? fmtPct(x.value, 1, x.seriesName !== '仓位')
              : normalize
                ? `${x.value.toFixed(4)}（${fmtPct(x.value - 1)}）`
                : fmtMoney(x.value);
          html += `<div style="display:flex;justify-content:space-between;gap:16px"><span>${dot(x.color)}${x.seriesName}</span><span style="font-family:${p.mono}">${v}</span></div>`;
        }
        return html;
      },
    },
    grid: grids,
    xAxis,
    yAxis,
    dataZoom: [{ type: 'inside', xAxisIndex: grids.map((_, i) => i) }],
    series: s,
  };
}

export function hexAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim());
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return c;
}

export function heatmapOption(
  input: {
    xVals: number[];
    yVals: number[];
    data: [number, number, number | null][];
    xLabel: string;
    yLabel: string;
    valueLabel: string;
    fmt: (v: number) => string;
    best?: [number, number];
  },
  p: Palette,
): EOption {
  const vals = input.data.map((d) => d[2]).filter((v): v is number => v !== null && Number.isFinite(v));
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    tooltip: {
      ...tooltipBase(p),
      trigger: 'item',
      formatter: (x: { value: [number, number, number | null] }) =>
        `${input.xLabel} = <b>${input.xVals[x.value[0]]}</b><br/>${input.yLabel} = <b>${input.yVals[x.value[1]]}</b><br/>${input.valueLabel}：<b>${
          x.value[2] === null ? '无效组合' : input.fmt(x.value[2])
        }</b>`,
    },
    grid: { left: 8, right: 16, top: 16, bottom: 64, containLabel: true },
    xAxis: {
      type: 'category',
      data: input.xVals.map(String),
      name: input.xLabel,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: p.fg2 },
      ...axisCommon(p),
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      data: input.yVals.map(String),
      name: input.yLabel,
      nameTextStyle: { color: p.fg2 },
      ...axisCommon(p),
    },
    visualMap: {
      min,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 140,
      itemWidth: 10,
      textStyle: { color: p.fg3, fontSize: 10 },
      formatter: (v: number) => input.fmt(v),
      inRange: { color: [p.down, p.panel2, p.up] },
      outOfRange: { color: p.panel2 },
    },
    series: [
      {
        type: 'heatmap',
        data: input.data.map((d) => (d[2] === null ? { value: d, itemStyle: { color: p.panel2 } } : d)),
        itemStyle: { borderColor: p.panel, borderWidth: 1 },
        label: { show: input.xVals.length * input.yVals.length <= 120, color: p.fg, fontSize: 9, formatter: (x: { value: [number, number, number | null] }) => (x.value[2] === null ? '' : input.fmt(x.value[2])) },
        emphasis: { itemStyle: { borderColor: p.fg, borderWidth: 1 } },
        markPoint: input.best
          ? { symbol: 'pin', symbolSize: 26, itemStyle: { color: p.accent }, label: { show: false }, data: [{ coord: input.best.map(String) }] }
          : undefined,
      },
    ],
  };
}

export function lineOption(
  input: { x: (string | number)[]; series: { name: string; data: (number | null)[]; color?: string }[]; xLabel?: string; fmt?: (v: number) => string; markX?: string | number },
  p: Palette,
): EOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    legend: { top: 0, left: 8, textStyle: { color: p.fg2, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    tooltip: {
      ...tooltipBase(p),
      valueFormatter: (v: number) => (input.fmt && Number.isFinite(v) ? input.fmt(v) : String(v)),
    },
    grid: { left: 8, right: 16, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: input.x.map(String), name: input.xLabel, nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: p.fg2 }, ...axisCommon(p) },
    yAxis: { type: 'value', scale: true, ...axisCommon(p), axisLabel: { ...axisCommon(p).axisLabel, formatter: input.fmt } },
    series: input.series.map((s, i) => ({
      name: s.name,
      type: 'line',
      data: s.data,
      showSymbol: true,
      symbolSize: 5,
      lineStyle: { width: 2, color: s.color ?? p.series[i] },
      itemStyle: { color: s.color ?? p.series[i] },
      markLine:
        i === 0 && input.markX !== undefined
          ? { silent: true, symbol: 'none', lineStyle: { color: p.accent, type: 'dashed' }, label: { show: false }, data: [{ xAxis: String(input.markX) }] }
          : undefined,
    })),
  };
}

export function fanOption(
  input: { steps: number[]; bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] }; actual?: number[] },
  p: Palette,
): EOption {
  const { steps, bands } = input;
  const band = (lo: number[], hi: number[], name: string, alpha: number) => [
    { name: name + '下', type: 'line', data: lo, stack: name, lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
    {
      name,
      type: 'line',
      data: hi.map((v, i) => v - lo[i]),
      stack: name,
      lineStyle: { opacity: 0 },
      showSymbol: false,
      areaStyle: { color: hexAlpha(p.accent, alpha) },
      silent: true,
      tooltip: { show: false },
    },
  ];
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    legend: { top: 0, left: 8, data: ['5%~95% 区间', '25%~75% 区间', '中位数', '实际净值'], textStyle: { color: p.fg2, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    tooltip: {
      ...tooltipBase(p),
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        const r = (k: string, v: number) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${k}</span><span style="font-family:${p.mono}">${v.toFixed(3)}</span></div>`;
        return `<div style="font-weight:600;margin-bottom:4px">第 ${steps[i]} 根</div>` + r('95%', bands.p95[i]) + r('75%', bands.p75[i]) + r('中位数', bands.p50[i]) + r('25%', bands.p25[i]) + r('5%', bands.p5[i]) + (input.actual ? r('实际', input.actual[i]) : '');
      },
    },
    grid: { left: 8, right: 16, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: steps.map(String), boundaryGap: false, ...axisCommon(p) },
    yAxis: { type: 'value', scale: true, ...axisCommon(p), axisLabel: { ...axisCommon(p).axisLabel, formatter: (v: number) => v.toFixed(2) } },
    series: [
      ...band(bands.p5, bands.p95, '5%~95% 区间', 0.14),
      ...band(bands.p25, bands.p75, '25%~75% 区间', 0.26),
      { name: '中位数', type: 'line', data: bands.p50, showSymbol: false, lineStyle: { color: p.accent, width: 2 }, itemStyle: { color: p.accent } },
      ...(input.actual
        ? [{ name: '实际净值', type: 'line', data: input.actual, showSymbol: false, lineStyle: { color: p.blue, width: 1.5 }, itemStyle: { color: p.blue } }]
        : []),
    ],
  };
}

export function histogramOption(input: { x: number[]; count: number[]; fmt: (v: number) => string; color?: string; markZero?: boolean }, p: Palette): EOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    tooltip: {
      ...tooltipBase(p),
      formatter: (ps: { dataIndex: number; value: number }[]) => `${input.fmt(input.x[ps[0].dataIndex])}<br/>次数：<b>${ps[0].value}</b>`,
    },
    grid: { left: 8, right: 16, top: 12, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: input.x.map((v) => input.fmt(v)), ...axisCommon(p) },
    yAxis: { type: 'value', ...axisCommon(p) },
    series: [
      {
        type: 'bar',
        data: input.count.map((c, i) => ({ value: c, itemStyle: { color: input.color ?? (input.x[i] >= 0 ? p.up : p.down), opacity: 0.8 } })),
        barCategoryGap: '8%',
      },
    ],
  };
}

export function stackedAreaOption(input: { dates: string[]; series: { name: string; data: number[] }[] }, p: Palette): EOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    legend: { top: 0, left: 8, textStyle: { color: p.fg2, fontSize: 11 }, itemWidth: 14, itemHeight: 8, type: 'scroll' },
    tooltip: {
      ...tooltipBase(p),
      valueFormatter: (v: number) => (v * 100).toFixed(1) + '%',
    },
    grid: { left: 8, right: 16, top: 32, bottom: 24, containLabel: true },
    xAxis: { type: 'category', data: input.dates, boundaryGap: false, ...axisCommon(p), splitLine: { show: false } },
    yAxis: { type: 'value', min: 0, max: 1, ...axisCommon(p), axisLabel: { ...axisCommon(p).axisLabel, formatter: (v: number) => (v * 100).toFixed(0) + '%' } },
    dataZoom: [{ type: 'inside' }],
    series: input.series.map((s, i) => ({
      name: s.name,
      type: 'line',
      stack: 'w',
      step: 'end',
      data: s.data,
      showSymbol: false,
      lineStyle: { width: 0 },
      areaStyle: { color: p.series[i % p.series.length], opacity: 0.75 },
      itemStyle: { color: p.series[i % p.series.length] },
    })),
  };
}

export function scatterOption(
  input: { points: [number, number][]; xLabel: string; yLabel: string; fmt: (v: number) => string },
  p: Palette,
): EOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: p.body },
    tooltip: {
      ...tooltipBase(p),
      trigger: 'item',
      formatter: (x: { value: [number, number] }) => `${input.xLabel}：${input.fmt(x.value[0])}<br/>${input.yLabel}：${input.fmt(x.value[1])}`,
    },
    grid: { left: 8, right: 16, top: 16, bottom: 30, containLabel: true },
    xAxis: { type: 'value', scale: true, name: input.xLabel, nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: p.fg2 }, ...axisCommon(p), axisLabel: { ...axisCommon(p).axisLabel, formatter: input.fmt } },
    yAxis: { type: 'value', scale: true, name: input.yLabel, nameTextStyle: { color: p.fg2 }, ...axisCommon(p), axisLabel: { ...axisCommon(p).axisLabel, formatter: input.fmt } },
    series: [
      {
        type: 'scatter',
        data: input.points,
        symbolSize: 6,
        itemStyle: { color: hexAlpha(p.accent, 0.65) },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: p.fg3, type: 'dashed' },
          label: { show: false },
          data: [{ xAxis: 0 }, { yAxis: 0 }],
        },
      },
    ],
  };
}
