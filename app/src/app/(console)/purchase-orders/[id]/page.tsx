import { Suspense } from "react";
import type { Metadata } from "next";
import { LoadingRows } from "@/components/page";
import { PurchaseOrderDetailView } from "@/components/views/purchase-order-detail";

export const metadata: Metadata = { title: "Purchase order" };

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      {params.then(({ id }) => (
        <PurchaseOrderDetailView id={decodeURIComponent(id)} />
      ))}
    </Suspense>
  );
}
