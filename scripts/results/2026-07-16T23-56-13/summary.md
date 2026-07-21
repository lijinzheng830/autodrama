# P0.9.8 稳定性验证报告

生成时间: 2026-07-17T00:03:18.039Z
测试剧本数: 5
成功: 5 / 失败: 0

## 概览

| 剧本 | 类型 | 章数 | AI Purpose% | 溢出章 | _r1 | VO(AI/管线) | Rhythm Warnings | 耗时 |
|------|------|------|-----------|--------|-----|------------|----------------|------|
| Case A1: 争吵对话 | dialogue-driven | 8 (AI:3) | 100% | 5 | 0 | 0/6 | 5 | 95s |
| Case A2: 多角色交流 | dialogue-driven | 6 (AI:4) | 100% | 2 | 0 | 0/1 | 1 | 113s |
| Case B1: 独处氛围 | visual-driven | 1 (AI:1) | 100% | 0 | 0 | 0/0 | 0 | 59s |
| Case B2: 回忆闪回 | visual-driven | 1 (AI:1) | 100% | 0 | 0 | 0/0 | 0 | 60s |
| Case C1: 混合场景（命令-反应-独处） | mixed | 3 (AI:1) | 100% | 2 | 0 | 0/0 | 2 | 85s |

## 目标达成情况

| 指标 | 实际值 | 目标 | 状态 |
|------|--------|------|------|
| AI shot_purpose 比例 | 100% | > 80% | [OK] |
| 平均溢出章数 | 1.8 | < 1 | [WARN] |
| _r1 重命名数 | 0.0 | 0 | [OK] |
| VO 管线生成 / AI生成 | 7 / 0 | 管线 < AI | [WARN] |
| 平均 Rhythm Warnings | 1.6 | < 2 | [OK] |
| 平均耗时 | 82s | - | - |

## AI Design Recovery Rate

| 剧本 | AI自主章 | 溢出章 | 自主率 |
|------|---------|--------|--------|
| Case A1: 争吵对话 | 3 | 5 | 38% |
| Case A2: 多角色交流 | 4 | 2 | 67% |
| Case B1: 独处氛围 | 1 | 0 | 100% |
| Case B2: 回忆闪回 | 1 | 0 | 100% |
| Case C1: 混合场景（命令-反应-独处） | 1 | 2 | 33% |

## 各剧本详细

### Case A1: 争吵对话
- 类型: dialogue-driven
- 总章数: 8 (AI自主: 3, Pipeline溢出: 5)
- 总镜数: 27
- AI shot_purpose 覆盖: 100% (27/27)
- 对白/画外音/视觉: 34/6/32
- 对白时长占比: 49%
- VO来源: AI 0 + Pipeline 6
- _r1 重命名: 0
- Rhythm Warnings: 5
- Compliance Warnings:
  - audio_track "dialogue_7" 对白17字 > 组容量16字（3镜合计）

### Case A2: 多角色交流
- 类型: dialogue-driven
- 总章数: 6 (AI自主: 4, Pipeline溢出: 2)
- 总镜数: 36
- AI shot_purpose 覆盖: 100% (36/36)
- 对白/画外音/视觉: 27/1/26
- 对白时长占比: 52%
- VO来源: AI 0 + Pipeline 1
- _r1 重命名: 0
- Rhythm Warnings: 1

### Case B1: 独处氛围
- 类型: visual-driven
- 总章数: 1 (AI自主: 1, Pipeline溢出: 0)
- 总镜数: 9
- AI shot_purpose 覆盖: 100% (9/9)
- 对白/画外音/视觉: 0/0/9
- 对白时长占比: 0%
- VO来源: AI 0 + Pipeline 0
- _r1 重命名: 0
- Rhythm Warnings: 0

### Case B2: 回忆闪回
- 类型: visual-driven
- 总章数: 1 (AI自主: 1, Pipeline溢出: 0)
- 总镜数: 9
- AI shot_purpose 覆盖: 100% (9/9)
- 对白/画外音/视觉: 0/0/9
- 对白时长占比: 0%
- VO来源: AI 0 + Pipeline 0
- _r1 重命名: 0
- Rhythm Warnings: 0

### Case C1: 混合场景（命令-反应-独处）
- 类型: mixed
- 总章数: 3 (AI自主: 1, Pipeline溢出: 2)
- 总镜数: 9
- AI shot_purpose 覆盖: 100% (9/9)
- 对白/画外音/视觉: 15/0/12
- 对白时长占比: 59%
- VO来源: AI 0 + Pipeline 0
- _r1 重命名: 0
- Rhythm Warnings: 2
- Compliance Warnings:
  - 镜#2 对白7字 > 镜容量6字（近景 2s）
