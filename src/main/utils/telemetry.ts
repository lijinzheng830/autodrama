/**
 * 遥测埋点模块
 * MVP1：空实现，预留接口
 * MVP2：接入真实数据上报逻辑
 */

export function trackEvent(_event: string, _data?: Record<string, unknown>): void {
  // TODO: implement in MVP2
}

export function trackAICall(
  _model: string,
  _channel: string,
  _tokens: number,
  _cost: number
): void {
  // TODO: implement in MVP2
}

export function trackError(_module: string, _error: string): void {
  // TODO: implement in MVP2
}
