import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingRows } from "@/components/page";
import { SupplierDetailView } from "@/components/views/supplier-detail";

export const metadata: Metadata = { title: "Supplier" };

export default function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      {params.then(({ id }) => (
        <SupplierDetailView id={decodeURIComponent(id)} />
      ))}
    </Suspense>
  );
}
