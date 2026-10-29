import type { SegmentedOption } from "@/components/ui/segmented";
import type { RangeKey } from "../types";

export const rangeOptions: SegmentedOption<RangeKey>[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "mtd", label: "MTD" },
  { value: "6m", label: "6m" },
  { value: "custom", label: "Custom" },
];

/** Compact uppercase variant used inside the Meetings Distribution widget. */
export const compactRangeOptions: SegmentedOption<RangeKey>[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "mtd", label: "MTD" },
  { value: "6m", label: "6M" },
];
