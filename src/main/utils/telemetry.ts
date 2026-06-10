/**
 * 遥测埋点模块
 * MVP1：空实现，预留接口
 * MVP2：接入真实数据上报逻辑
 */

// TODO(MVP2): 事件追踪 — 生成/审查/设置的匿名化事件上报
export function trackEvent(_event: string, _data?: Record<string, unknown>): void {}

// TODO(MVP2): AI调用统计 — 模型、通道、token消耗、费用追踪
export function trackAICall(
  _model: string,
  _channel: string,
  _tokens: number,
  _cost: number
): void {}

// TODO(MVP2): 错误上报 — 捕获模块、错误信息用于稳定性监控
export function trackError(_module: string, _error: string): void {}
