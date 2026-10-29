"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" variant="primary" size="lg" className="px-5" onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-4" />
      Print / Save as PDF
    </Button>
  );
}
