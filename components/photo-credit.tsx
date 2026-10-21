import type { Photo } from "@/lib/unsplash";

export function PhotoCredit({ photo, className }: { photo: Photo; className?: string }) {
  return (
    <p className={className}>
      Photo by{" "}
      <a href={photo.authorUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {photo.author}
      </a>{" "}
      on{" "}
      <a href={photo.unsplashUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        Unsplash
      </a>
    </p>
  );
}
