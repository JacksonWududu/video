#!/usr/bin/env python3
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib


SCRIPT_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = SCRIPT_DIR.parents[3]
STRICT_PATH = SCRIPT_DIR / "record-generated-imagegen-strict.py"
SCHEMA_PATH = SCRIPT_DIR / "schemas/white-cat-anatomy-qa-v2.schema.json"


def load_recorder():
    spec = importlib.util.spec_from_file_location("white_cat_anatomy_recorder", STRICT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load strict ImageGen recorder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_png(
    path: Path,
    width: int = 16,
    height: int = 9,
    rgb: tuple[int, int, int] = (255, 255, 255),
) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    pixel = bytes(rgb)
    rows = b"".join(b"\x00" + pixel * width for _ in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid_anatomy(source_path: str, source_checksum: str, map_path: str, map_checksum: str) -> dict:
    traces = []
    for index, trace_id in enumerate(("F1", "F2", "H1", "H2"), start=1):
        fore = trace_id.startswith("F")
        paw_bbox = [0.1 * index, 0.6, 0.05, 0.08]
        anchor = [0.45 + 0.05 * index, 0.5]
        traces.append({
            "id": trace_id,
            "class": "forelimb" if fore else "hindlimb",
            "paw_region_id": f"P{index}",
            "paw_bbox_normalized": paw_bbox,
            "paw_visible": True,
            "continuous_to_torso": True,
            "torso_anchor": "shoulder" if fore else "hip",
            "torso_anchor_point_normalized": anchor,
            "trace_polyline_normalized": [
                [paw_bbox[0] + 0.02, 0.65],
                [0.3 + 0.05 * index, 0.58],
                anchor,
            ],
            "occlusion_status": "none",
        })
    return {
        "contract_version": "white-cat-anatomy-qa-v2",
        "result": "pass",
        "source_image": {"path": source_path, "checksum_sha256": source_checksum},
        "canvas": {"width": 16, "height": 9},
        "limb_traces": traces,
        "forward_trace_ids": ["F1", "F2", "H1", "H2"],
        "reverse_trace_ids": ["F1", "F2", "H1", "H2"],
        "unassigned_paw_like_shapes": 0,
        "ambiguous_limb_regions": 0,
        "branched_or_fused_limb_regions": 0,
        "inspection_evidence": {
            "methods": ["full_resolution", "numbered_limb_map"],
            "numbered_limb_map_path": map_path,
            "numbered_limb_map_checksum_sha256": map_checksum,
            "numbered_limb_map_source_checksum_sha256": source_checksum,
            "numbered_limb_map_limb_ids": ["F1", "F2", "H1", "H2"],
        },
    }


class WhiteCatAnatomyQaV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.recorder = load_recorder()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir=SCRIPT_DIR)
        directory = Path(self.temporary.name)
        self.source = directory / "source.png"
        self.numbered = directory / "numbered.png"
        write_png(self.source)
        write_png(self.numbered, rgb=(255, 0, 0))
        self.source_relative = self.source.relative_to(REPOSITORY_ROOT).as_posix()
        self.numbered_relative = self.numbered.relative_to(REPOSITORY_ROOT).as_posix()
        self.source_binding = {
            "path": self.source_relative,
            "checksum_sha256": checksum(self.source),
        }
        self.anatomy = valid_anatomy(
            self.source_relative,
            checksum(self.source),
            self.numbered_relative,
            checksum(self.numbered),
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def validate(self, anatomy: dict) -> None:
        self.recorder.validate_white_cat_anatomy_qa_v2(
            anatomy,
            selected_source=self.source_binding,
            selected_source_file=self.source,
        )

    def test_complete_four_limb_evidence_passes(self) -> None:
        self.validate(self.anatomy)

    def test_machine_readable_v2_schema_is_unique_and_requires_provenance(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(schema["$id"], "white-cat-anatomy-qa-v2.schema.json")
        self.assertEqual(
            schema["properties"]["contract_version"]["const"],
            "white-cat-anatomy-qa-v2",
        )
        required = schema["properties"]["inspection_evidence"]["required"]
        self.assertIn("numbered_limb_map_source_checksum_sha256", required)
        self.assertIn("numbered_limb_map_limb_ids", required)

    def test_third_forelimb_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        extra = copy.deepcopy(anatomy["limb_traces"][0])
        extra.update(id="F3", paw_region_id="P5")
        anatomy["limb_traces"].append(extra)
        with self.assertRaisesRegex(ValueError, "P0_FORELIMB_COUNT"):
            self.validate(anatomy)

    def test_third_hindlimb_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        extra = copy.deepcopy(anatomy["limb_traces"][2])
        extra.update(id="H3", paw_region_id="P5")
        anatomy["limb_traces"].append(extra)
        with self.assertRaisesRegex(ValueError, "P0_HINDLIMB_COUNT"):
            self.validate(anatomy)

    def test_duplicate_paw_region_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["limb_traces"][1]["paw_region_id"] = "P1"
        with self.assertRaisesRegex(ValueError, "P0_PAW_COUNT"):
            self.validate(anatomy)

    def test_wrong_torso_anchor_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["limb_traces"][1]["torso_anchor"] = "hip"
        with self.assertRaisesRegex(ValueError, "P0_AMBIGUOUS_TRACE"):
            self.validate(anatomy)

    def test_shared_torso_outlet_fails_as_branch(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        shared = anatomy["limb_traces"][0]["torso_anchor_point_normalized"]
        anatomy["limb_traces"][1]["torso_anchor_point_normalized"] = shared
        anatomy["limb_traces"][1]["trace_polyline_normalized"][-1] = shared
        with self.assertRaisesRegex(ValueError, "P0_BRANCH_OR_FUSION"):
            self.validate(anatomy)

    def test_self_reported_branch_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["branched_or_fused_limb_regions"] = 1
        with self.assertRaisesRegex(ValueError, "P0_BRANCH_OR_FUSION"):
            self.validate(anatomy)

    def test_polyline_must_bind_paw_and_anchor(self) -> None:
        for field, value in (
            ("start", [0.99, 0.99]),
            ("end", [0.99, 0.99]),
        ):
            with self.subTest(field=field):
                anatomy = copy.deepcopy(self.anatomy)
                index = 0 if field == "start" else -1
                anatomy["limb_traces"][0]["trace_polyline_normalized"][index] = value
                with self.assertRaisesRegex(ValueError, "P0_AMBIGUOUS_TRACE"):
                    self.validate(anatomy)

    def test_non_finite_coordinate_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["limb_traces"][0]["trace_polyline_normalized"][1][0] = float("nan")
        with self.assertRaisesRegex(ValueError, "P0_AMBIGUOUS_TRACE"):
            self.validate(anatomy)

    def test_unassigned_paw_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["unassigned_paw_like_shapes"] = 1
        with self.assertRaisesRegex(ValueError, "P0_UNASSIGNED_PAW"):
            self.validate(anatomy)

    def test_ambiguous_trace_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["limb_traces"][1]["continuous_to_torso"] = False
        with self.assertRaisesRegex(ValueError, "P0_AMBIGUOUS_TRACE"):
            self.validate(anatomy)

    def test_forward_reverse_mismatch_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["reverse_trace_ids"] = ["F1", "F2", "H1", "H3"]
        with self.assertRaisesRegex(ValueError, "P0_FORWARD_REVERSE_MISMATCH"):
            self.validate(anatomy)

    def test_stale_numbered_map_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["inspection_evidence"]["numbered_limb_map_checksum_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_numbered_map_must_bind_current_source(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["inspection_evidence"]["numbered_limb_map_source_checksum_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_source_image_cannot_be_its_own_numbered_map(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["inspection_evidence"].update(
            numbered_limb_map_path=self.source_relative,
            numbered_limb_map_checksum_sha256=checksum(self.source),
        )
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_numbered_map_dimension_mismatch_fails(self) -> None:
        write_png(self.numbered, width=32, height=18, rgb=(255, 0, 0))
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["inspection_evidence"]["numbered_limb_map_checksum_sha256"] = checksum(self.numbered)
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_truncated_numbered_map_fails_full_decode(self) -> None:
        self.numbered.write_bytes(self.numbered.read_bytes()[:24])
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["inspection_evidence"]["numbered_limb_map_checksum_sha256"] = checksum(self.numbered)
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_stale_source_binding_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        self.source_binding["checksum_sha256"] = "0" * 64
        anatomy["source_image"]["checksum_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_specific_limb_error_precedes_inconsistent_result(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        extra = copy.deepcopy(anatomy["limb_traces"][0])
        extra.update(id="F3", paw_region_id="P5")
        anatomy["limb_traces"].append(extra)
        anatomy["result"] = "fail"
        with self.assertRaisesRegex(ValueError, "P0_FORELIMB_COUNT"):
            self.validate(anatomy)

    def test_new_v1_anatomy_contract_fails(self) -> None:
        anatomy = copy.deepcopy(self.anatomy)
        anatomy["contract_version"] = "white-cat-anatomy-qa-v1"
        with self.assertRaisesRegex(ValueError, "P0_EVIDENCE_STALE"):
            self.validate(anatomy)

    def test_new_white_cat_recorders_require_v2(self) -> None:
        strict = STRICT_PATH.read_text(encoding="utf-8")
        action = (SCRIPT_DIR / "record-generated-imagegen-hybrid-qa.py").read_text(encoding="utf-8")
        self.assertIn("ordinary-imagegen-white-cat-master-qa-v2", strict)
        self.assertIn("WHITE_CAT_ACTION_QA_VERSION", action)
        self.assertNotIn('"ordinary-imagegen-white-cat-master-qa-v1"', strict)
        self.assertNotIn('"ordinary-imagegen-white-cat-action-qa-v1"', action)


if __name__ == "__main__":
    unittest.main()
