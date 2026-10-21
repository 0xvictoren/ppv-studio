"use client";

import { SignInGate } from "@/components/sign-in-gate";
import { UploadForm } from "@/components/upload-form";

export default function EmbedUploadPage() {
  return (
    <div className="mx-auto max-w-3xl pt-4">
      <SignInGate embedded purpose="Sign in so we know which wallet gets paid for this video.">
        <UploadForm watchHref={(id) => `/embed/watch/${id}`} />
      </SignInGate>
    </div>
  );
}
