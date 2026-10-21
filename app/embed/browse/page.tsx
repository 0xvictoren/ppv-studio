"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Catalog } from "@/components/catalog";

function EmbeddedCatalog() {
  const params = useSearchParams();
  const category = params.get("category") ?? undefined;
  const creator = params.get("creator") ?? undefined;
  const back = encodeURIComponent(`/embed/browse?${params.toString()}`);
  const ref = params.get("ref");
  return (
    <Catalog
      watchHref={(id) => `/embed/watch/${id}?back=${back}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`}
      uploadHref="/embed/upload"
      initialCategory={category ?? "all"}
      lockCategory={!!category}
      creator={creator}
    />
  );
}

export default function EmbedBrowsePage() {
  return (
    <Suspense>
      <EmbeddedCatalog />
    </Suspense>
  );
}
