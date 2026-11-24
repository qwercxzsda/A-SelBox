"""Read one named Amazon source. Archive response bodies for offline replay."""

import json
import os
import time
from collections.abc import Mapping
from urllib.parse import quote

import httpx

from ..amazon.marketplaces import get_credential_scope, validate_marketplace_scope_pair
from ..amazon.transport import suppress_sensitive_transport_logging
from ..finances.values import array, object_value, text
from .invoices import identifier
from .named_information import CREATIVES


def _request(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    allow_profile_denial: bool = False,
    headers: dict[str, str] | None = None,
    params: Mapping[str, str] | None = None,
    data: dict[str, str] | None = None,
    json: dict[str, object] | None = None,
) -> httpx.Response:
    for retry in range(4):
        response = client.request(method, url, headers=headers, params=params, data=data, json=json)
        if response.status_code != 429 or retry == 3:
            if response.status_code not in (200, 404) and not (
                allow_profile_denial and response.status_code == 403
            ):
                raise RuntimeError(
                    f"Amazon reference request failed with HTTP {response.status_code}."
                )
            return response
        wait = response.headers.get("retry-after", "")
        time.sleep(min(60, int(wait)) if wait.isdecimal() else 2**retry)
    raise RuntimeError("Amazon request did not complete.")


def _headers(client: httpx.Client, scope: str, ads: bool) -> dict[str, str]:
    app, secret, refresh = (
        ("AD_API_CLIENT_ID", "AD_API_CLIENT_SECRET", "AD_API_REFRESH_TOKEN")
        if ads
        else (
            "LWA_APP_ID",
            "LWA_CLIENT_SECRET",
            get_credential_scope(scope).refresh_token_environment,
        )
    )
    response = _request(
        client,
        "POST",
        "https://api.amazon.com/auth/o2/token",
        data={
            "grant_type": "refresh_token",
            "client_id": os.environ[app],
            "client_secret": os.environ[secret],
            "refresh_token": os.environ[refresh],
        },
    )
    token = text(object_value(response.json()).get("access_token"))
    if ads:
        return {
            "Authorization": "Bearer " + token,
            "Amazon-Advertising-API-ClientId": os.environ[app],
            "Accept": "application/json",
        }
    return {"x-amz-access-token": token, "Accept": "application/json"}


def _ads_pages(
    client: httpx.Client, path: str, headers: dict[str, str], program: str, lookup: str
) -> list[str]:
    query: dict[str, object] = {
        "adProductFilter": {"include": [program]},
        "campaignIdFilter": {"include": [lookup]},
        "maxResults": 100,
    }
    pages: list[str] = []
    seen: set[str] = set()
    while True:
        response = _request(client, "POST", path, headers=headers, json=query)
        if response.status_code == 404:
            raise RuntimeError("Amazon Ads query endpoint is unavailable.")
        pages.append(response.text)
        token = object_value(response.json()).get("nextToken")
        if not token:
            return pages
        token = text(token)
        if token in seen:
            raise ValueError("Amazon Ads repeated a page token.")
        seen.add(token)
        query["nextToken"] = token


def _invoice(
    client: httpx.Client, host: str, headers: dict[str, str], market: str, native_id: str
) -> dict[str, object]:
    profiles = _request(client, "GET", host + "/v2/profiles", headers=headers)
    missing_answers: list[dict[str, str]] = []
    denied = False
    for value in array(profiles.json()):
        profile = object_value(value)
        account = object_value(profile["accountInfo"])
        if account.get("type") != "seller" or account.get("marketplaceStringId") != market:
            continue
        pid = identifier(profile["profileId"])
        response = _request(
            client,
            "GET",
            host + "/invoices/" + quote(native_id, safe=""),
            headers={**headers, "Amazon-Advertising-API-Scope": pid},
            allow_profile_denial=True,
        )
        if response.status_code == 200:
            return {"profile_id": pid, "body": response.text}
        if response.status_code == 404:
            missing_answers.append({"profile_id": pid, "body": response.text})
        else:
            denied = True
    if denied or not missing_answers:
        raise RuntimeError("No matching Ads profile could access the invoice.")
    return {"missing": True, "answers": missing_answers}


def _shipment(
    client: httpx.Client, host: str, headers: dict[str, str], market: str, native_id: str
) -> dict[str, object]:
    path = host + "/fba/inbound/v0/shipments"
    response = _request(
        client,
        "GET",
        path,
        headers=headers,
        params={"QueryType": "SHIPMENT", "ShipmentIdList": native_id, "MarketplaceId": market},
    )
    if response.status_code == 404:
        return {"missing": True, "body": response.text}
    payload = object_value(object_value(response.json())["payload"])
    if payload.get("NextToken"):
        raise ValueError("Unexpected pagination for a single inbound shipment.")
    if not array(payload["ShipmentData"]):
        return {"body": response.text, "items": []}
    item_url = path + "/" + quote(native_id, safe="") + "/items"
    item_response = _request(client, "GET", item_url, headers=headers)
    if item_response.status_code == 404:
        raise RuntimeError("Amazon returned a shipment header without its items endpoint.")
    pages = [item_response.text]
    tokens: set[str] = set()
    while token := object_value(object_value(item_response.json())["payload"]).get("NextToken"):
        token = text(token)
        if token in tokens:
            raise ValueError("Inbound shipment repeated a page token.")
        tokens.add(token)
        item_response = _request(
            client,
            "GET",
            host + "/fba/inbound/v0/shipmentItems",
            headers=headers,
            params={"QueryType": "NEXT_TOKEN", "NextToken": token, "MarketplaceId": market},
        )
        pages.append(item_response.text)
    return {"body": response.text, "items": pages}


def download_named(
    source: str,
    amazon_scope: str,
    marketplace_id: str,
    native_id: str,
    *,
    profile_id: str | None = None,
    campaign_aid: str | None = None,
    ad_type: str | None = None,
) -> bytes:
    validate_marketplace_scope_pair(amazon_scope, marketplace_id)
    if source not in {"AD_INVOICE", "CAMPAIGN", "PROMOTION", "SHIPMENT"}:
        raise ValueError("Unsupported named source.")
    ads = source in {"AD_INVOICE", "CAMPAIGN"}
    region = amazon_scope.lower() if amazon_scope in {"NA", "EU"} else "fe"
    host = (
        "https://advertising-api" + ("" if region == "na" else "-" + region) + ".amazon.com"
        if ads
        else f"https://sellingpartnerapi-{region}.amazon.com"
    )
    suppress_sensitive_transport_logging()
    with httpx.Client(timeout=60) as client:
        headers = _headers(client, amazon_scope, ads)
        bundle: dict[str, object]
        if source == "AD_INVOICE":
            bundle = _invoice(client, host, headers, marketplace_id, native_id)
        elif source == "CAMPAIGN":
            if ad_type not in CREATIVES or not profile_id:
                raise ValueError("Campaign lookup needs its invoice program and profile.")
            lookup = text(campaign_aid if ad_type == "SPONSORED_TV" else native_id)
            program = "SPONSORED_TELEVISION" if ad_type == "SPONSORED_TV" else text(ad_type)
            headers["Amazon-Advertising-API-Scope"] = profile_id
            base = host + "/adsApi/v1/query/"
            bundle = {"lookup_id": lookup, "ad_type": ad_type, "profile_id": profile_id}
            for key in ("campaigns", "ads"):
                bundle[key] = _ads_pages(client, base + key, headers, program, lookup)
        elif source == "SHIPMENT":
            bundle = _shipment(client, host, headers, marketplace_id, native_id)
        else:
            response = _request(
                client,
                "GET",
                host + "/promotions/2025-12-01/promotions/" + quote(native_id, safe=""),
                headers=headers,
                params={"includedData": "SELECTION"},
            )
            bundle = {"body": response.text, "missing": response.status_code == 404}
    return json.dumps(
        {"source": source, "marketplace_id": marketplace_id, "native_id": native_id, **bundle}
    ).encode()
