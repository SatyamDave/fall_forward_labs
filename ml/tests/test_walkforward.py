from ml.validation.walkforward import registration, verdict_of


def test_a_gate_not_evaluated_blocks_pass() -> None:
    assert verdict_of({"a": True, "b": True}) == "PASS"
    assert verdict_of({"a": True, "b": None}) == "FAIL"
    assert verdict_of({"a": True, "b": False}) == "FAIL"


def test_a_failed_walk_forward_registers_a_non_promotable_record() -> None:
    assert registration("PASS") == ("challenger", "")
    assert registration("FAIL") == ("no_signal", "walk-forward FAIL")
