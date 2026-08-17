#!/usr/bin/env python3
"""Fail-closed mechanical audit for the shared GEN-THINK review package."""

from __future__ import annotations

import hashlib
import json
import struct
import subprocess
import sys
from pathlib import Path


SHARED_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[5]
REVIEW_PATH = SHARED_ROOT / "schema/gen-think-review-v01.json"
OVERLAY_PATH = SHARED_ROOT / "schema/gen-think-visual-overlay-v01.json"
PRODUCTION_PATH = SHARED_ROOT / "schema/gen-think-production-v01.json"

EXPECTED = {
    "GEN-THINK-master-v04": (
        "assets/image/gen-think-master-v04.png",
        "d3a3f7a146cb44eb4aa571bf73e7cc80c8bf0492dc35ac3c41fc3425b6595093",
    ),
    "GEN-THINK-action-01-v01": (
        "assets/image/gen-think-action-01-v01.png",
        "fa3f9551d627597de601cc22bf0744f4afb91526c9b28f9036de258f9baff505",
    ),
    "GEN-THINK-action-02-v02": (
        "assets/image/gen-think-action-02-v02.png",
        "8febdc5675db8950ac94744b30c5079a7483877ffe88dfc40aa385240808fca4",
    ),
    "GEN-THINK-action-03-v01": (
        "assets/image/gen-think-action-03-v01.png",
        "fb5c85763ff5f81de0b3edfc5a9f0473f3b4601895503fde7d85d2fbca161030",
    ),
    "GEN-THINK-action-04-v01": (
        "assets/image/gen-think-action-04-v01.png",
        "27935232ce09f71d881f7436653d2df331e2fb44c0487ccf5c9606400bc07f26",
    ),
}

EXPECTED_DERIVATIVES = {
    "GEN-THINK-master-v04": (
        "assets/image/gen-think-master-v04-1920x1080-v01.png",
        "e3d84b7867bf0899c2929578068eb3a3397b9aff75814f250e4b96732f94375a",
    ),
    "GEN-THINK-action-01-v01": (
        "assets/image/gen-think-action-01-v01-1920x1080-v01.png",
        "6053d1dbc618372f35b6943eaf44e4134a43e043fddbbf39d3621148ad7ca946",
    ),
    "GEN-THINK-action-02-v02": (
        "assets/image/gen-think-action-02-v02-1920x1080-v01.png",
        "a16568c5def1c96b8789efc4d7fbec697271457451dc266c2c5357943f90ba13",
    ),
    "GEN-THINK-action-03-v01": (
        "assets/image/gen-think-action-03-v01-1920x1080-v01.png",
        "bd21a0852c2dae937db2486681a9aa24644403dc0a04926dccbbbc4097cd2664",
    ),
    "GEN-THINK-action-04-v01": (
        "assets/image/gen-think-action-04-v01-1920x1080-v01.png",
        "6762b39d7c4157cb201c8cd1f1277fd852a2aa54fefa319e7d780e64dccf44f3",
    ),
}

LOOP_ORDER = [
    "GEN-THINK-master-v04",
    "GEN-THINK-action-01-v01",
    "GEN-THINK-action-02-v02",
    "GEN-THINK-action-03-v01",
    "GEN-THINK-action-04-v01",
    "GEN-THINK-master-v04",
]


def fail(message: str) -> None:
    raise AssertionError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        fail(f"not a valid PNG header: {path}")
    return struct.unpack(">II", header[16:24])


def load_unique_json(path: Path) -> dict:
    def no_duplicates(pairs: list[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            if key in result:
                fail(f"duplicate JSON key {key!r} in {path}")
            result[key] = value
        return result

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=no_duplicates)


def repo_path(relative: str) -> Path:
    path = (REPO_ROOT / relative).resolve()
    try:
        path.relative_to(REPO_ROOT)
    except ValueError as exc:
        fail(f"path escapes repository: {relative}")
        raise exc
    return path


def main() -> int:
    review = load_unique_json(REVIEW_PATH)
    overlay = load_unique_json(OVERLAY_PATH)
    production = load_unique_json(PRODUCTION_PATH)

    if review.get("status") != "approved_exact_bytes":
        fail("review status is not approved_exact_bytes")
    if review.get("current_asset_id") is not None:
        fail("current_asset_id must be null for batch review")
    approval = review.get("approval") or {}
    if approval.get("status") != "approved" or approval.get("decision_message") != "批准 GEN-THINK 五图":
        fail("exact-byte approval evidence is missing")
    if approval.get("topic3_visual_batch_approved") is not False:
        fail("approval scope must explicitly exclude the topic3 visual batch")
    if review.get("derivatives_blocked_until_exact_byte_approval") is not False:
        fail("derivative gate did not unlock after exact-byte approval")
    if review.get("loop_contract", {}).get("state_order") != LOOP_ORDER:
        fail("loop order does not match the approved five-state contract")
    loop_contract = review.get("loop_contract", {})
    if loop_contract.get("render_mode") != "watercolor_bloom_every_boundary_v1":
        fail("loop render mode is not watercolor_bloom_every_boundary_v1")
    if (
        loop_contract.get("transition_kind") != "watercolor-bloom"
        or loop_contract.get("transition_duration_seconds") != 0.6
    ):
        fail("loop watercolor transition contract is incomplete")

    queue = review.get("queue", [])
    if len(queue) != len(EXPECTED):
        fail(f"expected {len(EXPECTED)} active assets, found {len(queue)}")
    queue_by_id = {item.get("asset_id"): item for item in queue}
    if set(queue_by_id) != set(EXPECTED):
        fail("active asset IDs do not match the five expected approval objects")

    master_checksum = EXPECTED["GEN-THINK-master-v04"][1]
    for asset_id, (relative_to_shared, expected_checksum) in EXPECTED.items():
        item = queue_by_id[asset_id]
        expected_repo_relative = f"leverage-video/src/shared/gen-think/{relative_to_shared}"
        if item.get("path") != expected_repo_relative:
            fail(f"unexpected path for {asset_id}: {item.get('path')}")
        path = repo_path(expected_repo_relative)
        if not path.is_file() or path.is_symlink():
            fail(f"asset must be a real regular file: {path}")
        actual_checksum = sha256(path)
        if actual_checksum != expected_checksum or item.get("checksum_sha256") != expected_checksum:
            fail(f"checksum mismatch for {asset_id}")
        dimensions = png_dimensions(path)
        if dimensions != (1672, 940) or item.get("measured_dimensions") != [1672, 940]:
            fail(f"dimension mismatch for {asset_id}: {dimensions}")
        ratio_error = abs((dimensions[0] / dimensions[1]) / (16 / 9) - 1)
        if ratio_error > 0.005:
            fail(f"aspect-ratio error exceeds 0.5% for {asset_id}: {ratio_error}")
        if item.get("status") != "approved":
            fail(f"unexpected queue status for {asset_id}")
        if item.get("presented_checksum_sha256") != expected_checksum:
            fail(f"presented checksum is missing or mismatched for {asset_id}")
        if item.get("approved_checksum_sha256") != expected_checksum:
            fail(f"approved checksum is missing or mismatched for {asset_id}")
        prompt = repo_path(item["prompt_path"])
        if not prompt.is_file() or sha256(prompt) != item.get("prompt_checksum_sha256"):
            fail(f"prompt checksum mismatch for {asset_id}")
        if "16:9 landscape composition" not in prompt.read_text(encoding="utf-8"):
            fail(f"prompt lacks exact aspect-ratio phrase for {asset_id}")
        if asset_id != "GEN-THINK-master-v04":
            if item.get("master_input_checksum_sha256") != master_checksum:
                fail(f"action does not reference immutable master-v04: {asset_id}")

    canonical = Path(review["input_fingerprints"]["canonical_identity_path"])
    if not canonical.is_file() or canonical.is_symlink():
        fail("canonical identity is missing, a symlink, or not a regular file")
    if sha256(canonical) != review["input_fingerprints"]["canonical_identity_checksum_sha256"]:
        fail("canonical identity checksum mismatch")

    presentation = review.get("batch_presentation") or {}
    review_doc = repo_path(presentation.get("review_document_path", ""))
    contact_sheet = repo_path(presentation.get("contact_sheet_path", ""))
    if not review_doc.is_file() or sha256(review_doc) != presentation.get("review_document_checksum_sha256"):
        fail("review document checksum mismatch")
    if not contact_sheet.is_file() or sha256(contact_sheet) != presentation.get("contact_sheet_checksum_sha256"):
        fail("contact sheet checksum mismatch")
    if presentation.get("approval_object_count") != 5:
        fail("approval object count must be 5")

    if overlay.get("status") != "shared_loop_ready_no_consumers_selected" or overlay.get("consumers") != []:
        fail("shared overlay must leave consumer selection to the user")
    production_checksum = sha256(PRODUCTION_PATH)
    if overlay.get("production_manifest_checksum_sha256") != production_checksum:
        fail("overlay production-manifest checksum mismatch")
    if review.get("family_qa", {}).get("production_manifest_checksum_sha256") != production_checksum:
        fail("review production-manifest checksum mismatch")
    if production.get("status") != "shared_loop_ready_no_consumers_selected":
        fail("production manifest is not in shared-loop-ready state")
    if production.get("consumers") != [] or production.get("consumer_selection_owner") != "user":
        fail("production manifest must not select consumer shots")
    documentation = repo_path(production.get("documentation_path", ""))
    if not documentation.is_file() or sha256(documentation) != production.get("documentation_checksum_sha256"):
        fail("production documentation checksum mismatch")

    production_states = {item.get("asset_id"): item for item in production.get("states", [])}
    if set(production_states) != set(EXPECTED_DERIVATIVES):
        fail("production state IDs do not match the five approved sources")
    for asset_id, (relative_to_shared, expected_checksum) in EXPECTED_DERIVATIVES.items():
        item = production_states[asset_id]
        expected_repo_relative = f"leverage-video/src/shared/gen-think/{relative_to_shared}"
        if item.get("derivative_path") != expected_repo_relative:
            fail(f"unexpected derivative path for {asset_id}")
        path = repo_path(expected_repo_relative)
        if not path.is_file() or path.is_symlink():
            fail(f"derivative must be a real regular file: {path}")
        if sha256(path) != expected_checksum or item.get("derivative_checksum_sha256") != expected_checksum:
            fail(f"derivative checksum mismatch for {asset_id}")
        if png_dimensions(path) != (1920, 1080) or item.get("derivative_dimensions") != [1920, 1080]:
            fail(f"derivative dimensions mismatch for {asset_id}")

    component = production.get("component") or {}
    component_files = [
        ("entry_path", "entry_checksum_sha256"),
        ("root_path", "root_checksum_sha256"),
        ("component_path", "component_checksum_sha256"),
        ("timing_path", "timing_checksum_sha256"),
        ("timing_test_path", "timing_test_checksum_sha256"),
        ("watercolor_transition_test_path", "watercolor_transition_test_checksum_sha256"),
    ]
    for path_key, checksum_key in component_files:
        path = repo_path(component.get(path_key, ""))
        if not path.is_file() or sha256(path) != component.get(checksum_key):
            fail(f"component artifact mismatch: {path_key}")
    if component.get("render_mode") != "watercolor_bloom_every_boundary_v1":
        fail("component render mode is not watercolor_bloom_every_boundary_v1")
    transition = component.get("transition_contract") or {}
    if (
        transition.get("rule_id") != "intra-shot-watercolor-bloom-v1"
        or transition.get("kind") != "watercolor-bloom"
        or transition.get("duration_seconds") != 0.6
        or transition.get("duration_in_frames_at_30_fps") != 18
        or transition.get("renderer") != "leverage-video/src/shared/watercolor-bloom"
        or transition.get("first_occurrence") != "direct_full_image_no_transition"
        or transition.get("pigment_policy") != "warm_reference_three_palette_v1"
        or transition.get("visible_neutral_pigment") != "forbidden"
        or transition.get("radiating_tendrils") != "forbidden_removed_from_mask_and_visible_layers"
    ):
        fail("shared watercolor transition contract is incomplete")
    if transition.get("warm_palettes") != [
        ["#F3C95F", "#E7A83E", "#C88442"],
        ["#F2BD6B", "#E99655", "#C87145"],
        ["#EFCF70", "#E9A648", "#D67A4A"],
    ]:
        fail("shared watercolor warm palettes are incomplete or reordered")
    renderer_source = repo_path(transition.get("renderer_source_path", ""))
    if (
        not renderer_source.is_file()
        or sha256(renderer_source) != transition.get("renderer_source_checksum_sha256")
    ):
        fail("shared watercolor renderer source checksum mismatch")
    if component.get("minimum_duration_in_frames") != 5:
        fail("component minimum duration must be 5 frames")

    preview = production.get("preview") or {}
    preview_path = repo_path(preview.get("path", ""))
    if not preview_path.is_file() or preview_path.is_symlink():
        fail("preview must be a real regular file")
    if sha256(preview_path) != preview.get("checksum_sha256"):
        fail("preview checksum mismatch")
    probe = subprocess.run(
        [
            "/opt/homebrew/bin/ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(preview_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    metadata = json.loads(probe.stdout)
    streams = metadata.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    if len(videos) != 1 or len(streams) != 1:
        fail("preview must contain exactly one video stream and no audio/subtitle streams")
    video = videos[0]
    if (
        video.get("codec_name") != "h264"
        or [video.get("width"), video.get("height")] != [1920, 1080]
        or video.get("r_frame_rate") != "30/1"
        or video.get("nb_frames") != "300"
        or float(metadata.get("format", {}).get("duration", 0)) != 10.0
    ):
        fail("preview technical metadata does not match the locked 10-second output")

    for path_key, checksum_key in [
        ("contact_sheet_path", "contact_sheet_checksum_sha256"),
        ("first_frame_still_path", "first_frame_still_checksum_sha256"),
        ("transition_midpoint_still_path", "transition_midpoint_still_checksum_sha256"),
    ]:
        path = repo_path(preview.get(path_key, ""))
        if not path.is_file() or sha256(path) != preview.get(checksum_key) or png_dimensions(path) != (1920, 1080):
            fail(f"preview QA raster mismatch: {path_key}")
    duration_test = preview.get("non_divisible_duration_test") or {}
    duration_test_path = repo_path(duration_test.get("still_path", ""))
    if (
        duration_test.get("duration_in_frames") != 451
        or duration_test.get("rendered_frame") != 450
        or not duration_test_path.is_file()
        or sha256(duration_test_path) != duration_test.get("still_checksum_sha256")
        or png_dimensions(duration_test_path) != (1920, 1080)
    ):
        fail("451-frame non-divisible-duration render evidence mismatch")
    determinism = preview.get("determinism_check") or {}
    if (
        determinism.get("frame") != 39
        or determinism.get("repeat_count") != 2
        or determinism.get("result") != "pass_identical_bytes"
        or determinism.get("matching_checksum_sha256")
        != "faad2a6a73cd08d0a5b716734cc7e6cffcb64e5315588c81edb3bae546c462d1"
    ):
        fail("frame-39 deterministic rerender evidence mismatch")

    leaked = list((REPO_ROOT / "leverage-video/src/topic3").rglob("gen-think*"))
    if leaked:
        fail("GEN-THINK files leaked into topic3: " + ", ".join(str(path) for path in leaked))

    print("PASS GEN-THINK shared package")
    print("approved exact-byte sources: 5/5")
    print("composition derivatives: 5/5 at 1920x1080")
    print("loop: master-v04 -> action-01-v01 -> action-02-v02 -> action-03-v01 -> action-04-v01 -> master-v04")
    print("internal transitions: intra-shot-watercolor-bloom-v1, 0.6s / 18 frames at 30fps; no radiating tendrils; first state fully visible")
    print("consumer mappings: 0 (reserved for user decision)")
    print("preview: 1920x1080, H.264, 30fps, 300 frames, 10.0s, no audio/subtitles")
    print("topic3 pending visual batch: explicitly not approved")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, TypeError, ValueError) as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        raise SystemExit(1)
