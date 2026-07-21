# prompt_templates 表初始化映射配置

> 2026-05-29 重新整理，12条（v2润色模板6条未实现已删除）
> content字段只存纯模板内容（v0/v2=LLM指令文本，v1=填空产出JSON）
> Kimi操作：①将灌表内容目录下18个.md文件复制到项目src/main/data/prompt-templates/ ②删db.ts和template.ts中的占位模板 ③新增INSERT逻辑

## v0前置解析模板（1条，template_version='v0'）

| 序号 | 文件名 | id | usage | name |
|---|---|---|---|---|
| 1 | v0-01-script-parse.md | official-v0-script-parse | script_parse | AI 剧本解析 |

## v1填空模板（14条，template_version='v1'）

| 序号 | 文件名 | id | usage | name |
|---|---|---|---|---|
| 2 | v1-04-character-image.md | official-v1-character-image | character_image | AI 角色参考图 |
| 3 | v1-04.5-character-skin.md | official-v1-character-skin | character_skin | 角色皮肤填空 |
| 4 | v1-05-scene-image.md | official-v1-scene-image | scene_image | AI 场景参考图 |
| 5 | v1-06-prop-image.md | official-v1-prop-image | prop_image | AI 道具参考图 |
| 6 | v1-07-grid-storyboard.md | official-v1-grid-storyboard | grid_storyboard | AI 九宫格故事板 |
| 7 | v1-12-asset-extract.md | official-v1-asset-extract | asset_extract | AI 资产提取 |
| 9 | v1-08-first-frame.md | official-v1-first-frame | first_frame | 首帧填空 |
| 10 | v1-09-last-frame.md | official-v1-last-frame | last_frame | 尾帧填空 |
| 11 | v1-10A-video-basic.md | official-v1-video-basic | video_basic | 视频基础图引导填空 |
| 12 | v1-10B-video-first-frame.md | official-v1-video-first-frame | video_first_frame | 视频首帧引导填空 |
| 13 | v1-10C-video-both-frames.md | official-v1-video-both-frames | video_both_frames | 视频首尾帧引导填空 |
| 14 | v1-10D-video-grid.md | official-v1-video-grid | video_grid | 视频宫格引导填空 |

## INSERT逻辑

每条记录字段：
- id：上表id列
- project_id：NULL（官方预设，不绑定项目）
- usage：上表usage列
- name：上表name列
- content：对应文件完整内容
- is_default：1（官方预设）
- template_version：v0/v1/v2（见上表分类）

INSERT策略：INSERT OR REPLACE（允许更新已有官方模板内容）

## 要删除的旧代码

1. db.ts中现有的4条占位INSERT（official-shot-image-standard/detailed/pure + official-shot-video）
2. template.ts中的OFFICIAL_TEMPLATES硬编码数组及其导出
3. template.ts中getPromptTemplates函数里合并OFFICIAL_TEMPLATES的逻辑——改为统一从数据库读取
