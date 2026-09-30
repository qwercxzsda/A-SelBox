"""Synthetic ownership and Auth accounts kept inside the disposable inventory stack."""

import secrets
from typing import Any
from uuid import uuid7

from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.connection import PostgresDatabaseConnection

from ...e2e.local_stack import LocalSupabaseStack
from .checks import require, rest_rows, verify_rest_fields


def account(
    stack: LocalSupabaseStack, database: PostgresDatabaseConnection, company: str | None
) -> dict[str, Any]:
    email, password = f"inventory-{uuid7().hex}@example.invalid", secrets.token_urlsafe(32)
    response = stack.request(
        "POST",
        "/auth/v1/admin/users",
        admin=True,
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
        },
    )
    require(response.status_code == 200, "Disposable Auth user creation failed.")
    with database.connection() as connection:
        connection.execute(
            "INSERT INTO public.app_accounts(user_id,access_role,company_id) VALUES (%s,%s,%s)",
            (response.json()["id"], "company_member" if company else "operator", company),
        )
    signed = stack.request(
        "POST",
        "/auth/v1/token?grant_type=password",
        json={
            "email": email,
            "password": password,
        },
    )
    require(signed.status_code == 200, "Disposable Auth sign-in failed.")
    return {
        "email": email,
        "password": password,
        "role": "member" if company else "operator",
        "token": signed.json()["access_token"],
    }


def prepare_accounts(
    stack: LocalSupabaseStack, database: PostgresDatabaseConnection, rows: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[int]]:
    # Ownership is explicitly synthetic and exists only in the disposable DB.
    companies = [create_company(database, f"Disposable inventory company {i}") for i in range(2)]
    groups: list[list[str]] = [[], []]
    for index, row in enumerate(rows):
        group = index % 2
        publish_sku_terms(
            database,
            sku=row["sku"],
            company_id=companies[group],
            expected_current_version_id=None,
            periods=[],
            change_reason="Disposable real inventory verification ownership",
        )
        groups[group].append(row["sku"])
    accounts = [account(stack, database, None)] + [
        account(stack, database, company) for company in companies
    ]
    for index, credentials in enumerate(accounts):
        visible = rest_rows(stack, credentials.pop("token"))
        expected_skus = [row["sku"] for row in rows] if index == 0 else groups[index - 1]
        require(
            {row["sku"] for row in visible} == set(expected_skus),
            "REST ownership isolation failed.",
        )
        verify_rest_fields(visible, rows)
        if index:
            require(
                all(not row["seller_namespace"] for row in visible),
                "Member source namespace leaked.",
            )
        credentials.update(count=len(visible), skus=expected_skus, sample=visible[0])
    return accounts, [len(group) for group in groups]
