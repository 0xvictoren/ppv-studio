"use client";

import { WatchView } from "@/components/watch-view";

export default function WatchPage({ params, searchParams }: { params: { id: string }; searchParams: { ref?: string } }) {
  return (
    <div className="container pt-8">
      <WatchView id={params.id} backHref="/videos" refParam={searchParams.ref} />
    </div>
  );
}
