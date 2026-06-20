import pytest
from fastapi import HTTPException

from backend.policies import (
    apply_branch_scope,
    assert_branch_access,
    clamp_pagination,
    escape_regex,
    validate_password,
)


def test_password_policy_rejects_short():
    with pytest.raises(HTTPException) as exc:
        validate_password("abc")
    assert exc.value.status_code == 400


def test_password_policy_accepts_strong():
    validate_password("securePass1")


def test_escape_regex_metacharacters():
    assert escape_regex("a+b?") == "a\\+b\\?"


def test_branch_scope_for_cashier():
    user = {"role": "cashier", "branch_id": "branch-1"}
    scoped = apply_branch_scope(user, {"category": "Dairy"})
    assert scoped["branch_id"] == "branch-1"
    assert scoped["category"] == "Dairy"


def test_branch_scope_super_admin_unrestricted():
    user = {"role": "admin", "branch_id": "branch-1"}
    scoped = apply_branch_scope(user, {})
    assert "branch_id" not in scoped


def test_branch_scope_branch_admin():
    user = {"role": "branch_admin", "branch_id": "branch-1"}
    scoped = apply_branch_scope(user, {"category": "Dairy"})
    assert scoped["branch_id"] == "branch-1"


def test_assert_branch_access_denied():
    user = {"role": "cashier", "branch_id": "a"}
    with pytest.raises(HTTPException) as exc:
        assert_branch_access(user, {"branch_id": "b"}, "product")
    assert exc.value.status_code == 403


def test_clamp_pagination():
    skip, limit = clamp_pagination(-5, 9999)
    assert skip == 0
    assert limit <= 500
