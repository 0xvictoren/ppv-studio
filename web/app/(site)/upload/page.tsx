"use client";

import { SignInGate } from "@/components/sign-in-gate";
import { UploadForm } from "@/components/upload-form";
import { PageTitle } from "@/components/ui/primitives";

export default function UploadPage() {
  return (
    <div className="container max-w-3xl">
      <PageTitle title="Upload" subtitle="Pick a category, set your price per hour, publish. Viewers pay by the second and you're paid every hour." />
      <SignInGate purpose="Sign in so we know which wallet gets paid for this video.">
        <UploadForm watchHref={(id) => `/watch/${id}`} dashboardHref="/dashboard" />
      </SignInGate>
    </div>
  );
}
