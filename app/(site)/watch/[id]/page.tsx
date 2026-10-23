"use client";

import { use } from "react";
import { WatchView } from "@/components/watch-view";

export default function WatchPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string }> }) {
  const params = use(props.params);
  const searchParams = use(props.searchParams);
  return (
    <div className="container pt-8">
      <WatchView id={params.id} backHref="/videos" refParam={searchParams.ref} />
    </div>
  );
}
