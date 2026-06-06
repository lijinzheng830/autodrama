# prompt_templates 表初始化映射配置

> 2026-05-29 重新整理，18条，与管线设计#8对齐
> content字段只存纯模板内容（v0/v2=LLM指令文本，v1=填空产出JSON）
> Kimi操作：①将灌表内容目录下18个.md文件复制到项目src/main/data/prompt-templates/ ②删db.ts和template.ts中的占位模板 ③新增INSERT逻辑

## v0前置解析模板（1条，template_version='v0'）

| 序号 | 文件名 | id | usage | name |
|---|---|---|---|---|
| 1 | v0-01-script-parse.md | official-v0-script-parse | script_parse | 剧本解析 |

## v1填空模板（11条，template_version='v1'）

| 序号 | 文件名 | id | usage | name |
|---|---|---|---|---|
| 2 | v1-04-character-image.md | official-v1-character-image | character_image | 角色定妆照填空 |
| 3 | v1-04.5-character-skin.md | official-v1-character-skin | character_skin | 角色皮肤填空 |
| 4 | v1-05-scene-image.md | official-v1-scene-image | scene_image | 场景图填空 |
| 5 | v1-06-prop-image.md | official-v1-prop-image | prop_image | 道具图填空 |
| 6 | v1-07-grid-storyboard.md | official-v1-grid-storyboard | grid_storyboard | 宫格故事板填空 |
| 7 | v1-08-first-frame.md | official-v1-first-frame | first_frame | 首帧填空 |
| 8 | v1-09-last-frame.md | official-v1-last-frame | last_frame | 尾帧填空 |
| 9 | v1-10A-video-basic.md | official-v1-video-basic | video_basic | 视频基础图引导填空 |
| 10 | v1-10B-video-first-frame.md | official-v1-video-first-frame | video_first_frame | 视频首帧引导填空 |
| 11 | v1-10C-video-both-frames.md | official-v1-video-both-frames | video_both_frames | 视频首尾帧引导填空 |
| 12 | v1-10D-video-grid.md | official-v1-video-grid | video_grid | 视频宫格引导填空 |

## v2润色模板（6条，template_version='v2'）

| 序号 | 文件名 | id | usage | name |
|---|---|---|---|---|
| 13 | v2-04A-character-polish.md | official-v2-character-polish | character_polish | 角色润色 |
| 14 | v2-05A-scene-polish.md | official-v2-scene-polish | scene_polish | 场景润色 |
| 15 | v2-06A-prop-polish.md | official-v2-prop-polish | prop_polish | 道具润色 |
| 16 | v2-07-shot-polish.md | official-v2-shot-polish | shot_polish | 分镜润色 |
| 17 | v2-08-first-frame-polish.md | official-v2-first-frame-polish | first_frame_polish | 首帧润色 |
| 18 | v2-09-last-frame-polish.md | official-v2-last-frame-polish | last_frame_polish | 尾帧润色 |

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
