#!/usr/bin/env python3
"""Contract checks for mandatory post-delivery BGM recommendations."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[4]


class PostDeliveryBgmRecommendationContractTest(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_standard_route_calls_bgm_skill_after_assembly(self) -> None:
        content = self.read(".agents/skills/run-knowledge-video/SKILL.md")
        route = content.split("## Route phases", 1)[1].split("## Revoice", 1)[0]
        self.assertLess(route.index("$assemble-video-master"), route.index("$short-video-bgm"))
        self.assertIn("after the delivery transaction passes", route)

    def test_standard_and_revoice_final_phases_require_recommendation(self) -> None:
        state = self.read(
            ".agents/skills/run-knowledge-video/references/workflow-state-machine.md"
        )
        self.assertIn(
            "final_rendering → awaiting_post_delivery_bgm_recommendation → delivered",
            state,
        )
        self.assertIn(
            "revoice_variant_rendering → awaiting_post_delivery_bgm_recommendation → "
            "revoice_variant_delivered",
            state,
        )
        self.assertIn("post_delivery_bgm_recommendation_policy: required-v1", state)
        self.assertIn(
            "Set final `delivered` or `revoice_variant_delivered` only after", state
        )

    def test_bgm_contract_requires_links_licenses_and_no_media_mutation(self) -> None:
        skill = self.read(".agents/skills/short-video-bgm/SKILL.md")
        contract = self.read(
            ".agents/skills/short-video-bgm/references/knowledge-video-post-delivery.md"
        )
        self.assertIn("knowledge-video-post-delivery.md", skill)
        for needle in (
            "3–5",
            "直接试听",
            "官方授权链接",
            "不得编造",
            '"music_downloaded": false',
            '"music_mixed": false',
            '"delivered_master_changed": false',
        ):
            self.assertIn(needle, contract)

    def test_workspace_validator_enforces_the_contract(self) -> None:
        validator = self.read(
            ".agents/skills/run-knowledge-video/scripts/validate_episode_workspace.py"
        )
        self.assertIn("def _validate_post_delivery_bgm_recommendation", validator)
        self.assertIn('policy != "required-v1"', validator)
        self.assertIn("3 <= len(recommendations) <= 5", validator)
        self.assertIn("must preserve delivered media", validator)

    def test_project_gate_routes_every_new_delivery_transaction(self) -> None:
        agents = self.read("AGENTS.md")
        self.assertIn("After each new standard/revoice delivery transaction", agents)
        self.assertIn("call `$short-video-bgm`", agents)


if __name__ == "__main__":
    unittest.main()
