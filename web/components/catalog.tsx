"use client";

import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { VideoCard } from "@/components/video-card";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Skeleton } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/segmented";
import { useVideos } from "@/lib/client/hooks";
import { CATEGORIES } from "@/lib/categories";

const TABS = [{ id: "all", label: "All" }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))] as const;
type Tab = (typeof TABS)[number]["id"];

export function Catalog({
  watchHref,
  uploadHref = "/upload",
  initialCategory = "all",
  creator,
  lockCategory,
}: {
  watchHref: (id: string) => string;
  uploadHref?: string;
  initialCategory?: string;
  creator?: string;
  lockCategory?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const [category, setCategory] = useState<Tab>(TABS.some((t) => t.id === initialCategory) ? (initialCategory as Tab) : "all");
  const query = useDeferredValue(q);
  const { data, isLoading, error } = useVideos({ q: query, sort, category: category === "all" ? undefined : category, creator });

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {!lockCategory && <Segmented label="Category" value={category} onChange={setCategory} options={TABS} className="self-start overflow-x-auto" />}
        <div className="flex gap-2">
          <div className="relative flex-1 lg:w-72 lg:flex-none">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="h-10 pl-10" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search videos" />
          </div>
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-10 rounded-md border bg-background px-3 text-sm text-foreground transition-colors duration-200 hover:bg-muted"
          >
            <option value="newest">Newest</option>
            <option value="top_rated">Top rated</option>
            <option value="cheapest">Lowest price</option>
            <option value="most_watched">Most watched</option>
          </select>
        </div>
      </div>

      <div className="mt-8">
        {error ? (
          <EmptyState title="Couldn't load videos" body={(error as Error).message} />
        ) : isLoading ? (
          <Grid>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-video w-full rounded-lg" />
                <Skeleton className="mt-3 h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            ))}
          </Grid>
        ) : !data?.length ? (
          <EmptyState
            title={q ? "Nothing matches that search" : "Nothing here yet"}
            body={q ? "Try a different word." : "Be the first to publish in this category. You set the price."}
          >
            {!q && (
              <Button asChild>
                <Link href={uploadHref}>Upload a video</Link>
              </Button>
            )}
          </EmptyState>
        ) : (
          <Grid>
            {data.map((v) => (
              <VideoCard key={v.id} video={v} href={watchHref(v.id)} />
            ))}
          </Grid>
        )}
      </div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
