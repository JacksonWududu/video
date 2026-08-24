#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path
from types import SimpleNamespace
import unittest


SCRIPT_DIR = Path(__file__).resolve().parent
RECORDER_PATHS = (
    SCRIPT_DIR / "record-generated-xuan-strict.py",
    SCRIPT_DIR / "record-generated-xuan-hybrid-qa.py",
    SCRIPT_DIR / "record-generated-xuan-strict-action.py",
)


def load_recorder(path: Path):
    spec = importlib.util.spec_from_file_location(f"test_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class XuanWhiteCatAnatomyQaTests(unittest.TestCase):
    def test_white_cat_uses_shared_v2_helper_with_exact_normalized_binding(self) -> None:
        normalized = {
            "path": "episode/assets/image/normalized/final.png",
            "checksum_sha256": "a" * 64,
        }
        normalized_file = Path("/private/tmp/final.png")
        identity_qa = {"result": "pass", "anatomy_evidence": {}}

        for path in RECORDER_PATHS:
            with self.subTest(recorder=path.name):
                recorder = load_recorder(path)
                captured = {}

                def validate(identity, *, selected_source, selected_source_file):
                    captured.update(
                        identity=identity,
                        selected_source=selected_source,
                        selected_source_file=selected_source_file,
                    )

                recorder.load_white_cat_helpers = lambda: SimpleNamespace(
                    validate_white_cat_identity_qa_v2=validate
                )
                recorder.validate_white_cat_qa(
                    {"white_cat_present": True},
                    {"identity_qa": identity_qa},
                    normalized,
                    normalized_file,
                )

                self.assertIs(captured["identity"], identity_qa)
                self.assertIs(captured["selected_source"], normalized)
                self.assertIs(captured["selected_source_file"], normalized_file)

    def test_non_white_cat_does_not_load_or_require_white_cat_qa(self) -> None:
        for path in RECORDER_PATHS:
            with self.subTest(recorder=path.name):
                recorder = load_recorder(path)
                recorder.load_white_cat_helpers = lambda: self.fail(
                    "non-white-cat route loaded white-cat helper"
                )
                recorder.validate_white_cat_qa(
                    {"white_cat_present": False},
                    {},
                    {},
                    Path("/private/tmp/not-used.png"),
                )

    def test_specific_p0_failure_is_not_masked_by_identity_result(self) -> None:
        for path in RECORDER_PATHS:
            with self.subTest(recorder=path.name):
                recorder = load_recorder(path)

                def reject_p0(*_args, **_kwargs):
                    raise ValueError("P0_FORELIMB_COUNT: exact topology failure")

                recorder.load_white_cat_helpers = lambda: SimpleNamespace(
                    validate_white_cat_identity_qa_v2=reject_p0
                )
                with self.assertRaisesRegex(ValueError, "P0_FORELIMB_COUNT"):
                    recorder.validate_white_cat_qa(
                        {"white_cat_present": True},
                        {"identity_qa": {"result": "fail"}},
                        {"path": "final.png", "checksum_sha256": "a" * 64},
                        Path("/private/tmp/final.png"),
                    )

    def test_dynamic_shared_helper_surfaces_specific_p0(self) -> None:
        for path in RECORDER_PATHS:
            with self.subTest(recorder=path.name):
                recorder = load_recorder(path)
                with self.assertRaisesRegex(ValueError, "P0_FORELIMB_COUNT"):
                    recorder.validate_white_cat_qa(
                        {"white_cat_present": True},
                        {
                            "identity_qa": {
                                "result": "fail",
                                "cat_count": 1,
                                "foreleg_count": 3,
                                "hindleg_count": 2,
                                "paw_count": 5,
                            }
                        },
                        {"path": "final.png", "checksum_sha256": "a" * 64},
                        Path("/private/tmp/final.png"),
                    )

    def test_v2_validation_precedes_generic_checks_and_state_mutation(self) -> None:
        for path in RECORDER_PATHS:
            with self.subTest(recorder=path.name):
                source = inspect.getsource(load_recorder(path).record)
                validation = source.index("validate_white_cat_qa(")
                mutation = source.index("item.update(")
                temporary_write = source.index("temporary =")
                self.assertLess(validation, mutation)
                self.assertLess(validation, temporary_write)
                if "for check in (" in source:
                    self.assertLess(validation, source.index("for check in ("))

    def test_white_cat_records_contract_version_and_identity_qa(self) -> None:
        strict_source = inspect.getsource(load_recorder(RECORDER_PATHS[0]).record)
        self.assertIn('item["qa_contract_version"] = qa["contract_version"]', strict_source)
        self.assertIn('item["identity_qa"] = qa["identity_qa"]', strict_source)
        for path in RECORDER_PATHS[1:]:
            with self.subTest(recorder=path.name):
                source = inspect.getsource(load_recorder(path).record)
                self.assertIn('item["qa_contract_version"] = qa["contract_version"]', source)
                self.assertIn('identity_qa=qa["identity_qa"]', source)


if __name__ == "__main__":
    unittest.main()
