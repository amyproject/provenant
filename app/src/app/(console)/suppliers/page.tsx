import type { Metadata } from "next";
import { SuppliersView } from "@/components/views/suppliers";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return <SuppliersView />;
}
