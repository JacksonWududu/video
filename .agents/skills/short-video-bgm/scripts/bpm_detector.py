#!/usr/bin/env python3
"""
音频 BPM 检测器
Audio BPM detector

依赖：librosa（音频分析库）。未安装时给出降级方案。

用法：
  python bpm_detector.py --file audio.mp3
  python bpm_detector.py --file audio.wav --out result.json

降级方案（无 librosa 时）：
  1. 用剪映导入音频，自动识别节拍看 BPM
  2. 在线工具：vitalybelov.com/bpm、songbpm.com
  3. 手动数拍：10秒内数到 N 拍，BPM = N * 6
  4. 安装：pip install librosa（建议装到独立 venv）
"""

import sys
import json
import argparse


def try_detect_with_librosa(audio_path):
    """用 librosa 检测 BPM，返回 (bpm, beats) 或 None。"""
    try:
        import librosa
    except ImportError:
        return None, "NO_LIBROSA"

    try:
        y, sr = librosa.load(audio_path, sr=None)
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
        # tempo 可能是 numpy 数组，取标量
        bpm = float(tempo) if not hasattr(tempo, '__len__') else float(tempo[0])
        beat_times = librosa.frames_to_time(beats, sr=sr).tolist()
        return bpm, beat_times
    except Exception as e:
        return None, f"检测失败：{e}"


def fallback_message():
    """无 librosa 时的降级提示。"""
    return """未安装 librosa，无法自动检测 BPM。

降级方案（任选其一）：

1. 剪映导入音频：
   - 导入音频 → 自动识别节拍 → 看 BPM 标注

2. 在线工具：
   - vitalybelov.com/bpm（上传音频检测）
   - songbpm.com（按歌名查）

3. 手动数拍：
   - 播放音频，10 秒内数到 N 拍
   - BPM = N × 6
   - 多测几次取平均

4. 安装 librosa（推荐装到独立 venv）：
   python -m venv ~/bgm_venv
   ~/bgm_venv/Scripts/activate   (Windows)
   或 source ~/bgm_venv/bin/activate  (Mac/Linux)
   pip install librosa
   再运行本脚本"""


def main():
    parser = argparse.ArgumentParser(description="音频 BPM 检测器")
    parser.add_argument("--file", required=True, help="音频文件路径 (mp3/wav/m4a 等)")
    parser.add_argument("--out", help="输出 JSON 文件路径，缺省打印到 stdout")
    args = parser.parse_args()

    print(f"检测音频：{args.file}", file=sys.stderr)
    bpm, info = try_detect_with_librosa(args.file)

    if bpm is None and info == "NO_LIBROSA":
        print(fallback_message(), file=sys.stderr)
        sys.exit(2)

    if bpm is None:
        print(info, file=sys.stderr)
        sys.exit(1)

    # 检测成功
    result = {
        "file": args.file,
        "bpm": round(bpm, 1),
        "beat_count": len(info) if isinstance(info, list) else 0,
        "beat_times": [round(t, 3) for t in info] if isinstance(info, list) else [],
    }

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"BPM 检测完成：{result['bpm']}，结果写入 {args.out}", file=sys.stderr)
    else:
        print(f"BPM：{result['bpm']}")
        print(f"节拍数：{result['beat_count']}")
        if result["beat_times"]:
            print(f"前10个节拍时间：{result['beat_times'][:10]}")
        print("\n拿到 BPM 后，可用 beat_marker.py 生成卡点时间戳：")
        print(f'  python beat_marker.py --duration <时长> --bpm {result["bpm"]}')


if __name__ == "__main__":
    main()
