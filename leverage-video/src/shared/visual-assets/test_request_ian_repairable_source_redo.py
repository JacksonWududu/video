from __future__ import annotations

import argparse
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
REDO_PATH = SCRIPT_DIR / "request-ian-repairable-source-redo.py"
FAILURE_PATH = SCRIPT_DIR / "record-image-generation-qa-failure.py"
GATE_PATH = SCRIPT_DIR.parents[3] / ".agents/skills/run-knowledge-video/scripts/validate_visual_approval_state.py"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_png(path: Path, color: int) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))
    rows = (b"\x00" + bytes((color, 220, 200)) * 16) * 9
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 9, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    )


class IanRepairableSourceRedoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.failure = load_module(FAILURE_PATH, "ian_redo_failure_fixture")
        cls.gate = load_module(GATE_PATH, "ian_redo_real_visual_gate")

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir=SCRIPT_DIR)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.workspace = self.root / "episode"
        (self.workspace / "schema").mkdir(parents=True)
        (self.workspace / "assets/image").mkdir(parents=True)
        self.state_file = self.workspace / "schema/episode-state.json"
        self.request_file = self.workspace / "schema/redo-request.json"
        self.asset_id = "S01-ian-v01"
        self.scope_id = "S01:standalone-graphic"

    def _write_json(self, path: Path, value: dict) -> None:
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def _binding(self, path: Path) -> dict:
        return {
            "path": path.relative_to(self.root).as_posix(),
            "checksum_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }

    def _fixture(self, prior_count: int = 0) -> tuple[dict, dict, dict]:
        item = {
            "asset_id": self.asset_id, "shot_id": "S01", "role": "standalone-graphic",
            "status": "pending_generation", "active_for_current_storyboard": True,
            "visual_generation_route": "ian-handdrawn-ppt", "white_cat_present": False,
            "generation_attempt_scope_id": self.scope_id,
        }
        review = {
            "contract_version": "visual-asset-review-v3", "mode": "one_click_final_review_v1",
            "queue_generation_allowed": True, "current_asset_id": self.asset_id, "queue": [item],
        }
        state = {
            "episode_id": "synthetic-ian-redo", "phase": "visual_production",
            "current_phase": "visual_production", "visual_asset_review": review,
        }
        for index in range(1, prior_count + 2):
            prompt = self.workspace / f"assets/image/prompt-{index}.txt"
            output = self.workspace / f"assets/image/output-{index}.png"
            prompt.write_text(f"Synthetic Ian complete master {index}.\n", encoding="utf-8")
            write_png(output, index * 40)
            failure = {
                "prompt": self._binding(prompt), "output": self._binding(output),
                "failure_reason": (
                    "IAN_ZONE_GEOMETRY: intact separated groups miss the approved zones"
                    if index == prior_count + 1 else "visible pseudo-text rejected"
                ),
                "qa_time": f"2026-09-05T10:00:0{index}+08:00",
            }
            self.failure.apply_failure_control(item, review, failure)
        self._write_json(self.state_file, state)
        finding = item["image_generation_repairable_findings"][-1]
        request = {
            "contract_version": "ian-repairable-source-redo-request-v1",
            "asset_id": self.asset_id, "generation_attempt_scope_id": self.scope_id,
            "exact_user_message": "太丑了， 换一个", "decided_at": "2026-09-05T10:01:00+08:00",
            "prompt": copy.deepcopy(finding["prompt"]), "output": copy.deepcopy(finding["output"]),
        }
        self._write_json(self.request_file, request)
        return state, item, request

    def _request_redo(self):
        module = load_module(REDO_PATH, "ian_repairable_source_redo_under_test")
        module.REPOSITORY_ROOT = self.root
        return module.request_redo(argparse.Namespace(
            episode_workspace="episode", asset_id=self.asset_id,
            request_path=self.request_file.relative_to(self.root).as_posix(),
        ))

    def _assert_rejected_without_writes(self) -> None:
        def snapshot() -> dict:
            return {
                path.relative_to(self.root).as_posix(): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()
            }
        before = snapshot()
        with self.assertRaises(ValueError):
            self._request_redo()
        self.assertEqual(snapshot(), before)

    def test_user_rejects_repairable_source_once_and_real_gate_allows_redo(self) -> None:
        state, original, request = self._fixture()
        with self.assertRaises(ValueError):
            self.gate.require_generation_allowed(state, self.asset_id)
        original_findings = copy.deepcopy(original["image_generation_repairable_findings"])
        source_paths = [self.root / request[key]["path"] for key in ("prompt", "output")]
        source_bytes = [path.read_bytes() for path in source_paths]

        result = self._request_redo()

        recorded = json.loads(self.state_file.read_text(encoding="utf-8"))
        item = recorded["visual_asset_review"]["queue"][0]
        self.assertEqual(result["result"], "redo_allowed")
        self.assertEqual(result["generation_gate"], {"result": "pass", "asset_id": self.asset_id})
        self.assertIs(self.gate.require_generation_allowed(recorded, self.asset_id), item)
        self.assertEqual(item["image_generation_attempt_control"]["rejected_generation_count"], 1)
        self.assertEqual(item["generation_attempt_scope_id"], self.scope_id)
        self.assertEqual(item["image_generation_repairable_findings"], original_findings)
        self.assertEqual(item["ian_layout_repair_disposition"]["status"], "source_rejected_by_user")
        self.assertEqual(len(item["image_generation_qa_failures"]), 1)
        self.assertEqual(item["image_generation_qa_failures"][0]["output"], request["output"])
        self.assertEqual(item["image_generation_qa_failures"][0]["failure_reason"],
                         "USER_AESTHETIC_REJECTION: " + request["exact_user_message"])
        self.assertIn(request["exact_user_message"], json.dumps(recorded, ensure_ascii=False))
        self.assertEqual([path.read_bytes() for path in source_paths], source_bytes)
        self.assertFalse(recorded["visual_asset_review"].get("ian_layout_repair_required", False))
        self.assertNotIn("approved_checksum_sha256", item)

    def test_next_geometry_finding_counts_distinct_generated_outputs_after_user_redo(self) -> None:
        _, original, _ = self._fixture()
        original_finding = copy.deepcopy(original["image_generation_repairable_findings"][0])
        self._request_redo()
        state = json.loads(self.state_file.read_text(encoding="utf-8"))
        review = state["visual_asset_review"]
        item = review["queue"][0]
        prompt = self.workspace / "assets/image/prompt-next.txt"
        output = self.workspace / "assets/image/output-next.png"
        prompt.write_text("Synthetic new Ian complete master after user rejection.\n", encoding="utf-8")
        write_png(output, 120)

        control = self.failure.apply_failure_control(item, review, {
            "prompt": self._binding(prompt), "output": self._binding(output),
            "failure_reason": "IAN_ZONE_GEOMETRY: new intact separated groups miss the approved zones",
            "qa_time": "2026-09-05T10:02:00+08:00",
        })

        finding = item["image_generation_repairable_findings"][-1]
        self.assertEqual(finding["generation_output_number"], 2)
        self.assertEqual(finding["attempt_number"], 2)
        self.assertEqual(control["rejected_generation_count"], 1)
        self.assertEqual(item["image_generation_repairable_findings"][0], original_finding)

    def test_third_counted_rejection_preserves_history_and_real_gate_stays_blocked(self) -> None:
        _, original, request = self._fixture(prior_count=2)
        original_failures = copy.deepcopy(original["image_generation_qa_failures"])
        original_findings = copy.deepcopy(original["image_generation_repairable_findings"])

        result = self._request_redo()

        recorded = json.loads(self.state_file.read_text(encoding="utf-8"))
        review = recorded["visual_asset_review"]
        item = review["queue"][0]
        control = item["image_generation_attempt_control"]
        self.assertEqual(result["result"], "stopped_user_takeover_required")
        self.assertEqual(control["rejected_generation_count"], 3)
        self.assertEqual(control["automatic_retry_status"], "stopped_user_takeover_required")
        self.assertEqual(control["generation_attempt_scope_id"], self.scope_id)
        self.assertEqual(control["maximum_automatic_rejected_generations"], 3)
        self.assertEqual(item["image_generation_qa_failures"][:2], original_failures)
        self.assertEqual(len(item["image_generation_qa_failures"]), 3)
        self.assertEqual(item["image_generation_qa_failures"][-1]["output"], request["output"])
        self.assertEqual(item["image_generation_repairable_findings"], original_findings)
        self.assertTrue(review["user_takeover_required"])
        self.assertFalse(review["queue_generation_allowed"])
        self.assertEqual(recorded["current_phase"], "awaiting_visual_asset_review")
        self.assertEqual(recorded["blockers"][-1]["generation_attempt_scope_id"], self.scope_id)
        with self.assertRaises(ValueError) as blocked:
            self.gate.require_generation_allowed(recorded, self.asset_id)
        self.assertEqual(result["generation_gate"], {"result": "blocked", "error": str(blocked.exception)})

    def test_repeated_request_cannot_count_source_twice_or_write_state(self) -> None:
        self._fixture()
        self._request_redo()
        self._assert_rejected_without_writes()

    def test_invalid_redo_requests_and_sources_leave_all_files_unchanged(self) -> None:
        cases = (
            "wrong_scope", "wrong_control_scope", "wrong_asset", "wrong_prompt_hash", "wrong_output_hash",
            "changed_prompt_bytes", "changed_output_bytes", "different_output_path", "not_current", "earlier_unapproved",
            "earlier_unapproved_at_third",
            "inactive", "non_ian", "duplicate_active", "wrong_repair_source", "wrong_repair_status",
            "extra_request_key", "criticism_only", "continue_only", "negative_redo", "cancel_redo", "stop_redo",
            "missing_time_offset",
        )
        for case in cases:
            with self.subTest(case=case):
                state, item, request = self._fixture(prior_count=2 if case == "earlier_unapproved_at_third" else 0)
                if case == "wrong_scope":
                    request["generation_attempt_scope_id"] = "S99:standalone-graphic"
                elif case == "wrong_control_scope":
                    item["image_generation_attempt_control"]["generation_attempt_scope_id"] = "S99:standalone-graphic"
                elif case == "wrong_asset":
                    request["asset_id"] = "S99-ian-v01"
                elif case == "wrong_prompt_hash":
                    request["prompt"]["checksum_sha256"] = "f" * 64
                elif case == "wrong_output_hash":
                    request["output"]["checksum_sha256"] = "f" * 64
                elif case in {"changed_prompt_bytes", "changed_output_bytes"}:
                    binding = request["prompt" if case == "changed_prompt_bytes" else "output"]
                    path = self.root / binding["path"]
                    path.write_bytes(path.read_bytes() + b"changed")
                elif case == "different_output_path":
                    original = self.root / request["output"]["path"]
                    alternate = original.with_name("substituted.png")
                    alternate.write_bytes(original.read_bytes())
                    request["output"] = self._binding(alternate)
                elif case == "not_current":
                    state["visual_asset_review"]["current_asset_id"] = "S99-ian-v01"
                elif case in {"earlier_unapproved", "earlier_unapproved_at_third"}:
                    earlier = copy.deepcopy(item)
                    earlier.update(asset_id="S00-ian-v01", shot_id="S00")
                    state["visual_asset_review"]["queue"].insert(0, earlier)
                elif case == "inactive":
                    item["active_for_current_storyboard"] = False
                elif case == "non_ian":
                    item["visual_generation_route"] = "imagegen"
                elif case == "duplicate_active":
                    state["visual_asset_review"]["queue"].append(copy.deepcopy(item))
                elif case == "wrong_repair_source":
                    item["ian_layout_repair_disposition"]["source_finding"] = copy.deepcopy(
                        item["ian_layout_repair_disposition"]["source_finding"],
                    )
                    item["ian_layout_repair_disposition"]["source_finding"]["output"]["checksum_sha256"] = "f" * 64
                elif case == "wrong_repair_status":
                    item["ian_layout_repair_disposition"]["status"] = "repaired"
                elif case == "extra_request_key":
                    request["bypass_gate"] = True
                elif case in {"criticism_only", "continue_only", "negative_redo", "cancel_redo", "stop_redo"}:
                    request["exact_user_message"] = {
                        "criticism_only": "太丑了", "continue_only": "继续", "negative_redo": "不要重做",
                        "cancel_redo": "取消重做", "stop_redo": "停止重新生成",
                    }[case]
                elif case == "missing_time_offset":
                    request["decided_at"] = "2026-09-05T10:01:00"
                self._write_json(self.state_file, state)
                self._write_json(self.request_file, request)
                self._assert_rejected_without_writes()


if __name__ == "__main__":
    unittest.main()
