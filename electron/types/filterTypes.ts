/** A single condition in a compound filter */
export interface FilterCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'between';
  value: string | number | boolean | string[] | number[];
  exclude?: boolean;
}

/** A group of conditions joined by AND or OR */
export interface FilterGroup {
  logic: 'AND' | 'OR';
  conditions: FilterCondition[];
}

/** Compound filter with multiple groups */
export interface CompoundFilter {
  logic: 'AND' | 'OR';
  groups: FilterGroup[];
}
