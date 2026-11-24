import * as echarts from 'echarts'

export type EChartsOption = echarts.EChartsCoreOption

/** 初始化图表（自动注册窗口 resize） */
export function initChart(el: HTMLElement, option: EChartsOption): echarts.ECharts {
  const chart = echarts.init(el)
  chart.setOption(option)
  return chart
}

/** 更新图表配置 */
export function setChartOption(chart: echarts.ECharts | null, option: EChartsOption) {
  if (!chart) return
  chart.setOption(option, true)
}

/** 销毁图表（组件卸载时调用） */
export function disposeChart(chart: echarts.ECharts | null) {
  if (chart) {
    chart.dispose()
  }
}

/** 常用调色板 */
export const PALETTE = ['#3A7AFE', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#84CC16']

/** 通用图例/坐标轴文字颜色 */
export const AXIS_TEXT = '#6B7280'

/** 生成默认折线/柱状系列颜色 */
export const LINE_COLORS = ['#3A7AFE', '#22C55E']

/** 游戏版版本线：主版本号 ≥ 5（正式版为 4.x） */
export function isGameVersion(version: string): boolean {
  const major = Number.parseInt(version.replace(/^v/i, '').split('.')[0], 10)
  return Number.isFinite(major) && major >= 5
}

/** 版本分布双色：正式版沿用原绿色渐变，游戏版橙色 */
export const EDITION_COLORS = {
  formal: ['#22C55E', '#86EFAC'],
  game: ['#F59E0B', '#FCD34D'],
}

/** 生成纵向渐变（柱状图用） */
export function verticalGradient(from: string, to: string) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  }
}
