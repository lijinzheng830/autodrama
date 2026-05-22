# Wan 2.7 蒸馏版/轻量化版本追踪

## 当前状态（2026-05-22）
- Wan 2.7 官方已发布（Image 2026-04-01, Video 2026-04-07）
- 开源权重：未完全放出（HuggingFace 上无官方 checkpoint）
- **官方蒸馏版/小参数版本：未公布**
- Wan 3.0 预告：60B 参数，4K，30秒，预计 2026 年中

## 需要盯的官方渠道

### 1. HuggingFace（最可能首发）
- https://huggingface.co/Wan-AI
- 关注模型：Wan2.7-T2V、Wan2.7-I2V、可能的 5B/1.3B 变体
- 订阅方式：点击组织页面 "Follow"，有 release 会邮件通知

### 2. ModelScope（魔搭社区）
- https://www.modelscope.cn/organization/Wan-AI
- 国内首发常在这里

### 3. GitHub
- https://github.com/Wan-Video（Wan 2.1/2.2 的仓库）
- 关注 Release 页面

### 4. 阿里云社区 / 通义万相
- https://wan.video
- https://www.aliyun.com/product/bailian
- 官方 API 文档更新

### 5. 阿里云 Model Studio
- 新模型/新规格上架会在这里先出现

## 社区替代方案（已有）
| 方案 | VRAM | 来源 |
|------|------|------|
| WanGP (deepbeepmeep) | 6GB+ | https://github.com/deepbeepmeep/Wan2GP |
| ComfyUI + GGUF Q3_K | 6-8GB | 社区量化 |
| FP8 量化 | ~27GB | H100/4090 可跑 |

## 预期时间线
- Wan 3.0：2026 年中（官方已预告）
- Wan 2.7 小版本：乐观估计 2026 Q3-Q4，悲观可能延后或不出

## 检查清单
每次更新时确认：
- [ ] HuggingFace Wan-AI 有新模型
- [ ] ModelScope 有新版本
- [ ] GitHub 有新 Release
- [ ] 阿里云社区/文档有更新
- [ ] WanGP 社区有支持 Wan 2.7 量化的进展


## Kaleido 正确地址（已确认）

| 项目 | 地址 |
|------|------|
| **GitHub 仓库** | https://github.com/zai-org/Kaleido ✅ |
| **HuggingFace 权重** | https://huggingface.co/zai-org/Kaleido-14B-S2V |
| **项目官网** | https://criliasmiller.github.io/Kaleido_Project/ |
| **论文** | https://arxiv.org/pdf/2510.18573 |

### Kaleido 关键信息
- **发布时间**：2025.10.22 代码开源 / 2025.10.28 14B 权重发布
- **模型规模**：14B 参数
- **分辨率**：512P
- **VAE**：基于 Wan 2.1 的 VAE
- **文本编码器**：UMT5-XXL
- **训练框架**：基于 CogVideoX，支持 DeepSpeed / FSDP2
- **推理**：支持多 GPU + 序列并行加速
- **提示格式**：`prompt@@image1.png@@image2.png@@image3.png`

### 下载权重命令
```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://huggingface.co/zai-org/Kaleido-14B-S2V
cd Kaleido-14B-S2V
python merge_kaleido.py
```
