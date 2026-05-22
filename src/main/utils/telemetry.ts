/**
 * 遥测埋点模块
 * MVP1：空实现，预留接口
 * MVP2：接入真实数据上报逻辑
 */

export function trackEvent(event: string, data?: Record<string, any>): void {
  // TODO: implement in MVP2
}

export function trackAICall(model: string, channel: string, tokens: number, cost: number): void {
  // TODO: implement in MVP2
}

export function trackError(module: string, error: string): void {
  // TODO: implement in MVP2
}
