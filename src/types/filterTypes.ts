/** Core photo filter — flat structure for simple filtering */
export interface PhotoFilter {
  folder?: string;
  search?: string;
  tag?: string;
  people?: number[];
  untagged?: 'untagged';
  blurScoreMin?: number;
  blurScoreMax?: number;
  dateType?: 'created' | 'modified';
  dateFrom?: string;
  dateTo?: string;
  year?: number;
  month?: number;
  camera?: string;
  fileType?: string;
  hasFaces?: boolean;
  faceQualityMin?: number;
  frontalFacesOnly?: boolean;
  unnamedFacesOnly?: boolean;
  confidenceTier?: 'high' | 'medium' | 'low' | 'unknown';
  initial?: boolean;
}

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

/** Persisted smart album */
export interface SmartAlbum {
  id?: number;
  name: string;
  filter_json: string;
  created_at?: string;
}

/** Sort options for search results */
export type SearchSort = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc';

/** Metadata options loaded for filter dropdowns */
export interface FilterMetadata {
  cameraModels: string[];
  years: number[];
  fileTypes: string[];
  tags: { id: number; name: string }[];
  folders: { folder: string }[];
  people: { id: number; name: string; face_count: number }[];
}
