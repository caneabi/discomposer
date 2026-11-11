import json
from pathlib import Path

import pytest

from discomposer import TemplateError, chosen_options, validate

FIXTURES = Path(__file__).resolve().parents[3] / "spec" / "fixtures"


def load(name):
    def expand(value):
        if isinstance(value, str) and value.startswith("REPEAT_"):
            return "x" * int(value[7:])
        if isinstance(value, list):
            return [expand(v) for v in value]
        if isinstance(value, dict):
            return {k: expand(v) for k, v in value.items()}
        return value

    return expand(json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8")))


@pytest.mark.parametrize("case", load("valid"), ids=lambda c: c["name"])
def test_valid(case):
    cleaned = validate(case["doc"])
    assert validate(cleaned) == cleaned


@pytest.mark.parametrize("case", load("invalid"), ids=lambda c: c["name"])
def test_invalid(case):
    with pytest.raises(TemplateError):
        validate(case["doc"])


def test_chosen_options_ignores_unknown_values():
    design = validate(load("valid")[3]["doc"])["design"]
    chosen = chosen_options(design, "tickets", ["support", "admin"])
    assert [o["value"] for o in chosen] == ["support"]
    assert chosen[0]["roles"] == ["333333333333333333"]
    assert chosen_options(design, "other", ["support"]) == []


def test_button_style_defaults_to_secondary():
    doc = validate({"design": {"blocks": [{"button": {"id": "a", "label": "A"}}]}})
    assert doc["design"]["blocks"][0]["button"]["style"] == "secondary"
