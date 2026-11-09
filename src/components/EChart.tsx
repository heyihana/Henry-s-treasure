import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, CandlestickChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  CandlestickChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type EOption = echarts.EChartsCoreOption;

interface Props {
  option: EOption;
  height?: number | string;
  className?: string;
  onClick?: (params: { dataIndex: number; seriesIndex: number; data: unknown }) => void;
  /** 保留缩放状态（更新数据时不重置 dataZoom） */
  keepZoom?: boolean;
}

export function EChart({ option, height = 320, className, onClick, keepZoom }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const el = ref.current!;
    const c = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => clickRef.current?.(p as never));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    if (keepZoom) {
      const prev = c.getOption() as { dataZoom?: { start?: number; end?: number }[] } | undefined;
      const z = prev?.dataZoom?.[0];
      const next = option as { dataZoom?: { start?: number; end?: number }[] };
      if (z && next.dataZoom) next.dataZoom = next.dataZoom.map((d) => ({ ...d, start: z.start, end: z.end }));
    }
    c.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option, keepZoom]);

  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
}
