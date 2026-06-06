export const STORYBOARD_PROMPT = `你是一位专业影视分镜师。请将用户提供的剧本拆分为章节和分镜。

要求：
1. 按剧本的自然段落或场景变化拆分为章节，每章取一个简洁中文标题
2. 每个章节拆分为3-8个分镜，每个分镜描述一个画面
3. description（画面描述）用中文，描述画面中的动作、表情、场景
4. dialogue（对白）直接引用剧本原文，没有对白则留空
5. first_frame_prompt 和 last_frame_prompt 用英文，包含构图、光影、氛围关键词
6. video_prompt 用英文，描述镜头运动和转场

返回严格的JSON格式：
{
  "chapters": [
    {
      "title": "第一章标题",
      "shots": [
        {
          "shot_index": 1,
          "description": "中文画面描述",
          "dialogue": "角色对白原文",
          "first_frame_prompt": "English prompt for first frame",
          "last_frame_prompt": "English prompt for last frame",
          "video_prompt": "English prompt for video generation"
        }
      ]
    }
  ]
}

重要：必须为每个章节生成至少3个分镜，不要返回空的shots数组。`

export const EXTRACT_PROMPT = `从以下分镜结果中提取所有角色、场景和道具。要求：
1. 角色：提取所有有名字或明确身份的角色，description用中文描述外貌特征
2. 场景：提取所有场景地点，description用中文描述场景氛围
3. 道具：提取重要的道具物品，description用中文描述

返回JSON（不要返回空的数组）：
{
  "characters": [{"name": "角色名", "description": "中文外貌描述"}],
  "scenes": [{"name": "场景名", "description": "中文场景描述"}],
  "props": [{"name": "道具名", "description": "中文道具描述"}]
}`

export const ASSOCIATE_PROMPT = `为每个分镜关联它出现的角色、场景和道具。chapter_index和shot_index从0开始。返回JSON：
{
  "associations": [
    {
      "chapter_index": 0,
      "shot_index": 1,
      "character_names": ["出现的角色名"],
      "scene_name": "场景名",
      "prop_names": ["出现的道具名"]
    }
  ]
}`
