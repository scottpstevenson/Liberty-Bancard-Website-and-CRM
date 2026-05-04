import { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Column<T> {
  header: string;
  accessorKey?: keyof T & string;
  cell?: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
}

interface ResponsiveTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string | number;
  mobileCard?: (row: T) => ReactNode;
  testId?: string;
  onRowClick?: (row: T) => void;
}

function getCellValue<T>(row: T, key: keyof T & string): string {
  const value = row[key];
  if (value == null) return "—";
  return String(value);
}

export function ResponsiveTable<T>({
  data,
  columns,
  keyExtractor,
  mobileCard,
  testId,
  onRowClick,
}: ResponsiveTableProps<T>) {
  return (
    <>
      {mobileCard && (
        <div className="md:hidden space-y-3" data-testid={testId ? `${testId}-mobile` : undefined}>
          {data.map((row) => (
            <div
              key={keyExtractor(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer" : undefined}
              data-testid={testId ? `${testId}-card-${keyExtractor(row)}` : undefined}
            >
              {mobileCard(row)}
            </div>
          ))}
        </div>
      )}

      <div
        className={mobileCard ? "hidden md:block overflow-x-auto" : "overflow-x-auto"}
        data-testid={testId ? `${testId}-desktop` : undefined}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={String(col.header)}
                  className={`${col.className || ""} ${col.hideOnMobile && !mobileCard ? "hidden md:table-cell" : ""}`}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow
                key={keyExtractor(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
                data-testid={testId ? `${testId}-row-${keyExtractor(row)}` : undefined}
              >
                {columns.map((col) => (
                  <TableCell
                    key={String(col.header)}
                    className={`${col.className || ""} ${col.hideOnMobile && !mobileCard ? "hidden md:table-cell" : ""}`}
                  >
                    {col.cell
                      ? col.cell(row)
                      : col.accessorKey
                        ? getCellValue(row, col.accessorKey)
                        : "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
