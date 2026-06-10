/**
 * 全局常量
 */

// ===== 一致性校验 =====
/** 关键词提取时，颜色词到 "hair/eye" 的最大邻近字符距离 */
export const CONSISTENCY_PROXIMITY_RANGE = 40

// ===== 生图 API =====
/** API 调用失败后重试等待间隔 (ms) */
export const IMAGE_API_RETRY_DELAY = 3_000
/** Agnes 图生图最多传入的参考图数量 */
export const AGNES_MAX_REF_IMAGES = 2
/** API 重试最大次数（指数退避） */
export const IMAGE_API_MAX_RETRIES = 3
