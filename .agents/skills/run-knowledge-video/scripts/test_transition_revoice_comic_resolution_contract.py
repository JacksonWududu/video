#!/usr/bin/env python3
"""Cross-contract checks for resolved C-04, C-05, and C-06."""

import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class TransitionRevoiceComicResolutionContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def assert_contains(self, relative_path: str, *needles: str) -> None:
        content = self.read(relative_path)
        for needle in needles:
            self.assertIn(needle, content, f"{relative_path} lacks {needle!r}")

    def test_route_recommendation_precedes_shared_fallback(self) -> None:
        self.assert_contains(
            "leverage-video/src/shared/scene-transitions/contract.mjs",
            "resolveTransitionRecommendation",
            "transition-recommendations.json",
            "authority: 'visual-generation-route'",
            "authority: 'shared-fallback'",
            "transition recommendation authority is stale or spoofed",
        )
        self.assert_contains(
            ".agents/skills/build-video-storyboard/SKILL.md",
            "matching rule declared by the approved source generation route first",
            "Only when neither priority applies use the shared semantic fallback",
            "shared renderer",
        )

    def test_revoice_transition_lock_is_mechanical(self) -> None:
        self.assert_contains(
            "leverage-video/src/shared/scene-transitions/contract.mjs",
            "validateRevoiceTransitionLock",
            "duration_seconds",
            "duration_in_frames",
            "revoice shot cannot fit its locked parent transition",
        )
        self.assert_contains(
            "leverage-video/src/shared/assembly-plan/build-assembly-plan.mjs",
            "strict-parent-transition-v1",
            "revoice_parent_transition",
        )

    def test_comic_route_is_legacy_read_only(self) -> None:
        self.assert_contains(
            "leverage-video/src/shared/visual-generation-routes/contract.mjs",
            "ACTIVE_ROUTE_IDS",
            "RETIRED_ROUTE_IDS",
            "comic-imagegen is retired for new or modified v3 work",
        )
        rules = json.loads(self.read(
            "leverage-video/src/shared/visual-generation-routes/transition-recommendations.json"
        ))
        self.assertEqual(rules["rules"][0]["scope"], "legacy-read-only")
        self.assert_contains(
            "leverage-video/src/shared/assembly-plan/build-assembly-plan.mjs",
            "comic-imagegen is legacy read-only",
            "cannot enter assembly or create a new output",
        )

    def test_route_catalog_extension_keeps_legacy_checksum_pinned(self) -> None:
        catalog = ROOT / "leverage-video/src/shared/visual-generation-routes/catalog.json"
        self.assertEqual(
            hashlib.sha256(catalog.read_bytes()).hexdigest(),
            "5214aa035c6a9ff7dcbd39e682ba899c4a3d3af3ba46804b0a96e3ae175d5d4e",
        )
        self.assert_contains(
            "leverage-video/src/shared/visual-generation-routes/contract.mjs",
            "LEGACY_V2_CATALOG_CHECKSUM_SHA256 = '9bf0d8b38002ae4e5e441a148eaa73f900937ba178dd2b777be764f68c4abca8'",
            "LEGACY_V2_VISUAL_LANGUAGE_CATALOG_CHECKSUM_SHA256 = 'a267bf4254fdc8bad1e1217dc50deb4417fe0606776159943b4439de72e9b255'",
        )

    def test_project_authority_is_current_and_size_bounded(self) -> None:
        agents = (ROOT / "AGENTS.md").read_bytes()
        self.assertLessEqual(len(agents), 6 * 1024)
        text = agents.decode("utf-8")
        self.assertIn("matching recommendation rule outranks the shared semantic fallback", text)
        self.assertIn("`comic-imagegen` is historical read-only", text)


if __name__ == "__main__":
    unittest.main()
