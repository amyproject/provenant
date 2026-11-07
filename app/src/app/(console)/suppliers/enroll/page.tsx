import type { Metadata } from "next";
import { EnrollSupplierView } from "@/components/views/enroll-supplier";

export const metadata: Metadata = { title: "Enroll supplier" };

export default function EnrollSupplierPage() {
  return <EnrollSupplierView />;
}
