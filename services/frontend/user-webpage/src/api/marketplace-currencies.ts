/**
 * Each marketplace in generated/marketplaces.json charges in exactly one currency (ISO 4217), as
 * observed in Finances. Financial review rejects a row in any other currency.
 */
const MARKETPLACE_CURRENCIES: Readonly<Partial<Record<string, string>>> = {
  "Amazon.ae": "AED",
  "Amazon.ca": "CAD",
  "Amazon.co.jp": "JPY",
  "Amazon.co.uk": "GBP",
  "Amazon.co.za": "ZAR",
  "Amazon.com": "USD",
  "Amazon.com.au": "AUD",
  "Amazon.com.be": "EUR",
  "Amazon.com.br": "BRL",
  "Amazon.com.mx": "MXN",
  "Amazon.com.tr": "TRY",
  "Amazon.de": "EUR",
  "Amazon.eg": "EGP",
  "Amazon.es": "EUR",
  "Amazon.fr": "EUR",
  "Amazon.ie": "EUR",
  "Amazon.in": "INR",
  "Amazon.it": "EUR",
  "Amazon.nl": "EUR",
  "Amazon.pl": "PLN",
  "Amazon.sa": "SAR",
  "Amazon.se": "SEK",
  "Amazon.sg": "SGD",
  "Non-Amazon DE": "EUR",
  "Non-Amazon IT": "EUR",
  "Non-Amazon US": "USD",
};

export function marketplaceCurrency(marketplace: string): string {
  const currency = Object.hasOwn(MARKETPLACE_CURRENCIES, marketplace)
    ? MARKETPLACE_CURRENCIES[marketplace]
    : undefined;
  if (currency === undefined) throw new Error(`No currency is defined for ${marketplace}`);
  return currency;
}
