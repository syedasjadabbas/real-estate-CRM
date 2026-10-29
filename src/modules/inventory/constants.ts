/** FR-071 statuses and FR-072 sale models, as observed in the reference filters. */
export const UNIT_STATUSES = ["available", "partially_booked", "reserved", "booked", "sold"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: "Available",
  partially_booked: "Partially booked",
  reserved: "Reserved",
  booked: "Booked",
  sold: "Sold",
};

export const SALE_MODELS = ["whole", "spu", "fractional_50"] as const;
export type SaleModel = (typeof SALE_MODELS)[number];

export const SALE_MODEL_LABELS: Record<SaleModel, string> = {
  whole: "Whole unit",
  spu: "SPU strips",
  fractional_50: "50% fractional",
};

/** Per-project dimension lists (FR-061). Size is the unit's area, so it has no list. */
export const DIMENSION_KEYS = ["floors", "blocks", "categories", "types", "premiums"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  floors: "Floors",
  blocks: "Blocks",
  categories: "Categories",
  types: "Types",
  premiums: "Premiums",
};

/** Unit field each dimension list constrains. */
export const DIMENSION_FIELD = {
  floors: "floor",
  blocks: "block",
  categories: "category",
  types: "type",
  premiums: "premium",
} as const satisfies Record<DimensionKey, string>;

export const UNIT_PAGE_SIZE = 50;
