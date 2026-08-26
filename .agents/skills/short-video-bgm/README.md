# 🎵 Short Video BGM · 短视频 BGM 与音效匹配

> 解决短视频创作者「找音乐难、卡点难、侵权怕」三大痛点——按情绪 / 节奏 / 赛道匹配免版权 BGM，并给出卡点时间戳与商用边界。

<p align="center">
  <a href="https://github.com/uahz/short-video-bgm"><img alt="Platform" src="https://img.shields.io/badge/Platform-All%20Skills--Clients-2D7FF9?logo=openai&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-green"></a>
  <a href="scripts/"><img alt="Language" src="https://img.shields.io/badge/Language-Python-3776AB?logo=python&logoColor=white"></a>
  <a href="SKILL.md"><img alt="Spec" src="https://img.shields.io/badge/SKILL.md-Anthropic%20Spec-FF6F00"></a>
</p>

按情绪 / 节奏 / 赛道匹配免版权 BGM，提供卡点音效、热门原声追踪、商用风险扫描与自动卡点时间戳生成，全程给出可商用边界，避免侵权。面向 **抖音 / 小红书 / 视频号 / 快手 / B 站 / TikTok** 等所有短视频创作者。

---

## ✨ 为什么需要它

短视频的「灵魂」在配乐，但创作者常被三件事卡住：

- **找音乐难** — 不知道什么情绪 / BPM 配什么画面
- **卡点难** — 手动对节拍费时，且不准
- **侵权怕** — 用了平台热歌跨平台发，收到侵权提醒

本 Skill 把这三件事变成一步到位的产出：推荐曲源 + 卡点时间戳 + 商用风险报告。

## 🎯 五大核心能力

| # | 能力 | 直接产出 |
|---|:---:|---|
| 1 | **BGM 匹配** | 按情绪（欢快/治愈/燃/悬疑…）、节奏（BPM）、赛道匹配免版权音乐，给出曲源与署名要求 |
| 2 | **卡点音效** | 转场（whoosh/riser）/ 提示（叮/pop）/ 鼓点（kick/snare）/ 环境音效分类推荐 |
| 3 | **热门原声追踪** | 各平台当前热门 BGM 趋势，按增速（而非绝对值）判断，提示饱和度风险 |
| 4 | **商用风险扫描** | 判定授权类型（CC0/CC-BY/平台/订阅/公版）、署名、商用边界、平台限制、录音版权，输出风险等级 |
| 5 | **自动卡点时间戳** | 给定时长 + BPM，生成卡点时间戳表（每 4 拍强卡点 + 每拍次卡点 + 段落切换），可导入剪映 |

## 🌐 兼容的客户端

本 Skill 采用通用的 **`SKILL.md` 规范（Anthropic Skills 格式）**，**所有支持 Skills 的 AI 客户端都能直接安装使用**，无需任何改造，包括但不限于：

| 客户端 | 推荐放置路径 |
|---|---|
| **WorkBuddy** | `~/.workbuddy/skills/short-video-bgm/` |
| **Claude**（Claude Code / Claude.ai） | 项目 `.claude/skills/short-video-bgm/` 或用户级 `skills/short-video-bgm/` |
| **Cursor** | `.cursor/skills/short-video-bgm/` |
| **Codex / ChatGPT** | `skills/short-video-bgm/` |
| **Windsurf / 其它兼容客户端** | 对应 `skills/short-video-bgm/` 目录 |

> 只要客户端能识别 `SKILL.md`，把本仓库文件夹放进去即可启用。

## 📦 安装

**方式一 · Git 克隆（推荐）**

```bash
git clone https://github.com/uahz/short-video-bgm.git ~/.workbuddy/skills/short-video-bgm
# 或换成你所用客户端的 skills 目录
```

**方式二 · 下载 ZIP**

在仓库首页点击 `Code → Download ZIP`，解压后把 `short-video-bgm/` 文件夹整体复制到客户端的 `skills/` 目录下。

**方式三 · 手动拷贝**

将本仓库整个文件夹（根目录必须含 `SKILL.md`）复制到客户端的 `skills/` 目录，重启 / 刷新客户端即被识别。

## 🚀 快速开始

直接对客户端说：

> 「给我这条 30 秒卡点视频配个燃向 BGM，120 BPM，再标出卡点时间戳，确认能不能商用」

或本地运行脚本：

```bash
# 卡点时间戳生成（纯标准库，开箱即用）
python scripts/beat_marker.py --duration 30 --bpm 120
python scripts/beat_marker.py --duration 45 --bpm 128 --segments '[{"t":15,"label":"转折"}]' --out beats.csv

# BPM 检测（需 librosa，未安装会自动给降级方案：剪映 / 在线 / 手动数拍）
python scripts/bpm_detector.py --file audio.mp3
```

## 📂 文件结构

```
short-video-bgm/
├── SKILL.md                       # Skill 主文件（客户端识别入口）
├── README.md
├── LICENSE
├── references/
│   ├── free-music-sources.md      # 免版权音乐源库
│   ├── mood-bpm-mapping.md        # 情绪 × 节奏 × 赛道匹配规则
│   ├── sound-effects-library.md   # 常用音效库
│   ├── trending-bgm-tracking.md   # 热门原声追踪方法
│   └── compliance-check.md        # 音乐商用合规判断框架
└── scripts/
    ├── beat_marker.py             # 卡点时间戳生成器
    └── bpm_detector.py            # 音频 BPM 检测器（需 librosa，无则降级）
```

## 🎯 触发词

短视频配乐 / BGM / 背景音乐 / 卡点 / 卡点标记 / 音效 / 转场音效 / 热门原声 / 免版权音乐 / 商用风险 / 视频配乐 / 踩点 / 找音乐 / 商用侵权 / beat marker / bgm / short video music / 卡点视频

## 📄 License

[MIT](LICENSE) © uahz
