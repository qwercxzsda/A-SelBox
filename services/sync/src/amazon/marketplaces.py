from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import cast
from zoneinfo import ZoneInfo

from sp_api.base import Marketplaces

from .scopes import AMAZON_SCOPES, validate_amazon_scope


def _transport_identity(marketplace: Marketplaces) -> tuple[str, str]:
    """Return the SDK endpoint and signing region used by one marketplace."""
    return cast(str, marketplace.endpoint), cast(str, marketplace.region)


@dataclass(frozen=True)
class AmazonCredentialScope:
    """Bind one refresh-token scope to its transport and marketplace candidates."""

    name: str
    client_marketplace: Marketplaces
    marketplace_candidates: tuple[Marketplaces, ...]

    def __post_init__(self) -> None:
        """Require one nonempty, internally consistent transport configuration."""
        if not self.name or self.name != self.name.strip().upper():
            raise ValueError("Credential scope names must be nonblank uppercase text.")
        if not self.marketplace_candidates:
            raise ValueError("Credential scopes require marketplace candidates.")
        if self.client_marketplace not in self.marketplace_candidates:
            raise ValueError("The client marketplace must be a scope candidate.")
        if len(set(self.marketplace_candidates)) != len(self.marketplace_candidates):
            raise ValueError("Credential scope marketplace candidates must be unique.")
        if any(
            _transport_identity(marketplace) != _transport_identity(self.client_marketplace)
            for marketplace in self.marketplace_candidates
        ):
            raise ValueError("Credential scope marketplaces must share one HTTP transport.")

    @property
    def marketplace_ids(self) -> tuple[str, ...]:
        """Return configured candidates; Sellers resolves current participation."""
        return tuple(marketplace.marketplace_id for marketplace in self.marketplace_candidates)

    @property
    def refresh_token_environment(self) -> str:
        """Return the sole environment-variable name for this credential scope."""
        return f"REFRESH_TOKEN_{self.name}"


# NA/EU credentials cover multiple marketplace candidates. Far East uses the
# separate country credentials configured below.
_REGIONAL_CREDENTIAL_MARKETPLACES: Mapping[str, tuple[Marketplaces, ...]] = MappingProxyType(
    {
        "NA": (Marketplaces.US, Marketplaces.CA, Marketplaces.MX, Marketplaces.BR),
        "EU": (
            Marketplaces.AE,
            Marketplaces.BE,
            Marketplaces.DE,
            Marketplaces.EG,
            Marketplaces.ES,
            Marketplaces.FR,
            Marketplaces.GB,
            Marketplaces.IE,
            Marketplaces.IN,
            Marketplaces.IT,
            Marketplaces.NL,
            Marketplaces.PL,
            Marketplaces.SA,
            Marketplaces.SE,
            Marketplaces.TR,
            Marketplaces.ZA,
        ),
    }
)

CREDENTIAL_SCOPES: Mapping[str, AmazonCredentialScope] = MappingProxyType(
    {
        "NA": AmazonCredentialScope("NA", Marketplaces.US, _REGIONAL_CREDENTIAL_MARKETPLACES["NA"]),
        "EU": AmazonCredentialScope("EU", Marketplaces.DE, _REGIONAL_CREDENTIAL_MARKETPLACES["EU"]),
        "JAPAN": AmazonCredentialScope("JAPAN", Marketplaces.JP, (Marketplaces.JP,)),
        "SINGAPORE": AmazonCredentialScope(
            "SINGAPORE",
            Marketplaces.SG,
            (Marketplaces.SG,),
        ),
        "AUSTRALIA": AmazonCredentialScope(
            "AUSTRALIA",
            Marketplaces.AU,
            (Marketplaces.AU,),
        ),
    }
)

# Data Kiosk DAY aggregation follows marketplace-local calendar dates. Use
# named IANA zones so daylight-saving and government rule changes come from the
# runtime time-zone database rather than hard-coded UTC offsets.
_MARKETPLACE_TIME_ZONE_NAMES: Mapping[str, str] = MappingProxyType(
    {
        Marketplaces.AE.marketplace_id: "Asia/Dubai",
        Marketplaces.BE.marketplace_id: "Europe/Brussels",
        Marketplaces.DE.marketplace_id: "Europe/Berlin",
        Marketplaces.PL.marketplace_id: "Europe/Warsaw",
        Marketplaces.EG.marketplace_id: "Africa/Cairo",
        Marketplaces.ES.marketplace_id: "Europe/Madrid",
        Marketplaces.FR.marketplace_id: "Europe/Paris",
        Marketplaces.GB.marketplace_id: "Europe/London",
        Marketplaces.IN.marketplace_id: "Asia/Kolkata",
        Marketplaces.IT.marketplace_id: "Europe/Rome",
        Marketplaces.IE.marketplace_id: "Europe/Dublin",
        Marketplaces.NL.marketplace_id: "Europe/Amsterdam",
        Marketplaces.SA.marketplace_id: "Asia/Riyadh",
        Marketplaces.SE.marketplace_id: "Europe/Stockholm",
        Marketplaces.TR.marketplace_id: "Europe/Istanbul",
        Marketplaces.ZA.marketplace_id: "Africa/Johannesburg",
        Marketplaces.AU.marketplace_id: "Australia/Sydney",
        Marketplaces.JP.marketplace_id: "Asia/Tokyo",
        Marketplaces.SG.marketplace_id: "Asia/Singapore",
        Marketplaces.US.marketplace_id: "America/Los_Angeles",
        Marketplaces.BR.marketplace_id: "America/Sao_Paulo",
        Marketplaces.CA.marketplace_id: "America/Vancouver",
        Marketplaces.MX.marketplace_id: "America/Mexico_City",
    }
)


def _validate_marketplace_registry() -> None:
    """Fail closed when the installed SDK and country registry diverge."""
    if tuple(CREDENTIAL_SCOPES) != AMAZON_SCOPES:
        raise RuntimeError("Amazon API routing must cover every persistence scope exactly.")
    configured_marketplaces = tuple(
        marketplace
        for scope in CREDENTIAL_SCOPES.values()
        for marketplace in scope.marketplace_candidates
    )
    counts = Counter(configured_marketplaces)
    if set(counts) != set(Marketplaces) or any(count != 1 for count in counts.values()):
        raise RuntimeError(
            "Amazon marketplace scope routing must cover every installed SDK marketplace "
            "exactly once."
        )

    configured_ids = {
        marketplace_id
        for scope in CREDENTIAL_SCOPES.values()
        for marketplace_id in scope.marketplace_ids
    }
    if len(configured_ids) != len(configured_marketplaces):
        raise RuntimeError("Installed Amazon SDK marketplace IDs must be unique.")
    if set(_MARKETPLACE_TIME_ZONE_NAMES) != configured_ids:
        raise RuntimeError(
            "Amazon marketplace time zones must cover every configured marketplace exactly."
        )
    for time_zone_name in _MARKETPLACE_TIME_ZONE_NAMES.values():
        ZoneInfo(time_zone_name)


_validate_marketplace_registry()


def get_credential_scope(scope: str) -> AmazonCredentialScope:
    """Return transport and marketplace routing for a named credential scope."""
    return CREDENTIAL_SCOPES[validate_amazon_scope(scope)]


def validate_marketplace_scope_pair(amazon_scope: str, marketplace_id: str) -> None:
    """Require an exact configured credential-scope and marketplace pairing."""
    scope = CREDENTIAL_SCOPES.get(amazon_scope)
    if scope is None:
        raise ValueError("Unsupported Amazon credential scope.")
    if marketplace_id not in scope.marketplace_ids:
        raise ValueError("Amazon marketplace ID is not configured for the credential scope.")


def get_marketplace_timezone(marketplace_id: str) -> ZoneInfo:
    """Return the named zone defining a marketplace's Data Kiosk DAY."""
    try:
        time_zone_name = _MARKETPLACE_TIME_ZONE_NAMES[marketplace_id]
    except KeyError as exc:
        raise ValueError(f"Unsupported Amazon marketplace ID: {marketplace_id}.") from exc
    return ZoneInfo(time_zone_name)
