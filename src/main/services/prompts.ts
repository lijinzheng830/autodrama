export const STORYBOARD_PROMPT = `根据用户提供的剧本，拆分为章节和分镜。返回以下JSON结构：
{
  "chapters": [
    {
      "title": "章节标题",
      "shots": [
        {
          "shot_index": 1,
          "description": "画面描述（中文）",
          "dialogue": "对白",
          "first_frame_prompt": "首帧英文提示词（用于AI生图，包含风格、构图、光影）",
          "last_frame_prompt": "尾帧英文提示词",
          "video_prompt": "视频提示词（英文）"
        }
      ]
    }
  ]
}

请以 JSON 格式返回`

export const EXTRACT_PROMPT = `根据分镜结果，提取所有角色、场景和道具。返回JSON：
{
  "characters": [{"name": "角色名", "description": "角色描述（中文）"}],
  "scenes": [{"name": "场景名", "description": "场景描述（中文）"}],
  "props": [{"name": "道具名", "description": "道具描述（中文）"}]
}

请以 JSON 格式返回`

export const ASSOCIATE_PROMPT = `根据分镜、角色、场景和道具列表，为每个分镜关联出现的角色、场景和道具。返回JSON：
{
  "associations": [
    {
      "chapter_index": 0,
      "shot_index": 1,
      "character_names": ["角色A"],
      "scene_name": "场景名",
      "prop_names": ["道具A"]
    }
  ]
}

请以 JSON 格式返回`
