"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WatchView } from "@/components/watch-view";

function EmbeddedWatch({ id }: { id: string }) {
  const sp = useSearchParams();
  const back = sp.get("back");
  // Only allow going back to another embed page.
  const backHref = back && back.startsWith("/embed/") ? back : undefined;
  return <WatchView id={id} embedded backHref={backHref} refParam={sp.get("ref")} />;
}

export default function EmbedWatchPage({ params }: { params: { id: string } }) {
  return (
    <Suspense>
      <EmbeddedWatch id={params.id} />
    </Suspense>
  );
}
