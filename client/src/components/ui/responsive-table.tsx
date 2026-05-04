import { ReactNode } from "react";

interface ResponsiveTableProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function ResponsiveTable({ children, className, "data-testid": testId }: ResponsiveTableProps) {
  return (
    <div
      className={`border rounded-lg overflow-x-auto ${className || ""}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
