export const AUTO_SCROLL_BOTTOM_THRESHOLD = 120;

export type ScrollMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function distanceFromScrollBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function isNearScrollBottom(
  metrics: ScrollMetrics,
  threshold = AUTO_SCROLL_BOTTOM_THRESHOLD,
): boolean {
  return distanceFromScrollBottom(metrics) <= threshold;
}
