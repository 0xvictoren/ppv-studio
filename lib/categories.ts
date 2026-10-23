// Content categories. Metadata only: every video is pay-per-second gated onchain the same way.
export const CATEGORIES = [
  { id: "movies", label: "Movies", blurb: "Films and shorts" },
  { id: "tutorials", label: "Tutorials", blurb: "Courses, lessons and how-tos" },
  { id: "exclusive", label: "Exclusive", blurb: "Members-style gated content" },
  { id: "other", label: "Other", blurb: "Everything else" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function isCategory(v: unknown): v is CategoryId {
  return CATEGORIES.some((c) => c.id === v);
}

export function categoryLabel(id: string | null | undefined) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
}
