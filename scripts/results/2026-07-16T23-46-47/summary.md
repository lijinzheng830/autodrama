# P0.9.8 稳定性验证报告

生成时间: 2026-07-16T23:53:03.167Z
测试剧本数: 5
成功: 0 / 失败: 5

## 概览

| 剧本 | 类型 | 章数 | AI Purpose% | 溢出章 | _r1 | VO(AI/管线) | Rhythm Warnings | 耗时 |
|------|------|------|-----------|--------|-----|------------|----------------|------|
| Case A1: 争吵对话 | dialogue-driven | FAILED | - | - | - | - | - | 89s |
| | | FOREIGN KEY constraint failed | | | | | | |
| Case A2: 多角色交流 | dialogue-driven | FAILED | - | - | - | - | - | 64s |
| | | FOREIGN KEY constraint failed | | | | | | |
| Case B1: 独处氛围 | visual-driven | FAILED | - | - | - | - | - | 62s |
| | | FOREIGN KEY constraint failed | | | | | | |
| Case B2: 回忆闪回 | visual-driven | FAILED | - | - | - | - | - | 57s |
| | | FOREIGN KEY constraint failed | | | | | | |
| Case C1: 混合场景（命令-反应-独处） | mixed | FAILED | - | - | - | - | - | 91s |
| | | FOREIGN KEY constraint failed | | | | | | |

## 目标达成情况


## AI Design Recovery Rate

| 剧本 | AI自主章 | 溢出章 | 自主率 |
|------|---------|--------|--------|

## 各剧本详细
