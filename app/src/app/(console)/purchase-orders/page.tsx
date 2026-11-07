import type { Metadata } from "next";
import { PurchaseOrdersView } from "@/components/views/purchase-orders";

export const metadata: Metadata = { title: "Purchase orders" };

export default function PurchaseOrdersPage() {
  return <PurchaseOrdersView />;
}
