{
  "section_0_tech_spec": "TECH SPEC: 16:9, 24fps progressive, 10-bit color depth, Rec.2020 color space, 180° shutter angle, no interlacing, no frame blending.",

  "section_1_format": "VIDEO OVERVIEW: Single continuous {{total_duration}}-second video, 16:9, 24fps. Sequence through all frames with consistent character/scene identity. No text, no subtitles, no watermarks, no logos, no UI elements. Era: {{era}}. Style: {{style_name}} — {{style_prompt}}.",

  "section_2_shots_body": "{{shots_body}}",

  "section_3_character_lock": "CHARACTER LOCK:\n{{character_descriptions}}\nEvery character appearance 100% identical to character design cards. No appearance drift, no face swapping. Real skin texture with visible pores, natural blinking, subtle breathing, hair/cloth micro-swaying. No wax-smooth skin, no plastic face.",

  "section_4_scene_lock": "SCENE LOCK: Same 3D space, same light direction, same prop positions across all shots. Location: {{scene_location}}. Time/Weather: {{scene_time_weather}}. Light: {{scene_lighting}}. Effects: {{scene_effects}}. Ref Objects: {{scene_reference_objects}}. Era-authentic material textures ({{era}}). Natural atmospheric mist and dust with subtle motion. No visual anachronisms.",

  "section_5_camera_direction": "CAMERA: Dolly, push, pull, pan, or track — one primary movement per shot. Acceptable transitions between shots: (1) camera pan/track following character into next frame, (2) shot/reverse-shot with eyeline match across 180° axis, (3) action continuity handoff with matching motion vectors, (4) foreground occlusion soft cut via scene elements, (5) J-cut audio lead-in before visual cut. Absolutely no hard jump cuts without visual continuity线索. Adjacent frames vary shot scale and camera angle (≥30°). Maintain 180-degree axis. Dutch angle only when specified for压迫感. Final frame locks on specified composition.",

  "section_6_lighting_design": "LIGHTING: {{scene_lighting}}. Light sources have clear origins and directions. Particles have sources and trajectories — no random floating particles. Light beams must not穿模 through characters, objects, or camera.",

  "section_7_lock_frame": "LOCK FRAME: Final frame (Frame {{last_frame_num}}, {{last_frame_duration}}) locks on: {{last_frame_desc}}. Camera decelerates over last 0.5s to complete stop, freezes for remaining duration. This frozen frame serves as opening frame of next video segment — pixel-perfect match required.",

  "section_8_anti_clipping": "ANTI-CLIPPING: Light beams/energy lines must emit from correct sources (hands/objects), not穿模 through palms, fingers, hair, face, body, or clothing. Characters must not morph or swap faces. Scene objects must not clip into each other. Energy effects must be blocked by protective barriers when specified — do not penetrate protected surfaces.",

  "negative_prompt_image": "blurry, low resolution, deformed anatomy, extra limbs, missing limbs, asymmetric face, deformed hands, wax-smooth skin, plastic face, 3D rendering texture, text, watermark, logo, subtitles, cartoon, anime, illustration",

  "negative_prompt_video": "frame flickering, camera shake, high-speed rotation, 360-degree orbit, chaotic camera翻滚, character morphing, scene distortion, lighting inconsistency, color shifting, character teleporting, object clipping, motion stutter, jerky movement, PPT freeze frame, static non-moving shot, jump cuts, 穿模",

  "negative_prompt_content": "text overlay, watermark, logo, subtitles, BGM, cartoon style, anime, 3D render look, plastic texture, over-smoothed skin, mutated, blank expression, dull colors, flat lighting, particle explosion满天飞, 穿模, objects passing through characters, light beams穿透身体",

  "camera_spec": "Camera: ARRI Alexa 65 large format, 6.5K open gate, base ISO 800, 180° shutter. Lens system: Master Prime spherical, no distortion. Lens mapping per shot scale: 24mm f/8.0 (wide), 50mm f/2.8 (medium), 85mm f/2.0 (close-up), 100mm f/2.8 (macro). Image character: {{era}} era, {{style_name}} aesthetic — refer to style template for film grain and color treatment.",

  "quality": "real human skin with visible pores, natural blinking, hair strands naturally swaying, fabric with natural wrinkle deformation, soft warm diffuse lighting, era-appropriate color palette ({{era}}), sharp focus, {{style_name}} art style."
}
