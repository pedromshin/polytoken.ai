"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import type { ChevronProps, DayButtonProps } from "react-day-picker";
import { DayPicker } from "react-day-picker";

import { cn } from "@polytoken/ui";

import { buttonVariants } from "./button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * v9 consolidates the v8 `IconLeft`/`IconRight` component slots into a
 * single `Chevron` slot (react-day-picker v9 migration — verified against
 * the installed 9.14.0 type declarations, not a cached v8-era assumption).
 * `orientation` tells us which direction to render.
 */
function CalendarChevron({ className, orientation, ...props }: ChevronProps) {
  if (orientation === "right") {
    return (
      <ChevronRightIcon className={cn("h-4 w-4", className)} {...props} />
    );
  }
  return <ChevronLeftIcon className={cn("h-4 w-4", className)} {...props} />;
}

/**
 * v9 splits the v8 combined "day" cell (which was simultaneously the grid
 * cell and the clickable button) into a `Day` grid cell (`<td>`, receives
 * `selected`/`today`/`outside`/`range_*` classNames automatically merged by
 * the library) and a separate `DayButton` (`<button>`, receives only its
 * static base classNames plus a `modifiers` prop). Styling the actual
 * visible highlight directly on the button — driven by the real `modifiers`
 * object DayButton receives as a prop, not by DOM `:has()`/`aria-selected`
 * tricks against the parent cell — is the v9-native approach and keeps the
 * v8 visual contract (selected = bg-primary, today = bg-accent, range
 * start/middle/end rounding, outside/disabled dimming) intact.
 */
function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: DayButtonProps) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  const isRangeSelected =
    modifiers.range_start || modifiers.range_end || modifiers.range_middle;

  return (
    <button
      ref={ref}
      data-day={day.isoDate}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "h-8 w-8 p-0 font-normal aria-selected:opacity-100",
        modifiers.today &&
          !modifiers.selected &&
          "bg-accent text-accent-foreground",
        modifiers.selected &&
          !modifiers.range_middle &&
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        modifiers.range_middle &&
          "rounded-none bg-accent text-accent-foreground",
        modifiers.range_start && "rounded-r-none",
        modifiers.range_end && "rounded-l-none",
        modifiers.outside &&
          (isRangeSelected || modifiers.selected
            ? "bg-accent/50 text-muted-foreground opacity-30"
            : "day-outside text-muted-foreground opacity-50"),
        modifiers.disabled && "text-muted-foreground opacity-50",
        modifiers.hidden && "invisible",
        className,
      )}
      {...props}
    />
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      navLayout="around"
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months:
          "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        // `month` is the shared positioned ancestor for the v9 "around"
        // nav-button layout (button_previous/button_next are rendered as
        // siblings of month_caption, not nested inside it — v8's `relative`
        // lived on `caption` instead, since v8 never split nav out of it).
        month: "relative space-y-4",
        month_caption: "flex justify-center pt-1 items-center",
        caption_label: "text-sm font-medium",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute left-1 top-1",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute right-1 top-1",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
        range_start: "day-range-start",
        range_end: "day-range-end",
        outside: "day-outside",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
