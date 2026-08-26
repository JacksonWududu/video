#!/usr/bin/env python3
"""
短视频卡点时间戳生成器
Short video beat marker generator

输入：视频时长(秒) + 目标 BPM（可选段落标记）
输出：卡点时间戳表（可参考导入剪映）

卡点类型：
  - 强卡点：每4拍（一个小节第一拍），用于画面定格/转场
  - 弱卡点：每拍，用于节奏推进
  - 段落卡点：用户标记的段落切换点

用法：
  python beat_marker.py --duration 30 --bpm 120
  python beat_marker.py --duration 45 --bpm 128 --segments '[{"t":15,"label":"转折"},{"t":30,"label":"高潮"}]'
  python beat_marker.py --duration 30 --bpm 120 --out beats.csv
"""

import sys
import json
import argparse


def format_ts(seconds):
    """秒转 MM:SS.mmm"""
    m = int(seconds // 60)
    s = seconds % 60
    return f"{m:02d}:{s:06.3f}"


def generate_beats(duration, bpm, segments=None):
    """生成卡点时间戳列表。"""
    if bpm <= 0:
        return []
    beat_interval = 60.0 / bpm  # 每拍秒数

    beats = []
    t = 0.0
    beat_index = 0  # 从0开始的小节内拍号

    while t <= duration + 0.001:
        in_bar = beat_index % 4  # 4拍一小节
        if in_bar == 0:
            beat_type = "强"
        else:
            beat_type = "弱"
        beats.append({
            "time": round(t, 3),
            "ts": format_ts(t),
            "type": beat_type,
            "beat": beat_index + 1,
            "bar": beat_index // 4 + 1,
            "in_bar": in_bar + 1,
        })
        t += beat_interval
        beat_index += 1

    # 插入段落卡点
    if segments:
        for seg in segments:
            seg_t = seg.get("t")
            label = seg.get("label", "")
            if seg_t is None or seg_t < 0 or seg_t > duration:
                continue
            # 检查是否与已有拍点重合（容差0.05秒）
            overlap = any(abs(b["time"] - seg_t) < 0.05 for b in beats)
            beats.append({
                "time": round(seg_t, 3),
                "ts": format_ts(seg_t),
                "type": "段落",
                "beat": "-",
                "bar": "-",
                "in_bar": "-",
                "label": label,
            })

    # 按时间排序
    beats.sort(key=lambda b: b["time"])
    return beats


def print_beats(beats, duration, bpm):
    """打印卡点表。"""
    print(f"视频时长：{duration}s | BPM：{bpm} | 拍间隔：{60/bpm:.3f}s | 共 {len(beats)} 个卡点")
    print(f"{'时间戳':<14}{'类型':<8}{'拍号':<6}{'小节':<6}{'小节内':<8}{'标签'}")
    print("-" * 50)
    for b in beats:
        label = b.get("label", "")
        print(f"{b['ts']:<14}{b['type']:<8}{str(b['beat']):<6}{str(b['bar']):<6}{str(b['in_bar']):<8}{label}")

    # 剪映导入提示
    strong = [b for b in beats if b["type"] in ("强", "段落")]
    print(f"\n强卡点（每4拍/段落切换）共 {len(strong)} 个，建议用于画面定格/转场：")
    for b in strong:
        print(f"  {b['ts']}  {b['type']}{(' - ' + b.get('label','')) if b.get('label') else ''}")


def main():
    parser = argparse.ArgumentParser(description="短视频卡点时间戳生成器")
    parser.add_argument("--duration", type=float, required=True, help="视频时长(秒)")
    parser.add_argument("--bpm", type=float, required=True, help="目标 BPM")
    parser.add_argument("--segments", help='段落标记 JSON，如 [{"t":15,"label":"转折"}]')
    parser.add_argument("--out", help="输出 CSV 文件路径，缺省打印到 stdout")
    args = parser.parse_args()

    segments = None
    if args.segments:
        try:
            segments = json.loads(args.segments)
        except json.JSONDecodeError as e:
            print(f"段落标记 JSON 解析失败：{e}", file=sys.stderr)
            sys.exit(1)

    beats = generate_beats(args.duration, args.bpm, segments)

    if args.out:
        import csv
        with open(args.out, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["时间戳", "类型", "拍号", "小节", "小节内", "标签"])
            for b in beats:
                writer.writerow([b["ts"], b["type"], b["beat"], b["bar"], b["in_bar"], b.get("label", "")])
        print(f"卡点表已写入 {args.out}，共 {len(beats)} 个卡点", file=sys.stderr)
    else:
        print_beats(beats, args.duration, args.bpm)


if __name__ == "__main__":
    main()
