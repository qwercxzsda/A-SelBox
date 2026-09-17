from datetime import date, datetime

from ..identifiers import validate_marketplace_id

ECONOMICS_SCHEMA_NAME: str = "analytics_economics_2024_03_15"

_IGNORED_CHARACTERS: frozenset[str] = frozenset({"\t", "\n", "\r", " ", ",", "\ufeff"})
_SINGLE_CHARACTER_TOKENS: frozenset[str] = frozenset(
    {"!", "$", "&", "(", ")", ":", "=", "@", "[", "]", "{", "|", "}"}
)

_ECONOMICS_QUERY_TEMPLATE: str = """\
query SkuEconomicsDaily {
  __SCHEMA_NAME__ {
    economics(
      startDate: "__START_DATE__"
      endDate: "__END_DATE__"
      aggregateBy: { date: DAY, productId: MSKU }
      marketplaceIds: ["__MARKETPLACE_ID__"]
      includeComponentsForFeeTypes: [FBA_FULFILLMENT_FEE, FBA_STORAGE_FEE]
    ) {
      startDate
      endDate
      marketplaceId
      msku
      childAsin
      fnsku
      parentAsin

      sales {
        averageSellingPrice { amount currencyCode }
        netProductSales { amount currencyCode }
        netUnitsSold
        orderedProductSales { amount currencyCode }
        refundedProductSales { amount currencyCode }
        unitsOrdered
        unitsRefunded
      }

      fees {
        feeTypeName
        charges {
          identifier
          startDate
          endDate
          properties {
            propertyName
            propertyValue
          }
          aggregatedDetail {
            amount { amount currencyCode }
            amountPerUnit { amount currencyCode }
            amountPerUnitDelta { amount currencyCode }
            promotionAmount { amount currencyCode }
            quantity
            taxAmount { amount currencyCode }
            totalAmount { amount currencyCode }
          }
          components {
            name
            properties {
              propertyName
              propertyValue
            }
            aggregatedDetail {
              amount { amount currencyCode }
              amountPerUnit { amount currencyCode }
              amountPerUnitDelta { amount currencyCode }
              promotionAmount { amount currencyCode }
              quantity
              taxAmount { amount currencyCode }
              totalAmount { amount currencyCode }
            }
          }
        }
      }

      ads {
        adTypeName
        charge {
          amount { amount currencyCode }
          amountPerUnit { amount currencyCode }
          amountPerUnitDelta { amount currencyCode }
          promotionAmount { amount currencyCode }
          quantity
          taxAmount { amount currencyCode }
          totalAmount { amount currencyCode }
        }
      }

      cost {
        costOfGoodsSold { amount currencyCode }
        fbaCost {
          shippingToAmazonCost { amount currencyCode }
        }
        mfnCost {
          fulfillmentCost { amount currencyCode }
          storageCost { amount currencyCode }
        }
        miscellaneousCost { amount currencyCode }
      }

      netProceeds {
        perUnit { amount currencyCode }
        total { amount currencyCode }
      }
    }
  }
}
"""


def build_daily_msku_economics_query(
    start_date: date,
    end_date: date,
    marketplace_id: str,
) -> str:
    """Build the pinned Economics query with DAY and MSKU aggregation."""
    if isinstance(start_date, datetime) or isinstance(end_date, datetime):
        raise TypeError("start_date and end_date must be datetime.date values.")
    if start_date > end_date:
        raise ValueError("start_date must be less than or equal to end_date.")

    normalized_marketplace_id = validate_marketplace_id(marketplace_id)
    return (
        _ECONOMICS_QUERY_TEMPLATE.replace("__SCHEMA_NAME__", ECONOMICS_SCHEMA_NAME)
        .replace("__START_DATE__", start_date.isoformat())
        .replace("__END_DATE__", end_date.isoformat())
        .replace("__MARKETPLACE_ID__", normalized_marketplace_id)
    )


def canonicalize_graphql_query(query: str) -> tuple[str, ...]:
    """Tokenize GraphQL while discarding only lexically insignificant input."""
    tokens: list[str] = []
    position = 0

    while position < len(query):
        character = query[position]
        if character in _IGNORED_CHARACTERS:
            position += 1
        elif character == "#":
            position = _skip_comment(query, position + 1)
        elif query.startswith('"""', position):
            token, position = _consume_block_string(query, position)
            tokens.append(token)
        elif character == '"':
            token, position = _consume_string(query, position)
            tokens.append(token)
        elif character in _SINGLE_CHARACTER_TOKENS:
            tokens.append(character)
            position += 1
        else:
            token, position = _consume_name_or_number(query, position)
            tokens.append(token)

    return tuple(tokens)


def _skip_comment(query: str, position: int) -> int:
    while position < len(query) and query[position] not in {"\n", "\r"}:
        position += 1
    return position


def _consume_string(query: str, position: int) -> tuple[str, int]:
    token_start = position
    position += 1
    while position < len(query):
        character = query[position]
        if character == "\\":
            position += 2
            if position > len(query):
                break
            continue
        position += 1
        if character == '"':
            return query[token_start:position], position
        if character in {"\n", "\r"}:
            break
    raise ValueError("Unterminated GraphQL string literal.")


def _consume_block_string(query: str, position: int) -> tuple[str, int]:
    token_start = position
    position += 3
    while position < len(query):
        if query.startswith('\\"""', position):
            position += 4
        elif query.startswith('"""', position):
            position += 3
            return query[token_start:position], position
        else:
            position += 1
    raise ValueError("Unterminated GraphQL block string literal.")


def _consume_name_or_number(query: str, position: int) -> tuple[str, int]:
    token_start = position
    while position < len(query):
        character = query[position]
        if (
            character in _IGNORED_CHARACTERS
            or character == "#"
            or character == '"'
            or character in _SINGLE_CHARACTER_TOKENS
        ):
            break
        position += 1
    return query[token_start:position], position


__all__ = ["ECONOMICS_SCHEMA_NAME", "build_daily_msku_economics_query"]
