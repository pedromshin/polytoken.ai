"use client";

import type { ICellEditorParams } from "ag-grid-community";
import * as React from "react";
import { format, isValid, parseISO } from "date-fns";

import { Calendar } from "../../calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";

/** Date cell editor using Calendar popover, opens immediately on mount (D-08) */
export const DateCellEditor = React.forwardRef<
  { getValue: () => string | null },
  ICellEditorParams
>((params, ref) => {
  const initialDate: Date | undefined = (() => {
    if (!params.value) return undefined;
    const d =
      typeof params.value === "string"
        ? parseISO(params.value)
        : new Date(params.value as string | number);
    return isValid(d) ? d : undefined;
  })();

  const [selected, setSelected] = React.useState<Date | undefined>(initialDate);
  const [open, setOpen] = React.useState(true);

  React.useImperativeHandle(ref, () => ({
    getValue: () => (selected ? format(selected, "yyyy-MM-dd") : null),
  }));

  const handleSelect = (date: Date | undefined) => {
    setSelected(date);
    setOpen(false);
    params.stopEditing();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="h-full w-full bg-transparent px-3 text-left text-sm"
          aria-label={String(params.colDef?.headerName ?? "Date")}
        >
          {selected ? (
            format(selected, "MMM d, yyyy")
          ) : (
            <span className="text-muted-foreground">Pick a date</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
});

DateCellEditor.displayName = "DateCellEditor";
