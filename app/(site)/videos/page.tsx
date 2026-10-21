"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Catalog } from "@/components/catalog";
import { PageTitle } from "@/components/ui/primitives";

function Browse() {
  const params = useSearchParams();
  return <Catalog watchHref={(id) => `/watch/${id}`} initialCategory={params.get("category") ?? "all"} />;
}

export default function BrowsePage() {
  return (
    <div className="container">
      <PageTitle title="Browse" subtitle="Every price is per hour. You pay by the second, only while it plays." />
      <Suspense>
        <Browse />
      </Suspense>
    </div>
  );
}
