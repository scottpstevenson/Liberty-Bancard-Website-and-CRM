---
name: Tasks page crash — ResponsiveTable misuse
description: /dashboard/tasks crashed because ResponsiveTable was used as a children wrapper (it's a data-driven component, not a container).
---

`client/src/pages/dashboard/Tasks.tsx` wrapped the shadcn `<Table>` in `<ResponsiveTable>`. The `ResponsiveTable` component in `client/src/components/ui/responsive-table.tsx` expects `data` and `columns` props — it is NOT a wrapper/container. Passing `<Table>` as children caused an error boundary crash.

Fixed: replaced `<ResponsiveTable data-testid="tasks-table">` with `<div className="overflow-x-auto border rounded-md" data-testid="tasks-table">`.

**Why:** ResponsiveTable is a self-contained table renderer, not a layout wrapper. Any future use should pass `data` and `columns` props, not children.
