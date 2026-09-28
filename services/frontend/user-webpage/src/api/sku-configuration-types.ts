export interface SkuConfigurationPeriod {
  marketplace_name: string;
  valid_from: string;
  valid_to: string | null;
  fee_rate_percent: string;
}

export interface SkuConfigurationRequirement {
  marketplace_name: string;
  valid_from: string;
  valid_to: string;
}

export interface SkuConfigurationIssue {
  sku: string;
  kind: "missing_company" | "missing_fee";
  marketplace_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export interface SkuConfigurationItem {
  sku: string;
  sku_id: string | null;
  company_id: string | null;
  terms_version_id: string | null;
  periods: SkuConfigurationPeriod[];
  requirements: SkuConfigurationRequirement[];
  issues: SkuConfigurationIssue[];
}

export interface SkuConfiguration {
  items: SkuConfigurationItem[];
}

export interface SkuConfigurationChange {
  sku: string;
  company_id: string | null;
  expected_current_version_id: string | null;
  periods: SkuConfigurationPeriod[];
}

export interface PublishSkuConfigurationOptions {
  accessToken: string;
  changes: SkuConfigurationChange[];
  changeReason?: string;
}

export interface PublishSkuConfigurationResult {
  published: { sku: string; terms_version_id: string }[];
  changed_count: number;
}
