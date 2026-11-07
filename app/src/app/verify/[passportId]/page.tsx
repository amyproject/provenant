import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingRows } from "@/components/page";
import { VerifyPassportView } from "@/components/views/verify-passport";

export const metadata: Metadata = { title: "Verify part passport" };

export default function VerifyPage({ params }: { params: Promise<{ passportId: string }> }) {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      {params.then(({ passportId }) => (
        <VerifyPassportView passportId={decodeURIComponent(passportId)} />
      ))}
    </Suspense>
  );
}
