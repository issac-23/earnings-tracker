import { Suspense } from "react";
import { Tracker } from "@/components/Tracker";

export default function Page() {
  return (
    <Suspense>
      <Tracker />
    </Suspense>
  );
}
